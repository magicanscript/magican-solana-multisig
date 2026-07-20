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

    /// Creates a PDA multisig. `1 <= threshold <= owners.len()`, no duplicates, N <= MAX_OWNERS.
    pub fn create_multisig(
        ctx: Context<CreateMultisig>,
        owners: Vec<Pubkey>,
        threshold: u8,
        seed: u64,
    ) -> Result<()> {
        create_multisig::handler(ctx, owners, threshold, seed)
    }

    /// Creates a proposal (a single inner instruction) and casts the proposer's auto-vote.
    /// Only an owner may call it.
    pub fn create_transaction(
        ctx: Context<CreateTransaction>,
        program_id: Pubkey,
        accounts: Vec<TransactionAccount>,
        data: Vec<u8>,
    ) -> Result<()> {
        create_transaction::handler(ctx, program_id, accounts, data)
    }

    /// Casts an owner's vote for a proposal (idempotent).
    pub fn approve(ctx: Context<Approve>) -> Result<()> {
        approve::handler(ctx)
    }

    /// Executes a proposal via `invoke_signed` once approvals >= threshold.
    /// The target accounts and program are passed as remaining_accounts.
    pub fn execute_transaction(ctx: Context<ExecuteTransaction>) -> Result<()> {
        execute_transaction::handler(ctx)
    }

    /// Changes the owner set and increments `owner_set_seqno`.
    /// Reachable only through a self-CPI from `execute_transaction` (see `Auth`).
    pub fn set_owners(ctx: Context<Auth>, owners: Vec<Pubkey>) -> Result<()> {
        governance::set_owners_handler(ctx, owners)
    }

    /// Changes the threshold. Reachable only through a self-CPI from `execute_transaction`.
    pub fn change_threshold(ctx: Context<Auth>, threshold: u8) -> Result<()> {
        governance::change_threshold_handler(ctx, threshold)
    }
}
