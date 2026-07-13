/**
 * End-to-end демо мультисига на @solana/kit через сгенерированный Codama-клиент.
 *
 * Гоняется против локального solana-test-validator (см. scripts/run-demo.sh),
 * но тот же код работает и на devnet — достаточно сменить RPC_URL/WS_URL.
 *
 * Сценарии:
 *   1. Happy-path 2-из-3: create → propose (SOL-перевод из PDA-казны) → approve → execute.
 *   2. Негатив M-1: при недостатке подписей execute падает с NotEnoughSigners.
 *
 * Запуск: yarn demo   (или tsx scripts/demo.ts)
 */
import {
  AccountRole,
  address,
  airdropFactory,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getU64Encoder,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
  type TransactionSigner,
} from '@solana/kit';

import {
  findMultisigPda,
  findMultisigSignerPda,
  getApproveInstruction,
  getCreateMultisigInstructionAsync,
  getCreateTransactionInstruction,
  getExecuteTransactionInstructionAsync,
  fetchMultisig,
  MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS,
} from '../clients/js/src/generated';

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8899';
const WS_URL = process.env.WS_URL ?? 'ws://127.0.0.1:8900';
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const LAMPORTS_PER_SOL = 1_000_000_000n;

type Rpcs = {
  rpc: Rpc<SolanaRpcApi>;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
};

// --- Инфраструктура отправки транзакций ---

async function sendIxs(
  { rpc, rpcSubscriptions }: Rpcs,
  feePayer: TransactionSigner,
  instructions: Instruction[],
): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const send = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await send(signed, { commitment: 'confirmed' });
  return getSignatureFromTransaction(signed);
}

// PDA предложения: seeds = [b"transaction", multisig, index_le]. Codama не генерит
// финдер (сид зависит от on-chain поля transaction_count), поэтому деривируем вручную.
async function deriveTransactionPda(multisig: Address, index: bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS,
    seeds: [
      new TextEncoder().encode('transaction'),
      getAddressEncoder().encode(multisig),
      getU64Encoder().encode(index),
    ],
  });
  return pda;
}

// Вложенная инструкция = System-перевод SOL из PDA-казны получателю.
// Возвращает (accounts для предложения, data, remaining для execute).
function buildSolTransfer(signerPda: Address, recipient: Address, amount: bigint) {
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true); // индекс инструкции System::Transfer
  dv.setBigUint64(4, amount, true);

  // Метаданные, которые уйдут в state предложения (is_signer=true у казны —
  // программа подпишет за неё через invoke_signed).
  const proposalAccounts = [
    { pubkey: signerPda, isSigner: true, isWritable: true },
    { pubkey: recipient, isSigner: false, isWritable: true },
  ];

  // remaining для execute: те же аккаунты (казна БЕЗ signer на внешнем уровне) плюс
  // сама целевая программа. invoke_signed внутри программы получает именно этот срез.
  const remaining = [
    { address: signerPda, role: AccountRole.WRITABLE },
    { address: recipient, role: AccountRole.WRITABLE },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
  ];

  return { proposalAccounts, data, remaining };
}

async function createMultisig(
  rpcs: Rpcs,
  creator: KeyPairSigner,
  owners: Address[],
  threshold: number,
  seed: bigint,
): Promise<{ multisig: Address; signerPda: Address }> {
  const ix = await getCreateMultisigInstructionAsync({ creator, owners, threshold, seed });
  await sendIxs(rpcs, creator, [ix]);
  const [multisig] = await findMultisigPda({ creator: creator.address, seed });
  const [signerPda] = await findMultisigSignerPda({ multisig });
  return { multisig, signerPda };
}

async function balance(rpcs: Rpcs, addr: Address): Promise<bigint> {
  const { value } = await rpcs.rpc.getBalance(addr, { commitment: 'confirmed' }).send();
  return value;
}

// --- Сценарий 1: успешный 2-из-3 перевод ---

