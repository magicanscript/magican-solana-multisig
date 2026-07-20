'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useBalance, useSolTransfer, useWalletConnection } from '@solana/react-hooks';
import type { Address, Instruction, TransactionSigner } from '@solana/kit';
import { createWalletTransactionSigner } from '@solana/client';
import { getApproveInstruction, getExecuteTransactionInstructionAsync } from '@generated';
import { asAddress, lamportsToSol, shortAddress, solToLamports } from '@/lib/format';
import { READ_COMMITMENT } from '@/lib/solana';
import { useMultisig } from '@/hooks/useMultisig';
import { useProposals } from '@/hooks/useProposals';
import { deriveTransactionPda } from '@/lib/pdas';
import { appendRemaining, remainingFromProposal } from '@/lib/ix';
import { humanizeError } from '@/lib/errors';
import { countApprovals } from '@/lib/proposal-status';
import { useSubmitTx } from '@/lib/tx';
import type { ProposalView } from '@/lib/multisig';
import { WalletButton } from '@/components/WalletButton';
import { ProposalRow } from '@/components/ProposalRow';
import { CreateProposalForm } from '@/components/CreateProposalForm';
import { SimulateDialog } from '@/components/SimulateDialog';

const EMPTY_INDEX: Map<string, number> = new Map();

