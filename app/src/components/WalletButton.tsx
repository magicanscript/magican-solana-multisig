'use client';

import { useState } from 'react';
import { useWalletConnection } from '@solana/react-hooks';
import { shortAddress } from '@/lib/format';

/**
 * Кнопка подключения кошелька. Гейтится по `isReady`, чтобы не ловить
 * SSR-hydration mismatch (до гидратации список коннекторов пуст).
 */
export function WalletButton() {
  const { isReady, status, connectors, connect, disconnect, wallet, connecting } =
    useWalletConnection();
  const [open, setOpen] = useState(false);

  if (!isReady) {
    return <div className="h-10 w-32 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />;
  }

  if (status === 'connected' && wallet) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-lg bg-zinc-100 px-3 py-2 font-mono text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {shortAddress(wallet.account.address)}
        </span>
        <button
          onClick={() => void disconnect()}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Отключить
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={connecting}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {connecting ? 'Подключение…' : 'Подключить кошелёк'}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {connectors.length === 0 ? (
            <p className="px-3 py-2 text-sm text-zinc-500">
              Кошелёк не найден. Установите Phantom.
            </p>
          ) : (
            connectors.map((c) => (
              <button
                key={c.id}
                onClick={async () => {
                  setOpen(false);
                  try {
                    await connect(c.id);
                  } catch {
                    /* ошибку показывает состояние error хука; здесь молча закрываем меню */
                  }
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {c.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" className="h-5 w-5" />
                )}
                {c.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
