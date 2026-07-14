/**
 * Spike совместимости (Task 1): доказать, что сгенерированный Codama-клиент
 * (`clients/js`, писался под @solana/kit ^6.10) типизируется и работает против
 * установленного @solana/kit 7, и что кастомная инструкция строится, а
 * getProgramAccounts читается/декодится. Гоняется через tsx, НЕ через Next.
 */
import { createSolanaRpc } from "@solana/kit";
import {
  getCreateMultisigInstructionAsync,
  getMultisigDecoder,
  MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS,
} from "@generated";

// (1) Типовая проверка: билдер кастомной инструкции разрешается против kit 7.
type CreateMultisigIx = Awaited<
  ReturnType<typeof getCreateMultisigInstructionAsync>
>;
const _typecheckIxBuilder: (ix: CreateMultisigIx) => string = (ix) =>
  ix.programAddress;
void _typecheckIxBuilder;

// (2) Чтение всех Multisig-аккаунтов программы + декод через клиент.
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
  console.log(`Программа: ${MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS}`);
  console.log(`RPC: ${rpcUrl}`);
  const all = await fetchAllMultisigs(rpcUrl);
  console.log(`Multisig-аккаунтов найдено: ${all.length}`);
  for (const m of all) {
    console.log(`  ${m.address}  M-of-N=${m.data.threshold}/${m.data.owners.length}`);
  }
  console.log("✔ spike: клиент типизируется под kit 7 и читает on-chain state");
}

main().catch((e) => {
  console.error("[spike FAIL]", e);
  process.exit(1);
});
