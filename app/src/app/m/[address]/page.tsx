'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useBalance, useSolTransfer, useWalletConnection } from '@solana/react-hooks';
import type { Address, Instruction, TransactionSigner } from '@solana/kit';
import { createWalletTransactionSigner } from '@solana/client';
import { getApproveInstruction, getExecuteTransactionInstructionAsync } from '@generated';
import { asAddress, lamportsToSol, shortAddress, solToLamports } from '@/lib/format';
import { READ_COMMITMENT } from '@/lib/solana';
import { useMultisig } from '@/hooks/useMultisig';
import { useProposals } from '@/hooks/useProposals';
import { deriveTransactionPda } from '@/lib/pdas';
import { appendRemaining, remainingFromProposal } from '@/lib/ix';
import { humanizeError } from '@/lib/errors';
import { countApprovals } from '@/lib/proposal-status';
import { useSubmitTx } from '@/lib/tx';
import type { ProposalView } from '@/lib/multisig';
import { WalletButton } from '@/components/WalletButton';
import { ProposalRow } from '@/components/ProposalRow';
import { CreateProposalForm } from '@/components/CreateProposalForm';
import { SimulateDialog } from '@/components/SimulateDialog';

const EMPTY_INDEX: Map<string, number> = new Map();

export default function MultisigPage() {
  const params = useParams<{ address: string }>();
  const address = asAddress(params.address);

  const { wallet } = useWalletConnection();
  const me = wallet?.account.address;

  const { data, signerPda, loading, error, refresh } = useMultisig(address);
  const proposals = useProposals(address);

  // Казна — только реактивно. Разовое чтение после пополнения показывало старую
  // сумму: публичный RPC — балансировщик, и нода, отвечающая на getBalance, может
  // отставать от той, что подтвердила перевод. `watch` держит WS-подписку на
  // аккаунт казны, поэтому новая сумма приезжает сама, без «обновите страницу».
  const treasury = useBalance(signerPda ?? undefined, {
    watch: true,
    commitment: READ_COMMITMENT,
  });
  const treasuryLamports = treasury.lamports ?? 0n;

  // У Transaction нет поля индекса — он живёт только в сидах PDA. Восстанавливаем
  // соответствие адрес→индекс, деривируя PDA для 0..transactionCount. Карту храним
  // вместе с ключом (адрес + счётчик), для которого она построена: чужую не отдаём,
  // и синхронный сброс в эффекте не нужен.
  const count = data ? Number(data.transactionCount) : 0;
  const mapKey = `${address}:${count}`;
  const [indexEntry, setIndexEntry] = useState<{ key: string; map: Map<string, number> }>({
    key: '',
    map: EMPTY_INDEX,
  });
  useEffect(() => {
    if (!count) return;
    let cancelled = false;
    void (async () => {
      // Деривация локальная (SHA-256 в цикле по bump), RPC здесь не участвует.
      const entries = await Promise.all(
        Array.from(
          { length: count },
          async (_, i) => [(await deriveTransactionPda(address, BigInt(i))).toString(), i] as const,
        ),
      );
      if (!cancelled) setIndexEntry({ key: `${address}:${count}`, map: new Map(entries) });
    })();
    return () => {
      cancelled = true;
    };
  }, [count, address]);
  const indexMap = indexEntry.key === mapKey ? indexEntry.map : EMPTY_INDEX;

  const solTransfer = useSolTransfer();
  const [fundAmount, setFundAmount] = useState('0.1');
  const [fundError, setFundError] = useState<string | null>(null);

  async function onFund() {
    setFundError(null);
    if (!signerPda) return;
    try {
      // bigint трактуется как лампорты (1 SOL = 1e9).
      const lamports = solToLamports(fundAmount);
      if (lamports <= 0n) {
        setFundError('Введите сумму больше 0');
        return;
      }
      // Обновлять казну руками не нужно: она на WS-подписке (useBalance выше).
      await solTransfer.send(
        { amount: lamports, destination: signerPda },
        { commitment: READ_COMMITMENT },
      );
    } catch (e) {
      setFundError(humanizeError(e));
    }
  }

  // Действия над предложениями (approve/execute) идут через один диалог: собрали
  // инструкцию → сухой прогон → подпись. Signer-инстанс фиксируем в pending, чтобы
  // simulate и send видели ровно один и тот же (иначе kit падает на двух инстансах).
  const submit = useSubmitTx();
  const [pending, setPending] = useState<{
    title: string;
    ix: Instruction;
    signer: TransactionSigner;
    // Признак, что результат действия уже виден в списке. Без него отставшая нода
    // отдаёт прежнюю маску, и одобрение выглядит потерянным (см. lib/rpc-lag).
    done: (items: ProposalView[]) => boolean;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function startAction(
    title: string,
    build: (signer: TransactionSigner) => Promise<Instruction>,
    done: (items: ProposalView[]) => boolean,
  ) {
    setActionError(null);
    if (!wallet) return;
    try {
      const signer = createWalletTransactionSigner(wallet).signer;
      const ix = await build(signer);
      setPending({ title, ix, signer, done });
      await submit.simulate([ix], signer);
    } catch (e) {
      setActionError(humanizeError(e));
    }
  }

  const find = (items: ProposalView[], target: ProposalView) =>
    items.find((x) => x.address === target.address);

  const onApprove = (view: ProposalView) =>
    void startAction(
      'Одобрить предложение',
      async (owner) => getApproveInstruction({ multisig: address, transaction: view.address, owner }),
      // Голос — булева маска: ждём, пока одобрений станет больше, чем было.
      (items) => {
        const next = find(items, view);
        return next != null && countApprovals(next.data.signers) > countApprovals(view.data.signers);
      },
    );

  const onExecute = (view: ProposalView) =>
    void startAction(
      'Исполнить предложение',
      async () => {
        const execIx = await getExecuteTransactionInstructionAsync({
          multisig: address,
          transaction: view.address,
        });
        // remaining восстанавливаем из того, что предложение хранит on-chain, —
        // независимо от того, кто и чем его создал (SOL или raw).
        return appendRemaining(
          execIx,
          remainingFromProposal({ programId: view.data.programId, accounts: view.data.accounts }),
        );
      },
      (items) => find(items, view)?.data.didExecute === true,
    );

  async function onConfirmAction() {
    if (!pending) return;
    const done = pending.done;
    try {
      await submit.run([pending.ix], pending.signer);
    } catch {
      // Ошибку показывает диалог (sendError) — не закрываем.
      return;
    }
    setPending(null);
    submit.reset();
    // Обновление — ВНЕ try отправки: его ошибка попала бы в catch, где диалог уже
    // закрыт, а sendError стёрт, и пропала бы молча. Свои ошибки refresh кладёт в
    // proposals.error, и список показывает их вместе с кнопкой «Повторить».
    await proposals.refresh(done);
  }

  function onCancelAction() {
    setPending(null);
    submit.reset();
  }

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
                      // Правка суммы во время отправки меняла бы поле, которое к уже
                      // подписанному переводу отношения не имеет, — вводит в заблуждение.
                      disabled={solTransfer.isSending}
                      spellCheck={false}
                      className="w-28 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
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
              </div>

              {wallet && signerPda && (
                <div className="mb-4">
                  <CreateProposalForm
                    multisig={address}
                    signerPda={signerPda}
                    treasuryLamports={treasuryLamports}
                    session={wallet}
                    onCreated={async () => {
                      // Счётчик мультисига нужен не меньше списка: индекс строки
                      // (#0, #1…) восстанавливается деривацией PDA по счётчику.
                      const want = proposals.data.length + 1;
                      await Promise.all([
                        refresh((m) => Number(m.transactionCount) >= want),
                        proposals.refresh((items) => items.length >= want),
                      ]);
                    }}
                  />
                </div>
              )}

              {actionError && (
                <p className="mb-3 text-sm text-red-600 dark:text-red-400">{actionError}</p>
              )}

              {proposals.loading ? (
                <div className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
              ) : proposals.error ? (
                // «Предложений нет» и «список не загрузился» — разные вещи: молча
                // выдав первое за второе, мы скрыли бы предложение, ждущее подписи.
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-red-300 py-12 text-center dark:border-red-900">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {humanizeError(proposals.error)}
                  </p>
                  <button
                    type="button"
                    onClick={() => void proposals.refresh()}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Повторить
                  </button>
                </div>
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
                      signerPda={signerPda ?? undefined}
                      // Пока идёт одно действие, второе начинать нельзя: startAction
                      // перетирает pending и сбрасывает сухой прогон — подписалось бы
                      // не то, что показано в диалоге.
                      busy={pending != null || submit.sending}
                      onApprove={onApprove}
                      onExecute={onExecute}
                    />
                  ))}
                </div>
              )}
            </section>

            <SimulateDialog
              open={pending != null}
              title={pending?.title ?? ''}
              sim={submit.sim}
              sending={submit.sending}
              sendError={submit.sendError}
              onConfirm={onConfirmAction}
              onCancel={onCancelAction}
            />
          </>
        )}
      </main>
    </div>
  );
}
