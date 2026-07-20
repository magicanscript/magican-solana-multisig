import {
  AccountRole,
  address,
  getBase64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { MAX_TX_ACCOUNTS, MAX_TX_DATA } from "./limits";

export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

/** Account metadata exactly in the shape the on-chain `Transaction` stores it. */
export type ProposalAccount = { pubkey: Address; isSigner: boolean; isWritable: boolean };
/** An account for `remaining_accounts` on execute. */
export type Remaining = { address: Address; role: AccountRole };

/**
 * The rent-exempt minimum for a System account with no data.
 *
 * Checked against `getMinimumBalanceForRentExemption(0)` on devnet. The value is hardcoded
 * on purpose (the client-side check must work without an extra RPC call), but one day it
 * will move: the minimum is being lowered and made dynamic (SIMD-0437/0194) — take it from RPC then.
 */
export const RENT_EXEMPT_MIN_LAMPORTS = 890_880n;

/** Why the transfer amount won't go through: the rent rules were verified by a probe on devnet. */
export type AmountIssue =
  | { kind: "remainder"; safeMax: bigint }
  | { kind: "recipient"; needed: bigint };

/**
 * The maximum to withdraw is the whole balance: the runtime allows draining the treasury to
 * zero (the account is simply deleted). Keeping a minimum around is pointless — it would lock up SOL.
 */
export const maxTransferLamports = (treasuryLamports: bigint): bigint => treasuryLamports;

/**
 * After the transfer the treasury must be left either EXACTLY at zero or no lower than the
 * minimum: the runtime rejects an in-between remainder (InsufficientFundsForRent), and that
 * fails on execute — when the approvals are already collected and there is no way to cancel.
 */
export function checkTreasuryRemainder(treasuryLamports: bigint, amount: bigint): AmountIssue | null {
  if (amount >= treasuryLamports) return null; // full withdrawal is fine; a shortfall isn't about rent
  const rest = treasuryLamports - amount;
  if (rest >= RENT_EXEMPT_MIN_LAMPORTS) return null;
  return { kind: "remainder", safeMax: treasuryLamports - RENT_EXEMPT_MIN_LAMPORTS };
}

/**
 * After the transfer the recipient must have enough to be rent-exempt: the runtime rejects a
 * dust transfer to an empty address. The same trap as with the treasury remainder — only on execute.
 */
export function checkRecipientRent(recipientLamports: bigint, amount: bigint): AmountIssue | null {
  if (recipientLamports + amount >= RENT_EXEMPT_MIN_LAMPORTS) return null;
  return { kind: "recipient", needed: RENT_EXEMPT_MIN_LAMPORTS - recipientLamports };
}

/**
 * `remaining_accounts` for execute — built from what the proposal actually stores on-chain
 * (the same for SOL and raw proposals; the creation form has nothing to do with it).
 *
 * We don't raise roles higher than needed: the program signs for the treasury PDA itself
 * via `invoke_signed`, at the outer level the signer privilege is not required (#11).
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
  // We don't raise the roles in remaining higher than needed: invoke_signed provides the
  // signature for the PDA, here the signer privilege is neither required nor requested.
  const remaining: Remaining[] = [
    { address: signerPda, role: AccountRole.WRITABLE },
    { address: recipient, role: AccountRole.WRITABLE },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
  ];
  return { proposalAccounts, data, remaining };
}

/**
 * The nested instruction's data: base64 → bytes.
 *
 * Whitespace and line breaks are stripped — a blob copied from an explorer arrives with
 * them, and kit's decoder chokes on them. The length, however, we check ourselves: on a
 * string whose length is %4==1 the decoder silently drops the trailing character ("SGVsbG8hA"
 * yields the same bytes as "SGVsbG8h"). A blob truncated while copying would thus turn into a
 * proposal with SOMEONE ELSE'S data — and that would surface on execute, where there is no
 * way to cancel the proposal.
 */
export function decodeInstructionData(dataBase64: string): Uint8Array {
  const clean = dataBase64.replace(/\s+/g, "");
  if (clean.length % 4 === 1) {
    throw new Error("Data is truncated: this is not complete base64 — make sure you copied the whole block");
  }
  try {
    // getBase64Encoder, not Buffer: under Turbopack there is no Buffer polyfill in the browser.
    return new Uint8Array(getBase64Encoder().encode(clean));
  } catch {
    throw new Error("Instruction data must be base64");
  }
}

/**
 * Raw mode: nested instructions are supported whose only signer is the treasury PDA (the
 * program signs for it via invoke_signed). Execute cannot supply external signers, so such
 * proposals are cut off here: otherwise a proposal would reach the quorum but could never
 * be executed.
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
      `Only the multisig treasury PDA (${input.signerPda}) may be a signer, ` +
        `but ${foreignSigner.pubkey} was given: such a proposal can never be executed.`,
    );
  }
  if (input.accounts.length > MAX_TX_ACCOUNTS) {
    throw new Error(`Too many accounts: ${input.accounts.length}, maximum ${MAX_TX_ACCOUNTS}`);
  }

  const data = decodeInstructionData(input.dataBase64);
  if (data.length > MAX_TX_DATA) {
    throw new Error(`Instruction data is too large: ${data.length} bytes, maximum ${MAX_TX_DATA}`);
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
