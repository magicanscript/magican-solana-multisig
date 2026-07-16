'use client';

import Link from 'next/link';
import type { MultisigView } from '@/lib/multisig';
import { shortAddress } from '@/lib/format';

/** Карточка мультисига на дашборде: адрес-ссылка, порог M-of-N, число владельцев. */
export function MultisigCard({ view }: { view: MultisigView }) {
  const { address, data } = view;
  const threshold = Number(data.threshold);
  const ownersCount = data.owners.length;

  return (
    <Link
      href={`/m/${address}`}
      className="group flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-indigo-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-500"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-zinc-600 group-hover:text-indigo-600 dark:text-zinc-400 dark:group-hover:text-indigo-400">
          {shortAddress(address, 6, 6)}
        </span>
        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          {threshold}-of-{ownersCount}
        </span>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {ownersCount} {ownersCount === 1 ? 'владелец' : 'владельцев'} · порог {threshold}
      </p>
    </Link>
  );
}
