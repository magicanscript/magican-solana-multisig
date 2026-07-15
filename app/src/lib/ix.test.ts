import { describe, it, expect } from "vitest";
import { AccountRole, address } from "@solana/kit";
import { buildRawNested, buildSolTransfer, appendRemaining } from "./ix";
import { MAX_TX_ACCOUNTS, MAX_TX_DATA } from "./limits";

const SIGNER = address("So11111111111111111111111111111111111111112");
const RECIP = address("SysvarC1ock11111111111111111111111111111111");
const SYSTEM = address("11111111111111111111111111111111");

describe("buildSolTransfer", () => {
  it("кодирует System::Transfer (u32=2, затем u64 amount LE)", () => {
    const { data } = buildSolTransfer(SIGNER, RECIP, 1_000_000_000n);
    expect(data.length).toBe(12);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    expect(dv.getUint32(0, true)).toBe(2);
    expect(dv.getBigUint64(4, true)).toBe(1_000_000_000n);
  });

  it("treasury-PDA — подписант, получатель — только writable", () => {
    const { proposalAccounts } = buildSolTransfer(SIGNER, RECIP, 1n);
    expect(proposalAccounts).toEqual([
      { pubkey: SIGNER, isSigner: true, isWritable: true },
      { pubkey: RECIP, isSigner: false, isWritable: true },
    ]);
  });

  it("remaining включает обе стороны и System Program последним", () => {
    const { remaining } = buildSolTransfer(SIGNER, RECIP, 1n);
    expect(remaining).toEqual([
      { address: SIGNER, role: AccountRole.WRITABLE },
      { address: RECIP, role: AccountRole.WRITABLE },
      { address: SYSTEM, role: AccountRole.READONLY },
    ]);
  });
});

describe("buildRawNested", () => {
  it("декодирует base64-данные в байты", () => {
    const { data } = buildRawNested({
      programId: RECIP,
      signerPda: SIGNER,
      accounts: [{ pubkey: SIGNER, isSigner: true, isWritable: true }],
      dataBase64: Buffer.from([1, 2, 3]).toString("base64"),
    });
    expect(Array.from(data)).toEqual([1, 2, 3]);
  });

  // execute подписывает только за treasury-PDA (invoke_signed). Если пометить
  // подписантом чужой аккаунт, предложение наберёт кворум, но исполнить его
  // будет нельзя НИКОГДА — MissingRequiredSignature. Ловим это до создания.
  it("отвергает подписанта, который не является treasury-PDA", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: [{ pubkey: RECIP, isSigner: true, isWritable: true }],
        dataBase64: "",
      }),
    ).toThrow(/подписант|signer/i);
  });

  it("разрешает подписанта, если это treasury-PDA", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: [{ pubkey: SIGNER, isSigner: true, isWritable: true }],
        dataBase64: "",
      }),
    ).not.toThrow();
  });

  it("маппит is_writable в роли и добавляет program id последним", () => {
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

  it("отвергает больше MAX_TX_ACCOUNTS аккаунтов", () => {
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
    ).toThrow(/аккаунт/i);
  });

  it("отвергает данные длиннее MAX_TX_DATA", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: [],
        dataBase64: Buffer.alloc(MAX_TX_DATA + 1).toString("base64"),
      }),
    ).toThrow(/данны/i);
  });

  it("принимает ровно граничные значения лимитов", () => {
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

describe("appendRemaining", () => {
  it("дописывает remaining-аккаунты в хвост существующих", () => {
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