export default function MultisigPage() {
  const params = useParams<{ address: string }>();
  const address = asAddress(params.address);

  const { wallet } = useWalletConnection();
  const me = wallet?.account.address;

  const { data, signerPda, loading, error, refresh } = useMultisig(address);
  const proposals = useProposals(address);

  // The treasury is read reactively only. A one-shot read after funding showed the
  // old amount: a public RPC is a load balancer, and the node answering getBalance
  // may lag behind the one that confirmed the transfer. `watch` keeps a WebSocket
  // subscription on the treasury account, so the new amount arrives on its own,
  // without a "refresh the page".
  const treasury = useBalance(signerPda ?? undefined, {
    watch: true,
    commitment: READ_COMMITMENT,
  });
  const treasuryLamports = treasury.lamports ?? 0n;

  // A Transaction has no index field — the index lives only in the PDA seeds. We
  // rebuild the address→index mapping by deriving the PDA for 0..transactionCount.
  // The map is stored together with the key (address + counter) it was built for:
  // we never hand out a map belonging to another one, and no synchronous reset in
  // the effect is needed.
  const count = data ? Number(data.transactionCount) : 0;
  const mapKey = `${address}:${count}`;
  const [indexEntry, setIndexEntry] = useState<{ key: string; map: Map<string, number> }>({
    key: '',
    map: EMPTY_INDEX,
  });
  useEffect(() => {
    if (!count) return;
    let cancelled = false;
    void (async () => {
      // Derivation is local (SHA-256 in a loop over the bump), no RPC involved.
      const entries = await Promise.all(
        Array.from(
          { length: count },
          async (_, i) => [(await deriveTransactionPda(address, BigInt(i))).toString(), i] as const,
        ),
      );
      if (!cancelled) setIndexEntry({ key: `${address}:${count}`, map: new Map(entries) });
    })();
    return () => {
      cancelled = true;
    };
  }, [count, address]);
  const indexMap = indexEntry.key === mapKey ? indexEntry.map : EMPTY_INDEX;

  const solTransfer = useSolTransfer();
  const [fundAmount, setFundAmount] = useState('0.1');
  const [fundError, setFundError] = useState<string | null>(null);

  async function onFund() {
    setFundError(null);
    if (!signerPda) return;
    try {
      // A bigint is interpreted as lamports (1 SOL = 1e9).
      const lamports = solToLamports(fundAmount);
      if (lamports <= 0n) {
        setFundError('Enter an amount greater than 0');
        return;
      }
      // No manual treasury refresh needed: it is on a WebSocket subscription
      // (useBalance above).
      await solTransfer.send(
        { amount: lamports, destination: signerPda },
        { commitment: READ_COMMITMENT },
      );
    } catch (e) {
      setFundError(humanizeError(e));
    }
  }

  // Proposal actions (approve/execute) go through a single dialog: build the
  // instruction → dry run → sign. The signer instance is pinned in `pending` so that
  // simulate and send see exactly the same one (otherwise kit fails on two
  // instances).
  const submit = useSubmitTx();
  const [pending, setPending] = useState<{
    title: string;
    ix: Instruction;
    signer: TransactionSigner;
    // A predicate telling that the action's result is already visible in the list.
    // Without it a lagging node returns the previous mask and the approval looks
    // lost (see lib/rpc-lag).
    done: (items: ProposalView[]) => boolean;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function startAction(
    title: string,
    build: (signer: TransactionSigner) => Promise<Instruction>,
    done: (items: ProposalView[]) => boolean,
  ) {
    setActionError(null);
    if (!wallet) return;
    try {
      const signer = createWalletTransactionSigner(wallet).signer;
      const ix = await build(signer);
      setPending({ title, ix, signer, done });
      await submit.simulate([ix], signer);
    } catch (e) {
      setActionError(humanizeError(e));
    }
  }

  const find = (items: ProposalView[], target: ProposalView) =>
    items.find((x) => x.address === target.address);

  const onApprove = (view: ProposalView) =>
    void startAction(
      'Approve proposal',
      async (owner) => getApproveInstruction({ multisig: address, transaction: view.address, owner }),
      // A vote is a boolean mask: wait until there are more approvals than before.
      (items) => {
        const next = find(items, view);
        return next != null && countApprovals(next.data.signers) > countApprovals(view.data.signers);
      },
    );

  const onExecute = (view: ProposalView) =>
    void startAction(
      'Execute proposal',
      async () => {
        const execIx = await getExecuteTransactionInstructionAsync({
          multisig: address,
          transaction: view.address,
        });
        // The remaining accounts are rebuilt from what the proposal stores on-chain,
        // regardless of who created it and how (SOL or raw).
        return appendRemaining(
          execIx,
          remainingFromProposal({ programId: view.data.programId, accounts: view.data.accounts }),
        );
      },
      (items) => find(items, view)?.data.didExecute === true,
    );

  async function onConfirmAction() {
    if (!pending) return;
    const done = pending.done;
    try {
      await submit.run([pending.ix], pending.signer);
    } catch {
      // The dialog shows the error (sendError) — keep it open.
      return;
    }
    setPending(null);
    submit.reset();
    // The refresh is OUTSIDE the send try: its error would land in the catch, where
    // the dialog is already closed and sendError wiped, and would vanish silently.
    // refresh puts its own errors into proposals.error, and the list shows them
    // together with the "Retry" button.
    await proposals.refresh(done);
  }

  function onCancelAction() {
    setPending(null);
    submit.reset();
  }

  const msView = data ? { address, data } : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight text-black dark:text-white">
          Magican Multisig
        </Link>
        <WalletButton />
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href="/"
          className="text-sm text-zinc-500 transition-colors hover:text-indigo-600 dark:text-zinc-400"
        >
          ← Back to dashboard
        </Link>

        {loading && !data ? (
          <div className="mt-6 h-48 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        ) : error ? (
          <p className="mt-6 text-sm text-red-600 dark:text-red-400">{humanizeError(error)}</p>
        ) : !msView ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
            <p className="text-zinc-500 dark:text-zinc-400">No multisig found at this address.</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Refresh
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-mono text-lg font-semibold text-black dark:text-white">
                  {shortAddress(address, 6, 6)}
                </h1>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  {msView.data.threshold}-of-{msView.data.owners.length}
                </span>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Owners
                </p>
                <ul className="flex flex-col gap-1">
                  {(msView.data.owners as Address[]).map((owner) => (
                    <li key={owner} className="flex items-center gap-2">
                      <span className="font-mono text-sm text-zinc-600 dark:text-zinc-400">
                        {shortAddress(owner, 6, 6)}
                      </span>
                      {me && owner === me && (
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                          you
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* Treasury */}
            <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Treasury</p>
                  <p className="text-2xl font-bold text-black dark:text-white">
                    {lamportsToSol(treasuryLamports)} SOL
                  </p>
                  {signerPda && (
                    <p className="mt-1 font-mono text-xs text-zinc-400">
                      {shortAddress(signerPda, 6, 6)}
                    </p>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-500">Fund (SOL)</label>
                    <input
                      value={fundAmount}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        if (v === '' || /^\d*\.?\d*$/.test(v)) setFundAmount(v);
                      }}
                      // Editing the amount while sending would change a field that has
                      // nothing to do with the already signed transfer — misleading.
                      disabled={solTransfer.isSending}
                      spellCheck={false}
                      className="w-28 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={onFund}
                    disabled={!me || solTransfer.isSending}
                    title={me ? undefined : 'Connect your wallet'}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {solTransfer.isSending ? 'Sending…' : 'Fund'}
                  </button>
                </div>
              </div>
              {fundError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{fundError}</p>}
            </section>

            {/* Proposals */}
            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-black dark:text-white">Proposals</h2>
              </div>

              {wallet && signerPda && (
                <div className="mb-4">
                  <CreateProposalForm
                    multisig={address}
                    signerPda={signerPda}
                    treasuryLamports={treasuryLamports}
                    session={wallet}
                    onCreated={async () => {
                      // The multisig counter matters as much as the list: the row
                      // index (#0, #1…) is rebuilt by deriving PDAs from the counter.
                      const want = proposals.data.length + 1;
                      await Promise.all([
                        refresh((m) => Number(m.transactionCount) >= want),
                        proposals.refresh((items) => items.length >= want),
                      ]);
                    }}
                  />
                </div>
              )}

              {actionError && (
                <p className="mb-3 text-sm text-red-600 dark:text-red-400">{actionError}</p>
              )}

              {proposals.loading ? (
                <div className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
              ) : proposals.error ? (
                // "No proposals" and "the list failed to load" are different things:
                // silently passing the latter off as the former would hide a proposal
                // that is waiting for a signature.
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-red-300 py-12 text-center dark:border-red-900">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {humanizeError(proposals.error)}
                  </p>
                  <button
                    type="button"
                    onClick={() => void proposals.refresh()}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Retry
                  </button>
                </div>
              ) : proposals.data.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 py-12 text-center text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  No proposals yet.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {proposals.data.map((view) => (
                    <ProposalRow
                      key={view.address}
                      view={view}
                      ms={msView}
                      index={indexMap.get(view.address.toString())}
                      me={me}
                      signerPda={signerPda ?? undefined}
                      // While one action is in flight a second must not start:
                      // startAction overwrites pending and resets the dry run — what
                      // gets signed would not be what the dialog shows.
                      busy={pending != null || submit.sending}
                      onApprove={onApprove}
                      onExecute={onExecute}
                    />
                  ))}
                </div>
              )}
            </section>

            <SimulateDialog
              open={pending != null}
              title={pending?.title ?? ''}
              sim={submit.sim}
              sending={submit.sending}
              sendError={submit.sendError}
              onConfirm={onConfirmAction}
              onCancel={onCancelAction}
            />
          </>
        )}
      </main>
    </div>
  );
}
