use {
    anchor_lang::{
        solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

use anchor_lang::prelude::Pubkey;

/// Загружает собранную программу в LiteSVM и возвращает (svm, program_id).
fn setup() -> (LiteSVM, Pubkey) {
    let program_id = magican_solana_multisig::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/magican_solana_multisig.so");
    svm.add_program(program_id, bytes).unwrap();
    (svm, program_id)
}

fn multisig_pda(program_id: &Pubkey, creator: &Pubkey, seed: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"multisig", creator.as_ref(), &seed.to_le_bytes()],
        program_id,
    )
    .0
}

/// Собирает и отправляет `create_multisig`; возвращает результат send_transaction.
fn create_multisig(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    creator: &Keypair,
    owners: &[Pubkey],
    threshold: u8,
    seed: u64,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
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
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&creator.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[creator]).unwrap();
    svm.send_transaction(tx)
}

#[test]
fn test_create_multisig_happy_path() {
    let (mut svm, program_id) = setup();
    let creator = Keypair::new();
    let creator_pk = creator.pubkey();
    svm.airdrop(&creator_pk, 5_000_000_000).unwrap();

    let owners: Vec<Pubkey> = vec![creator_pk, Pubkey::new_unique(), Pubkey::new_unique()];
    let threshold: u8 = 2;
    let seed: u64 = 42;

    create_multisig(&mut svm, &program_id, &creator, &owners, threshold, seed).unwrap();

    let pda = multisig_pda(&program_id, &creator_pk, seed);
    let acc = svm.get_account(&pda).expect("multisig account exists");
    let multisig =
        magican_solana_multisig::Multisig::try_deserialize(&mut acc.data.as_slice()).unwrap();

    assert_eq!(multisig.creator, creator_pk);
    assert_eq!(multisig.seed, seed);
    assert_eq!(multisig.owners, owners);
    assert_eq!(multisig.threshold, threshold);
    assert_eq!(multisig.owner_set_seqno, 0);
    assert_eq!(multisig.transaction_count, 0);
}

#[test]
fn test_create_multisig_rejects_zero_threshold() {
    let (mut svm, program_id) = setup();
    let creator = Keypair::new();
    svm.airdrop(&creator.pubkey(), 5_000_000_000).unwrap();

    let owners = vec![creator.pubkey(), Pubkey::new_unique()];
    let res = create_multisig(&mut svm, &program_id, &creator, &owners, 0, 1);
    assert!(res.is_err(), "threshold=0 must be rejected");
}

#[test]
fn test_create_multisig_rejects_threshold_above_n() {
    let (mut svm, program_id) = setup();
    let creator = Keypair::new();
    svm.airdrop(&creator.pubkey(), 5_000_000_000).unwrap();

    let owners = vec![creator.pubkey(), Pubkey::new_unique()];
    let res = create_multisig(&mut svm, &program_id, &creator, &owners, 3, 1);
    assert!(res.is_err(), "threshold > N must be rejected");
}

#[test]
fn test_create_multisig_rejects_duplicate_owners() {
    let (mut svm, program_id) = setup();
    let creator = Keypair::new();
    svm.airdrop(&creator.pubkey(), 5_000_000_000).unwrap();

    let dup = Pubkey::new_unique();
    let owners = vec![dup, dup, Pubkey::new_unique()];
    let res = create_multisig(&mut svm, &program_id, &creator, &owners, 2, 1);
    assert!(res.is_err(), "duplicate owners must be rejected");
}
