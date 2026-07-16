'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWalletConnection } from '@solana/react-hooks';
import { fetchOwnedMultisigs, type MultisigView } from '@/lib/multisig';

/**
 * Мультисиги, где подключённый кошелёк — один из владельцев.
 * Перезапрашивает при смене адреса кошелька; `refresh` — ручной ре-фетч.
 */
export function useMyMultisigs() {
  const { wallet } = useWalletConnection();
  const owner = wallet?.account.address;
  const [data, setData] = useState<MultisigView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (!owner) {
      setData([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await fetchOwnedMultisigs(owner));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [owner]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
