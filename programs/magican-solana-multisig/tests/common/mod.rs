#![allow(dead_code)]
//! Shared helpers for the LiteSVM tests: loading the program, deriving PDAs,
//! building and sending every multisig instruction.

use {
    anchor_lang::{
        solana_program::instruction::{AccountMeta, Instruction},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

use anchor_lang::prelude::Pubkey;
use magican_solana_multisig::{Multisig, Transaction, TransactionAccount};

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

pub fn setup() -> (LiteSVM, Pubkey) {
    let program_id = magican_solana_multisig::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../../target/deploy/magican_solana_multisig.so");
    svm.add_program(program_id, bytes).unwrap();
    (svm, program_id)
}

pub fn funded_keypair(svm: &mut LiteSVM, lamports: u64) -> Keypair {
    let kp = Keypair::new();
    svm.airdrop(&kp.pubkey(), lamports).unwrap();
    kp
}

// --- PDA derivation ---

pub fn multisig_pda(program_id: &Pubkey, creator: &Pubkey, seed: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"multisig", creator.as_ref(), &seed.to_le_bytes()],
        program_id,
    )
    .0
}

pub fn multisig_signer_pda(program_id: &Pubkey, multisig: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[multisig.as_ref()], program_id)
}

pub fn transaction_pda(program_id: &Pubkey, multisig: &Pubkey, index: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"transaction", multisig.as_ref(), &index.to_le_bytes()],
        program_id,
    )
    .0
}

// --- Sending a transaction ---

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair, signers: &[&Keypair]) -> TxResult {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx)
}

// --- Instructions ---

pub fn create_multisig(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    creator: &Keypair,
    owners: &[Pubkey],
    threshold: u8,
    seed: u64,
) -> TxResult {
    let pda = multisig_pda(program_id, &creator.pubkey(), seed);
    create_multisig_at(svm, program_id, creator, &pda, owners, threshold, seed)
}

