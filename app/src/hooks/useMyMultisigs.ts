'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWalletConnection } from '@solana/react-hooks';
import type { Address } from '@solana/kit';
import { fetchOwnedMultisigs, type MultisigView } from '@/lib/multisig';

const EMPTY: MultisigView[] = [];

/**
 * Мультисиги, где подключённый кошелёк — один из владельцев.
 * Перезапрашивает при смене адреса кошелька; `refresh` — ручной ре-фетч.
 *
 * Список привязан к владельцу, для которого получен, а `loading` — производное
 * («данных под текущего владельца ещё нет»). Так первый кадр не выглядит как
 * «мультисигов нет», а после смены кошелька не показываются чужие.
 */
export function useMyMultisigs() {
  const { wallet } = useWalletConnection();
  const owner = wallet?.account.address;
  const [entry, setEntry] = useState<{ key?: Address; items: MultisigView[] }>({ items: EMPTY });
  const [failure, setFailure] = useState<{ key?: Address; error: unknown } | null>(null);
  // Ответы приходят в произвольном порядке — устаревший не должен перетереть свежий.
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
    // Правило считает вызов refresh() синхронным setState и не заглядывает за
    // await внутри него. Проверено: все setState здесь стоят ПОСЛЕ await, то есть
    // каскадного рендера, от которого правило защищает, тут нет.
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
