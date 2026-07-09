use anchor_lang::prelude::*;

use crate::constants::MULTISIG_SEED;
use crate::state::{assert_valid_owners_and_threshold, Multisig};

#[derive(Accounts)]
#[instruction(owners: Vec<Pubkey>, threshold: u8, seed: u64)]
pub struct CreateMultisig<'info> {
    /// PDA-кошелёк. `init` (не `init_if_needed`) закрывает reinit-атаку (#7).
    /// Канонический bump сохраняем в state для последующего `invoke_signed` (#8).
    #[account(
        init,
        payer = creator,
        space = 8 + Multisig::INIT_SPACE,
        seeds = [MULTISIG_SEED, creator.key().as_ref(), &seed.to_le_bytes()],
        bump
    )]
    pub multisig: Account<'info, Multisig>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateMultisig>,
    owners: Vec<Pubkey>,
    threshold: u8,
    seed: u64,
) -> Result<()> {
    assert_valid_owners_and_threshold(&owners, threshold)?;

    let multisig = &mut ctx.accounts.multisig;
    multisig.creator = ctx.accounts.creator.key();
    multisig.seed = seed;
    multisig.owners = owners;
    multisig.threshold = threshold;
    multisig.owner_set_seqno = 0;
    multisig.transaction_count = 0;
    multisig.bump = ctx.bumps.multisig;

    Ok(())
}
