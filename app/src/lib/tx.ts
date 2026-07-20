'use client';

import { useCallback, useRef, useState } from 'react';
import type { Instruction, TransactionSigner } from '@solana/kit';
import { useSendTransaction, useSimulateTransaction, useSolanaClient } from '@solana/react-hooks';
import { transactionToBase64 } from '@solana/client';
import { simulationFailure } from './errors';
import { READ_COMMITMENT } from './solana';

/** A dry-run summary for the UI: logs, the error (from prepare or from the simulation), flags. */
export type SimState = {
  logs: readonly string[];
  error: unknown;
  loading: boolean;
  /** The compute units consumed (if RPC reported them). */
  units: bigint | null;
  /** The simulation finished successfully — it can be sent. */
  ok: boolean;
  /** A dry run was requested (there is a payload or a preparation error). */
  ready: boolean;
};

/**
 * The sending wrapper for the forms. Split into two phases:
 *  1. `simulate(ix, authority)` — assembles the message through framework-kit (`prepare`,
 *     feePayer = `authority`) and serializes it to base64 **without a signature/popup**; the
 *     reactive `useSimulateTransaction` runs it on RPC and fills `sim`.
 *  2. `run(ix, authority)` — the real send (`send`, the wallet signs).
 *
 * `authority` is the single wallet `TransactionSigner` (`createWalletTransactionSigner(session).signer`).
 * The very same instance must also be used as the `creator` inside the instruction: kit throws if two
 * DIFFERENT signer instances arrive for one address. That is why the caller creates it and passes it here.
 *
 * We don't build the message by hand and don't call `rpc.simulateTransaction` manually — the simulation
 * is already built into framework-kit, and `send()` simulates on its own too.
 */
export function useSubmitTx() {
  const client = useSolanaClient();
  const {
    send,
    isSending,
    signature,
    error: sendError,
    reset: resetSend,
  } = useSendTransaction();

  const [base64, setBase64] = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState<unknown>(null);

  // `prepare` goes to the network for a blockhash, and its answer arrives whenever it arrives.
  // Without a generation counter, the answer of a CANCELLED run was written into the state on top
  // of a new action: the dialog showed "succeeded" and the logs of someone else's transaction,
  // while the current one was being signed. The generation cuts off everything that went stale.
  const gen = useRef(0);
  const inflight = useRef<AbortController | null>(null);

  // encoding is mandatory: the hook doesn't set it itself, and RPC expects base58 by default.
  const query = useSimulateTransaction(base64, { config: { encoding: 'base64' } });

  const simulate = useCallback(
    async (instructions: readonly Instruction[], authority: TransactionSigner) => {
      const mine = ++gen.current;
      inflight.current?.abort();
      const ac = new AbortController();
      inflight.current = ac;
      setPrepareError(null);
      setBase64(null);
      try {
        const prepared = await client.transaction.prepare({
          instructions,
          authority,
          abortSignal: ac.signal,
        });
        if (mine !== gen.current) return; // the run was cancelled or the next one started
        // prepared.message is compiled but NOT signed — there is no wallet popup.
        setBase64(transactionToBase64(prepared.message));
      } catch (e) {
        if (mine !== gen.current) return;
        setPrepareError(e);
      }
    },
    [client],
  );

  const run = useCallback(
    (instructions: readonly Instruction[], authority: TransactionSigner) =>
      // We wait for confirmation at the same level we read at: otherwise a redirect/refresh
      // right after sending would read a state where the transaction is not there yet.
      send({ instructions, authority }, { commitment: READ_COMMITMENT }),
    [send],
  );

  const reset = useCallback(() => {
    // We advance the generation here too: reset clears the state but does not stop a prepare
    // already in flight — without this it would "resurrect" the cancelled run.
    gen.current++;
    inflight.current?.abort();
    inflight.current = null;
    setBase64(null);
    setPrepareError(null);
    resetSend();
  }, [resetSend]);

  // A successful RPC response ≠ a successful transaction: an execution failure arrives in
  // value.err, while query.error stays empty. Without this check the dry run would say
  // "ready to send" exactly when the transaction is doomed.
  const value = query.data?.value;
  const simFailure = value?.err != null ? simulationFailure(value.err, query.logs) : null;

  const sim: SimState = {
    logs: query.logs,
    error: prepareError ?? query.error ?? simFailure,
    loading: query.isLoading,
    units: value?.unitsConsumed ?? null,
    ok:
      base64 != null &&
      prepareError == null &&
      query.error == null &&
      simFailure == null &&
      query.isSuccess,
    ready: base64 != null || prepareError != null,
  };

  return { simulate, run, sim, sending: isSending, sendError, signature, reset };
}
