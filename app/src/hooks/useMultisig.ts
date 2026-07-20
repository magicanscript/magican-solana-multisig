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
 * Один мультисиг по адресу: правила (`data`) и адрес treasury-PDA.
 *
 * Баланс казны хук НЕ отдаёт: разовый `getBalance` после пополнения врёт —
 * публичный RPC за балансировщиком отвечает с ноды, которая ещё не догнала
 * подтверждение с другой. Баланс берётся реактивно, через `useBalance(…, {watch})`
 * поверх WS-подписки (см. страницу мультисига).
 *
 * Всё привязано к адресу, для которого получено. Иначе при переходе между
 * мультисигами под новым заголовком отрисовалась бы ЧУЖАЯ казна — и «Пополнить»
 * ушло бы на предыдущую treasury-PDA. `loading` — производное, поэтому эффект
 * ничего синхронно не сбрасывает.
 */
export function useMultisig(address: Address | undefined) {
  const [entry, setEntry] = useState<Entry>(EMPTY);
  const [failure, setFailure] = useState<{ key?: Address; error: unknown } | null>(null);
  // Ответы приходят в произвольном порядке — устаревший не должен перетереть свежий.
  const gen = useRef(0);

  const refresh = useCallback(async (until?: (data: Multisig) => boolean) => {
    const mine = ++gen.current;
    if (!address) return;
    try {
      const rpc = getRpc();
      const read = () => fetchMaybeMultisig(rpc, address, { commitment: READ_COMMITMENT });
      // «Не найден» сразу после создания — обычно отставание ноды, а не отсутствие;
      // так же и данные, отставшие от только что отправленной записи (см. rpc-lag).
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
    // Правило считает вызов refresh() синхронным setState и не заглядывает за
    // await внутри него. Проверено: все setState здесь стоят ПОСЛЕ await, то есть
    // каскадного рендера, от которого правило защищает, тут нет.
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
