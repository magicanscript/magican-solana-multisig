import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
} from "@solana/kit";
import { findMultisigPda, findMultisigSignerPda } from "@generated";
import { PROGRAM_ID } from "./solana";

export const deriveMultisigPda = async (creator: Address, seed: bigint): Promise<Address> =>
  (await findMultisigPda({ creator, seed }))[0];

export const deriveSignerPda = async (multisig: Address): Promise<Address> =>
  (await findMultisigSignerPda({ multisig }))[0];

// У transaction-PDA нет сгенерированного финдера — деривируем вручную
// по сидам программы: [b"transaction", multisig, index_le].
export async function deriveTransactionPda(multisig: Address, index: bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      new TextEncoder().encode("transaction"),
      getAddressEncoder().encode(multisig),
      getU64Encoder().encode(index),
    ],
  });
  return pda;
}
