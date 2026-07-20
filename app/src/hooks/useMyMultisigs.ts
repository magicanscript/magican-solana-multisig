'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWalletConnection } from '@solana/react-hooks';
import type { Address } from '@solana/kit';
import { fetchOwnedMultisigs, type MultisigView } from '@/lib/multisig';

const EMPTY: MultisigView[] = [];

/**
 * Multisigs where the connected wallet is one of the owners.
 * Re-fetches when the wallet address changes; `refresh` is a manual re-fetch.
 *
 * The list is bound to the owner it was fetched for, and `loading` is derived
 * ("there is no data for the current owner yet"). That way the first frame does not
 * look like "no multisigs", and after a wallet switch someone else's are not shown.
 */
export function useMyMultisigs() {
  const { wallet } = useWalletConnection();
  const owner = wallet?.account.address;
  const [entry, setEntry] = useState<{ key?: Address; items: MultisigView[] }>({ items: EMPTY });
  const [failure, setFailure] = useState<{ key?: Address; error: unknown } | null>(null);
  // Responses arrive in arbitrary order — a stale one must not overwrite a fresh one.
  const gen = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++gen.current;
    if (!owner) return;
    try {
      const items = await fetchOwnedMultisigs(owner);
      if (mine !== gen.current) return;
      setFailure(null);
      setEntry({ key: owner, items });
    } catch (e) {
      if (mine !== gen.current) return;
      setFailure({ key: owner, error: e });
    }
  }, [owner]);

  useEffect(() => {
    // The lint rule treats the refresh() call as a synchronous setState and does not
    // look past the awaits inside it. Verified: every setState here comes AFTER an
    // await, so the cascading render the rule guards against cannot happen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const error = failure && failure.key === owner ? failure.error : null;
  const fresh = entry.key === owner;
  return {
    data: fresh ? entry.items : EMPTY,
    loading: owner != null && !fresh && error == null,
    error,
    refresh,
  };
}
