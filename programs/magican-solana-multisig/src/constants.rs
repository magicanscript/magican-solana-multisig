use anchor_lang::prelude::*;

/// Максимальное число владельцев (N). Ограничивает размер аккаунта `Multisig`
/// и защищает от раздувания state.
pub const MAX_OWNERS: usize = 10;

/// Максимальное число аккаунтов во вложенной инструкции предложения.
pub const MAX_TX_ACCOUNTS: usize = 16;

/// Максимальный размер сериализованных данных вложенной инструкции (байт).
pub const MAX_TX_DATA: usize = 1024;

/// Сид PDA-аккаунта мультисига: seeds = [MULTISIG_SEED, creator, seed_le].
#[constant]
pub const MULTISIG_SEED: &[u8] = b"multisig";

/// Сид PDA-аккаунта транзакции: seeds = [TRANSACTION_SEED, multisig, index_le].
#[constant]
pub const TRANSACTION_SEED: &[u8] = b"transaction";
