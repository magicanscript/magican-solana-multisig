'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from '@solana/kit';
import { fetchMaybeMultisig, type Multisig } from '@generated';
import { getRpc, READ_COMMITMENT } from '@/lib/solana';
import { deriveSignerPda } from '@/lib/pdas';
import { RPC_LAG_DELAY_MS, RPC_LAG_RETRIES, sleep } from '@/lib/rpc-lag';

type Entry = {
  key?: Address;
  data: Multisig | null;
  signerPda: Address | null;
};
const EMPTY: Entry = { data: null, signerPda: null };

/**
 * A single multisig by address: its rules (`data`) and the treasury-PDA address.
 *
 * The hook does NOT expose the treasury balance: a one-shot `getBalance` after
 * funding lies — a public RPC behind a load balancer answers from a node that has
 * not yet caught up with a confirmation seen by another one. The balance is read
 * reactively, via `useBalance(…, {watch})` on top of a WebSocket subscription (see
 * the multisig page).
 *
 * Everything is bound to the address it was fetched for. Otherwise, navigating
 * between multisigs would render ANOTHER multisig's treasury under the new
 * heading — and "Fund" would go to the previous treasury PDA. `loading` is
 * derived, so the effect never resets anything synchronously.
 */
export function useMultisig(address: Address | undefined) {
  const [entry, setEntry] = useState<Entry>(EMPTY);
  const [failure, setFailure] = useState<{ key?: Address; error: unknown } | null>(null);
  // Responses arrive in arbitrary order — a stale one must not overwrite a fresh one.
  const gen = useRef(0);

  const refresh = useCallback(async (until?: (data: Multisig) => boolean) => {
    const mine = ++gen.current;
    if (!address) return;
    try {
      const rpc = getRpc();
      const read = () => fetchMaybeMultisig(rpc, address, { commitment: READ_COMMITMENT });
      // "Not found" right after creation usually means a lagging node, not absence;
      // the same goes for data lagging behind a write we just sent (see rpc-lag).
      const stale = (a: Awaited<ReturnType<typeof read>>) =>
        !a.exists || (until != null && !until(a.data));
      let acc = await read();
      for (let i = 0; stale(acc) && i < RPC_LAG_RETRIES; i++) {
        await sleep(RPC_LAG_DELAY_MS);
        if (mine !== gen.current) return;
        acc = await read();
      }
      if (mine !== gen.current) return;
      if (!acc.exists) {
        setFailure(null);
        setEntry({ key: address, ...EMPTY });
        return;
      }
      const pda = await deriveSignerPda(address);
      if (mine !== gen.current) return;
      setFailure(null);
      setEntry({ key: address, data: acc.data, signerPda: pda });
    } catch (e) {
      if (mine !== gen.current) return;
      setFailure({ key: address, error: e });
    }
  }, [address]);

  useEffect(() => {
    // The lint rule treats the refresh() call as a synchronous setState and does not
    // look past the awaits inside it. Verified: every setState here comes AFTER an
    // await, so the cascading render the rule guards against cannot happen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const error = failure && failure.key === address ? failure.error : null;
  const fresh = entry.key === address;
  const current = fresh ? entry : EMPTY;
  return {
    data: current.data,
    signerPda: current.signerPda,
    loading: address != null && !fresh && error == null,
    error,
    refresh,
  };
}
