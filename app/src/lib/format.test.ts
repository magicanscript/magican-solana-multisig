import { describe, it, expect } from "vitest";
import { lamportsToSol, pluralOwners, shortAddress, solToLamports } from "./format";

describe("pluralOwners", () => {
  it("uses the singular only for exactly one", () => {
    expect(pluralOwners(1)).toBe("owner");
    expect(pluralOwners(2)).toBe("owners");
    expect(pluralOwners(4)).toBe("owners");
    expect(pluralOwners(5)).toBe("owners");
    expect(pluralOwners(10)).toBe("owners");
  });

  it("holds the edge cases: teens and tails", () => {
    expect(pluralOwners(11)).toBe("owners");
    expect(pluralOwners(12)).toBe("owners");
    expect(pluralOwners(14)).toBe("owners");
    expect(pluralOwners(21)).toBe("owners");
    expect(pluralOwners(22)).toBe("owners");
    expect(pluralOwners(0)).toBe("owners");
  });
});

describe("solToLamports", () => {
  it("converts whole and fractional SOL into lamports", () => {
    expect(solToLamports("1")).toBe(1_000_000_000n);
    expect(solToLamports("0.1")).toBe(100_000_000n);
    expect(solToLamports("0")).toBe(0n);
    expect(solToLamports("2.5")).toBe(2_500_000_000n);
  });

  it("holds precision down to a lamport (where a float already lies)", () => {
    expect(solToLamports("0.000000001")).toBe(1n);
    // 1.109120 SOL = a balance of 2 SOL minus the rent-exempt minimum: a typical "MAX" result.
    expect(solToLamports("1.10912")).toBe(1_109_120_000n);
  });

  it("accepts the form without a leading/trailing zero", () => {
    expect(solToLamports("1.")).toBe(1_000_000_000n);
    expect(solToLamports(".5")).toBe(500_000_000n);
  });

  it("ignores surrounding whitespace", () => {
    expect(solToLamports("  0.25  ")).toBe(250_000_000n);
  });

  it("rejects non-numbers, negatives and an empty string", () => {
    for (const bad of ["", "  ", "abc", "-1", "1,5", "1e9", "1.2.3", "."]) {
      expect(() => solToLamports(bad), bad).toThrow(/amount|number/i);
    }
  });

  // Finer than a lamport is not a user mistake but an inexpressible value: silently rounding
  // is not allowed, otherwise "MAX" would send something other than what is displayed.
  it("rejects more than 9 digits after the point", () => {
    expect(() => solToLamports("0.0000000001")).toThrow(/9|lamport/i);
  });

  // setBigUint64 wraps modulo 2^64 WITHOUT an exception: 18446744074 SOL would have gone
  // on-chain as 0.29 SOL. We catch the boundary here, before the encoder.
  it("rejects amounts larger than u64", () => {
    const u64Max = 18_446_744_073_709_551_615n;
    expect(solToLamports("18446744073.709551615")).toBe(u64Max);
    expect(() => solToLamports("18446744073.709551616")).toThrow(/too large/i);
    expect(() => solToLamports("18446744074")).toThrow(/too large/i);
    expect(() => solToLamports("20000000000")).toThrow(/too large/i);
  });
});

describe("lamportsToSol", () => {
  it("rounds down and trims the trailing zeros", () => {
    expect(lamportsToSol(1_000_000_000n)).toBe("1");
    expect(lamportsToSol(1_500_000_000n)).toBe("1.5");
    expect(lamportsToSol(0n)).toBe("0");
  });

  // The reverse path of "MAX": what is shown in the field must parse back without losses.
  it("round-trips with solToLamports at full precision", () => {
    const lamports = 2_000_000_000n - 890_880n;
    expect(solToLamports(lamportsToSol(lamports, 9))).toBe(lamports);
  });

  it("keeps the leading zeros in the fractional part", () => {
    expect(lamportsToSol(1_000_000n)).toBe("0.001");
    expect(lamportsToSol(10n, 9)).toBe("0.00000001");
  });

  // The dividend's sign on a BigInt remainder broke the layout of the string: it came out as "0.0-1".
  it("shows negatives correctly, not as junk in the middle of the string", () => {
    expect(lamportsToSol(-1_500_000_000n)).toBe("-1.5");
    expect(lamportsToSol(-1_000_000n)).toBe("-0.001");
    expect(lamportsToSol(-1n, 9)).toBe("-0.000000001");
  });
});

describe("shortAddress", () => {
  it("shortens a long address and leaves a short one alone", () => {
    expect(shortAddress("11111111111111111111111111111111")).toBe("1111…1111");
    expect(shortAddress("abc")).toBe("abc");
  });
});
