import { describe, it, expect } from "vitest";
import { AccountRole, address } from "@solana/kit";
import {
  buildRawNested,
  buildSolTransfer,
  appendRemaining,
  checkRecipientRent,
  checkTreasuryRemainder,
  maxTransferLamports,
  remainingFromProposal,
  RENT_EXEMPT_MIN_LAMPORTS,
} from "./ix";
import { MAX_TX_ACCOUNTS, MAX_TX_DATA } from "./limits";

const SIGNER = address("So11111111111111111111111111111111111111112");
const RECIP = address("SysvarC1ock11111111111111111111111111111111");
const SYSTEM = address("11111111111111111111111111111111");

describe("buildSolTransfer", () => {
  it("encodes System::Transfer (u32=2, then the u64 amount LE)", () => {
    const { data } = buildSolTransfer(SIGNER, RECIP, 1_000_000_000n);
    expect(data.length).toBe(12);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    expect(dv.getUint32(0, true)).toBe(2);
    expect(dv.getBigUint64(4, true)).toBe(1_000_000_000n);
  });

  it("the treasury PDA is the signer, the recipient is writable only", () => {
    const { proposalAccounts } = buildSolTransfer(SIGNER, RECIP, 1n);
    expect(proposalAccounts).toEqual([
      { pubkey: SIGNER, isSigner: true, isWritable: true },
      { pubkey: RECIP, isSigner: false, isWritable: true },
    ]);
  });

  it("remaining includes both sides and the System Program last", () => {
    const { remaining } = buildSolTransfer(SIGNER, RECIP, 1n);
    expect(remaining).toEqual([
      { address: SIGNER, role: AccountRole.WRITABLE },
      { address: RECIP, role: AccountRole.WRITABLE },
      { address: SYSTEM, role: AccountRole.READONLY },
    ]);
  });
});

describe("buildRawNested", () => {
  it("decodes base64 data into bytes", () => {
    const { data } = buildRawNested({
      programId: RECIP,
      signerPda: SIGNER,
      accounts: [{ pubkey: SIGNER, isSigner: true, isWritable: true }],
      dataBase64: Buffer.from([1, 2, 3]).toString("base64"),
    });
    expect(Array.from(data)).toEqual([1, 2, 3]);
  });

  // execute signs only for the treasury PDA (invoke_signed). If someone else's account is
  // marked as a signer, the proposal will reach the quorum, but it will NEVER be possible
  // to execute it — MissingRequiredSignature. We catch this before creation.
  it("rejects a signer that is not the treasury PDA", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: [{ pubkey: RECIP, isSigner: true, isWritable: true }],
        dataBase64: "",
      }),
    ).toThrow(/signer/i);
  });

  it("allows a signer if it is the treasury PDA", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: [{ pubkey: SIGNER, isSigner: true, isWritable: true }],
        dataBase64: "",
      }),
    ).not.toThrow();
  });

  it("maps is_writable to roles and adds the program id last", () => {
    const { remaining } = buildRawNested({
      programId: RECIP,
      signerPda: SIGNER,
      accounts: [
        { pubkey: SIGNER, isSigner: true, isWritable: true },
        { pubkey: SYSTEM, isSigner: false, isWritable: false },
      ],
      dataBase64: "",
    });
    expect(remaining).toEqual([
      { address: SIGNER, role: AccountRole.WRITABLE },
      { address: SYSTEM, role: AccountRole.READONLY },
      { address: RECIP, role: AccountRole.READONLY },
    ]);
  });

  it("rejects more than MAX_TX_ACCOUNTS accounts", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: Array.from({ length: MAX_TX_ACCOUNTS + 1 }, () => ({
          pubkey: RECIP,
          isSigner: false,
          isWritable: false,
        })),
        dataBase64: "",
      }),
    ).toThrow(/accounts/i);
  });

  it("rejects data longer than MAX_TX_DATA", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: [],
        dataBase64: Buffer.alloc(MAX_TX_DATA + 1).toString("base64"),
      }),
    ).toThrow(/data/i);
  });

  // A probe against kit's live decoder: a string whose length is %4==1 decodes WITHOUT an
  // error, silently losing the trailing character ("SGVsbG8hA" → the same 6 bytes as "SGVsbG8h").
  // A blob truncated while copying would give a proposal with SOMEONE ELSE'S data, and that
  // would surface on execute — where there is nothing left to cancel with.
  it("rejects truncated base64 instead of silently losing the tail", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: [],
        dataBase64: "SGVsbG8hA",
      }),
    ).toThrow(/base64/i);
  });

  it("rejects non-base64", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: [],
        dataBase64: "not base64!",
      }),
    ).toThrow(/base64/i);
  });

  // A blob copied from an explorer often arrives with line breaks — kit's decoder chokes
  // on whitespace, while for the user this is "valid data".
  it("tolerates spaces and line breaks inside base64", () => {
    const { data } = buildRawNested({
      programId: RECIP,
      signerPda: SIGNER,
      accounts: [],
      dataBase64: " SGVs\nbG8h ",
    });
    expect(Array.from(data)).toEqual([...Buffer.from("Hello!")]);
  });

  it("accepts exactly the boundary values of the limits", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: Array.from({ length: MAX_TX_ACCOUNTS }, () => ({
          pubkey: RECIP,
          isSigner: false,
          isWritable: false,
        })),
        dataBase64: Buffer.alloc(MAX_TX_DATA).toString("base64"),
      }),
    ).not.toThrow();
  });
});

