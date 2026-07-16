'use client';

import { useCallback, useState } from 'react';
import type { Instruction, TransactionSigner } from '@solana/kit';
import { useSendTransaction, useSimulateTransaction, useSolanaClient } from '@solana/react-hooks';
import { transactionToBase64 } from '@solana/client';

/** Сводка сухого прогона для UI: логи, ошибка (prepare или симуляции), флаги. */
export type SimState = {
  logs: readonly string[];
  error: unknown;
  loading: boolean;
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

  // encoding обязателен: хук не проставляет его сам, а RPC по умолчанию ждёт base58.
  const query = useSimulateTransaction(base64, { config: { encoding: 'base64' } });

  const simulate = useCallback(
    async (instructions: readonly Instruction[], authority: TransactionSigner) => {
      setPrepareError(null);
      setBase64(null);
      try {
        const prepared = await client.transaction.prepare({ instructions, authority });
        // prepared.message скомпилировано, но НЕ подписано — попапа кошелька нет.
        setBase64(transactionToBase64(prepared.message));
      } catch (e) {
        setPrepareError(e);
      }
    },
    [client],
  );

  const run = useCallback(
    (instructions: readonly Instruction[], authority: TransactionSigner) =>
      send({ instructions, authority }),
    [send],
  );

  const reset = useCallback(() => {
    setBase64(null);
    setPrepareError(null);
    resetSend();
  }, [resetSend]);

  const sim: SimState = {
    logs: query.logs,
    error: prepareError ?? query.error,
    loading: query.isLoading,
    ok: base64 != null && prepareError == null && query.error == null && query.isSuccess,
    ready: base64 != null || prepareError != null,
  };

  return { simulate, run, sim, sending: isSending, sendError, signature, reset };
}
