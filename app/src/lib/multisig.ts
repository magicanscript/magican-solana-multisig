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
import { getRpc, PROGRAM_ID } from "./solana";

export type MultisigView = {
  address: Address;
  data: ReturnType<ReturnType<typeof getMultisigDecoder>["decode"]>;
};
export type ProposalView = {
  address: Address;
  data: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
};

// Через kit, а не Buffer: Buffer в браузере есть только благодаря полифилу
// webpack, а в Next 16 бандлер по умолчанию — Turbopack.
const decodeB64 = (d: string) => new Uint8Array(getBase64Encoder().encode(d));

/** Дискриминатор Anchor — первые 8 байт аккаунта; отделяет Multisig от Transaction. */
export const discriminatorFilter = (
  discriminator: ReadonlyUint8Array,
): GetProgramAccountsMemcmpFilter => ({
  memcmp: {
    offset: 0n,
    encoding: "base58",
    bytes: getBase58Decoder().decode(discriminator) as Base58EncodedBytes,
  },
});

/** Address — структурный подтип Base58EncodedBytes, каст не нужен. */
export const addressFilter = (offset: bigint, value: Address): GetProgramAccountsMemcmpFilter => ({
  memcmp: { offset, encoding: "base58", bytes: value },
});

// Владелец может стоять на любой позиции в owners, а memcmp сравнивает байты по
// фиксированному смещению — понадобился бы отдельный запрос на каждый индекс.
// Поэтому сужаем дискриминатором, а владельца отбираем клиентски.
export function filterOwned(all: MultisigView[], owner: Address): MultisigView[] {
  return all.filter((m) => (m.data.owners as Address[]).some((o) => o === owner));
}

export async function fetchOwnedMultisigs(owner: Address): Promise<MultisigView[]> {
  const dec = getMultisigDecoder();
  const res = await getRpc()
    .getProgramAccounts(PROGRAM_ID, {
      encoding: "base64",
      filters: [discriminatorFilter(MULTISIG_DISCRIMINATOR)],
    })
    .send();
  const all = res
    .map((a) => {
      try {
        return { address: a.pubkey, data: dec.decode(decodeB64(a.account.data[0])) };
      } catch {
        return null;
      }
    })
    .filter((x): x is MultisigView => x !== null);
  return filterOwned(all, owner);
}

export async function fetchProposals(multisig: Address): Promise<ProposalView[]> {
  const dec = getTransactionDecoder();
  const res = await getRpc()
    .getProgramAccounts(PROGRAM_ID, {
      encoding: "base64",
      // Transaction.multisig — первое поле после дискриминатора → offset 8.
      filters: [discriminatorFilter(TRANSACTION_DISCRIMINATOR), addressFilter(8n, multisig)],
    })
    .send();
  return res
    .map((a) => {
      try {
        return { address: a.pubkey, data: dec.decode(decodeB64(a.account.data[0])) };
      } catch {
        return null;
      }
    })
    .filter((x): x is ProposalView => x !== null);
}
