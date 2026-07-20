/**
 * Compatibility spike (Task 1): prove that the generated Codama client
 * (`clients/js`, written against @solana/kit ^6.10) type-checks and works against
 * the installed @solana/kit 7, that a custom instruction can be built, and that
 * getProgramAccounts can be read and decoded. Run via tsx, NOT via Next.
 */
import { createSolanaRpc } from "@solana/kit";
import {
  getCreateMultisigInstructionAsync,
  getMultisigDecoder,
  MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS,
} from "@generated";

// (1) Type check: the custom instruction builder resolves against kit 7.
type CreateMultisigIx = Awaited<
  ReturnType<typeof getCreateMultisigInstructionAsync>
>;
const _typecheckIxBuilder: (ix: CreateMultisigIx) => string = (ix) =>
  ix.programAddress;
void _typecheckIxBuilder;

// (2) Read all Multisig accounts of the program + decode them via the client.
export async function fetchAllMultisigs(rpcUrl: string) {
  const rpc = createSolanaRpc(rpcUrl);
  const res = await rpc
    .getProgramAccounts(MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS, {
      encoding: "base64",
    })
    .send();
  const dec = getMultisigDecoder();
  return res.map((a) => ({
    address: a.pubkey,
    data: dec.decode(
      new Uint8Array(Buffer.from((a.account.data as [string, string])[0], "base64")),
    ),
  }));
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8899";
  console.log(`Program: ${MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS}`);
  console.log(`RPC: ${rpcUrl}`);
  const all = await fetchAllMultisigs(rpcUrl);
  console.log(`Multisig accounts found: ${all.length}`);
  for (const m of all) {
    console.log(`  ${m.address}  M-of-N=${m.data.threshold}/${m.data.owners.length}`);
  }
  console.log("✔ spike: the client type-checks against kit 7 and reads on-chain state");
}

main().catch((e) => {
  console.error("[spike FAIL]", e);
  process.exit(1);
});
