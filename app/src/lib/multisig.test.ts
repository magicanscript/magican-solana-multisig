import { describe, it, expect } from "vitest";
import { address, getBase58Encoder, type Address } from "@solana/kit";
import { MULTISIG_DISCRIMINATOR, TRANSACTION_DISCRIMINATOR } from "@generated";
import { filterOwned, discriminatorFilter, addressFilter, type MultisigView } from "./multisig";

const me: Address = address("So11111111111111111111111111111111111111112");
const other: Address = address("SysvarC1ock11111111111111111111111111111111");

const view = (addr: Address, owners: Address[]) =>
  ({ address: addr, data: { owners } }) as unknown as MultisigView;

describe("filterOwned", () => {
  it("keeps only the multisigs where the owner is in the list", () => {
    const all = [view(me, [me, other]), view(other, [other])];
    expect(filterOwned(all, me).map((m) => m.address)).toEqual([me]);
  });

  it("finds the owner not only at the first position", () => {
    expect(filterOwned([view(other, [other, me])], me)).toHaveLength(1);
  });

  it("returns empty when the owner is nowhere to be found", () => {
    expect(filterOwned([view(other, [other])], me)).toEqual([]);
  });
});

describe("memcmp filters", () => {
  it("discriminatorFilter encodes the discriminator as base58 at offset zero", () => {
    const f = discriminatorFilter(MULTISIG_DISCRIMINATOR);
    expect(f.memcmp.offset).toBe(0n);
    expect(f.memcmp.encoding).toBe("base58");
    // We check the round-trip, not just "it's a string": otherwise the test would survive
    // an encoder/decoder swapped by mistake.
    expect(new Uint8Array(getBase58Encoder().encode(f.memcmp.bytes))).toEqual(
      new Uint8Array(MULTISIG_DISCRIMINATOR),
    );
  });

  it("Multisig and Transaction differ by their discriminator", () => {
    expect(discriminatorFilter(MULTISIG_DISCRIMINATOR).memcmp.bytes).not.toBe(
      discriminatorFilter(TRANSACTION_DISCRIMINATOR).memcmp.bytes,
    );
  });

  it("addressFilter puts the address as base58 at the given offset", () => {
    // Transaction.multisig is the first field after the discriminator, hence offset 8.
    const f = addressFilter(8n, me);
    expect(f.memcmp).toEqual({ offset: 8n, encoding: "base58", bytes: me });
  });
});