/// Like `create_multisig`, but with an explicit `multisig` account address — for the PDA
/// substitution test (#8).
pub fn create_multisig_at(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    creator: &Keypair,
    multisig: &Pubkey,
    owners: &[Pubkey],
    threshold: u8,
    seed: u64,
) -> TxResult {
    let ix = Instruction::new_with_bytes(
        *program_id,
        &magican_solana_multisig::instruction::CreateMultisig {
            owners: owners.to_vec(),
            threshold,
            seed,
        }
        .data(),
        magican_solana_multisig::accounts::CreateMultisig {
            multisig: *multisig,
            creator: creator.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, ix, creator, &[creator])
}

pub fn create_transaction(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    multisig: &Pubkey,
    proposer: &Keypair,
    index: u64,
    target_program_id: Pubkey,
    accounts: Vec<TransactionAccount>,
    data: Vec<u8>,
) -> TxResult {
    let tx_pda = transaction_pda(program_id, multisig, index);
    let ix = Instruction::new_with_bytes(
        *program_id,
        &magican_solana_multisig::instruction::CreateTransaction {
            program_id: target_program_id,
            accounts,
            data,
        }
        .data(),
        magican_solana_multisig::accounts::CreateTransaction {
            multisig: *multisig,
            transaction: tx_pda,
            proposer: proposer.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, ix, proposer, &[proposer])
}

pub fn approve(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    multisig: &Pubkey,
    transaction: &Pubkey,
    owner: &Keypair,
) -> TxResult {
    let ix = Instruction::new_with_bytes(
        *program_id,
        &magican_solana_multisig::instruction::Approve {}.data(),
        magican_solana_multisig::accounts::Approve {
            multisig: *multisig,
            transaction: *transaction,
            owner: owner.pubkey(),
        }
        .to_account_metas(None),
    );
    send(svm, ix, owner, &[owner])
}

/// `remaining` — the inner instruction's target accounts and its program
/// (is_signer=false at the outer level; the PDA signs via invoke_signed inside).
pub fn execute_transaction(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    multisig: &Pubkey,
    transaction: &Pubkey,
    executor: &Keypair,
    remaining: Vec<AccountMeta>,
) -> TxResult {
    let (signer_pda, _) = multisig_signer_pda(program_id, multisig);
    let mut metas = magican_solana_multisig::accounts::ExecuteTransaction {
        multisig: *multisig,
        transaction: *transaction,
        multisig_signer: signer_pda,
    }
    .to_account_metas(None);
    metas.extend(remaining);

    let ix = Instruction::new_with_bytes(
        *program_id,
        &magican_solana_multisig::instruction::ExecuteTransaction {}.data(),
        metas,
    );
    send(svm, ix, executor, &[executor])
}

// --- SOL transfer out of the treasury PDA (target = SystemProgram) ---

/// Decomposes a SOL transfer out of the treasury PDA into (metadata, data, remaining).
pub fn sol_transfer_parts(
    signer_pda: &Pubkey,
    recipient: &Pubkey,
    amount: u64,
) -> (Vec<TransactionAccount>, Vec<u8>, Vec<AccountMeta>) {
    let ix = anchor_lang::solana_program::system_instruction::transfer(signer_pda, recipient, amount);
    let ta = ix
        .accounts
        .iter()
        .map(|m| TransactionAccount {
            pubkey: m.pubkey,
            is_signer: m.is_signer,
            is_writable: m.is_writable,
        })
        .collect();
    let remaining = ix
        .accounts
        .iter()
        .map(|m| AccountMeta {
            pubkey: m.pubkey,
            is_signer: false,
            is_writable: m.is_writable,
        })
        .chain(std::iter::once(AccountMeta::new_readonly(
            anchor_lang::solana_program::system_program::ID,
            false,
        )))
        .collect();
    (ta, ix.data, remaining)
}

// --- Governance: building the inner instruction (target = the multisig itself) ---

/// Decomposes an inner instruction with the `Auth` context (multisig + multisig_signer)
/// into (metadata for create_transaction, remaining accounts for execute).
/// The CPI target program is our own multisig.
fn auth_ix_parts(
    program_id: &Pubkey,
    multisig: &Pubkey,
    signer_pda: &Pubkey,
) -> (Vec<TransactionAccount>, Vec<AccountMeta>) {
    let ta = vec![
        TransactionAccount {
            pubkey: *multisig,
            is_signer: false,
            is_writable: true,
        },
        TransactionAccount {
            pubkey: *signer_pda,
            is_signer: true,
            is_writable: false,
        },
    ];
    // At the outer level the PDA does not sign; plus the CPI target program itself.
    let remaining = vec![
        AccountMeta::new(*multisig, false),
        AccountMeta::new_readonly(*signer_pda, false),
        AccountMeta::new_readonly(*program_id, false),
    ];
    (ta, remaining)
}

pub fn set_owners_parts(
    program_id: &Pubkey,
    multisig: &Pubkey,
    signer_pda: &Pubkey,
    new_owners: Vec<Pubkey>,
) -> (Vec<TransactionAccount>, Vec<u8>, Vec<AccountMeta>) {
    let (ta, remaining) = auth_ix_parts(program_id, multisig, signer_pda);
    let data = magican_solana_multisig::instruction::SetOwners { owners: new_owners }.data();
    (ta, data, remaining)
}

pub fn change_threshold_parts(
    program_id: &Pubkey,
    multisig: &Pubkey,
    signer_pda: &Pubkey,
    new_threshold: u8,
) -> (Vec<TransactionAccount>, Vec<u8>, Vec<AccountMeta>) {
    let (ta, remaining) = auth_ix_parts(program_id, multisig, signer_pda);
    let data = magican_solana_multisig::instruction::ChangeThreshold {
        threshold: new_threshold,
    }
    .data();
    (ta, data, remaining)
}

// --- Error checking ---

/// Asserts that the transaction failed and that the message/logs contain `needle`
/// (the Anchor error name in the logs or the runtime error string). Prints the actual
/// error on a mismatch — so that a test does not turn green for the wrong reason.
pub fn assert_err_log(res: TxResult, needle: &str) {
    match res {
        Ok(_) => panic!("expected a failure with '{needle}', but the transaction succeeded"),
        Err(e) => {
            let logs = e.meta.logs.join("\n");
            let err = format!("{:?}", e.err);
            assert!(
                logs.contains(needle) || err.contains(needle),
                "expected an error with '{needle}', got err={err}\nlogs:\n{logs}"
            );
        }
    }
}

// --- Reading state ---

pub fn fetch_multisig(svm: &LiteSVM, pda: &Pubkey) -> Multisig {
    let acc = svm.get_account(pda).expect("multisig account exists");
    Multisig::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

pub fn fetch_transaction(svm: &LiteSVM, pda: &Pubkey) -> Transaction {
    let acc = svm.get_account(pda).expect("transaction account exists");
    Transaction::try_deserialize(&mut acc.data.as_slice()).unwrap()
}
