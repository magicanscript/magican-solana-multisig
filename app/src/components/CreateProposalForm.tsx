'use client';

import { useMemo, useState } from 'react';
import { address, isAddress, type Address, type Instruction, type TransactionSigner } from '@solana/kit';
import { createWalletTransactionSigner, type WalletSession } from '@solana/client';
import { fetchMaybeMultisig, getCreateTransactionInstruction } from '@generated';
import {
  buildRawNested,
  buildSolTransfer,
  checkRecipientRent,
  checkTreasuryRemainder,
  maxTransferLamports,
  SYSTEM_PROGRAM,
  type AmountIssue,
  type ProposalAccount,
} from '@/lib/ix';
import { MAX_TX_ACCOUNTS, MAX_TX_DATA } from '@/lib/limits';
import { deriveTransactionPda } from '@/lib/pdas';
import { humanizeError } from '@/lib/errors';
import { lamportsToSol, shortAddress, solToLamports } from '@/lib/format';
import { getRpc, READ_COMMITMENT } from '@/lib/solana';
import { useSubmitTx } from '@/lib/tx';
import { SimulateDialog } from './SimulateDialog';

type Built = { ix: Instruction; signer: TransactionSigner };

type Mode = 'sol' | 'raw';
/** A row of the accounts table in raw mode: the address is still a string, the flags are already booleans. */
type RawAccount = { pubkey: string; isSigner: boolean; isWritable: boolean };

const EMPTY_ACCOUNT: RawAccount = { pubkey: '', isSigner: false, isWritable: false };

/** Validation before building the instruction. The amount is parsed exactly: string -> lamports, no floats. */
function validate(recipient: string, amount: string): string | null {
  const to = recipient.trim();
  if (!to) return 'Enter the recipient address';
  if (!isAddress(to)) return `Invalid address: ${shortAddress(to, 6, 6)}`;
  let lamports: bigint;
  try {
    lamports = solToLamports(amount);
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid amount';
  }
  if (lamports <= 0n) return 'Amount must be greater than 0';
  return null;
}

/**
 * Validation for raw mode. The rules for the nested instruction (a foreign signer,
 * the limits, base64 integrity) live in `buildRawNested` — here we only lift the
 * addresses to their type and surface the reason it refused. Building is pure and
 * cheap, so we run it on every keystroke: the button goes dark right away instead
 * of after a click.
 */
function validateRaw(
  signerPda: Address,
  programId: string,
  accounts: RawAccount[],
  dataBase64: string,
): string | null {
  const pid = programId.trim();
  if (!pid) return 'Enter the instruction program id';
  if (!isAddress(pid)) return `Invalid program id: ${shortAddress(pid, 6, 6)}`;

  const parsed: ProposalAccount[] = [];
  for (const [i, a] of accounts.entries()) {
    const key = a.pubkey.trim();
    if (!key) return `Fill in the address of account #${i + 1}`;
    if (!isAddress(key)) return `Invalid address for account #${i + 1}: ${shortAddress(key, 6, 6)}`;
    parsed.push({ pubkey: address(key), isSigner: a.isSigner, isWritable: a.isWritable });
  }

  try {
    buildRawNested({ programId: address(pid), signerPda, accounts: parsed, dataBase64 });
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid instruction';
  }
  return null;
}

/** Human-readable text for a rent rule violation (the rules live in lib/ix.ts). */
function issueText(issue: AmountIssue): string {
  return issue.kind === 'remainder'
    ? `You can't withdraw that much: the treasury would be left with a non-rent-exempt remainder. Withdraw at most ${lamportsToSol(issue.safeMax, 9)} SOL, or the entire balance.`
    : `The recipient wouldn't have enough for account rent: at least ${lamportsToSol(issue.needed, 9)} SOL is required, otherwise the transfer will be rejected on execution.`;
}

/**
 * A new proposal: a SOL transfer out of the multisig treasury. Creating a proposal is
 * not yet the transfer: the approvals are collected later, so an insufficient treasury
 * balance is shown as a warning, not a block (the treasury can be funded before execute).
 *
 * Rent rule violations, on the other hand, are exactly a block: such a proposal would
 * collect approvals and still fail on execute, with no way to take it back (the program
 * has no cancel).
 */
