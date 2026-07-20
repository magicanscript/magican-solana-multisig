'use client';

import { useEffect, useRef } from 'react';
import type { SimState } from '@/lib/tx';
import { humanizeError } from '@/lib/errors';

/**
 * A dry run before signing: what the transaction will do, how many CU it eats and
 * how it fails. The sign button is enabled only on a successful simulation — we
 * don't let anyone sign a transaction that is already doomed.
 *
 * A native `<dialog>` opened via `showModal()`, not a div with `fixed inset-0`: a
 * backdrop only intercepts the mouse, while from the keyboard the whole background
 * stays in the tab order. Tabbing out from under the modal opened a second identical
 * dialog on top of the first, pressed "Fund" (a second wallet popup) and "Disconnect" —
 * and disconnecting the wallet unmounts the form, so the outcome of an already signed
 * transaction is lost without a trace. `showModal()` makes the rest of the document
 * inert per the spec — in one move and without a hand-rolled focus trap, and
 * `aria-modal` stops being an empty promise.
 */
export function SimulateDialog({
  open,
  title,
  sim,
  sending,
  sendError,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  sim: SimState;
  sending: boolean;
  sendError: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // showModal() on an already open dialog throws InvalidStateError — so we check first.
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (!open) return null;

  const error = sim.error ?? sendError;

  return (
    <dialog
      ref={ref}
      aria-label={title}
      // Escape closes the dialog on its own; while sending there is nothing to close —
      // the transaction is already signed and in flight, and closing would hide its outcome.
      onCancel={(e) => {
        e.preventDefault();
        if (!sending) onCancel();
      }}
      onClick={(e) => {
        // A click outside the card = a click on the <dialog> itself (the card inside stops propagation).
        if (e.target === e.currentTarget && !sending) onCancel();
      }}
      className="m-auto w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <div onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-black dark:text-white">{title}</h2>

        <div className="mt-4">
          {/* While the simulation has produced neither success nor error the run is still
              going: SWR has an intermediate idle frame on which the dialog body would
              otherwise stand empty. */}
          {sim.loading || !sim.ready || (!error && !sim.ok) ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Simulating…</p>
          ) : error ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {humanizeError(error)}
            </pre>
          ) : sim.ok ? (
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              ✓ Simulation succeeded
              {sim.units != null && (
                <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                  {sim.units.toString()} CU
                </span>
              )}
            </p>
          ) : null}

          {sending && (
            // We wait for confirmation until the blockhash expires — that is up to a
            // minute and a half of a frozen screen. We say plainly that it is intended.
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Waiting for network confirmation — this may take up to a minute. Don&apos;t close the tab.
            </p>
          )}

          {sim.logs.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
                Program logs ({sim.logs.length})
              </summary>
              <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-zinc-50 p-3 font-mono text-xs text-zinc-600 dark:bg-black dark:text-zinc-400">
                {sim.logs.join('\n')}
              </pre>
            </details>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!sim.ok || sending}
            title={sim.ok ? undefined : 'Available only after a successful simulation'}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Sign'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
