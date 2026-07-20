'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { address, isAddress, type Address, type Instruction, type TransactionSigner } from '@solana/kit';
import { createWalletTransactionSigner, type WalletSession } from '@solana/client';
import { getCreateMultisigInstructionAsync } from '@generated';
import { deriveMultisigPda } from '@/lib/pdas';
import { humanizeError } from '@/lib/errors';
import { MAX_OWNERS } from '@/lib/limits';
import { shortAddress } from '@/lib/format';
import { useSubmitTx } from '@/lib/tx';

type Built = { ix: Instruction; pda: Address; signer: TransactionSigner };

/** Seed is a u64 in the PDA seeds; anything larger the instruction encoder won't take. */
const MAX_U64 = 18_446_744_073_709_551_615n;

/** Client-side validation before building the instruction — so we never ship data we know is broken. */
function validate(owners: string[], threshold: number): string | null {
  const trimmed = owners.map((o) => o.trim());
  if (trimmed.some((o) => o.length === 0)) return 'Fill in every owner address';
  const bad = trimmed.find((o) => !isAddress(o));
  if (bad) return `Invalid address: ${shortAddress(bad, 6, 6)}`;
  if (new Set(trimmed).size !== trimmed.length) return 'The list contains a duplicate owner';
  if (trimmed.length > MAX_OWNERS) return `Too many owners (maximum ${MAX_OWNERS})`;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > trimmed.length)
    return `Threshold must be between 1 and ${trimmed.length}`;
  return null;
}

/**
 * The create-multisig form. Owner #1 is the connected wallet (the creator, who is also
 * the fee payer and the only signer). Flow: fill in → "Simulate" (a dry run with no
 * popup) → "Create" (wallet popup, send) → redirect to the multisig page.
 */
