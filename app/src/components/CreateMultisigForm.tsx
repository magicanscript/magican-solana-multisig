'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { address, isAddress, type Address, type Instruction, type TransactionSigner } from '@solana/kit';
import { createWalletTransactionSigner, type WalletSession } from '@solana/client';
import { getCreateMultisigInstructionAsync } from '@generated';
import { deriveMultisigPda } from '@/lib/pdas';
import { humanizeError } from '@/lib/errors';
import { MAX_OWNERS } from '@/lib/limits';
import { shortAddress } from '@/lib/format';
import { useSubmitTx } from '@/lib/tx';

type Built = { ix: Instruction; pda: Address; signer: TransactionSigner };

/** Seed — u64 в сидах PDA; выше кодировщик инструкции не примет. */
const MAX_U64 = 18_446_744_073_709_551_615n;

/** Клиентская валидация до сборки инструкции — чтобы не гонять заведомо битые данные. */
function validate(owners: string[], threshold: number): string | null {
  const trimmed = owners.map((o) => o.trim());
  if (trimmed.some((o) => o.length === 0)) return 'Заполните все адреса владельцев';
  const bad = trimmed.find((o) => !isAddress(o));
  if (bad) return `Некорректный адрес: ${shortAddress(bad, 6, 6)}`;
  if (new Set(trimmed).size !== trimmed.length) return 'В списке есть дубликат владельца';
  if (trimmed.length > MAX_OWNERS) return `Слишком много владельцев (максимум ${MAX_OWNERS})`;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > trimmed.length)
    return `Порог должен быть от 1 до ${trimmed.length}`;
  return null;
}

/**
 * Форма создания мультисига. Владелец №1 — подключённый кошелёк (creator, он же плательщик
 * и единственный подписант). Поток: заполнить → «Проверить» (сухой прогон без попапа) →
 * «Создать» (попап кошелька, отправка) → редирект на страницу мультисига.
 */
