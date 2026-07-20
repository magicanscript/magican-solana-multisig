import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import { deriveMultisigPda, deriveSignerPda, deriveTransactionPda } from "./pdas";

const MS = address("So11111111111111111111111111111111111111112");
const CREATOR = address("SysvarC1ock11111111111111111111111111111111");

describe("pdas", () => {
  it("transaction PDA детерминирована и зависит от index", async () => {
    const a0 = await deriveTransactionPda(MS, 0n);
    const a0b = await deriveTransactionPda(MS, 0n);
    const a1 = await deriveTransactionPda(MS, 1n);
    expect(a0).toBe(a0b);
    expect(a0).not.toBe(a1);
  });

  it("transaction PDA зависит от мультисига", async () => {
    const a = await deriveTransactionPda(MS, 0n);
    const b = await deriveTransactionPda(CREATOR, 0n);
    expect(a).not.toBe(b);
  });

  it("signer PDA отличается от адреса данных мультисига", async () => {
    const signer = await deriveSignerPda(MS);
    expect(signer).not.toBe(MS);
  });

  it("multisig PDA детерминирована и зависит от seed", async () => {
    const a0 = await deriveMultisigPda(CREATOR, 0n);
    const a0b = await deriveMultisigPda(CREATOR, 0n);
    const a1 = await deriveMultisigPda(CREATOR, 1n);
    expect(a0).toBe(a0b);
    expect(a0).not.toBe(a1);
  });

  // Эталон снят с devnet: эти адреса создала САМА программа (мультисиг
  // BWxU3Vb…UZZP, seed = Date.now() на момент создания). Тесты на детерминизм
  // прошли бы и при неверном префиксе сида, и при big-endian индексе — здесь
  // же зафиксирован байт-в-байт результат реальной on-chain деривации.
  describe("эталон с devnet", () => {
    const REAL_CREATOR = address("2xUiPmxzu69ZC21V5EkM9bUGNfj7f142Xsk2ybTXvG82");
    const REAL_SEED = 1_784_211_346_363n;
    const REAL_MULTISIG = address("BWxU3VbNWeP9Q7XDXzbWVNqs2hnpas3JXWNe8Y1PUZZP");
    const REAL_TREASURY = address("89hbftZTLyqhY3WxB6HFSTRpcPA3GUg2jaiDv2sqLPsT");

    it("multisig PDA совпадает с созданной программой", async () => {
      expect(await deriveMultisigPda(REAL_CREATOR, REAL_SEED)).toBe(REAL_MULTISIG);
    });

    it("treasury PDA совпадает с той, что реально хранит SOL", async () => {
      expect(await deriveSignerPda(REAL_MULTISIG)).toBe(REAL_TREASURY);
    });
  });
});
