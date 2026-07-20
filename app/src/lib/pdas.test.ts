import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import { deriveMultisigPda, deriveSignerPda, deriveTransactionPda } from "./pdas";

const MS = address("So11111111111111111111111111111111111111112");
const CREATOR = address("SysvarC1ock11111111111111111111111111111111");

describe("pdas", () => {
  it("the transaction PDA is deterministic and depends on the index", async () => {
    const a0 = await deriveTransactionPda(MS, 0n);
    const a0b = await deriveTransactionPda(MS, 0n);
    const a1 = await deriveTransactionPda(MS, 1n);
    expect(a0).toBe(a0b);
    expect(a0).not.toBe(a1);
  });

  it("the transaction PDA depends on the multisig", async () => {
    const a = await deriveTransactionPda(MS, 0n);
    const b = await deriveTransactionPda(CREATOR, 0n);
    expect(a).not.toBe(b);
  });

  it("the signer PDA differs from the multisig data address", async () => {
    const signer = await deriveSignerPda(MS);
    expect(signer).not.toBe(MS);
  });

  it("the multisig PDA is deterministic and depends on the seed", async () => {
    const a0 = await deriveMultisigPda(CREATOR, 0n);
    const a0b = await deriveMultisigPda(CREATOR, 0n);
    const a1 = await deriveMultisigPda(CREATOR, 1n);
    expect(a0).toBe(a0b);
    expect(a0).not.toBe(a1);
  });

  // The reference was taken from devnet: these addresses were created by the program ITSELF
  // (multisig BWxU3Vb…UZZP, seed = Date.now() at creation time). Determinism tests would pass
  // with a wrong seed prefix and with a big-endian index too — here the byte-for-byte result
  // of the real on-chain derivation is pinned down.
  describe("the devnet reference", () => {
    const REAL_CREATOR = address("2xUiPmxzu69ZC21V5EkM9bUGNfj7f142Xsk2ybTXvG82");
    const REAL_SEED = 1_784_211_346_363n;
    const REAL_MULTISIG = address("BWxU3VbNWeP9Q7XDXzbWVNqs2hnpas3JXWNe8Y1PUZZP");
    const REAL_TREASURY = address("89hbftZTLyqhY3WxB6HFSTRpcPA3GUg2jaiDv2sqLPsT");

    it("the multisig PDA matches the one the program created", async () => {
      expect(await deriveMultisigPda(REAL_CREATOR, REAL_SEED)).toBe(REAL_MULTISIG);
    });

    it("the treasury PDA matches the one that actually holds the SOL", async () => {
      expect(await deriveSignerPda(REAL_MULTISIG)).toBe(REAL_TREASURY);
    });
  });
});
