'use client';

import { useMemo, useState } from 'react';
import { address, isAddress, type Address, type Instruction, type TransactionSigner } from '@solana/kit';
import { createWalletTransactionSigner, type WalletSession } from '@solana/client';
import { fetchMaybeMultisig, getCreateTransactionInstruction } from '@generated';
import {
  buildRawNested,
  buildSolTransfer,
  checkRecipientRent,
  checkTreasuryRemainder,
  maxTransferLamports,
  SYSTEM_PROGRAM,
  type AmountIssue,
  type ProposalAccount,
} from '@/lib/ix';
import { MAX_TX_ACCOUNTS, MAX_TX_DATA } from '@/lib/limits';
import { deriveTransactionPda } from '@/lib/pdas';
import { humanizeError } from '@/lib/errors';
import { lamportsToSol, shortAddress, solToLamports } from '@/lib/format';
import { getRpc, READ_COMMITMENT } from '@/lib/solana';
import { useSubmitTx } from '@/lib/tx';
import { SimulateDialog } from './SimulateDialog';

type Built = { ix: Instruction; signer: TransactionSigner };

type Mode = 'sol' | 'raw';
/** Строка таблицы аккаунтов в raw-режиме: адрес ещё строка, флаги уже булевы. */
type RawAccount = { pubkey: string; isSigner: boolean; isWritable: boolean };

const EMPTY_ACCOUNT: RawAccount = { pubkey: '', isSigner: false, isWritable: false };

/** Валидация до сборки инструкции. Сумму парсим точно: строка → лампорты, без float. */
function validate(recipient: string, amount: string): string | null {
  const to = recipient.trim();
  if (!to) return 'Укажите адрес получателя';
  if (!isAddress(to)) return `Некорректный адрес: ${shortAddress(to, 6, 6)}`;
  let lamports: bigint;
  try {
    lamports = solToLamports(amount);
  } catch (e) {
    return e instanceof Error ? e.message : 'Некорректная сумма';
  }
  if (lamports <= 0n) return 'Сумма должна быть больше 0';
  return null;
}

/**
 * Валидация raw-режима. Правила вложенной инструкции (чужой подписант, лимиты,
 * целостность base64) живут в `buildRawNested` — здесь мы только доводим адреса
 * до типа и показываем то, чем он отказал. Сборка чистая и дешёвая, поэтому
 * гоняем её на каждый ввод: кнопка гаснет сразу, а не после клика.
 */
function validateRaw(
  signerPda: Address,
  programId: string,
  accounts: RawAccount[],
  dataBase64: string,
): string | null {
  const pid = programId.trim();
  if (!pid) return 'Укажите program id инструкции';
  if (!isAddress(pid)) return `Некорректный program id: ${shortAddress(pid, 6, 6)}`;

  const parsed: ProposalAccount[] = [];
  for (const [i, a] of accounts.entries()) {
    const key = a.pubkey.trim();
    if (!key) return `Заполните адрес аккаунта #${i + 1}`;
    if (!isAddress(key)) return `Некорректный адрес аккаунта #${i + 1}: ${shortAddress(key, 6, 6)}`;
    parsed.push({ pubkey: address(key), isSigner: a.isSigner, isWritable: a.isWritable });
  }

  try {
    buildRawNested({ programId: address(pid), signerPda, accounts: parsed, dataBase64 });
  } catch (e) {
    return e instanceof Error ? e.message : 'Некорректная инструкция';
  }
  return null;
}

/** Человеческий текст для нарушения правил ренты (правила — в lib/ix.ts). */
function issueText(issue: AmountIssue): string {
  return issue.kind === 'remainder'
    ? `Столько вывести нельзя: в казне остался бы «неарендуемый» хвост. Выведите не больше ${lamportsToSol(issue.safeMax, 9)} SOL либо весь баланс целиком.`
    : `Получателю не хватит на аренду аккаунта: нужно минимум ${lamportsToSol(issue.needed, 9)} SOL, иначе перевод отклонят при исполнении.`;
}

/**
 * Новое предложение: перевод SOL из казны мультисига. Создание предложения — это
 * ещё не перевод: подписи собираются потом, поэтому нехватку средств в казне
 * показываем предупреждением, а не запретом (казну можно пополнить до execute).
 *
 * А вот нарушения правил ренты — именно запрет: такое предложение соберёт подписи
 * и всё равно упадёт на execute, а отменить его нечем (в программе нет cancel).
 */
