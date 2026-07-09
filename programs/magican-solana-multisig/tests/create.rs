mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use solana_signer::Signer;

#[test]
fn test_create_multisig_happy_path() {
    let (mut svm, program_id) = setup();
    let creator = funded_keypair(&mut svm, 5_000_000_000);
    let creator_pk = creator.pubkey();

    let owners: Vec<Pubkey> = vec![creator_pk, Pubkey::new_unique(), Pubkey::new_unique()];
    let threshold: u8 = 2;
    let seed: u64 = 42;

    create_multisig(&mut svm, &program_id, &creator, &owners, threshold, seed).unwrap();

    let pda = multisig_pda(&program_id, &creator_pk, seed);
    let multisig = fetch_multisig(&svm, &pda);

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
    let creator = funded_keypair(&mut svm, 5_000_000_000);
    let owners = vec![creator.pubkey(), Pubkey::new_unique()];
    let res = create_multisig(&mut svm, &program_id, &creator, &owners, 0, 1);
    assert!(res.is_err(), "threshold=0 must be rejected");
}

#[test]
fn test_create_multisig_rejects_threshold_above_n() {
    let (mut svm, program_id) = setup();
    let creator = funded_keypair(&mut svm, 5_000_000_000);
    let owners = vec![creator.pubkey(), Pubkey::new_unique()];
    let res = create_multisig(&mut svm, &program_id, &creator, &owners, 3, 1);
    assert!(res.is_err(), "threshold > N must be rejected");
}

#[test]
fn test_create_multisig_rejects_duplicate_owners() {
    let (mut svm, program_id) = setup();
    let creator = funded_keypair(&mut svm, 5_000_000_000);
    let dup = Pubkey::new_unique();
    let owners = vec![dup, dup, Pubkey::new_unique()];
    let res = create_multisig(&mut svm, &program_id, &creator, &owners, 2, 1);
    assert!(res.is_err(), "duplicate owners must be rejected");
}
