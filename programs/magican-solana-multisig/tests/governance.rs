mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::AccountMeta;
use common::*;
use magican_solana_multisig::TransactionAccount;
use solana_keypair::Keypair;
use solana_signer::Signer;

/// Проводит governance-предложение (target = сам мультисиг) через полный цикл
/// propose → approve → execute. Возвращает результат execute.
fn run_governance_proposal(
    svm: &mut litesvm::LiteSVM,
    program_id: &Pubkey,
    multisig: &Pubkey,
    proposer: &Keypair,
    approver: &Keypair,
    index: u64,
    ta: Vec<TransactionAccount>,
    data: Vec<u8>,
    remaining: Vec<AccountMeta>,
) -> TxResult {
    create_transaction(svm, program_id, multisig, proposer, index, *program_id, ta, data).unwrap();
    let tx_pda = transaction_pda(program_id, multisig, index);
    approve(svm, program_id, multisig, &tx_pda, approver).unwrap();
    execute_transaction(svm, program_id, multisig, &tx_pda, proposer, remaining)
}

#[test]
fn test_set_owners_invalidates_pending_proposal() {
    let (mut svm, program_id) = setup();

    let owner1 = funded_keypair(&mut svm, 5_000_000_000);
    let owner2 = funded_keypair(&mut svm, 5_000_000_000);
    let owner3 = Keypair::new();
    let owners = vec![owner1.pubkey(), owner2.pubkey(), owner3.pubkey()];
    let seed: u64 = 1;

    create_multisig(&mut svm, &program_id, &owner1, &owners, 2, seed).unwrap();
    let multisig = multisig_pda(&program_id, &owner1.pubkey(), seed);
    let (signer_pda, _) = multisig_signer_pda(&program_id, &multisig);
    svm.airdrop(&signer_pda, 2_000_000_000).unwrap();

    // Предложение A (index 0): перевод SOL. Набираем 2/2 одобрений, но НЕ исполняем.
    let recipient = Pubkey::new_unique();
    let (ta_a, data_a, remaining_a) = sol_transfer_parts(&signer_pda, &recipient, 1_000_000_000);
    create_transaction(&mut svm, &program_id, &multisig, &owner1, 0, anchor_lang::solana_program::system_program::ID, ta_a, data_a).unwrap();
    let tx_a = transaction_pda(&program_id, &multisig, 0);
    approve(&mut svm, &program_id, &multisig, &tx_a, &owner2).unwrap();
    assert_eq!(fetch_transaction(&svm, &tx_a).signers, vec![true, true, false], "A готово к исполнению");

    // Предложение B (index 1): set_owners([o1, o2]) — убираем o3. Исполняем.
    let new_owners = vec![owner1.pubkey(), owner2.pubkey()];
    let (ta_b, data_b, remaining_b) =
        set_owners_parts(&program_id, &multisig, &signer_pda, new_owners.clone());
    run_governance_proposal(&mut svm, &program_id, &multisig, &owner1, &owner2, 1, ta_b, data_b, remaining_b)
        .unwrap();

    let ms = fetch_multisig(&svm, &multisig);
    assert_eq!(ms.owners, new_owners, "владельцы обновлены");
    assert_eq!(ms.owner_set_seqno, 1, "seqno инкрементнулся");
    assert_eq!(ms.threshold, 2, "порог сохранён");

    // Теперь A нельзя исполнить: его owner_set_seqno=0 != 1 (#5).
    let stale = execute_transaction(&mut svm, &program_id, &multisig, &tx_a, &owner1, remaining_a);
    assert!(stale.is_err(), "старое предложение инвалидировано сменой владельцев");
    assert!(!fetch_transaction(&svm, &tx_a).did_execute, "A так и не исполнено");
}

#[test]
fn test_change_threshold_via_governance() {
    let (mut svm, program_id) = setup();

    let owner1 = funded_keypair(&mut svm, 5_000_000_000);
    let owner2 = funded_keypair(&mut svm, 5_000_000_000);
    let owner3 = Keypair::new();
    let owners = vec![owner1.pubkey(), owner2.pubkey(), owner3.pubkey()];
    let seed: u64 = 2;

    create_multisig(&mut svm, &program_id, &owner1, &owners, 2, seed).unwrap();
    let multisig = multisig_pda(&program_id, &owner1.pubkey(), seed);
    let (signer_pda, _) = multisig_signer_pda(&program_id, &multisig);

    // Меняем порог 2 → 3 через голосование.
    let (ta, data, remaining) = change_threshold_parts(&program_id, &multisig, &signer_pda, 3);
    run_governance_proposal(&mut svm, &program_id, &multisig, &owner1, &owner2, 0, ta, data, remaining)
        .unwrap();

    assert_eq!(fetch_multisig(&svm, &multisig).threshold, 3, "порог изменён на 3");
}