describe("remainingFromProposal", () => {
  // execute restores remaining from what actually lies on-chain, not from the form:
  // the proposal could have been created by anyone with anything.
  it("maps is_writable to roles and adds the program id last", () => {
    expect(
      remainingFromProposal({
        programId: RECIP,
        accounts: [
          { pubkey: SIGNER, isSigner: true, isWritable: true },
          { pubkey: SYSTEM, isSigner: false, isWritable: false },
        ],
      }),
    ).toEqual([
      { address: SIGNER, role: AccountRole.WRITABLE },
      { address: SYSTEM, role: AccountRole.READONLY },
      { address: RECIP, role: AccountRole.READONLY },
    ]);
  });

  // The key invariant: the execute of a SOL proposal, restored from on-chain data,
  // must match what buildSolTransfer computed at creation time.
  it("for a SOL transfer yields the same as buildSolTransfer.remaining", () => {
    const built = buildSolTransfer(SIGNER, RECIP, 5n);
    expect(
      remainingFromProposal({ programId: SYSTEM, accounts: built.proposalAccounts }),
    ).toEqual(built.remaining);
  });

  // invoke_signed inside the program provides the signature for the PDA; at the outer
  // level the signer privilege is not needed and not requested (we don't raise the role).
  it("does not raise the role to signer even for accounts with is_signer", () => {
    const [pda] = remainingFromProposal({
      programId: SYSTEM,
      accounts: [{ pubkey: SIGNER, isSigner: true, isWritable: false }],
    });
    expect(pda.role).toBe(AccountRole.READONLY);
  });
});

// The rules were verified by a probe against the real devnet runtime (see docs, Task 12 point):
//   treasury: the remainder must be either EXACTLY 0 (the account is deleted) or >= the minimum;
//             anything in between → InsufficientFundsForRent on execute;
//   recipient: the resulting balance >= the minimum, otherwise InsufficientFundsForRent.
describe("maxTransferLamports", () => {
  // The runtime allows draining to zero (post = Uninitialized), so MAX is the whole balance.
  it("yields the whole treasury balance: a full withdrawal is allowed", () => {
    expect(maxTransferLamports(2_000_000_000n)).toBe(2_000_000_000n);
    expect(maxTransferLamports(RENT_EXEMPT_MIN_LAMPORTS)).toBe(RENT_EXEMPT_MIN_LAMPORTS);
    expect(maxTransferLamports(0n)).toBe(0n);
  });
});

describe("checkTreasuryRemainder", () => {
  const TREASURY = 100_000_000n;

  it("a full withdrawal to zero is fine", () => {
    expect(checkTreasuryRemainder(TREASURY, TREASURY)).toBeNull();
  });

  it("a remainder no smaller than the minimum is fine", () => {
    expect(checkTreasuryRemainder(TREASURY, TREASURY - RENT_EXEMPT_MIN_LAMPORTS)).toBeNull();
    expect(checkTreasuryRemainder(TREASURY, 1n)).toBeNull();
  });

  // The hole between "MAX minus the minimum" and "the whole balance": the runtime rejects that.
  it("a remainder in the forbidden interval is not allowed, we hint the safe maximum", () => {
    const issue = checkTreasuryRemainder(TREASURY, TREASURY - 500_000n);
    expect(issue).toEqual({ kind: "remainder", safeMax: TREASURY - RENT_EXEMPT_MIN_LAMPORTS });
    expect(checkTreasuryRemainder(TREASURY, TREASURY - RENT_EXEMPT_MIN_LAMPORTS + 1n)).not.toBeNull();
  });

  it("an amount larger than the treasury balance is not about rent, no error here", () => {
    expect(checkTreasuryRemainder(TREASURY, TREASURY + 1n)).toBeNull();
  });
});

describe("checkRecipientRent", () => {
  // The main trap: it fails on execute, when the approvals are already collected and there
  // is nothing to cancel the proposal with — the program has neither cancel nor close.
  it("dust to an empty address is not allowed, we report what is missing", () => {
    expect(checkRecipientRent(0n, 1_000n)).toEqual({
      kind: "recipient",
      needed: RENT_EXEMPT_MIN_LAMPORTS,
    });
  });

  it("exactly the minimum to an empty address is fine", () => {
    expect(checkRecipientRent(0n, RENT_EXEMPT_MIN_LAMPORTS)).toBeNull();
  });

  it("the recipient's own balance is enough — any amount is fine", () => {
    expect(checkRecipientRent(RENT_EXEMPT_MIN_LAMPORTS, 1n)).toBeNull();
    expect(checkRecipientRent(500_000_000n, 1_000n)).toBeNull();
  });

  it("the recipient's balance is topped up to the minimum by the transfer", () => {
    expect(checkRecipientRent(890_000n, 880n)).toBeNull();
    expect(checkRecipientRent(890_000n, 879n)).not.toBeNull();
  });
});

describe("appendRemaining", () => {
  it("appends the remaining accounts after the existing ones", () => {
    const execIx = {
      programAddress: RECIP,
      accounts: [{ address: SIGNER, role: AccountRole.READONLY }],
    };
    const out = appendRemaining(execIx, [{ address: SYSTEM, role: AccountRole.WRITABLE }]);
    expect(out.accounts).toEqual([
      { address: SIGNER, role: AccountRole.READONLY },
      { address: SYSTEM, role: AccountRole.WRITABLE },
    ]);
  });
});
