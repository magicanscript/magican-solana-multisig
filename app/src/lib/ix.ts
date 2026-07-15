import {
  AccountRole,
  address,
  getBase64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { MAX_TX_ACCOUNTS, MAX_TX_DATA } from "./limits";

export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

/** Метаданные аккаунта в том виде, в каком их хранит on-chain `Transaction`. */
export type ProposalAccount = { pubkey: Address; isSigner: boolean; isWritable: boolean };
/** Аккаунт для `remaining_accounts` при execute. */
export type Remaining = { address: Address; role: AccountRole };

export function buildSolTransfer(signerPda: Address, recipient: Address, amount: bigint) {
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true); // System::Transfer
  dv.setBigUint64(4, amount, true);

  const proposalAccounts: ProposalAccount[] = [
    { pubkey: signerPda, isSigner: true, isWritable: true },
    { pubkey: recipient, isSigner: false, isWritable: true },
  ];
  // Роли в remaining не поднимаем выше нужного: подпись за PDA даёт invoke_signed,
  // здесь signer-привилегия не требуется и не запрашивается.
  const remaining: Remaining[] = [
    { address: signerPda, role: AccountRole.WRITABLE },
    { address: recipient, role: AccountRole.WRITABLE },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
  ];
  return { proposalAccounts, data, remaining };
}

/**
 * Raw-режим: поддерживаются вложенные инструкции, единственный подписант которых —
 * treasury-PDA (за него подписывает программа через invoke_signed). Внешних
 * подписантов execute предоставить не может, поэтому такие предложения отсекаем
 * здесь: иначе предложение наберёт кворум, но исполнить его будет нельзя никогда.
 */
export function buildRawNested(input: {
  programId: Address;
  signerPda: Address;
  accounts: ProposalAccount[];
  dataBase64: string;
}) {
  const foreignSigner = input.accounts.find((a) => a.isSigner && a.pubkey !== input.signerPda);
  if (foreignSigner) {
    throw new Error(
      `Подписантом может быть только treasury-PDA мультисига (${input.signerPda}), ` +
        `а указан ${foreignSigner.pubkey}: такое предложение невозможно исполнить.`,
    );
  }
  if (input.accounts.length > MAX_TX_ACCOUNTS) {
    throw new Error(`Слишком много аккаунтов: ${input.accounts.length}, максимум ${MAX_TX_ACCOUNTS}`);
  }

  // getBase64Encoder, а не Buffer: под Turbopack полифила Buffer в браузере нет.
  const data = new Uint8Array(getBase64Encoder().encode(input.dataBase64));
  if (data.length > MAX_TX_DATA) {
    throw new Error(`Данные инструкции слишком велики: ${data.length} байт, максимум ${MAX_TX_DATA}`);
  }
  const remaining: Remaining[] = [
    ...input.accounts.map((a) => ({
      address: a.pubkey,
      role: a.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
    })),
    { address: input.programId, role: AccountRole.READONLY },
  ];
  return { programId: input.programId, proposalAccounts: input.accounts, data, remaining };
}

export const appendRemaining = <T extends Instruction>(execIx: T, remaining: Remaining[]): T => ({
  ...execIx,
  accounts: [...(execIx.accounts ?? []), ...remaining],
});
