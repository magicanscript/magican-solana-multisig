'use client';

import { useEffect, useRef } from 'react';
import type { SimState } from '@/lib/tx';
import { humanizeError } from '@/lib/errors';

/**
 * Сухой прогон перед подписью: что транзакция сделает, сколько CU съест и с чем
 * упадёт. Кнопка подписи включается только при успешной симуляции — подписывать
 * заведомо обречённую транзакцию не даём.
 *
 * Нативный `<dialog open через showModal()>`, а не div с `fixed inset-0`: подложка
 * перехватывает только мышь, а с клавиатуры весь фон остаётся в tab-порядке. Через
 * Tab из-под модалки открывался второй такой же диалог поверх первого, жалась
 * «Пополнить» (второй попап кошелька) и «Отключить» — а отключение кошелька
 * размонтирует форму, и исход уже подписанной транзакции теряется без следа.
 * `showModal()` делает остальной документ инертным по спецификации — одним приёмом
 * и без самодельной ловушки фокуса, и `aria-modal` перестаёт быть обещанием впустую.
 */
export function SimulateDialog({
  open,
  title,
  sim,
  sending,
  sendError,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  sim: SimState;
  sending: boolean;
  sendError: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // showModal() на уже открытом диалоге бросает InvalidStateError — сверяемся.
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (!open) return null;

  const error = sim.error ?? sendError;

  return (
    <dialog
      ref={ref}
      aria-label={title}
      // Escape закрывает диалог сам; во время отправки закрывать нечего — транзакция
      // уже подписана и летит, а закрытие спрятало бы её исход.
      onCancel={(e) => {
        e.preventDefault();
        if (!sending) onCancel();
      }}
      onClick={(e) => {
        // Клик мимо карточки = по самому <dialog> (карточка внутри останавливает всплытие).
        if (e.target === e.currentTarget && !sending) onCancel();
      }}
      className="m-auto w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <div onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-black dark:text-white">{title}</h2>

        <div className="mt-4">
          {/* Пока симуляция не дала ни успеха, ни ошибки — прогон ещё идёт: у SWR
              есть промежуточный idle-кадр, на котором тело диалога иначе пустует. */}
          {sim.loading || !sim.ready || (!error && !sim.ok) ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Сухой прогон…</p>
          ) : error ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {humanizeError(error)}
            </pre>
          ) : sim.ok ? (
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              ✓ Симуляция успешна
              {sim.units != null && (
                <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                  {sim.units.toString()} CU
                </span>
              )}
            </p>
          ) : null}

          {sending && (
            // Подтверждения ждём до исчерпания blockhash — это до полутора минут
            // замершего экрана. Честно предупреждаем, что так и задумано.
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Ждём подтверждения сети — это может занять до минуты. Не закрывайте вкладку.
            </p>
          )}

          {sim.logs.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
                Логи программы ({sim.logs.length})
              </summary>
              <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-zinc-50 p-3 font-mono text-xs text-zinc-600 dark:bg-black dark:text-zinc-400">
                {sim.logs.join('\n')}
              </pre>
            </details>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!sim.ok || sending}
            title={sim.ok ? undefined : 'Доступно только после успешной симуляции'}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Отправка…' : 'Подписать'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
