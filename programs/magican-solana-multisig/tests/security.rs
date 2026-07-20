//! The project's main showcase: one negative test per attack vector from the
//! threat model (PRD section 5). Every test expects the attack to fail.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::solana_program::system_program;
use common::*;
use magican_solana_multisig::TransactionAccount;
use solana_keypair::Keypair;
use solana_signer::Signer;

const SOL: u64 = 1_000_000_000;

/// Creates a multisig with owner1 + random extra owners and the given threshold.
fn make_multisig(
    svm: &mut litesvm::LiteSVM,
    program_id: &Pubkey,
    threshold: u8,
    n_owners: usize,
    seed: u64,
) -> (Keypair, Vec<Pubkey>, Pubkey, Pubkey) {
    let owner1 = funded_keypair(svm, 5 * SOL);
    let mut owners = vec![owner1.pubkey()];
    for _ in 1..n_owners {
        owners.push(Pubkey::new_unique());
    }
    create_multisig(svm, program_id, &owner1, &owners, threshold, seed).unwrap();
    let ms = multisig_pda(program_id, &owner1.pubkey(), seed);
    let (signer, _) = multisig_signer_pda(program_id, &ms);
    (owner1, owners, ms, signer)
}

// #1 — A non-owner cannot propose or approve.
#[test]
fn vector_01_non_owner_cannot_propose_or_approve() {
    let (mut svm, pid) = setup();
    let (owner1, _owners, ms, signer) = make_multisig(&mut svm, &pid, 1, 2, 1);
    let attacker = funded_keypair(&mut svm, 5 * SOL);

    // propose from an outsider
    let (ta, data, _) = sol_transfer_parts(&signer, &Pubkey::new_unique(), SOL);
    let res = create_transaction(&mut svm, &pid, &ms, &attacker, 0, system_program::ID, ta, data);
    assert_err_log(res, "NotAnOwner"); // #1: a non-owner cannot propose

    // a valid proposal from owner1, then approve from an outsider
    let (ta, data, _) = sol_transfer_parts(&signer, &Pubkey::new_unique(), SOL);
    create_transaction(&mut svm, &pid, &ms, &owner1, 0, system_program::ID, ta, data).unwrap();
    let tx = transaction_pda(&pid, &ms, 0);
    let res = approve(&mut svm, &pid, &ms, &tx, &attacker);
    assert_err_log(res, "NotAnOwner"); // #1: a non-owner cannot approve
}

// #2 — Execution with approvals < threshold.
#[test]
fn vector_02_execute_below_threshold_fails() {
    let (mut svm, pid) = setup();
    let (owner1, _owners, ms, signer) = make_multisig(&mut svm, &pid, 2, 3, 2);
    svm.airdrop(&signer, 2 * SOL).unwrap();

    let (ta, data, remaining) = sol_transfer_parts(&signer, &Pubkey::new_unique(), SOL);
    create_transaction(&mut svm, &pid, &ms, &owner1, 0, system_program::ID, ta, data).unwrap();
    let tx = transaction_pda(&pid, &ms, 0);

    // only the proposer's auto-vote (1) < threshold (2)
    let res = execute_transaction(&mut svm, &pid, &ms, &tx, &owner1, remaining);
    assert_err_log(res, "NotEnoughSigners"); // #2
}

// #3 — Replay: executing the same transaction a second time.
#[test]
fn vector_03_replay_execution_fails() {
    let (mut svm, pid) = setup();
    let (owner1, _owners, ms, signer) = make_multisig(&mut svm, &pid, 1, 2, 3);
    svm.airdrop(&signer, 2 * SOL).unwrap();

    let (ta, data, remaining) = sol_transfer_parts(&signer, &Pubkey::new_unique(), SOL);
    create_transaction(&mut svm, &pid, &ms, &owner1, 0, system_program::ID, ta, data).unwrap();
    let tx = transaction_pda(&pid, &ms, 0);

    execute_transaction(&mut svm, &pid, &ms, &tx, &owner1, remaining.clone()).unwrap();
    svm.expire_blockhash();
    let res = execute_transaction(&mut svm, &pid, &ms, &tx, &owner1, remaining);
    assert_err_log(res, "AlreadyExecuted"); // #3
}

