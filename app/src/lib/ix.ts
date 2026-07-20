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

/**
 * Rent-exempt минимум для System-аккаунта без данных.
 *
 * Сверено с `getMinimumBalanceForRentExemption(0)` на devnet. Значение зафиксировано
 * намеренно (клиентская проверка должна работать без лишнего RPC), но однажды оно
 * поедет: минимум снижают и делают динамическим (SIMD-0437/0194) — тогда брать с RPC.
 */
export const RENT_EXEMPT_MIN_LAMPORTS = 890_880n;

/** Почему сумма перевода не пройдёт: правила ренты проверены зондом на devnet. */
export type AmountIssue =
  | { kind: "remainder"; safeMax: bigint }
  | { kind: "recipient"; needed: bigint };

/**
 * Максимум к выводу — весь баланс: рантайм разрешает опустошить казну в ноль
 * (аккаунт просто удаляется). Оставлять минимум незачем — это заперло бы SOL.
 */
export const maxTransferLamports = (treasuryLamports: bigint): bigint => treasuryLamports;

/**
 * Казна после перевода обязана остаться либо РОВНО в нуле, либо не ниже минимума:
 * промежуточный остаток рантайм отвергает (InsufficientFundsForRent), и упадёт это
 * на execute — когда подписи уже собраны, а отменить предложение нечем.
 */
export function checkTreasuryRemainder(treasuryLamports: bigint, amount: bigint): AmountIssue | null {
  if (amount >= treasuryLamports) return null; // полный вывод — можно; нехватка — не про ренту
  const rest = treasuryLamports - amount;
  if (rest >= RENT_EXEMPT_MIN_LAMPORTS) return null;
  return { kind: "remainder", safeMax: treasuryLamports - RENT_EXEMPT_MIN_LAMPORTS };
}

/**
 * Получателю после перевода обязано хватить на rent-exempt: перевод пыли на пустой
 * адрес рантайм отвергает. Тот же капкан, что и с остатком казны, — только на execute.
 */
export function checkRecipientRent(recipientLamports: bigint, amount: bigint): AmountIssue | null {
  if (recipientLamports + amount >= RENT_EXEMPT_MIN_LAMPORTS) return null;
  return { kind: "recipient", needed: RENT_EXEMPT_MIN_LAMPORTS - recipientLamports };
}

/**
 * `remaining_accounts` для execute — из того, что предложение реально хранит on-chain
 * (одинаково для SOL- и raw-предложений; форма создания тут ни при чём).
 *
 * Роли не поднимаем выше нужного: подпись за treasury-PDA программа ставит сама
 * через `invoke_signed`, на внешнем уровне signer-привилегия не требуется (#11).
 */
export const remainingFromProposal = (proposal: {
  programId: Address;
  accounts: readonly ProposalAccount[];
}): Remaining[] => [
  ...proposal.accounts.map((a) => ({
    address: a.pubkey,
    role: a.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
  })),
  { address: proposal.programId, role: AccountRole.READONLY },
];

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
 * Данные вложенной инструкции: base64 → байты.
 *
 * Пробелы и переносы вырезаем — скопированный из обозревателя блоб приходит с
 * ними, а декодер kit на них падает. А вот длину проверяем сами: на строке
 * длиной %4==1 декодер молча роняет хвостовой символ («SGVsbG8hA» даёт те же
 * байты, что «SGVsbG8h»). Обрезанный при копировании блоб так превратился бы в
 * предложение с ЧУЖИМИ данными — и выяснилось бы это на execute, где отменить
 * предложение нечем.
 */
export function decodeInstructionData(dataBase64: string): Uint8Array {
  const clean = dataBase64.replace(/\s+/g, "");
  if (clean.length % 4 === 1) {
    throw new Error("Данные обрезаны: это не целый base64 — проверьте, что скопировали блок целиком");
  }
  try {
    // getBase64Encoder, а не Buffer: под Turbopack полифила Buffer в браузере нет.
    return new Uint8Array(getBase64Encoder().encode(clean));
  } catch {
    throw new Error("Данные инструкции должны быть в base64");
  }
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

  const data = decodeInstructionData(input.dataBase64);
  if (data.length > MAX_TX_DATA) {
    throw new Error(`Данные инструкции слишком велики: ${data.length} байт, максимум ${MAX_TX_DATA}`);
  }
  const remaining = remainingFromProposal({
    programId: input.programId,
    accounts: input.accounts,
  });
  return { programId: input.programId, proposalAccounts: input.accounts, data, remaining };
}

export const appendRemaining = <T extends Instruction>(execIx: T, remaining: Remaining[]): T => ({
  ...execIx,
  accounts: [...(execIx.accounts ?? []), ...remaining],
});
