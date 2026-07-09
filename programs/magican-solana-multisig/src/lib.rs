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
}
