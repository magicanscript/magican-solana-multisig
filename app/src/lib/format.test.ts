import { describe, it, expect } from "vitest";
import { lamportsToSol, pluralOwners, shortAddress, solToLamports } from "./format";

describe("pluralOwners", () => {
  it("склоняет по правилам русского, а не по !== 1", () => {
    expect(pluralOwners(1)).toBe("владелец");
    expect(pluralOwners(2)).toBe("владельца");
    expect(pluralOwners(4)).toBe("владельца");
    expect(pluralOwners(5)).toBe("владельцев");
    expect(pluralOwners(10)).toBe("владельцев");
  });

  it("держит подлые случаи: 11-14 и хвосты", () => {
    expect(pluralOwners(11)).toBe("владельцев");
    expect(pluralOwners(12)).toBe("владельцев");
    expect(pluralOwners(14)).toBe("владельцев");
    expect(pluralOwners(21)).toBe("владелец");
    expect(pluralOwners(22)).toBe("владельца");
    expect(pluralOwners(0)).toBe("владельцев");
  });
});

describe("solToLamports", () => {
  it("переводит целые и дробные SOL в лампорты", () => {
    expect(solToLamports("1")).toBe(1_000_000_000n);
    expect(solToLamports("0.1")).toBe(100_000_000n);
    expect(solToLamports("0")).toBe(0n);
    expect(solToLamports("2.5")).toBe(2_500_000_000n);
  });

  it("держит точность до лампорта (там, где float уже врёт)", () => {
    expect(solToLamports("0.000000001")).toBe(1n);
    // 1.109120 SOL = баланс 2 SOL минус rent-exempt минимум: типичный результат «MAX».
    expect(solToLamports("1.10912")).toBe(1_109_120_000n);
  });

  it("допускает форму без ведущего/хвостового нуля", () => {
    expect(solToLamports("1.")).toBe(1_000_000_000n);
    expect(solToLamports(".5")).toBe(500_000_000n);
  });

  it("игнорирует окружающие пробелы", () => {
    expect(solToLamports("  0.25  ")).toBe(250_000_000n);
  });

  it("отвергает не-числа, отрицательные и пустую строку", () => {
    for (const bad of ["", "  ", "abc", "-1", "1,5", "1e9", "1.2.3", "."]) {
      expect(() => solToLamports(bad), bad).toThrow(/сумм|числ/i);
    }
  });

  // Дробнее лампорта — не ошибка пользователя, а невыразимая величина: молча
  // округлять нельзя, иначе «MAX» отправит не то, что показано.
  it("отвергает больше 9 знаков после точки", () => {
    expect(() => solToLamports("0.0000000001")).toThrow(/9|лампорт/i);
  });

  // setBigUint64 оборачивает по модулю 2^64 БЕЗ исключения: 18446744074 SOL уехали
  // бы on-chain как 0.29 SOL. Ловим границу здесь, до кодировщика.
  it("отвергает суммы больше u64", () => {
    const u64Max = 18_446_744_073_709_551_615n;
    expect(solToLamports("18446744073.709551615")).toBe(u64Max);
    expect(() => solToLamports("18446744073.709551616")).toThrow(/велик/i);
    expect(() => solToLamports("18446744074")).toThrow(/велик/i);
    expect(() => solToLamports("20000000000")).toThrow(/велик/i);
  });
});

describe("lamportsToSol", () => {
  it("округляет вниз и обрезает хвостовые нули", () => {
    expect(lamportsToSol(1_000_000_000n)).toBe("1");
    expect(lamportsToSol(1_500_000_000n)).toBe("1.5");
    expect(lamportsToSol(0n)).toBe("0");
  });

  // Обратный путь «MAX»: показанное в поле должно парситься назад без потерь.
  it("round-trip с solToLamports при полной точности", () => {
    const lamports = 2_000_000_000n - 890_880n;
    expect(solToLamports(lamportsToSol(lamports, 9))).toBe(lamports);
  });

  it("сохраняет ведущие нули в дробной части", () => {
    expect(lamportsToSol(1_000_000n)).toBe("0.001");
    expect(lamportsToSol(10n, 9)).toBe("0.00000001");
  });

  // Знак делимого у BigInt-остатка ломал вёрстку строки: получалось "0.0-1".
  it("корректно показывает отрицательные, а не мусор в середине строки", () => {
    expect(lamportsToSol(-1_500_000_000n)).toBe("-1.5");
    expect(lamportsToSol(-1_000_000n)).toBe("-0.001");
    expect(lamportsToSol(-1n, 9)).toBe("-0.000000001");
  });
});

describe("shortAddress", () => {
  it("сокращает длинный адрес и не трогает короткий", () => {
    expect(shortAddress("11111111111111111111111111111111")).toBe("1111…1111");
    expect(shortAddress("abc")).toBe("abc");
  });
});
