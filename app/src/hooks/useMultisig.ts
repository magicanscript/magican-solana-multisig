'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Address } from '@solana/kit';
import { fetchMaybeMultisig, type Multisig } from '@generated';
import { getRpc } from '@/lib/solana';
import { deriveSignerPda } from '@/lib/pdas';

/**
 * Один мультисиг по адресу: правила (`data`), treasury-PDA и её баланс в лампортах.
 * `signerPda`/`treasuryLamports` нужны для показа казны и построения SOL-переводов.
 */
export function useMultisig(address: Address | undefined) {
  const [data, setData] = useState<Multisig | null>(null);
  const [signerPda, setSignerPda] = useState<Address | null>(null);
  const [treasuryLamports, setTreasuryLamports] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setData(null);
      setSignerPda(null);
      setTreasuryLamports(0n);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rpc = getRpc();
      const acc = await fetchMaybeMultisig(rpc, address);
      if (!acc.exists) {
        setData(null);
        setSignerPda(null);
        setTreasuryLamports(0n);
        return;
      }
      setData(acc.data);
      const pda = await deriveSignerPda(address);
      setSignerPda(pda);
      const bal = await rpc.getBalance(pda).send();
      setTreasuryLamports(bal.value);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, signerPda, treasuryLamports, loading, error, refresh };
}
