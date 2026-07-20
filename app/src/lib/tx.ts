'use client';

import { useCallback, useRef, useState } from 'react';
import type { Instruction, TransactionSigner } from '@solana/kit';
import { useSendTransaction, useSimulateTransaction, useSolanaClient } from '@solana/react-hooks';
import { transactionToBase64 } from '@solana/client';
import { simulationFailure } from './errors';
import { READ_COMMITMENT } from './solana';

/** Сводка сухого прогона для UI: логи, ошибка (prepare или симуляции), флаги. */
export type SimState = {
  logs: readonly string[];
  error: unknown;
  loading: boolean;
  /** Потреблённые вычислительные единицы (если RPC их сообщил). */
  units: bigint | null;
  /** Симуляция завершилась успешно — можно отправлять. */
  ok: boolean;
  /** Был запрошен сухой прогон (есть payload или ошибка подготовки). */
  ready: boolean;
};

/**
 * Обёртка отправки для форм. Разбита на две фазы:
 *  1. `simulate(ix, authority)` — собирает сообщение через framework-kit (`prepare`,
 *     feePayer = `authority`) и сериализует его в base64 **без подписи/попапа**; реактивный
 *     `useSimulateTransaction` прогоняет его на RPC и наполняет `sim`.
 *  2. `run(ix, authority)` — реальная отправка (`send`, кошелёк подписывает).
 *
 * `authority` — единый wallet-`TransactionSigner` (`createWalletTransactionSigner(session).signer`).
 * Тот же инстанс обязан использоваться и как `creator` внутри инструкции: kit падает, если на один
 * адрес приходят два РАЗНЫХ signer-инстанса. Поэтому его создаёт вызывающий и передаёт сюда.
 *
 * Сообщение руками не строим и `rpc.simulateTransaction` вручную не зовём — симуляция уже встроена
 * в framework-kit, а `send()` симулирует и сам.
 */
export function useSubmitTx() {
  const client = useSolanaClient();
  const {
    send,
    isSending,
    signature,
    error: sendError,
    reset: resetSend,
  } = useSendTransaction();

  const [base64, setBase64] = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState<unknown>(null);

  // `prepare` ходит в сеть за блокхэшем, и его ответ приходит когда придёт. Без
  // счётчика поколений ответ ОТМЕНЁННОГО прогона дописывался в стейт уже поверх
  // нового действия: диалог показывал «успешно» и логи чужой транзакции, а
  // подписывалась текущая. Поколение отсекает всё, что успело устареть.
  const gen = useRef(0);
  const inflight = useRef<AbortController | null>(null);

  // encoding обязателен: хук не проставляет его сам, а RPC по умолчанию ждёт base58.
  const query = useSimulateTransaction(base64, { config: { encoding: 'base64' } });

  const simulate = useCallback(
    async (instructions: readonly Instruction[], authority: TransactionSigner) => {
      const mine = ++gen.current;
      inflight.current?.abort();
      const ac = new AbortController();
      inflight.current = ac;
      setPrepareError(null);
      setBase64(null);
      try {
        const prepared = await client.transaction.prepare({
          instructions,
          authority,
          abortSignal: ac.signal,
        });
        if (mine !== gen.current) return; // прогон отменён или начат следующий
        // prepared.message скомпилировано, но НЕ подписано — попапа кошелька нет.
        setBase64(transactionToBase64(prepared.message));
      } catch (e) {
        if (mine !== gen.current) return;
        setPrepareError(e);
      }
    },
    [client],
  );

  const run = useCallback(
    (instructions: readonly Instruction[], authority: TransactionSigner) =>
      // Ждём подтверждения на том же уровне, с каким читаем: иначе редирект/refresh
      // сразу после отправки прочитает состояние, где транзакции ещё нет.
      send({ instructions, authority }, { commitment: READ_COMMITMENT }),
    [send],
  );

  const reset = useCallback(() => {
    // Поколение двигаем и здесь: reset чистит стейт, но не останавливает уже
    // летящий prepare — без этого он бы «воскресил» отменённый прогон.
    gen.current++;
    inflight.current?.abort();
    inflight.current = null;
    setBase64(null);
    setPrepareError(null);
    resetSend();
  }, [resetSend]);

  // Успешный ответ RPC ≠ успешная транзакция: провал исполнения приезжает в
  // value.err, а query.error остаётся пустым. Без этой проверки сухой прогон
  // говорил бы «можно отправлять» ровно тогда, когда транзакция обречена.
  const value = query.data?.value;
  const simFailure = value?.err != null ? simulationFailure(value.err, query.logs) : null;

  const sim: SimState = {
    logs: query.logs,
    error: prepareError ?? query.error ?? simFailure,
    loading: query.isLoading,
    units: value?.unitsConsumed ?? null,
    ok:
      base64 != null &&
      prepareError == null &&
      query.error == null &&
      simFailure == null &&
      query.isSuccess,
    ready: base64 != null || prepareError != null,
  };

  return { simulate, run, sim, sending: isSending, sendError, signature, reset };
}
