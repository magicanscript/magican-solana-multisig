'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Address } from '@solana/kit';
import { fetchProposals, type ProposalView } from '@/lib/multisig';

/**
 * Предложения (Transaction PDA) конкретного мультисига.
 * `refresh` вызывать после approve/execute, чтобы подтянуть новые маски голосов.
 */
export function useProposals(address: Address | undefined) {
  const [data, setData] = useState<ProposalView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setData([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await fetchProposals(address));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