// #4 — A double approval by one owner does not inflate the count.
#[test]
fn vector_04_double_approve_is_not_counted_twice() {
    let (mut svm, pid) = setup();
    let (owner1, _owners, ms, signer) = make_multisig(&mut svm, &pid, 2, 3, 4);
    svm.airdrop(&signer, 2 * SOL).unwrap();

    let (ta, data, remaining) = sol_transfer_parts(&signer, &Pubkey::new_unique(), SOL);
    create_transaction(&mut svm, &pid, &ms, &owner1, 0, system_program::ID, ta, data).unwrap();
    let tx = transaction_pda(&pid, &ms, 0);

    // owner1 votes again — the mask stays [true,false,false], still 1 approval.
    approve(&mut svm, &pid, &ms, &tx, &owner1).unwrap();
    assert_eq!(fetch_transaction(&svm, &tx).signers, vec![true, false, false]);

    let res = execute_transaction(&mut svm, &pid, &ms, &tx, &owner1, remaining);
    assert_err_log(res, "NotEnoughSigners"); // #4
}

// #5 — A removed owner pushing an old proposal through after the owner set changed.
#[test]
fn vector_05_stale_owner_set_cannot_execute() {
    let (mut svm, pid) = setup();
    // owners [o1, o2], threshold 1 (so proposals are ready right after the auto-vote).
    let owner1 = funded_keypair(&mut svm, 5 * SOL);
    let owner2 = funded_keypair(&mut svm, 5 * SOL);
    let owners = vec![owner1.pubkey(), owner2.pubkey()];
    create_multisig(&mut svm, &pid, &owner1, &owners, 1, 5).unwrap();
    let ms = multisig_pda(&pid, &owner1.pubkey(), 5);
    let (signer, _) = multisig_signer_pda(&pid, &ms);
    svm.airdrop(&signer, 2 * SOL).unwrap();

    // Proposal A (index 0) — ready, but we do NOT execute it.
    let (ta_a, data_a, remaining_a) = sol_transfer_parts(&signer, &Pubkey::new_unique(), SOL);
    create_transaction(&mut svm, &pid, &ms, &owner1, 0, system_program::ID, ta_a, data_a).unwrap();
    let tx_a = transaction_pda(&pid, &ms, 0);

    // Proposal B (index 1) — set_owners([o1]) -> seqno 0->1. Execute it.
    let (ta_b, data_b, remaining_b) = set_owners_parts(&pid, &ms, &signer, vec![owner1.pubkey()]);
    create_transaction(&mut svm, &pid, &ms, &owner1, 1, pid, ta_b, data_b).unwrap();
    let tx_b = transaction_pda(&pid, &ms, 1);
    execute_transaction(&mut svm, &pid, &ms, &tx_b, &owner1, remaining_b).unwrap();
    assert_eq!(fetch_multisig(&svm, &ms).owner_set_seqno, 1);

    // Now A is invalidated.
    let res = execute_transaction(&mut svm, &pid, &ms, &tx_a, &owner1, remaining_a);
    assert_err_log(res, "InvalidOwnerSetForExecute"); // #5
}

// #6 — Changing the threshold while bypassing the vote (a direct call).
#[test]
fn vector_06_direct_change_threshold_fails() {
    use anchor_lang::solana_program::instruction::Instruction;
    use anchor_lang::{InstructionData, ToAccountMetas};
    use solana_message::{Message, VersionedMessage};
    use solana_transaction::versioned::VersionedTransaction;

    let (mut svm, pid) = setup();
    let (owner1, _owners, ms, signer) = make_multisig(&mut svm, &pid, 1, 2, 6);

    let ix = Instruction::new_with_bytes(
        pid,
        &magican_solana_multisig::instruction::ChangeThreshold { threshold: 1 }.data(),
        magican_solana_multisig::accounts::Auth {
            multisig: ms,
            multisig_signer: signer,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&owner1.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&owner1]);
    let failed = match tx {
        Err(_) => true,
        Ok(tx) => svm.send_transaction(tx).is_err(),
    };
    assert!(failed, "#6: a direct change_threshold without the self-CPI must fail");
}

