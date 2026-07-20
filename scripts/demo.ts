/**
 * End-to-end multisig demo on @solana/kit via the generated Codama client.
 *
 * It runs against a local solana-test-validator (see scripts/run-demo.sh),
 * but the same code works on devnet too — just change RPC_URL/WS_URL.
 *
 * Scenarios:
 *   1. Happy path 2-of-3: create → propose (SOL transfer from the treasury PDA) → approve → execute.
 *   2. Negative M-1: with not enough approvals, execute fails with NotEnoughSigners.
 *
 * Run: yarn demo   (or tsx scripts/demo.ts)
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

// --- Transaction sending infrastructure ---

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

// Proposal PDA: seeds = [b"transaction", multisig, index_le]. Codama doesn't generate
// a finder (the seed depends on the on-chain transaction_count field), so we derive it manually.
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

// The nested instruction = a System SOL transfer from the treasury PDA to the recipient.
// Returns (accounts for the proposal, data, remaining for execute).
function buildSolTransfer(signerPda: Address, recipient: Address, amount: bigint) {
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true); // System::Transfer instruction index
  dv.setBigUint64(4, amount, true);

  // Metadata that goes into the proposal state (is_signer=true for the treasury —
  // the program signs for it via invoke_signed).
  const proposalAccounts = [
    { pubkey: signerPda, isSigner: true, isWritable: true },
    { pubkey: recipient, isSigner: false, isWritable: true },
  ];

  // remaining for execute: the same accounts (the treasury WITHOUT signer at the outer level)
  // plus the target program itself. invoke_signed inside the program gets exactly this slice.
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

// --- Scenario 1: a successful 2-of-3 transfer ---

async function happyPath(rpcs: Rpcs) {
  console.log('\n=== Scenario 1: happy path 2-of-3 ===');
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

  // Fund the treasury.
  await airdrop({ recipientAddress: signerPda, lamports: lamports(2n * LAMPORTS_PER_SOL), commitment: 'confirmed' });

  const recipient = (await generateKeyPairSigner()).address;
  const amount = 1n * LAMPORTS_PER_SOL;
  const { proposalAccounts, data, remaining } = buildSolTransfer(signerPda, recipient, amount);

  // Propose (index 0). Proposer=creator gets an automatic approval.
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
  console.log('  propose:       ok (creator auto-approval → 1/2)');

  // Approve by the second owner → 2/2.
  const approveIx = getApproveInstruction({ multisig, transaction: txPda, owner: owner2 });
  await sendIxs(rpcs, owner2, [approveIx]);
  console.log('  approve o2:    ok (2/2, quorum reached)');

  // Execute.
  const execIx = await getExecuteTransactionInstructionAsync({ multisig, transaction: txPda });
  const execWithRemaining: Instruction = {
    ...execIx,
    accounts: [...(execIx.accounts ?? []), ...remaining],
  };
  const before = await balance(rpcs, recipient);
  await sendIxs(rpcs, creator, [execWithRemaining]);
  const after = await balance(rpcs, recipient);
  console.log(`  execute:       ok, recipient balance ${before} → ${after} lamports`);

  if (after - before !== amount) {
    throw new Error(`expected an increase of ${amount}, got ${after - before}`);
  }
  const ms = await fetchMultisig(rpcs.rpc, multisig);
  console.log(`  ✔ threshold=${ms.data.threshold}, owner_set_seqno=${ms.data.ownerSetSeqno}, tx_count=${ms.data.transactionCount}`);
}

// --- Scenario 2: not enough approvals (M-1) ---

async function insufficientSigners(rpcs: Rpcs) {
  console.log('\n=== Scenario 2: negative M-1 (execute at 1/2) ===');
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
  console.log('  propose:       ok (only 1/2 — the creator, there is NO second approve)');

  const execIx = await getExecuteTransactionInstructionAsync({ multisig, transaction: txPda });
  const execWithRemaining: Instruction = {
    ...execIx,
    accounts: [...(execIx.accounts ?? []), ...remaining],
  };

  try {
    await sendIxs(rpcs, creator, [execWithRemaining]);
    throw new Error('ERROR: execute went through without enough approvals — that is a bug!');
  } catch (e) {
    const msg = String((e as Error).message ?? e) + JSON.stringify(e, Object.getOwnPropertyNames(e));
    const isExpected = msg.includes('6005') || msg.toLowerCase().includes('notenoughsigners') || msg.includes('0x1775');
    if (!isExpected) {
      console.log('  (diagnostics) unexpected error:', msg.slice(0, 400));
      throw e;
    }
    console.log('  ✔ execute rejected: NotEnoughSigners (code 6005 / 0x1775) — exactly as it should be');
  }
}

async function main() {
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Program: ${MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS}`);
  const rpcs: Rpcs = {
    rpc: createSolanaRpc(RPC_URL),
    rpcSubscriptions: createSolanaRpcSubscriptions(WS_URL),
  };
  await happyPath(rpcs);
  await insufficientSigners(rpcs);
  console.log('\n✔ Both scenarios behaved as expected.');
}

main().catch((e) => {
  console.error('\n[FAIL] The demo crashed:', e);
  process.exit(1);
});
