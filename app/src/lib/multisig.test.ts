import { describe, it, expect } from "vitest";
import { address, getBase58Encoder, type Address } from "@solana/kit";
import { MULTISIG_DISCRIMINATOR, TRANSACTION_DISCRIMINATOR } from "@generated";
import { filterOwned, discriminatorFilter, addressFilter, type MultisigView } from "./multisig";

const me: Address = address("So11111111111111111111111111111111111111112");
const other: Address = address("SysvarC1ock11111111111111111111111111111111");

const view = (addr: Address, owners: Address[]) =>
  ({ address: addr, data: { owners } }) as unknown as MultisigView;

describe("filterOwned", () => {
  it("оставляет только мультисиги, где owner есть в списке", () => {
    const all = [view(me, [me, other]), view(other, [other])];
    expect(filterOwned(all, me).map((m) => m.address)).toEqual([me]);
  });

  it("находит владельца не только на первой позиции", () => {
    expect(filterOwned([view(other, [other, me])], me)).toHaveLength(1);
  });

  it("возвращает пусто, когда владельца нет нигде", () => {
    expect(filterOwned([view(other, [other])], me)).toEqual([]);
  });
});

describe("memcmp-фильтры", () => {
  it("discriminatorFilter кодирует дискриминатор в base58 с нулевого offset", () => {
    const f = discriminatorFilter(MULTISIG_DISCRIMINATOR);
    expect(f.memcmp.offset).toBe(0n);
    expect(f.memcmp.encoding).toBe("base58");
    // Проверяем round-trip, а не просто "это строка": иначе тест переживёт
    // перепутанные местами encoder/decoder.
    expect(new Uint8Array(getBase58Encoder().encode(f.memcmp.bytes))).toEqual(
      new Uint8Array(MULTISIG_DISCRIMINATOR),
    );
  });

  it("Multisig и Transaction различаются дискриминатором", () => {
    expect(discriminatorFilter(MULTISIG_DISCRIMINATOR).memcmp.bytes).not.toBe(
      discriminatorFilter(TRANSACTION_DISCRIMINATOR).memcmp.bytes,
    );
  });

  it("addressFilter кладёт адрес как base58 по заданному offset", () => {
    // Transaction.multisig — первое поле после дискриминатора, значит offset 8.
    const f = addressFilter(8n, me);
    expect(f.memcmp).toEqual({ offset: 8n, encoding: "base58", bytes: me });
  });
});