#[test]
fn test_change_threshold_invalidates_pending_proposal() {
    // F2 (аудит): понижение порога не должно делать исполнимым предложение,
    // которое НИКОГДА не набирало прежний кворум. Инвалидируем его бампом seqno.
    let (mut svm, program_id) = setup();

    let owner1 = funded_keypair(&mut svm, 5_000_000_000);
    let owner2 = funded_keypair(&mut svm, 5_000_000_000);
    let owner3 = funded_keypair(&mut svm, 5_000_000_000);
    let owners = vec![owner1.pubkey(), owner2.pubkey(), owner3.pubkey()];
    let seed: u64 = 4;

    // Стартовый порог 3 из 3.
    create_multisig(&mut svm, &program_id, &owner1, &owners, 3, seed).unwrap();
    let multisig = multisig_pda(&program_id, &owner1.pubkey(), seed);
    let (signer_pda, _) = multisig_signer_pda(&program_id, &multisig);
    svm.airdrop(&signer_pda, 2_000_000_000).unwrap();

    // Предложение A (index 0): перевод SOL. Набираем ТОЛЬКО 2 из 3 — кворума нет.
    let recipient = Pubkey::new_unique();
    let (ta_a, data_a, remaining_a) = sol_transfer_parts(&signer_pda, &recipient, 1_000_000_000);
    create_transaction(&mut svm, &program_id, &multisig, &owner1, 0, anchor_lang::solana_program::system_program::ID, ta_a, data_a).unwrap();
    let tx_a = transaction_pda(&program_id, &multisig, 0);
    approve(&mut svm, &program_id, &multisig, &tx_a, &owner2).unwrap();
    assert_eq!(fetch_transaction(&svm, &tx_a).signers, vec![true, true, false], "A имеет лишь 2/3");

    // При пороге 3 предложение A сейчас не исполнить.
    let insufficient = execute_transaction(&mut svm, &program_id, &multisig, &tx_a, &owner1, remaining_a.clone());
    assert_err_log(insufficient, "NotEnoughSigners");

    // Предложение B (index 1): change_threshold 3 → 2. Исполняем (нужно 3/3 согласия).
    svm.expire_blockhash();
    let (ta_b, data_b, remaining_b) = change_threshold_parts(&program_id, &multisig, &signer_pda, 2);
    create_transaction(&mut svm, &program_id, &multisig, &owner1, 1, program_id, ta_b, data_b).unwrap();
    let tx_b = transaction_pda(&program_id, &multisig, 1);
    approve(&mut svm, &program_id, &multisig, &tx_b, &owner2).unwrap();
    approve(&mut svm, &program_id, &multisig, &tx_b, &owner3).unwrap();
    execute_transaction(&mut svm, &program_id, &multisig, &tx_b, &owner1, remaining_b).unwrap();

    let ms = fetch_multisig(&svm, &multisig);
    assert_eq!(ms.threshold, 2, "порог понижен до 2");
    assert_eq!(ms.owner_set_seqno, 1, "смена порога инкрементнула seqno (F2)");

    // Ключевой момент: A имеет 2 одобрения и порог теперь 2 — но исполниться НЕ должно,
    // т.к. его snapshot seqno=0 != 1. Без фикса F2 A бы «проскочило».
    svm.expire_blockhash();
    let stale = execute_transaction(&mut svm, &program_id, &multisig, &tx_a, &owner1, remaining_a);
    assert_err_log(stale, "InvalidOwnerSetForExecute");
    assert!(!fetch_transaction(&svm, &tx_a).did_execute, "A так и не исполнено");
}

#[test]
fn test_direct_set_owners_call_fails() {
    // set_owners нельзя вызвать напрямую (#6): за multisig_signer (Signer-PDA) невозможно
    // подписать без self-CPI из execute_transaction.
    use anchor_lang::solana_program::instruction::Instruction;
    use anchor_lang::{InstructionData, ToAccountMetas};
    use solana_message::{Message, VersionedMessage};
    use solana_transaction::versioned::VersionedTransaction;

    let (mut svm, program_id) = setup();

    let owner1 = funded_keypair(&mut svm, 5_000_000_000);
    let owner2 = Keypair::new();
    let owners = vec![owner1.pubkey(), owner2.pubkey()];
    let seed: u64 = 3;

    create_multisig(&mut svm, &program_id, &owner1, &owners, 1, seed).unwrap();
    let multisig = multisig_pda(&program_id, &owner1.pubkey(), seed);
    let (signer_pda, _) = multisig_signer_pda(&program_id, &multisig);

    let ix = Instruction::new_with_bytes(
        program_id,
        &magican_solana_multisig::instruction::SetOwners {
            owners: vec![owner1.pubkey()],
        }
        .data(),
        magican_solana_multisig::accounts::Auth {
            multisig,
            multisig_signer: signer_pda,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&owner1.pubkey()), &blockhash);
    // multisig_signer помечен как обязательный подписант, но его keypair недоступен —
    // сборка транзакции падает (нет подписи PDA).
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&owner1]);
    let failed = match tx {
        Err(_) => true,
        Ok(tx) => svm.send_transaction(tx).is_err(),
    };
    assert!(failed, "прямой вызов set_owners должен падать");
}