export function CreateProposalForm({
  multisig,
  signerPda,
  treasuryLamports,
  session,
  onCreated,
}: {
  multisig: Address;
  signerPda: Address;
  treasuryLamports: bigint;
  session: WalletSession;
  onCreated: () => void | Promise<void>;
}) {
  const submit = useSubmitTx();

  const [mode, setMode] = useState<Mode>('sol');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [rawProgramId, setRawProgramId] = useState('');
  const [rawAccounts, setRawAccounts] = useState<RawAccount[]>([]);
  const [rawData, setRawData] = useState('');
  const [built, setBuilt] = useState<Built | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const solError = useMemo(() => validate(recipient, amount), [recipient, amount]);
  const rawError = useMemo(
    () => validateRaw(signerPda, rawProgramId, rawAccounts, rawData),
    [signerPda, rawProgramId, rawAccounts, rawData],
  );
  const clientError = mode === 'sol' ? solError : rawError;
  // Проверка успевает сходить в сеть трижды (счётчик мультисига + два баланса) ДО того,
  // как появится built, — всё это время кнопка оставалась живой, и второй клик слал
  // второй залп запросов и мигал диалогом.
  const [checking, setChecking] = useState(false);
  // Диалог открыт (или транзакция летит) — форма заперта: ниже она обёрнута в fieldset.
  const locked = built != null || submit.sending || checking;
  // Вывести можно всё до нуля — рантайм это разрешает (аккаунт казны удаляется).
  const available = maxTransferLamports(treasuryLamports);

  // Сумма выше баланса — не ошибка: предложение живёт до execute, к тому времени
  // казну могут пополнить. Но предупредить обязаны, иначе execute упадёт молча.
  const overBalance = useMemo(() => {
    if (solError) return false;
    try {
      return solToLamports(amount) > treasuryLamports;
    } catch {
      return false;
    }
  }, [amount, treasuryLamports, solError]);

  const invalidate = () => {
    if (built) {
      setBuilt(null);
      submit.reset();
    }
    setFormError(null);
  };

  async function onCheck() {
    setFormError(null);
    if (clientError) {
      setFormError(clientError);
      return;
    }
    setChecking(true);
    try {
      // Единый signer-инстанс на весь цикл build → simulate → send: он же proposer
      // внутри инструкции, он же authority отправки (два инстанса на адрес → kit падает).
      const signer = createWalletTransactionSigner(session).signer;
      const rpc = getRpc();

      // Счётчик читаем заново, а не из снапшота страницы: индекс входит в сиды PDA,
      // и если сосед успел создать предложение, наш PDA будет уже не тот (Anchor 2006).
      const fresh = await fetchMaybeMultisig(rpc, multisig, { commitment: READ_COMMITMENT });
      if (!fresh.exists) {
        setFormError('Мультисиг не найден — обновите страницу');
        return;
      }

      let programId: Address;
      let proposalAccounts: ProposalAccount[];
      let data: Uint8Array;

      if (mode === 'sol') {
        const to = address(recipient.trim());
        const lamports = solToLamports(amount);

        // Правила ренты: обе стороны перевода. Нарушение здесь = предложение, которое
        // соберёт кворум и всё равно упадёт на execute, навсегда (cancel в программе нет).
        const [treasuryNow, recipientNow] = await Promise.all([
          rpc.getBalance(signerPda, { commitment: READ_COMMITMENT }).send(),
          rpc.getBalance(to, { commitment: READ_COMMITMENT }).send(),
        ]);
        const issue =
          checkTreasuryRemainder(treasuryNow.value, lamports) ??
          checkRecipientRent(recipientNow.value, lamports);
        if (issue) {
          setFormError(issueText(issue));
          return;
        }

        programId = SYSTEM_PROGRAM;
        ({ proposalAccounts, data } = buildSolTransfer(signerPda, to, lamports));
      } else {
        // Правила ренты тут не проверить: во что превратится произвольная инструкция,
        // клиент не знает. Об этом честно предупреждаем в подсказке под формой.
        const raw = buildRawNested({
          programId: address(rawProgramId.trim()),
          signerPda,
          accounts: rawAccounts.map((a) => ({
            pubkey: address(a.pubkey.trim()),
            isSigner: a.isSigner,
            isWritable: a.isWritable,
          })),
          dataBase64: rawData,
        });
        programId = raw.programId;
        proposalAccounts = raw.proposalAccounts;
        data = raw.data;
      }

      const txPda = await deriveTransactionPda(multisig, fresh.data.transactionCount);
      const ix = getCreateTransactionInstruction({
        multisig,
        transaction: txPda,
        proposer: signer,
        programId,
        accounts: proposalAccounts,
        data,
      });
      setBuilt({ ix, signer });
      await submit.simulate([ix], signer);
    } catch (e) {
      setFormError(humanizeError(e));
    } finally {
      setChecking(false);
    }
  }

  async function onConfirm() {
    if (!built) return;
    try {
      await submit.run([built.ix], built.signer);
    } catch {
      // Ошибку отправки показывает диалог (sendError) — модалку не закрываем.
      return;
    }
    // Только после успеха: закрываем диалог, чистим форму и обновляем список.
    // `onCreated` намеренно ВНЕ try — иначе его ошибка попадала бы в тот же catch,
    // где диалог уже закрыт, а sendError стёрт, и исчезала бы бесследно.
    setBuilt(null);
    submit.reset();
    setRecipient('');
    setAmount('');
    setRawProgramId('');
    setRawAccounts([]);
    setRawData('');
    try {
      await onCreated();
    } catch (e) {
      setFormError(humanizeError(e));
    }
  }

  function onCancel() {
    setBuilt(null);
    submit.reset();
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Пока открыт диалог, форма заперта целиком. Модалка перекрывает её только
          визуально — с клавиатуры поля остаются достижимы, а любая правка зовёт
          invalidate(): сухой прогон сбросился бы под уже отправленной подписью.
          `contents` — чтобы fieldset не вмешивался в раскладку. */}
      <fieldset disabled={locked} className="contents">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Новое предложение</p>
        <div
          role="tablist"
          aria-label="Тип предложения"
          className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800"
        >
          {(
            [
              ['sol', 'Перевод SOL'],
              ['raw', 'Raw'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => {
                setMode(value);
                invalidate();
              }}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                mode === value
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'sol' ? (
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs text-zinc-500">Получатель</label>
          <input
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              invalidate();
            }}
            placeholder="Адрес получателя"
            spellCheck={false}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Сумма (SOL)</label>
          <div className="flex items-center gap-1">
            <input
              value={amount}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (v === '' || /^\d*\.?\d*$/.test(v)) {
                  setAmount(v);
                  invalidate();
                }
              }}
              placeholder="0.0"
              spellCheck={false}
              className="w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={() => {
                // Полная точность (9 знаков): показанное в поле обязано разобраться
                // назад в те же лампорты, иначе «MAX» отправит не то, что видно.
                setAmount(lamportsToSol(available, 9));
                invalidate();
              }}
              disabled={available === 0n}
              title="Весь баланс казны (полный вывод рантайм разрешает)"
              className="rounded-lg border border-zinc-300 px-2 py-2 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              MAX
            </button>
          </div>
        </div>
      </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Program id инструкции</label>
            <input
              value={rawProgramId}
              onChange={(e) => {
                setRawProgramId(e.target.value);
                invalidate();
              }}
              placeholder="Адрес программы"
              spellCheck={false}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs text-zinc-500">
                Аккаунты ({rawAccounts.length} из {MAX_TX_ACCOUNTS})
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    // Ради этой строки raw и существует: подписать вложенную
                    // инструкцию программа может только за свою казну.
                    setRawAccounts((prev) => [
                      ...prev,
                      { pubkey: signerPda, isSigner: true, isWritable: true },
                    ]);
                    invalidate();
                  }}
                  disabled={rawAccounts.length >= MAX_TX_ACCOUNTS}
                  title="Казна мультисига как подписант вложенной инструкции"
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  + Казна
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRawAccounts((prev) => [...prev, EMPTY_ACCOUNT]);
                    invalidate();
                  }}
                  disabled={rawAccounts.length >= MAX_TX_ACCOUNTS}
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  + Аккаунт
                </button>
              </div>
            </div>

            {rawAccounts.length === 0 ? (
              <p className="text-xs text-zinc-400">
                Аккаунтов нет — инструкции без аккаунтов тоже бывают.
              </p>
            ) : (
              rawAccounts.map((acc, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    value={acc.pubkey}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRawAccounts((prev) =>
                        prev.map((a, j) => (j === i ? { ...a, pubkey: v } : a)),
                      );
                      invalidate();
                    }}
                    placeholder={`Адрес аккаунта #${i + 1}`}
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                  {(
                    [
                      ['isSigner', 'signer'],
                      ['isWritable', 'writable'],
                    ] as const
                  ).map(([flag, label]) => (
                    <label
                      key={flag}
                      className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400"
                    >
                      <input
                        type="checkbox"
                        checked={acc[flag]}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setRawAccounts((prev) =>
                            prev.map((a, j) => (j === i ? { ...a, [flag]: v } : a)),
                          );
                          invalidate();
                        }}
                      />
                      {label}
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setRawAccounts((prev) => prev.filter((_, j) => j !== i));
                      invalidate();
                    }}
                    aria-label={`Удалить аккаунт #${i + 1}`}
                    className="rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">
              Данные инструкции, base64 (до {MAX_TX_DATA} байт)
            </label>
            <textarea
              value={rawData}
              onChange={(e) => {
                setRawData(e.target.value);
                invalidate();
              }}
              rows={3}
              placeholder="Пусто — если инструкция без данных"
              spellCheck={false}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Исполняя предложение, программа подписывает вложенную инструкцию только за казну
            мультисига ({shortAddress(signerPda, 6, 6)}) — другой подписант сделает предложение
            неисполнимым, поэтому такое не создаётся. Сухой прогон проверяет создание
            предложения, а не его будущее исполнение: что сделает произвольная инструкция,
            клиент знать не может.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          В казне: {lamportsToSol(available, 9)} SOL
        </p>
        <button
          type="button"
          onClick={onCheck}
          disabled={clientError != null || submit.sim.loading}
          title={clientError ?? undefined}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Проверить
        </button>
      </div>

      {mode === 'sol' && overBalance && (
        <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
          В казне сейчас меньше — предложение создать можно, но исполнить получится только
          после пополнения.
        </p>
      )}
      {formError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{formError}</p>}
      </fieldset>

      <SimulateDialog
        open={built != null}
        title="Создать предложение"
        sim={submit.sim}
        sending={submit.sending}
        sendError={submit.sendError}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
}