export function CreateMultisigForm({ session }: { session: WalletSession }) {
  const router = useRouter();
  const submit = useSubmitTx();
  const creator = session.account.address;

  const [owners, setOwners] = useState<string[]>(() => [creator, '']);
  const [threshold, setThreshold] = useState(2);
  // The seed is fixed once: it goes into the PDA, so it must not change between simulate and create.
  const [seed, setSeed] = useState<bigint>(() => BigInt(Date.now()));

  const [built, setBuilt] = useState<Built | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const clientError = useMemo(() => validate(owners, threshold), [owners, threshold]);

  // Any change to the inputs invalidates the previously built/simulated transaction.
  const invalidate = () => {
    if (built) {
      setBuilt(null);
      submit.reset();
    }
    setFormError(null);
  };

  const setOwner = (i: number, value: string) => {
    setOwners((prev) => prev.map((o, idx) => (idx === i ? value : o)));
    invalidate();
  };
  const addOwner = () => {
    if (owners.length >= MAX_OWNERS) return;
    setOwners((prev) => [...prev, '']);
    invalidate();
  };
  const removeOwner = (i: number) => {
    setOwners((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      // The threshold cannot exceed the number of owners: without clamping, the form
      // silently got stuck on "threshold must be between 1 and N" after a removal.
      setThreshold((t) => Math.min(t, next.length));
      return next;
    });
    invalidate();
  };

  async function onCheck() {
    setFormError(null);
    const err = validate(owners, threshold);
    if (err) {
      setFormError(err);
      return;
    }
    try {
      // A single signer instance for the whole cycle (build -> simulate -> send): both as
      // the creator inside the instruction and as the sending authority. Two different
      // instances for the same address make kit throw.
      const signer = createWalletTransactionSigner(session).signer;
      const ownerAddrs = owners.map((o) => address(o.trim()));
      const ix = await getCreateMultisigInstructionAsync({
        creator: signer,
        owners: ownerAddrs,
        threshold,
        seed,
      });
      const pda = await deriveMultisigPda(creator, seed);
      setBuilt({ ix, pda, signer });
      await submit.simulate([ix], signer);
    } catch (e) {
      setFormError(humanizeError(e));
    }
  }

  // Between "the transaction confirmed" and "the page changed" there is a window: sending
  // is already false while built and sim.ok are not cleared yet — the button came back to
  // life, and a second click sent the same instruction with the same seed, getting
  // "account already in use". We keep the lock until we navigate away.
  const [leaving, setLeaving] = useState(false);

  async function onCreate() {
    if (!built) return;
    try {
      await submit.run([built.ix], built.signer);
      setLeaving(true);
      router.push(`/m/${built.pda}`);
    } catch {
      // the error is shown by submit.sendError below
    }
  }

  const { sim, sending, sendError } = submit;
  const busy = sim.loading || sending || leaving;

  return (
    <div className="flex flex-col gap-6">
      {/* While the transaction is in flight the fields are locked: any edit calls
          invalidate(), which kills the dry run and wipes sendError — the form would show
          "Simulate" and an empty error area on top of an already signed send.
          `contents` keeps the fieldset out of the layout. */}
      <fieldset disabled={sending || leaving} className="contents">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Owners ({owners.length}/{MAX_OWNERS})
          </label>
          <button
            type="button"
            onClick={addOwner}
            disabled={owners.length >= MAX_OWNERS}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            + Add owner
          </button>
        </div>

        {owners.map((owner, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={owner}
              onChange={(e) => setOwner(i, e.target.value)}
              readOnly={i === 0}
              spellCheck={false}
              placeholder="Owner address (base58)"
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 read-only:bg-zinc-100 read-only:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:read-only:bg-zinc-800"
            />
            {i === 0 ? (
              <span className="shrink-0 rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                you
              </span>
            ) : (
              <button
                type="button"
                onClick={() => removeOwner(i)}
                className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-2 text-xs text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:border-zinc-700 dark:hover:bg-red-950"
                aria-label="Remove owner"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </section>

      <section className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Threshold (M of {owners.length})
          </label>
          <input
            type="number"
            min={1}
            max={owners.length}
            value={threshold}
            onChange={(e) => {
              setThreshold(Number(e.target.value));
              invalidate();
            }}
            className="w-24 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Seed</label>
          <input
            value={seed.toString()}
            onChange={(e) => {
              const v = e.target.value.trim();
              // The seed goes into the u64 encoder: without a bound it threw the codec's
              // raw message instead of a clear refusal. Extra digits are simply not accepted.
              if (v === '' || (/^\d+$/.test(v) && BigInt(v) <= MAX_U64)) {
                setSeed(v === '' ? 0n : BigInt(v));
                invalidate();
              }
            }}
            spellCheck={false}
            className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
      </section>

      {clientError && !formError && (
        <p className="text-sm text-amber-600 dark:text-amber-500">{clientError}</p>
      )}
      {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}

      {sim.ready && (
        <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
          <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Dry run
          </h3>
          {sim.loading ? (
            <p className="text-sm text-zinc-500">Simulating…</p>
          ) : sim.error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{humanizeError(sim.error)}</p>
          ) : sim.ok ? (
            <>
              <p className="mb-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                ✓ Simulation succeeded — ready to create
              </p>
              {sim.logs.length > 0 && (
                <pre className="max-h-40 overflow-auto rounded bg-zinc-100 p-2 text-xs text-zinc-600 dark:bg-black dark:text-zinc-400">
                  {sim.logs.join('\n')}
                </pre>
              )}
            </>
          ) : null}
        </section>
      )}

      {sendError != null && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {humanizeError(sendError)}
        </pre>
      )}

      <div className="flex items-center gap-3">
        {sim.ok && built ? (
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? 'Sending…' : 'Create multisig'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onCheck}
            disabled={busy || clientError != null}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sim.loading ? 'Simulating…' : 'Simulate'}
          </button>
        )}
      </div>
      </fieldset>
    </div>
  );
}
