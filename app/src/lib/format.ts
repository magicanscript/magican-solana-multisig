import type { Address } from '@solana/kit';

/** Сокращает адрес до `ABCD…WXYZ` для компактного показа в UI. */
export function shortAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Лампорты (bigint) → строка SOL с обрезкой хвостовых нулей. */
export function lamportsToSol(lamports: bigint, maxFractionDigits = 6): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = lamports % LAMPORTS_PER_SOL;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(9, '0').slice(0, maxFractionDigits).replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/** Явное сужение строки к бренду Address (для ссылок/пропсов). */
export const asAddress = (s: string): Address => s as Address;
