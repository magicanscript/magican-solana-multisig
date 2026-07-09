use anchor_lang::prelude::*;

use crate::constants::{MAX_OWNERS, MAX_TX_ACCOUNTS, MAX_TX_DATA};
use crate::error::ErrorCode;

/// PDA-кошелёк с мультиподписью.
///
/// seeds = [MULTISIG_SEED, creator.key(), seed.to_le_bytes()] — уникальность на создателя.
/// Сам аккаунт выступает «владельцем» средств и подписывает вложенные инструкции
/// через `invoke_signed`. `creator` и `seed` хранятся, чтобы реконструировать сиды подписи.
#[account]
#[derive(InitSpace)]
pub struct Multisig {
    /// Создатель — часть сидов PDA (нужен для `invoke_signed`).
    pub creator: Pubkey,
    /// Пользовательский сид — часть сидов PDA (позволяет одному создателю иметь много мультисигов).
    pub seed: u64,
    /// Список владельцев (N).
    #[max_len(MAX_OWNERS)]
    pub owners: Vec<Pubkey>,
    /// Сколько подписей нужно для исполнения (M).
    pub threshold: u8,
    /// Версия набора владельцев — инвалидирует старые предложения при смене владельцев.
    pub owner_set_seqno: u32,
    /// Счётчик для деривации PDA транзакций.
    pub transaction_count: u64,
    /// Канонический bump самого PDA данных `Multisig`.
    pub bump: u8,
    /// Канонический bump treasury/authority PDA (`multisig_signer`, seeds = [multisig.key()]).
    /// Это System-owned PDA-казна: держит средства и подписывает вложенные инструкции
    /// через `invoke_signed`. Отделён от аккаунта данных, т.к. `SystemProgram.transfer`
    /// требует System-владения source-аккаунта.
    pub signer_bump: u8,
}

/// Предложение (одна вложенная инструкция), проходящее процедуру голосования.
///
/// seeds = [TRANSACTION_SEED, multisig.key(), transaction_index.to_le_bytes()].
#[account]
#[derive(InitSpace)]
pub struct Transaction {
    /// К какому мультисигу относится.
    pub multisig: Pubkey,
    /// Кто предложил.
    pub proposer: Pubkey,
    /// Целевая программа вложенной инструкции.
    pub program_id: Pubkey,
    /// Метаданные аккаунтов вложенной инструкции.
    #[max_len(MAX_TX_ACCOUNTS)]
    pub accounts: Vec<TransactionAccount>,
    /// Сериализованные данные вложенной инструкции.
    #[max_len(MAX_TX_DATA)]
    pub data: Vec<u8>,
    /// Маска одобрений, длиной = owners.len() на момент создания.
    #[max_len(MAX_OWNERS)]
    pub signers: Vec<bool>,
    /// Защита от повторного исполнения (replay).
    pub did_execute: bool,
    /// Снапшот версии владельцев на момент создания.
    pub owner_set_seqno: u32,
}

/// Метаданные одного аккаунта вложенной инструкции.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct TransactionAccount {
    pub pubkey: Pubkey,
    pub is_signer: bool,
    pub is_writable: bool,
}

/// Валидация набора владельцев и порога — переиспользуется в `create_multisig`,
/// `set_owners`, `change_threshold`.
///
/// Проверяет: непустой список, лимит N, отсутствие дубликатов, `1 <= threshold <= N`.
pub fn assert_valid_owners_and_threshold(owners: &[Pubkey], threshold: u8) -> Result<()> {
    require!(!owners.is_empty(), ErrorCode::InvalidThreshold);
    require!(owners.len() <= MAX_OWNERS, ErrorCode::TooManyOwners);
    assert_unique_owners(owners)?;
    require!(
        threshold >= 1 && (threshold as usize) <= owners.len(),
        ErrorCode::InvalidThreshold
    );
    Ok(())
}

/// Проверка уникальности владельцев: дубликаты обходили бы эффективный порог (#10).
pub fn assert_unique_owners(owners: &[Pubkey]) -> Result<()> {
    for (i, owner) in owners.iter().enumerate() {
        require!(
            !owners.iter().skip(i + 1).any(|o| o == owner),
            ErrorCode::DuplicateOwner
        );
    }
    Ok(())
}
