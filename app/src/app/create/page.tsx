'use client';

import Link from 'next/link';
import { useWalletConnection } from '@solana/react-hooks';
import { WalletButton } from '@/components/WalletButton';
import { CreateMultisigForm } from '@/components/CreateMultisigForm';

export default function CreatePage() {
  const { isReady, status, wallet } = useWalletConnection();
  const connected = status === 'connected';

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight text-black dark:text-white">
          Magican Multisig
        </Link>
        <WalletButton />
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-6">
          <Link
            href="/"
            className="text-sm text-zinc-500 transition-colors hover:text-indigo-600 dark:text-zinc-400"
          >
            ← Back to dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-black dark:text-white">
            New multisig
          </h1>
        </div>

        {!isReady ? (
          <div className="h-64 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        ) : !connected || !wallet ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
            <p className="text-zinc-500 dark:text-zinc-400">
              Connect your wallet to create a multisig.
            </p>
            <WalletButton />
          </div>
        ) : (
          <CreateMultisigForm session={wallet} />
        )}
      </main>
    </div>
  );
}
