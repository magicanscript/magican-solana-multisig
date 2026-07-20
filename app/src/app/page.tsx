'use client';

import Link from 'next/link';
import { useWalletConnection } from '@solana/react-hooks';
import { WalletButton } from '@/components/WalletButton';
import { MultisigCard } from '@/components/MultisigCard';
import { useMyMultisigs } from '@/hooks/useMyMultisigs';
import { humanizeError } from '@/lib/errors';

export default function Home() {
  const { isReady, status } = useWalletConnection();
  const connected = status === 'connected';
  const { data, loading, error, refresh } = useMyMultisigs();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight text-black dark:text-white">
          Magican Multisig
        </Link>
        <WalletButton />
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {!isReady ? (
          <div className="h-40 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        ) : !connected ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-zinc-300 py-20 text-center dark:border-zinc-700">
            <h1 className="text-2xl font-semibold text-black dark:text-white">
              Programmable multisig on Solana
            </h1>
            <p className="max-w-md text-zinc-500 dark:text-zinc-400">
              Connect your wallet to see your multisigs or create a new one.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <h1 className="text-2xl font-semibold text-black dark:text-white">My multisigs</h1>
              <Link
                href="/create"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
              >
                Create multisig
              </Link>
            </div>

            {loading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-28 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
                ))}
              </div>
            ) : error ? (
              // An RPC failure must not be rendered as "no multisigs": the owner
              // would conclude there is nothing to sign, while a proposal may be
              // waiting for their signature.
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-red-300 py-16 text-center dark:border-red-900">
                <p className="text-sm text-red-600 dark:text-red-400">{humanizeError(error)}</p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Retry
                </button>
              </div>
            ) : data.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 py-16 text-center text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                You don&apos;t have any multisigs yet. Create your first one.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.map((view) => (
                  <MultisigCard key={view.address} view={view} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
