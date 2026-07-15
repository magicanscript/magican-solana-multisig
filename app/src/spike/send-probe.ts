// Временный зонд: проверяем, что инструкции Codama (типизированы под kit 7)
// принимаются API framework-kit, который внутри держит kit 5.5.1.
import type { TransactionPrepareAndSendRequest } from "@solana/client";
import {
  getApproveInstruction,
  getCreateTransactionInstruction,
  getExecuteTransactionInstructionAsync,
  getCreateMultisigInstructionAsync,
} from "@generated";

type CreateMultisigIx = Awaited<ReturnType<typeof getCreateMultisigInstructionAsync>>;
type ExecuteIx = Awaited<ReturnType<typeof getExecuteTransactionInstructionAsync>>;
type ApproveIx = ReturnType<typeof getApproveInstruction>;
type CreateTxIx = ReturnType<typeof getCreateTransactionInstruction>;

declare const createMultisigIx: CreateMultisigIx;
declare const executeIx: ExecuteIx;
declare const approveIx: ApproveIx;
declare const createTxIx: CreateTxIx;

// Если типы kit7 и kit5 несовместимы — здесь будет ошибка компиляции.
export const probeCreateMultisig: TransactionPrepareAndSendRequest = {
  instructions: [createMultisigIx],
};
export const probeApprove: TransactionPrepareAndSendRequest = { instructions: [approveIx] };
export const probeCreateTx: TransactionPrepareAndSendRequest = { instructions: [createTxIx] };
export const probeExecute: TransactionPrepareAndSendRequest = { instructions: [executeIx] };

// Смешанный батч — как в реальном флоу.
export const probeBatch: TransactionPrepareAndSendRequest = {
  instructions: [createTxIx, approveIx, executeIx],
};
