'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSolTransfer, useWalletConnection } from '@solana/react-hooks';
import type { Address } from '@solana/kit';
import { asAddress, lamportsToSol, shortAddress } from '@/lib/format';
import { useMultisig } from '@/hooks/useMultisig';
import { useProposals } from '@/hooks/useProposals';
import { deriveTransactionPda } from '@/lib/pdas';
import { humanizeError } from '@/lib/errors';
import { WalletButton } from '@/components/WalletButton';
import { ProposalRow } from '@/components/ProposalRow';

export default function MultisigPage() {
  const params = useParams<{ address: string }>();
  const address = asAddress(params.address);

  const { wallet } = useWalletConnection();
  const me = wallet?.account.address;

  const { data, signerPda, treasuryLamports, loading, error, refresh } = useMultisig(address);
  const proposals = useProposals(address);

  // У Transaction нет поля индекса — он живёт только в сидах PDA. Восстанавливаем
  // соответствие адрес→индекс, деривируя PDA для 0..transactionCount.
  const [indexMap, setIndexMap] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const count = data ? Number(data.transactionCount) : 0;
    if (!count) {
      setIndexMap(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        Array.from(
          { length: count },
          async (_, i) => [(await deriveTransactionPda(address, BigInt(i))).toString(), i] as const,
        ),
      );
      if (!cancelled) setIndexMap(new Map(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.transactionCount, address]);

  const solTransfer = useSolTransfer();
  const [fundAmount, setFundAmount] = useState('0.1');
  const [fundError, setFundError] = useState<string | null>(null);

  async function onFund() {
    setFundError(null);
    if (!signerPda) return;
    const sol = Number(fundAmount);
    if (!(sol > 0)) {
      setFundError('Введите сумму больше 0');
      return;
    }
    try {
      // bigint трактуется как лампорты (1 SOL = 1e9).
      await solTransfer.send({ amount: BigInt(Math.round(sol * 1e9)), destination: signerPda });
      await refresh();
    } catch (e) {
      setFundError(humanizeError(e));
    }
  }

  // Заглушки — реальные approve/execute появятся в Task 12.
  const onApprove = (_proposal: Address) => {};
  const onExecute = (_proposal: Address) => {};

  const msView = data ? { address, data } : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight text-black dark:text-white">
          Magican Multisig
        </Link>
        <WalletButton />
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href="/"
          className="text-sm text-zinc-500 transition-colors hover:text-indigo-600 dark:text-zinc-400"
        >
          ← К дашборду
        </Link>

        {loading && !data ? (
          <div className="mt-6 h-48 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        ) : error ? (
          <p className="mt-6 text-sm text-red-600 dark:text-red-400">{humanizeError(error)}</p>
        ) : !msView ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
            <p className="text-zinc-500 dark:text-zinc-400">Мультисиг не найден по этому адресу.</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Обновить
            </button>
          </div>
        ) : (
          <>
            {/* Шапка */}
            <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-mono text-lg font-semibold text-black dark:text-white">
                  {shortAddress(address, 6, 6)}
                </h1>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  {msView.data.threshold}-of-{msView.data.owners.length}
                </span>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Владельцы
                </p>
                <ul className="flex flex-col gap-1">
                  {(msView.data.owners as Address[]).map((owner) => (
                    <li key={owner} className="flex items-center gap-2">
                      <span className="font-mono text-sm text-zinc-600 dark:text-zinc-400">
                        {shortAddress(owner, 6, 6)}
                      </span>
                      {me && owner === me && (
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                          вы
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* Treasury */}
            <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Казна</p>
                  <p className="text-2xl font-bold text-black dark:text-white">
                    {lamportsToSol(treasuryLamports)} SOL
                  </p>
                  {signerPda && (
                    <p className="mt-1 font-mono text-xs text-zinc-400">
                      {shortAddress(signerPda, 6, 6)}
                    </p>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-500">Пополнить (SOL)</label>
                    <input
                      value={fundAmount}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        if (v === '' || /^\d*\.?\d*$/.test(v)) setFundAmount(v);
                      }}
                      spellCheck={false}
                      className="w-28 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={onFund}
                    disabled={!me || solTransfer.isSending}
                    title={me ? undefined : 'Подключите кошелёк'}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {solTransfer.isSending ? 'Отправка…' : 'Пополнить'}
                  </button>
                </div>
              </div>
              {fundError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{fundError}</p>}
            </section>

            {/* Предложения */}
            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-black dark:text-white">Предложения</h2>
                {/* Слот формы «Создать предложение» — Task 12–13 */}
              </div>

              {proposals.loading ? (
                <div className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
              ) : proposals.data.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 py-12 text-center text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  Пока нет предложений.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {proposals.data.map((view) => (
                    <ProposalRow
                      key={view.address}
                      view={view}
                      ms={msView}
                      index={indexMap.get(view.address.toString())}
                      me={me}
                      onApprove={onApprove}
                      onExecute={onExecute}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
