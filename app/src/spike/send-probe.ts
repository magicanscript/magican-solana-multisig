// Temporary probe: check that Codama instructions (typed against kit 7) are accepted
// by the framework-kit API, which internally holds kit 5.5.1.
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

// If the kit7 and kit5 types are incompatible, this fails to compile.
export const probeCreateMultisig: TransactionPrepareAndSendRequest = {
  instructions: [createMultisigIx],
};
export const probeApprove: TransactionPrepareAndSendRequest = { instructions: [approveIx] };
export const probeCreateTx: TransactionPrepareAndSendRequest = { instructions: [createTxIx] };
export const probeExecute: TransactionPrepareAndSendRequest = { instructions: [executeIx] };

// A mixed batch — as in the real flow.
export const probeBatch: TransactionPrepareAndSendRequest = {
  instructions: [createTxIx, approveIx, executeIx],
};
