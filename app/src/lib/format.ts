import type { Address } from '@solana/kit';

/** Сокращает адрес до `ABCD…WXYZ` для компактного показа в UI. */
export function shortAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;
/** Лампорты — u64 on-chain; всё, что выше, невыразимо в инструкции. */
export const MAX_LAMPORTS = 18_446_744_073_709_551_615n;

/** Лампорты (bigint) → строка SOL с обрезкой хвостовых нулей. */
export function lamportsToSol(lamports: bigint, maxFractionDigits = 6): string {
  // Остаток BigInt наследует знак делимого, и минус уезжал в середину строки
  // («0.0-1»). Знак снимаем заранее и возвращаем на место в конце.
  const sign = lamports < 0n ? '-' : '';
  const abs = lamports < 0n ? -lamports : lamports;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = abs % LAMPORTS_PER_SOL;
  if (frac === 0n) return `${sign}${whole}`;
  const fracStr = frac.toString().padStart(9, '0').slice(0, maxFractionDigits).replace(/0+$/, '');
  return fracStr ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`;
}

/**
 * Строка SOL → лампорты, точно. Через Number считать нельзя: `0.1 * 1e9` уже
 * даёт погрешность, а «MAX» обязан отправить ровно ту сумму, что показана.
 */
export function solToLamports(input: string): bigint {
  const s = input.trim();
  if (!/^\d+\.?\d*$|^\.\d+$/.test(s)) {
    throw new Error("Введите сумму в SOL числом, например 0.25");
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 9) {
    throw new Error("Дробнее одного лампорта: не более 9 знаков после точки");
  }
  const lamports = BigInt(whole || "0") * LAMPORTS_PER_SOL + BigInt(frac.padEnd(9, "0"));
  // Кодировщик инструкции (setBigUint64) переполнение НЕ ловит — молча берёт
  // остаток по модулю 2^64, и on-chain уехала бы совсем другая сумма.
  if (lamports > MAX_LAMPORTS) {
    throw new Error("Сумма слишком велика: больше, чем вообще существует лампортов");
  }
  return lamports;
}

/**
 * Склонение «владелец» по числу. Наивное `n === 1 ? 'владелец' : 'владельцев'`
 * давало «2 владельцев»; в русском три формы, и 11–14 — исключение из правила хвоста.
 */
export function pluralOwners(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "владельцев";
  const mod10 = n % 10;
  if (mod10 === 1) return "владелец";
  if (mod10 >= 2 && mod10 <= 4) return "владельца";
  return "владельцев";
}

/** Явное сужение строки к бренду Address (для ссылок/пропсов). */
export const asAddress = (s: string): Address => s as Address;
