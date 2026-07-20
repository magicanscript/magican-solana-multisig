'use client';

import { useEffect, useRef, useState } from 'react';
import { useWalletConnection } from '@solana/react-hooks';
import { shortAddress } from '@/lib/format';
import { humanizeError } from '@/lib/errors';

/**
 * Кнопка подключения кошелька. Гейтится по `isReady`, чтобы не ловить
 * SSR-hydration mismatch (до гидратации список коннекторов пуст).
 */
export function WalletButton() {
  const { isReady, status, connectors, connect, disconnect, wallet, connecting, error } =
    useWalletConnection();
  const [open, setOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Меню должно закрываться так, как этого ждут: Escape и клик мимо.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!isReady) {
    return (
      <div
        aria-busy="true"
        aria-label="Загрузка кошелька"
        className="h-10 w-32 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800"
      />
    );
  }

  if (status === 'connected' && wallet) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-lg bg-zinc-100 px-3 py-2 font-mono text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {shortAddress(wallet.account.address)}
        </span>
        <button
          type="button"
          onClick={async () => {
            setDisconnecting(true);
            try {
              await disconnect();
            } finally {
              setDisconnecting(false);
            }
          }}
          disabled={disconnecting}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {disconnecting ? 'Отключение…' : 'Отключить'}
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={connecting}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {connecting ? 'Подключение…' : 'Подключить кошелёк'}
      </button>

      {/* Отказ в подключении обязан быть виден: иначе кнопка просто «отщёлкивает»,
          и пользователь не понимает, что произошло. */}
      {error != null && !open && (
        <p
          role="alert"
          className="absolute right-0 z-10 mt-2 w-56 rounded-lg border border-red-200 bg-white p-2 text-xs text-red-600 shadow-lg dark:border-red-900 dark:bg-zinc-900 dark:text-red-400"
        >
          {humanizeError(error)}
        </p>
      )}

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-2 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {connectors.length === 0 ? (
            // Список кошельков — срез на момент загрузки страницы (см. providers.tsx),
            // поэтому только что установленный кошелёк виден лишь после перезагрузки.
            <p className="px-3 py-2 text-sm text-zinc-500">
              Кошелёк не найден. Установите Phantom и обновите страницу.
            </p>
          ) : (
            connectors.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitem"
                onClick={async () => {
                  setOpen(false);
                  try {
                    await connect(c.id);
                  } catch {
                    /* текст берём из error хука — он отрисован выше */
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