async function happyPath(rpcs: Rpcs) {
  console.log('\n=== Сценарий 1: happy-path 2-из-3 ===');
  const creator = await generateKeyPairSigner();
  const owner2 = await generateKeyPairSigner();
  const owner3 = await generateKeyPairSigner();
  const airdrop = airdropFactory(rpcs);
  await airdrop({ recipientAddress: creator.address, lamports: lamports(5n * LAMPORTS_PER_SOL), commitment: 'confirmed' });
  await airdrop({ recipientAddress: owner2.address, lamports: lamports(2n * LAMPORTS_PER_SOL), commitment: 'confirmed' });

  const owners = [creator.address, owner2.address, owner3.address];
  const { multisig, signerPda } = await createMultisig(rpcs, creator, owners, 2, 1n);
  console.log(`  multisig:      ${multisig}`);
  console.log(`  treasury PDA:  ${signerPda}`);

  // Пополняем казну.
  await airdrop({ recipientAddress: signerPda, lamports: lamports(2n * LAMPORTS_PER_SOL), commitment: 'confirmed' });

  const recipient = (await generateKeyPairSigner()).address;
  const amount = 1n * LAMPORTS_PER_SOL;
  const { proposalAccounts, data, remaining } = buildSolTransfer(signerPda, recipient, amount);

  // Propose (index 0). Proposer=creator получает автоголос.
  const txPda = await deriveTransactionPda(multisig, 0n);
  const proposeIx = getCreateTransactionInstruction({
    multisig,
    transaction: txPda,
    proposer: creator,
    programId: SYSTEM_PROGRAM,
    accounts: proposalAccounts,
    data,
  });
  await sendIxs(rpcs, creator, [proposeIx]);
  console.log('  propose:       ok (creator автоголос → 1/2)');

  // Approve вторым владельцем → 2/2.
  const approveIx = getApproveInstruction({ multisig, transaction: txPda, owner: owner2 });
  await sendIxs(rpcs, owner2, [approveIx]);
  console.log('  approve o2:    ok (2/2, кворум набран)');

  // Execute.
  const execIx = await getExecuteTransactionInstructionAsync({ multisig, transaction: txPda });
  const execWithRemaining: Instruction = {
    ...execIx,
    accounts: [...(execIx.accounts ?? []), ...remaining],
  };
  const before = await balance(rpcs, recipient);
  await sendIxs(rpcs, creator, [execWithRemaining]);
  const after = await balance(rpcs, recipient);
  console.log(`  execute:       ok, баланс получателя ${before} → ${after} lamports`);

  if (after - before !== amount) {
    throw new Error(`ожидался прирост ${amount}, получено ${after - before}`);
  }
  const ms = await fetchMultisig(rpcs.rpc, multisig);
  console.log(`  ✔ threshold=${ms.data.threshold}, owner_set_seqno=${ms.data.ownerSetSeqno}, tx_count=${ms.data.transactionCount}`);
}

// --- Сценарий 2: недостаток подписей (M-1) ---

async function insufficientSigners(rpcs: Rpcs) {
  console.log('\n=== Сценарий 2: негатив M-1 (execute при 1/2) ===');
  const creator = await generateKeyPairSigner();
  const owner2 = await generateKeyPairSigner();
  const owner3 = await generateKeyPairSigner();
  const airdrop = airdropFactory(rpcs);
  await airdrop({ recipientAddress: creator.address, lamports: lamports(5n * LAMPORTS_PER_SOL), commitment: 'confirmed' });

  const owners = [creator.address, owner2.address, owner3.address];
  const { multisig, signerPda } = await createMultisig(rpcs, creator, owners, 2, 2n);
  await airdrop({ recipientAddress: signerPda, lamports: lamports(2n * LAMPORTS_PER_SOL), commitment: 'confirmed' });

  const recipient = (await generateKeyPairSigner()).address;
  const { proposalAccounts, data, remaining } = buildSolTransfer(signerPda, recipient, LAMPORTS_PER_SOL);

  const txPda = await deriveTransactionPda(multisig, 0n);
  const proposeIx = getCreateTransactionInstruction({
    multisig,
    transaction: txPda,
    proposer: creator,
    programId: SYSTEM_PROGRAM,
    accounts: proposalAccounts,
    data,
  });
  await sendIxs(rpcs, creator, [proposeIx]);
  console.log('  propose:       ok (только 1/2 — creator, второго approve НЕТ)');

  const execIx = await getExecuteTransactionInstructionAsync({ multisig, transaction: txPda });
  const execWithRemaining: Instruction = {
    ...execIx,
    accounts: [...(execIx.accounts ?? []), ...remaining],
  };

  try {
    await sendIxs(rpcs, creator, [execWithRemaining]);
    throw new Error('ОШИБКА: execute прошёл при недостатке подписей — это баг!');
  } catch (e) {
    const msg = String((e as Error).message ?? e) + JSON.stringify(e, Object.getOwnPropertyNames(e));
    const isExpected = msg.includes('6005') || msg.toLowerCase().includes('notenoughsigners') || msg.includes('0x1775');
    if (!isExpected) {
      console.log('  (диагностика) неожиданная ошибка:', msg.slice(0, 400));
      throw e;
    }
    console.log('  ✔ execute отклонён: NotEnoughSigners (код 6005 / 0x1775) — как и должно быть');
  }
}

async function main() {
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Программа: ${MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS}`);
  const rpcs: Rpcs = {
    rpc: createSolanaRpc(RPC_URL),
    rpcSubscriptions: createSolanaRpcSubscriptions(WS_URL),
  };
  await happyPath(rpcs);
  await insufficientSigners(rpcs);
  console.log('\n✔ Оба сценария отработали ожидаемо.');
}

main().catch((e) => {
  console.error('\n[FAIL] Демо упало:', e);
  process.exit(1);
});