export function CreateMultisigForm({ session }: { session: WalletSession }) {
  const router = useRouter();
  const submit = useSubmitTx();
  const creator = session.account.address;

  const [owners, setOwners] = useState<string[]>(() => [creator, '']);
  const [threshold, setThreshold] = useState(2);
  // Сид фиксируем один раз: он входит в PDA, менять его между «проверить» и «создать» нельзя.
  const [seed, setSeed] = useState<bigint>(() => BigInt(Date.now()));

  const [built, setBuilt] = useState<Built | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const clientError = useMemo(() => validate(owners, threshold), [owners, threshold]);

  // Любое изменение входных данных инвалидирует ранее собранную/проверенную транзакцию.
  const invalidate = () => {
    if (built) {
      setBuilt(null);
      submit.reset();
    }
    setFormError(null);
  };

  const setOwner = (i: number, value: string) => {
    setOwners((prev) => prev.map((o, idx) => (idx === i ? value : o)));
    invalidate();
  };
  const addOwner = () => {
    if (owners.length >= MAX_OWNERS) return;
    setOwners((prev) => [...prev, '']);
    invalidate();
  };
  const removeOwner = (i: number) => {
    setOwners((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      // Порог не может превышать число владельцев: без клампа форма молча
      // застревала в ошибке «порог должен быть от 1 до N» после удаления.
      setThreshold((t) => Math.min(t, next.length));
      return next;
    });
    invalidate();
  };

  async function onCheck() {
    setFormError(null);
    const err = validate(owners, threshold);
    if (err) {
      setFormError(err);
      return;
    }
    try {
      // Единый signer-инстанс на весь цикл (build → simulate → send): и как creator
      // внутри инструкции, и как authority отправки. Разные инстансы на один адрес → kit падает.
      const signer = createWalletTransactionSigner(session).signer;
      const ownerAddrs = owners.map((o) => address(o.trim()));
      const ix = await getCreateMultisigInstructionAsync({
        creator: signer,
        owners: ownerAddrs,
        threshold,
        seed,
      });
      const pda = await deriveMultisigPda(creator, seed);
      setBuilt({ ix, pda, signer });
      await submit.simulate([ix], signer);
    } catch (e) {
      setFormError(humanizeError(e));
    }
  }

  // Между «транзакция подтвердилась» и «страница сменилась» есть окно: sending уже
  // false, а built и sim.ok ещё нет — кнопка оживала, и второй клик отправлял ту же
  // инструкцию с тем же seed, получая «account already in use». Замок держим до ухода.
  const [leaving, setLeaving] = useState(false);

  async function onCreate() {
    if (!built) return;
    try {
      await submit.run([built.ix], built.signer);
      setLeaving(true);
      router.push(`/m/${built.pda}`);
    } catch {
      // ошибку показывает submit.sendError ниже
    }
  }

  const { sim, sending, sendError } = submit;
  const busy = sim.loading || sending || leaving;

  return (
    <div className="flex flex-col gap-6">
      {/* Пока транзакция летит, поля заперты: любая правка зовёт invalidate(), а он
          гасит сухой прогон и стирает sendError — форма показывала бы «Проверить»
          и пустой экран ошибок поверх уже подписанной отправки.
          `contents` — чтобы fieldset не вмешивался в раскладку. */}
      <fieldset disabled={sending || leaving} className="contents">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Владельцы ({owners.length}/{MAX_OWNERS})
          </label>
          <button
            type="button"
            onClick={addOwner}
            disabled={owners.length >= MAX_OWNERS}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            + Добавить владельца
          </button>
        </div>

        {owners.map((owner, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={owner}
              onChange={(e) => setOwner(i, e.target.value)}
              readOnly={i === 0}
              spellCheck={false}
              placeholder="Адрес владельца (base58)"
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 read-only:bg-zinc-100 read-only:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:read-only:bg-zinc-800"
            />
            {i === 0 ? (
              <span className="shrink-0 rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                вы
              </span>
            ) : (
              <button
                type="button"
                onClick={() => removeOwner(i)}
                className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-2 text-xs text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:border-zinc-700 dark:hover:bg-red-950"
                aria-label="Удалить владельца"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </section>

      <section className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Порог (M из {owners.length})
          </label>
          <input
            type="number"
            min={1}
            max={owners.length}
            value={threshold}
            onChange={(e) => {
              setThreshold(Number(e.target.value));
              invalidate();
            }}
            className="w-24 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Seed</label>
          <input
            value={seed.toString()}
            onChange={(e) => {
              const v = e.target.value.trim();
              // Seed уходит в u64-кодировщик: без границы он бросал сырую строку
              // кодека вместо понятного отказа. Лишние цифры просто не принимаем.
              if (v === '' || (/^\d+$/.test(v) && BigInt(v) <= MAX_U64)) {
                setSeed(v === '' ? 0n : BigInt(v));
                invalidate();
              }
            }}
            spellCheck={false}
            className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
      </section>

      {clientError && !formError && (
        <p className="text-sm text-amber-600 dark:text-amber-500">{clientError}</p>
      )}
      {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}

      {sim.ready && (
        <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
          <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Сухой прогон
          </h3>
          {sim.loading ? (
            <p className="text-sm text-zinc-500">Симуляция…</p>
          ) : sim.error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{humanizeError(sim.error)}</p>
          ) : sim.ok ? (
            <>
              <p className="mb-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                ✓ Симуляция успешна — можно создавать
              </p>
              {sim.logs.length > 0 && (
                <pre className="max-h-40 overflow-auto rounded bg-zinc-100 p-2 text-xs text-zinc-600 dark:bg-black dark:text-zinc-400">
                  {sim.logs.join('\n')}
                </pre>
              )}
            </>
          ) : null}
        </section>
      )}

      {sendError != null && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {humanizeError(sendError)}
        </pre>
      )}

      <div className="flex items-center gap-3">
        {sim.ok && built ? (
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? 'Отправка…' : 'Создать мультисиг'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onCheck}
            disabled={busy || clientError != null}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sim.loading ? 'Проверка…' : 'Проверить'}
          </button>
        )}
      </div>
      </fieldset>
    </div>
  );
}
