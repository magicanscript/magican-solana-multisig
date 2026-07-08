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

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
