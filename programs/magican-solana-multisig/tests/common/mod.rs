#![allow(dead_code)]
//! Общие хелперы для LiteSVM-тестов: загрузка программы, деривация PDA,
//! сборка и отправка всех инструкций мультисига.

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

// --- Деривация PDA ---

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

// --- Отправка транзакции ---

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair, signers: &[&Keypair]) -> TxResult {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx)
}

// --- Инструкции ---

pub fn create_multisig(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    creator: &Keypair,
    owners: &[Pubkey],
    threshold: u8,
    seed: u64,
) -> TxResult {
    let pda = multisig_pda(program_id, &creator.pubkey(), seed);
    let ix = Instruction::new_with_bytes(
        *program_id,
        &magican_solana_multisig::instruction::CreateMultisig {
            owners: owners.to_vec(),
            threshold,
            seed,
        }
        .data(),
        magican_solana_multisig::accounts::CreateMultisig {
            multisig: pda,
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

/// `remaining` — целевые аккаунты вложенной инструкции и её программа
/// (is_signer=false на внешнем уровне; PDA подписывает через invoke_signed внутри).
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

// --- Чтение state ---

pub fn fetch_multisig(svm: &LiteSVM, pda: &Pubkey) -> Multisig {
    let acc = svm.get_account(pda).expect("multisig account exists");
    Multisig::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

pub fn fetch_transaction(svm: &LiteSVM, pda: &Pubkey) -> Transaction {
    let acc = svm.get_account(pda).expect("transaction account exists");
    Transaction::try_deserialize(&mut acc.data.as_slice()).unwrap()
}
