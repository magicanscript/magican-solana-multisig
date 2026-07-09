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
    let owner2 = funded_keypair(&mut svm, 5_000_000_000); // второй одобряющий
    let owner3 = Keypair::new();
    let owners = vec![owner1.pubkey(), owner2.pubkey(), owner3.pubkey()];
    let seed: u64 = 1;

    create_multisig(&mut svm, &program_id, &owner1, &owners, 2, seed).unwrap();
    let multisig = multisig_pda(&program_id, &owner1.pubkey(), seed);
    let (signer_pda, _) = multisig_signer_pda(&program_id, &multisig);

    // Пополняем PDA-казну 2 SOL.
    svm.airdrop(&signer_pda, 2_000_000_000).unwrap();

    let recipient = Pubkey::new_unique();
    let amount = 1_000_000_000;
    let (ta, data, remaining) = sol_transfer_parts(&signer_pda, &recipient, amount);

    // Предложение (index 0). Автоголос owner1 → одобрений 1.
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
    assert_eq!(tx_state.signers, vec![true, false, false], "автоголос proposer");
    assert!(!tx_state.did_execute);

    // При 1 из 2 одобрений execute должен падать.
    let early = execute_transaction(
        &mut svm,
        &program_id,
        &multisig,
        &tx_pda,
        &owner1,
        remaining.clone(),
    );
    assert!(early.is_err(), "execute ниже порога должен падать");
    // Обновляем blockhash: иначе финальный execute повторит сообщение раннего → AlreadyProcessed.
    svm.expire_blockhash();

    // Второе одобрение owner2 → одобрений 2 = threshold.
    approve(&mut svm, &program_id, &multisig, &tx_pda, &owner2).unwrap();
    assert_eq!(
        fetch_transaction(&svm, &tx_pda).signers,
        vec![true, true, false]
    );

    // Теперь execute проходит; SOL уходит с PDA-казны.
    execute_transaction(&mut svm, &program_id, &multisig, &tx_pda, &owner1, remaining).unwrap();

    assert_eq!(svm.get_balance(&recipient), Some(amount), "получатель получил 1 SOL");
    assert_eq!(
        svm.get_balance(&signer_pda),
        Some(1_000_000_000),
        "в казне осталось 1 SOL"
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

    // owner1 голосует повторно — маска не меняется, лишнего голоса нет.
    approve(&mut svm, &program_id, &multisig, &tx_pda, &owner1).unwrap();
    assert_eq!(
        fetch_transaction(&svm, &tx_pda).signers,
        vec![true, false, false],
        "повторный approve не накручивает счётчик"
    );
}
