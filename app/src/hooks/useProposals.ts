'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from '@solana/kit';
import { fetchProposals, type ProposalView } from '@/lib/multisig';
import { RPC_LAG_DELAY_MS, RPC_LAG_RETRIES, sleep } from '@/lib/rpc-lag';

const EMPTY: ProposalView[] = [];

/**
 * Предложения (Transaction PDA) конкретного мультисига.
 * `refresh` вызывать после approve/execute, чтобы подтянуть новые маски голосов.
 * Ему можно передать `until` — признак того, что запись уже видна (новое
 * предложение в списке, поднявшаяся маска): пока признака нет, читаем повторно,
 * иначе отставшая нода отдаёт прежний список и голос выглядит потерянным.
 *
 * Состояние привязано к адресу, для которого получено: чужой список под новым
 * адресом не отдаётся, а `loading` — производное («данных под текущий адрес ещё
 * нет»), поэтому эффекту не нужно ничего синхронно сбрасывать. Побочный плюс:
 * ручной `refresh()` после approve не мигает скелетоном.
 */
export function useProposals(address: Address | undefined) {
  const [entry, setEntry] = useState<{ key?: Address; items: ProposalView[] }>({ items: EMPTY });
  const [failure, setFailure] = useState<{ key?: Address; error: unknown } | null>(null);
  // Ответы приходят в произвольном порядке — устаревший не должен перетереть свежий.
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
    // Правило считает вызов refresh() синхронным setState и не заглядывает за
    // await внутри него. Проверено: все setState здесь стоят ПОСЛЕ await, то есть
    // каскадного рендера, от которого правило защищает, тут нет.
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
