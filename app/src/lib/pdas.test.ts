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
});
