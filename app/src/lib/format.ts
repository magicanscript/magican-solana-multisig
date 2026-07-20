import type { Address } from '@solana/kit';

/** Shortens an address to `ABCD…WXYZ` for a compact display in the UI. */
export function shortAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;
/** Lamports are a u64 on-chain; anything above that is inexpressible in an instruction. */
export const MAX_LAMPORTS = 18_446_744_073_709_551_615n;

/** Lamports (bigint) → a SOL string with the trailing zeros trimmed. */
export function lamportsToSol(lamports: bigint, maxFractionDigits = 6): string {
  // A BigInt remainder inherits the sign of the dividend, and the minus drifted into the
  // middle of the string ("0.0-1"). We strip the sign up front and put it back at the end.
  const sign = lamports < 0n ? '-' : '';
  const abs = lamports < 0n ? -lamports : lamports;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = abs % LAMPORTS_PER_SOL;
  if (frac === 0n) return `${sign}${whole}`;
  const fracStr = frac.toString().padStart(9, '0').slice(0, maxFractionDigits).replace(/0+$/, '');
  return fracStr ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`;
}

/**
 * A SOL string → lamports, exactly. Going through Number is not allowed: `0.1 * 1e9` already
 * gives an error, while "MAX" must send exactly the amount that is displayed.
 */
export function solToLamports(input: string): bigint {
  const s = input.trim();
  if (!/^\d+\.?\d*$|^\.\d+$/.test(s)) {
    throw new Error("Enter the amount in SOL as a number, e.g. 0.25");
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 9) {
    throw new Error("Finer than a single lamport: no more than 9 digits after the point");
  }
  const lamports = BigInt(whole || "0") * LAMPORTS_PER_SOL + BigInt(frac.padEnd(9, "0"));
  // The instruction encoder (setBigUint64) does NOT catch the overflow — it silently takes
  // the remainder modulo 2^64, and a completely different amount would go on-chain.
  if (lamports > MAX_LAMPORTS) {
    throw new Error("The amount is too large: more than the lamports that exist at all");
  }
  return lamports;
}

/** The plural form of "owner" by count. */
export function pluralOwners(n: number): string {
  return n === 1 ? "owner" : "owners";
}

/** An explicit narrowing of a string to the Address brand (for links/props). */
export const asAddress = (s: string): Address => s as Address;
