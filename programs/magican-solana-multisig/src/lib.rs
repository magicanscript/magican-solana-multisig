pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("EKYNZ8yeiivzgpmbq5TxC5bphmRnfARLxgzMxDUhHEUG");

#[program]
pub mod magican_solana_multisig {
    use super::*;

    /// Создаёт PDA-мультисиг. `1 <= threshold <= owners.len()`, без дубликатов, N <= MAX_OWNERS.
    pub fn create_multisig(
        ctx: Context<CreateMultisig>,
        owners: Vec<Pubkey>,
        threshold: u8,
        seed: u64,
    ) -> Result<()> {
        create_multisig::handler(ctx, owners, threshold, seed)
    }

    /// Создаёт предложение (одна вложенная инструкция) и ставит автоголос proposer'а.
    /// Вызывать может только владелец.
    pub fn create_transaction(
        ctx: Context<CreateTransaction>,
        program_id: Pubkey,
        accounts: Vec<TransactionAccount>,
        data: Vec<u8>,
    ) -> Result<()> {
        create_transaction::handler(ctx, program_id, accounts, data)
    }

    /// Ставит голос владельца за предложение (идемпотентно).
    pub fn approve(ctx: Context<Approve>) -> Result<()> {
        approve::handler(ctx)
    }

    /// Исполняет предложение через `invoke_signed`, если одобрений >= threshold.
    /// Целевые аккаунты и программа передаются как remaining_accounts.
    pub fn execute_transaction(ctx: Context<ExecuteTransaction>) -> Result<()> {
        execute_transaction::handler(ctx)
    }

    /// Меняет набор владельцев и инкрементирует `owner_set_seqno`.
    /// Доступно только через self-CPI из `execute_transaction` (см. `Auth`).
    pub fn set_owners(ctx: Context<Auth>, owners: Vec<Pubkey>) -> Result<()> {
        governance::set_owners(ctx, owners)
    }

    /// Меняет порог. Доступно только через self-CPI из `execute_transaction`.
    pub fn change_threshold(ctx: Context<Auth>, threshold: u8) -> Result<()> {
        governance::change_threshold(ctx, threshold)
    }
}
