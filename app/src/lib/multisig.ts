import {
  getBase58Decoder,
  getBase64Encoder,
  type Address,
  type Base58EncodedBytes,
  type GetProgramAccountsMemcmpFilter,
  type ReadonlyUint8Array,
} from "@solana/kit";
import {
  getMultisigDecoder,
  getTransactionDecoder,
  MULTISIG_DISCRIMINATOR,
  TRANSACTION_DISCRIMINATOR,
} from "@generated";
import { getRpc, PROGRAM_ID, READ_COMMITMENT } from "./solana";

export type MultisigView = {
  address: Address;
  data: ReturnType<ReturnType<typeof getMultisigDecoder>["decode"]>;
};
export type ProposalView = {
  address: Address;
  data: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
};

// Through kit, not Buffer: in the browser Buffer exists only thanks to the webpack
// polyfill, and in Next 16 the default bundler is Turbopack.
const decodeB64 = (d: string) => new Uint8Array(getBase64Encoder().encode(d));

/** The Anchor discriminator — the account's first 8 bytes; it separates Multisig from Transaction. */
export const discriminatorFilter = (
  discriminator: ReadonlyUint8Array,
): GetProgramAccountsMemcmpFilter => ({
  memcmp: {
    offset: 0n,
    encoding: "base58",
    bytes: getBase58Decoder().decode(discriminator) as Base58EncodedBytes,
  },
});

/** Address is a structural subtype of Base58EncodedBytes, no cast is needed. */
export const addressFilter = (offset: bigint, value: Address): GetProgramAccountsMemcmpFilter => ({
  memcmp: { offset, encoding: "base58", bytes: value },
});

// An owner can sit at any position in owners, while memcmp compares bytes at a fixed
// offset — a separate request per index would be needed. So we narrow by the discriminator
// and pick the owner out on the client.
export function filterOwned(all: MultisigView[], owner: Address): MultisigView[] {
  return all.filter((m) => (m.data.owners as Address[]).some((o) => o === owner));
}

// The discriminator has already cut off foreign types, so a decoding failure means a real
// schema mismatch (a redeploy without regenerating the client) or data corruption. Dropping
// such an account from the list silently is not allowed: "one multisig fewer" without a trace.
function warnUndecodable(kind: string, pubkey: Address, e: unknown): null {
  console.warn(`Failed to decode ${kind} ${pubkey} — skipped. Reason:`, e);
  return null;
}

export async function fetchOwnedMultisigs(owner: Address): Promise<MultisigView[]> {
  const dec = getMultisigDecoder();
  const res = await getRpc()
    .getProgramAccounts(PROGRAM_ID, {
      commitment: READ_COMMITMENT,
      encoding: "base64",
      filters: [discriminatorFilter(MULTISIG_DISCRIMINATOR)],
    })
    .send();
  const all = res
    .map((a) => {
      try {
        return { address: a.pubkey, data: dec.decode(decodeB64(a.account.data[0])) };
      } catch (e) {
        return warnUndecodable("multisig", a.pubkey, e);
      }
    })
    .filter((x): x is MultisigView => x !== null);
  return filterOwned(all, owner);
}

export async function fetchProposals(multisig: Address): Promise<ProposalView[]> {
  const dec = getTransactionDecoder();
  const res = await getRpc()
    .getProgramAccounts(PROGRAM_ID, {
      commitment: READ_COMMITMENT,
      encoding: "base64",
      // Transaction.multisig is the first field after the discriminator → offset 8.
      filters: [discriminatorFilter(TRANSACTION_DISCRIMINATOR), addressFilter(8n, multisig)],
    })
    .send();
  return res
    .map((a) => {
      try {
        return { address: a.pubkey, data: dec.decode(decodeB64(a.account.data[0])) };
      } catch (e) {
        return warnUndecodable("proposal", a.pubkey, e);
      }
    })
    .filter((x): x is ProposalView => x !== null);
}