// #7 — Reinit of an existing multisig.
#[test]
fn vector_07_reinit_fails() {
    let (mut svm, pid) = setup();
    let owner1 = funded_keypair(&mut svm, 5 * SOL);
    let owners = vec![owner1.pubkey(), Pubkey::new_unique()];
    create_multisig(&mut svm, &pid, &owner1, &owners, 1, 7).unwrap();
    // A repeated create with the same creator+seed -> the same PDA -> init fails.
    let res = create_multisig(&mut svm, &pid, &owner1, &owners, 1, 7);
    assert!(res.is_err(), "#7: reinit of an existing multisig must fail");
}

// #8 — Substituting the PDA with a non-canonical/foreign address.
#[test]
fn vector_08_wrong_pda_address_fails() {
    let (mut svm, pid) = setup();
    let owner1 = funded_keypair(&mut svm, 5 * SOL);
    let owners = vec![owner1.pubkey(), Pubkey::new_unique()];

    // The account is derived for seed=100 while the instruction says seed=8 -> seeds constraint fails.
    let wrong = multisig_pda(&pid, &owner1.pubkey(), 100);
    let res = create_multisig_at(&mut svm, &pid, &owner1, &wrong, &owners, 1, 8);
    assert_err_log(res, "ConstraintSeeds"); // #8
}

// #9 — An invalid threshold through governance (0).
#[test]
fn vector_09_change_threshold_zero_fails() {
    let (mut svm, pid) = setup();
    let (owner1, _owners, ms, signer) = make_multisig(&mut svm, &pid, 1, 2, 9);

    let (ta, data, remaining) = change_threshold_parts(&pid, &ms, &signer, 0);
    create_transaction(&mut svm, &pid, &ms, &owner1, 0, pid, ta, data).unwrap();
    let tx = transaction_pda(&pid, &ms, 0);
    // The inner change_threshold(0) fails -> the whole execute reverts.
    let res = execute_transaction(&mut svm, &pid, &ms, &tx, &owner1, remaining);
    assert_err_log(res, "InvalidThreshold"); // #9
    assert!(!fetch_transaction(&svm, &tx).did_execute, "did_execute is not set on a revert");
}

// #10 — Duplicate owners through governance.
#[test]
fn vector_10_set_owners_duplicate_fails() {
    let (mut svm, pid) = setup();
    let (owner1, _owners, ms, signer) = make_multisig(&mut svm, &pid, 1, 2, 10);

    let dup = Pubkey::new_unique();
    let (ta, data, remaining) = set_owners_parts(&pid, &ms, &signer, vec![dup, dup]);
    create_transaction(&mut svm, &pid, &ms, &owner1, 0, pid, ta, data).unwrap();
    let tx = transaction_pda(&pid, &ms, 0);
    let res = execute_transaction(&mut svm, &pid, &ms, &tx, &owner1, remaining);
    assert_err_log(res, "DuplicateOwner"); // #10
}

// #11 — Privilege escalation during a CPI: the program cannot sign for a foreign account.
#[test]
fn vector_11_cpi_privilege_escalation_fails() {
    let (mut svm, pid) = setup();
    let (owner1, _owners, ms, _signer) = make_multisig(&mut svm, &pid, 1, 2, 11);

    // The victim is a plain System account with funds that we do NOT control.
    let victim = Pubkey::new_unique();
    svm.airdrop(&victim, 3 * SOL).unwrap();
    let recipient = Pubkey::new_unique();

    // The proposal: a SOL transfer OUT OF victim (victim is marked is_signer=true).
    let inner = system_instruction::transfer(&victim, &recipient, SOL);
    let ta = vec![
        TransactionAccount {
            pubkey: victim,
            is_signer: true,
            is_writable: true,
        },
        TransactionAccount {
            pubkey: recipient,
            is_signer: false,
            is_writable: true,
        },
    ];
    let remaining = vec![
        AccountMeta::new(victim, false),
        AccountMeta::new(recipient, false),
        AccountMeta::new_readonly(system_program::ID, false),
    ];

    create_transaction(&mut svm, &pid, &ms, &owner1, 0, system_program::ID, ta, inner.data).unwrap();
    let tx = transaction_pda(&pid, &ms, 0);

    // invoke_signed signs only for the treasury PDA, not for victim -> the CPI fails.
    let res = execute_transaction(&mut svm, &pid, &ms, &tx, &owner1, remaining);
    assert!(res.is_err(), "#11: the program cannot sign for a foreign account");
    assert_eq!(svm.get_balance(&victim), Some(3 * SOL), "the victim's funds are untouched");
}
