mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::system_program;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn test_2_of_3_sol_transfer_from_pda_treasury() {
    let (mut svm, program_id) = setup();

    let owner1 = funded_keypair(&mut svm, 5_000_000_000); // creator + proposer
    let owner2 = funded_keypair(&mut svm, 5_000_000_000); // second approver
    let owner3 = Keypair::new();
    let owners = vec![owner1.pubkey(), owner2.pubkey(), owner3.pubkey()];
    let seed: u64 = 1;

    create_multisig(&mut svm, &program_id, &owner1, &owners, 2, seed).unwrap();
    let multisig = multisig_pda(&program_id, &owner1.pubkey(), seed);
    let (signer_pda, _) = multisig_signer_pda(&program_id, &multisig);

    // Top up the PDA treasury with 2 SOL.
    svm.airdrop(&signer_pda, 2_000_000_000).unwrap();

    let recipient = Pubkey::new_unique();
    let amount = 1_000_000_000;
    let (ta, data, remaining) = sol_transfer_parts(&signer_pda, &recipient, amount);

    // Proposal (index 0). owner1's auto-vote gives 1 approval.
    create_transaction(
        &mut svm,
        &program_id,
        &multisig,
        &owner1,
        0,
        system_program::ID,
        ta,
        data,
    )
    .unwrap();
    let tx_pda = transaction_pda(&program_id, &multisig, 0);

    let tx_state = fetch_transaction(&svm, &tx_pda);
    assert_eq!(tx_state.signers, vec![true, false, false], "proposer auto-vote");
    assert!(!tx_state.did_execute);

    // With 1 of 2 approvals execute must fail.
    let early = execute_transaction(
        &mut svm,
        &program_id,
        &multisig,
        &tx_pda,
        &owner1,
        remaining.clone(),
    );
    assert!(early.is_err(), "execute below the threshold must fail");
    // Refresh the blockhash: otherwise the final execute repeats the early message -> AlreadyProcessed.
    svm.expire_blockhash();

    // owner2's second approval brings it to 2 approvals = threshold.
    approve(&mut svm, &program_id, &multisig, &tx_pda, &owner2).unwrap();
    assert_eq!(
        fetch_transaction(&svm, &tx_pda).signers,
        vec![true, true, false]
    );

    // Now execute goes through; the SOL leaves the PDA treasury.
    execute_transaction(&mut svm, &program_id, &multisig, &tx_pda, &owner1, remaining).unwrap();

    assert_eq!(svm.get_balance(&recipient), Some(amount), "recipient received 1 SOL");
    assert_eq!(
        svm.get_balance(&signer_pda),
        Some(1_000_000_000),
        "1 SOL left in the treasury"
    );
    assert!(fetch_transaction(&svm, &tx_pda).did_execute, "did_execute=true");
}

#[test]
fn test_approve_is_idempotent() {
    let (mut svm, program_id) = setup();

    let owner1 = funded_keypair(&mut svm, 5_000_000_000);
    let owner2 = funded_keypair(&mut svm, 5_000_000_000);
    let owner3 = Keypair::new();
    let owners = vec![owner1.pubkey(), owner2.pubkey(), owner3.pubkey()];
    let seed: u64 = 7;

    create_multisig(&mut svm, &program_id, &owner1, &owners, 2, seed).unwrap();
    let multisig = multisig_pda(&program_id, &owner1.pubkey(), seed);
    let (signer_pda, _) = multisig_signer_pda(&program_id, &multisig);

    let recipient = Pubkey::new_unique();
    let (ta, data, _) = sol_transfer_parts(&signer_pda, &recipient, 1);
    create_transaction(
        &mut svm,
        &program_id,
        &multisig,
        &owner1,
        0,
        system_program::ID,
        ta,
        data,
    )
    .unwrap();
    let tx_pda = transaction_pda(&program_id, &multisig, 0);

    // owner1 votes again — the mask does not change, no extra vote appears.
    approve(&mut svm, &program_id, &multisig, &tx_pda, &owner1).unwrap();
    assert_eq!(
        fetch_transaction(&svm, &tx_pda).signers,
        vec![true, false, false],
        "a repeated approve does not inflate the count"
    );
}
