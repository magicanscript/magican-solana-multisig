'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from '@solana/kit';
import { fetchProposals, type ProposalView } from '@/lib/multisig';
import { RPC_LAG_DELAY_MS, RPC_LAG_RETRIES, sleep } from '@/lib/rpc-lag';

const EMPTY: ProposalView[] = [];

/**
 * Proposals (Transaction PDAs) of a particular multisig.
 * Call `refresh` after approve/execute to pull in the new approval masks. It accepts
 * an `until` predicate — a sign that the write is already visible (a new proposal in
 * the list, a grown mask): while the sign is absent we read again, otherwise a
 * lagging node returns the previous list and the vote looks lost.
 *
 * State is bound to the address it was fetched for: a list belonging to another
 * address is never handed out, and `loading` is derived ("there is no data for the
 * current address yet"), so the effect needs no synchronous reset. Side benefit: a
 * manual `refresh()` after approve does not flash the skeleton.
 */
export function useProposals(address: Address | undefined) {
  const [entry, setEntry] = useState<{ key?: Address; items: ProposalView[] }>({ items: EMPTY });
  const [failure, setFailure] = useState<{ key?: Address; error: unknown } | null>(null);
  // Responses arrive in arbitrary order — a stale one must not overwrite a fresh one.
  const gen = useRef(0);

  const refresh = useCallback(async (until?: (items: ProposalView[]) => boolean) => {
    const mine = ++gen.current;
    if (!address) return;
    try {
      let items = await fetchProposals(address);
      for (let i = 0; until && !until(items) && i < RPC_LAG_RETRIES; i++) {
        await sleep(RPC_LAG_DELAY_MS);
        if (mine !== gen.current) return;
        items = await fetchProposals(address);
      }
      if (mine !== gen.current) return;
      setFailure(null);
      setEntry({ key: address, items });
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
  return {
    data: fresh ? entry.items : EMPTY,
    loading: address != null && !fresh && error == null,
    error,
    refresh,
  };
}
