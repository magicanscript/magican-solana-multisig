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

  // Зонд на живом декодере kit: строка длиной %4==1 декодируется БЕЗ ошибки,
  // молча теряя хвостовой символ ("SGVsbG8hA" → те же 6 байт, что "SGVsbG8h").
  // Блоб, обрезанный при копировании, дал бы предложение с ЧУЖИМИ данными, а
  // выяснилось бы это на execute — где отменить уже нечем.
  it("отвергает обрезанный base64 вместо тихой потери хвоста", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: [],
        dataBase64: "SGVsbG8hA",
      }),
    ).toThrow(/base64/i);
  });

  it("отвергает не-base64", () => {
    expect(() =>
      buildRawNested({
        programId: RECIP,
        signerPda: SIGNER,
        accounts: [],
        dataBase64: "не base64!",
      }),
    ).toThrow(/base64/i);
  });

  // Скопированный из обозревателя блоб часто приходит с переносами строк —
  // декодер kit на пробелах падает, а для пользователя это «валидные данные».
  it("терпит пробелы и переносы внутри base64", () => {
    const { data } = buildRawNested({
      programId: RECIP,
      signerPda: SIGNER,
      accounts: [],
      dataBase64: " SGVs\nbG8h ",
    });
    expect(Array.from(data)).toEqual([...Buffer.from("Hello!")]);
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

describe("remainingFromProposal", () => {
  // execute восстанавливает remaining из того, что реально лежит on-chain,
  // а не из формы: предложение мог создать кто угодно и чем угодно.
  it("маппит is_writable в роли и добавляет program id последним", () => {
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

  // Ключевой инвариант: execute SOL-предложения, восстановленный из on-chain
  // данных, обязан совпасть с тем, что посчитал buildSolTransfer при создании.
  it("для SOL-перевода даёт то же, что buildSolTransfer.remaining", () => {
    const built = buildSolTransfer(SIGNER, RECIP, 5n);
    expect(
      remainingFromProposal({ programId: SYSTEM, accounts: built.proposalAccounts }),
    ).toEqual(built.remaining);
  });

  // Подпись за PDA даёт invoke_signed внутри программы; на внешнем уровне
  // signer-привилегия не нужна и не запрашивается (не поднимаем роль).
  it("не поднимает роль до signer даже для аккаунтов с is_signer", () => {
    const [pda] = remainingFromProposal({
      programId: SYSTEM,
      accounts: [{ pubkey: SIGNER, isSigner: true, isWritable: false }],
    });
    expect(pda.role).toBe(AccountRole.READONLY);
  });
});

// Правила проверены зондом на реальном рантайме devnet (см. docs, точка Task 12):
//   казна: остаток обязан быть либо РОВНО 0 (аккаунт удаляется), либо >= минимума;
//          промежуток → InsufficientFundsForRent на execute;
//   получатель: итоговый баланс >= минимума, иначе InsufficientFundsForRent.
describe("maxTransferLamports", () => {
  // Слив в ноль рантайм разрешает (post = Uninitialized), поэтому MAX — весь баланс.
  it("даёт весь баланс казны: полный вывод разрешён", () => {
    expect(maxTransferLamports(2_000_000_000n)).toBe(2_000_000_000n);
    expect(maxTransferLamports(RENT_EXEMPT_MIN_LAMPORTS)).toBe(RENT_EXEMPT_MIN_LAMPORTS);
    expect(maxTransferLamports(0n)).toBe(0n);
  });
});

describe("checkTreasuryRemainder", () => {
  const TREASURY = 100_000_000n;

  it("полный вывод в ноль — можно", () => {
    expect(checkTreasuryRemainder(TREASURY, TREASURY)).toBeNull();
  });

  it("остаток не меньше минимума — можно", () => {
    expect(checkTreasuryRemainder(TREASURY, TREASURY - RENT_EXEMPT_MIN_LAMPORTS)).toBeNull();
    expect(checkTreasuryRemainder(TREASURY, 1n)).toBeNull();
  });

  // Дыра между «MAX минус минимум» и «весь баланс»: рантайм такое отвергает.
  it("остаток в запрещённом интервале — нельзя, подсказываем безопасный максимум", () => {
    const issue = checkTreasuryRemainder(TREASURY, TREASURY - 500_000n);
    expect(issue).toEqual({ kind: "remainder", safeMax: TREASURY - RENT_EXEMPT_MIN_LAMPORTS });
    expect(checkTreasuryRemainder(TREASURY, TREASURY - RENT_EXEMPT_MIN_LAMPORTS + 1n)).not.toBeNull();
  });

  it("сумма больше баланса казны — это не про ренту, здесь не ошибка", () => {
    expect(checkTreasuryRemainder(TREASURY, TREASURY + 1n)).toBeNull();
  });
});

describe("checkRecipientRent", () => {
  // Главный капкан: падает на execute, когда подписи уже собраны, а отменить
  // предложение нечем — в программе нет ни cancel, ни close.
  it("пыль на пустой адрес — нельзя, сообщаем недостающее", () => {
    expect(checkRecipientRent(0n, 1_000n)).toEqual({
      kind: "recipient",
      needed: RENT_EXEMPT_MIN_LAMPORTS,
    });
  });

  it("ровно минимум на пустой адрес — можно", () => {
    expect(checkRecipientRent(0n, RENT_EXEMPT_MIN_LAMPORTS)).toBeNull();
  });

  it("получателю хватает своего баланса — любая сумма можно", () => {
    expect(checkRecipientRent(RENT_EXEMPT_MIN_LAMPORTS, 1n)).toBeNull();
    expect(checkRecipientRent(500_000_000n, 1_000n)).toBeNull();
  });

  it("баланс получателя добивается переводом до минимума", () => {
    expect(checkRecipientRent(890_000n, 880n)).toBeNull();
    expect(checkRecipientRent(890_000n, 879n)).not.toBeNull();
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