export function CreateProposalForm({
  multisig,
  signerPda,
  treasuryLamports,
  session,
  onCreated,
}: {
  multisig: Address;
  signerPda: Address;
  treasuryLamports: bigint;
  session: WalletSession;
  onCreated: () => void | Promise<void>;
}) {
  const submit = useSubmitTx();

  const [mode, setMode] = useState<Mode>('sol');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [rawProgramId, setRawProgramId] = useState('');
  const [rawAccounts, setRawAccounts] = useState<RawAccount[]>([]);
  const [rawData, setRawData] = useState('');
  const [built, setBuilt] = useState<Built | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const solError = useMemo(() => validate(recipient, amount), [recipient, amount]);
  const rawError = useMemo(
    () => validateRaw(signerPda, rawProgramId, rawAccounts, rawData),
    [signerPda, rawProgramId, rawAccounts, rawData],
  );
  const clientError = mode === 'sol' ? solError : rawError;
  // The check makes three network round trips (the multisig counter plus two balances)
  // BEFORE `built` appears — for all that time the button stayed alive, and a second click
  // fired a second volley of requests and flashed the dialog.
  const [checking, setChecking] = useState(false);
  // The dialog is open (or a transaction is in flight) — the form is locked: it is wrapped in a fieldset below.
  const locked = built != null || submit.sending || checking;
  // Everything down to zero can be withdrawn — the runtime allows it (the treasury account is deleted).
  const available = maxTransferLamports(treasuryLamports);

  // An amount above the balance is not an error: the proposal lives until execute, and by
  // then the treasury may be funded. But we must warn, otherwise execute fails silently.
  const overBalance = useMemo(() => {
    if (solError) return false;
    try {
      return solToLamports(amount) > treasuryLamports;
    } catch {
      return false;
    }
  }, [amount, treasuryLamports, solError]);

  const invalidate = () => {
    if (built) {
      setBuilt(null);
      submit.reset();
    }
    setFormError(null);
  };

  async function onCheck() {
    setFormError(null);
    if (clientError) {
      setFormError(clientError);
      return;
    }
    setChecking(true);
    try {
      // A single signer instance for the whole build -> simulate -> send cycle: it is both
      // the proposer inside the instruction and the sending authority (two instances for one
      // address make kit throw).
      const signer = createWalletTransactionSigner(session).signer;
      const rpc = getRpc();

      // We re-read the counter instead of using the page snapshot: the index goes into the
      // PDA seeds, and if someone else created a proposal first, our PDA is already the wrong
      // one (Anchor 2006).
      const fresh = await fetchMaybeMultisig(rpc, multisig, { commitment: READ_COMMITMENT });
      if (!fresh.exists) {
        setFormError('Multisig not found — refresh the page');
        return;
      }

      let programId: Address;
      let proposalAccounts: ProposalAccount[];
      let data: Uint8Array;

      if (mode === 'sol') {
        const to = address(recipient.trim());
        const lamports = solToLamports(amount);

        // Rent rules: both sides of the transfer. A violation here means a proposal that
        // will reach quorum and still fail on execute, forever (the program has no cancel).
        const [treasuryNow, recipientNow] = await Promise.all([
          rpc.getBalance(signerPda, { commitment: READ_COMMITMENT }).send(),
          rpc.getBalance(to, { commitment: READ_COMMITMENT }).send(),
        ]);
        const issue =
          checkTreasuryRemainder(treasuryNow.value, lamports) ??
          checkRecipientRent(recipientNow.value, lamports);
        if (issue) {
          setFormError(issueText(issue));
          return;
        }

        programId = SYSTEM_PROGRAM;
        ({ proposalAccounts, data } = buildSolTransfer(signerPda, to, lamports));
      } else {
        // Rent rules can't be checked here: the client has no idea what an arbitrary
        // instruction will do. We say so plainly in the hint below the form.
        const raw = buildRawNested({
          programId: address(rawProgramId.trim()),
          signerPda,
          accounts: rawAccounts.map((a) => ({
            pubkey: address(a.pubkey.trim()),
            isSigner: a.isSigner,
            isWritable: a.isWritable,
          })),
          dataBase64: rawData,
        });
        programId = raw.programId;
        proposalAccounts = raw.proposalAccounts;
        data = raw.data;
      }

      const txPda = await deriveTransactionPda(multisig, fresh.data.transactionCount);
      const ix = getCreateTransactionInstruction({
        multisig,
        transaction: txPda,
        proposer: signer,
        programId,
        accounts: proposalAccounts,
        data,
      });
      setBuilt({ ix, signer });
      await submit.simulate([ix], signer);
    } catch (e) {
      setFormError(humanizeError(e));
    } finally {
      setChecking(false);
    }
  }

  async function onConfirm() {
    if (!built) return;
    try {
      await submit.run([built.ix], built.signer);
    } catch {
      // The send error is shown by the dialog (sendError) — we keep the modal open.
      return;
    }
    // Only after success: close the dialog, clear the form and refresh the list.
    // `onCreated` is deliberately OUTSIDE the try — otherwise its error would land in the
    // same catch, where the dialog is already closed and sendError wiped, and it would
    // vanish without a trace.
    setBuilt(null);
    submit.reset();
    setRecipient('');
    setAmount('');
    setRawProgramId('');
    setRawAccounts([]);
    setRawData('');
    try {
      await onCreated();
    } catch (e) {
      setFormError(humanizeError(e));
    }
  }

  function onCancel() {
    setBuilt(null);
    submit.reset();
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {/* While the dialog is open the whole form is locked. The modal covers it only
          visually — from the keyboard the fields stay reachable, and any edit calls
          invalidate(): the dry run would be reset underneath an already submitted signature.
          `contents` keeps the fieldset out of the layout. */}
      <fieldset disabled={locked} className="contents">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">New proposal</p>
        <div
          role="tablist"
          aria-label="Proposal type"
          className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800"
        >
          {(
            [
              ['sol', 'SOL transfer'],
              ['raw', 'Raw'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => {
                setMode(value);
                invalidate();
              }}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                mode === value
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'sol' ? (
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs text-zinc-500">Recipient</label>
          <input
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              invalidate();
            }}
            placeholder="Recipient address"
            spellCheck={false}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Amount (SOL)</label>
          <div className="flex items-center gap-1">
            <input
              value={amount}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (v === '' || /^\d*\.?\d*$/.test(v)) {
                  setAmount(v);
                  invalidate();
                }
              }}
              placeholder="0.0"
              spellCheck={false}
              className="w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={() => {
                // Full precision (9 decimals): what the field shows must parse back into the
                // same lamports, otherwise "MAX" would send something other than what is seen.
                setAmount(lamportsToSol(available, 9));
                invalidate();
              }}
              disabled={available === 0n}
              title="The entire treasury balance (the runtime allows a full withdrawal)"
              className="rounded-lg border border-zinc-300 px-2 py-2 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              MAX
            </button>
          </div>
        </div>
      </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Instruction program id</label>
            <input
              value={rawProgramId}
              onChange={(e) => {
                setRawProgramId(e.target.value);
                invalidate();
              }}
              placeholder="Program address"
              spellCheck={false}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs text-zinc-500">
                Accounts ({rawAccounts.length} of {MAX_TX_ACCOUNTS})
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    // This row is the whole reason raw mode exists: the program can only
                    // sign the nested instruction on behalf of its own treasury.
                    setRawAccounts((prev) => [
                      ...prev,
                      { pubkey: signerPda, isSigner: true, isWritable: true },
                    ]);
                    invalidate();
                  }}
                  disabled={rawAccounts.length >= MAX_TX_ACCOUNTS}
                  title="The multisig treasury as a signer of the nested instruction"
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  + Treasury
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRawAccounts((prev) => [...prev, EMPTY_ACCOUNT]);
                    invalidate();
                  }}
                  disabled={rawAccounts.length >= MAX_TX_ACCOUNTS}
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  + Account
                </button>
              </div>
            </div>

            {rawAccounts.length === 0 ? (
              <p className="text-xs text-zinc-400">
                No accounts — some instructions need none.
              </p>
            ) : (
              rawAccounts.map((acc, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    value={acc.pubkey}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRawAccounts((prev) =>
                        prev.map((a, j) => (j === i ? { ...a, pubkey: v } : a)),
                      );
                      invalidate();
                    }}
                    placeholder={`Account #${i + 1} address`}
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                  {(
                    [
                      ['isSigner', 'signer'],
                      ['isWritable', 'writable'],
                    ] as const
                  ).map(([flag, label]) => (
                    <label
                      key={flag}
                      className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400"
                    >
                      <input
                        type="checkbox"
                        checked={acc[flag]}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setRawAccounts((prev) =>
                            prev.map((a, j) => (j === i ? { ...a, [flag]: v } : a)),
                          );
                          invalidate();
                        }}
                      />
                      {label}
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setRawAccounts((prev) => prev.filter((_, j) => j !== i));
                      invalidate();
                    }}
                    aria-label={`Remove account #${i + 1}`}
                    className="rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">
              Instruction data, base64 (up to {MAX_TX_DATA} bytes)
            </label>
            <textarea
              value={rawData}
              onChange={(e) => {
                setRawData(e.target.value);
                invalidate();
              }}
              rows={3}
              placeholder="Empty — if the instruction takes no data"
              spellCheck={false}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            When executing a proposal, the program signs the nested instruction only on behalf
            of the multisig treasury ({shortAddress(signerPda, 6, 6)}) — any other signer makes the
            proposal impossible to execute, so we never create one. The dry run checks the creation
            of the proposal, not its future execution: the client cannot know what an arbitrary
            instruction will do.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          In the treasury: {lamportsToSol(available, 9)} SOL
        </p>
        <button
          type="button"
          onClick={onCheck}
          disabled={clientError != null || submit.sim.loading}
          title={clientError ?? undefined}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Simulate
        </button>
      </div>

      {mode === 'sol' && overBalance && (
        <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
          The treasury currently holds less — the proposal can be created, but it will only be
          executable after it is funded.
        </p>
      )}
      {formError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{formError}</p>}
      </fieldset>

      <SimulateDialog
        open={built != null}
        title="Create proposal"
        sim={submit.sim}
        sending={submit.sending}
        sendError={submit.sendError}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
}
