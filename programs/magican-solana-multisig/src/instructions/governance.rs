use anchor_lang::prelude::*;

use crate::constants::MAX_OWNERS;
use crate::error::ErrorCode;
use crate::state::{assert_unique_owners, Multisig};

/// Context for governing the rules. The signer is the treasury/authority PDA (`multisig_signer`),
/// declared as a `Signer` with a seed constraint: ONLY `invoke_signed` from `execute_transaction`
/// can sign on its behalf. So `set_owners`/`change_threshold` are unreachable directly — only
/// "through the vote" (#6). The pattern comes from the audited `coral-xyz/multisig`.
#[derive(Accounts)]
pub struct Auth<'info> {
    #[account(mut)]
    pub multisig: Account<'info, Multisig>,
    #[account(
        seeds = [multisig.key().as_ref()],
        bump = multisig.signer_bump,
    )]
    pub multisig_signer: Signer<'info>,
}

// The `_handler` suffix is not cosmetic: `instructions.rs` glob-re-exports this module, and a
// bare `set_owners` would collide with the `#[program]` function of the same name in lib.rs
// (ambiguous_glob_reexports).
pub fn set_owners_handler(ctx: Context<Auth>, owners: Vec<Pubkey>) -> Result<()> {
    require!(!owners.is_empty(), ErrorCode::InvalidThreshold);
    require!(owners.len() <= MAX_OWNERS, ErrorCode::TooManyOwners);
    assert_unique_owners(&owners)?;

    let multisig = &mut ctx.accounts.multisig;

    // If the owners now number fewer than the threshold, clamp the threshold down (behavior of
    // the audited reference: safer than leaving an unreachable threshold).
    if (owners.len() as u8) < multisig.threshold {
        multisig.threshold = owners.len() as u8;
    }
    multisig.owners = owners;

    // Incrementing the owner-set version invalidates every proposal created earlier but not
    // yet executed (#5): a removed owner cannot push an old one through.
    multisig.owner_set_seqno = multisig
        .owner_set_seqno
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}

pub fn change_threshold_handler(ctx: Context<Auth>, threshold: u8) -> Result<()> {
    let multisig = &mut ctx.accounts.multisig;
    require!(
        threshold >= 1 && (threshold as usize) <= multisig.owners.len(),
        ErrorCode::InvalidThreshold
    );
    multisig.threshold = threshold;

    // F2 (audit): changing the threshold is a change of the quorum rules too. `execute` reads
    // `threshold` at execution time, so LOWERING the threshold would make an old proposal that
    // never gathered enough votes suddenly executable without re-approval under the new rule.
    // We bump `owner_set_seqno` (using it as the overall configuration version) in order to
    // invalidate all pending proposals and demand fresh votes (#5).
    multisig.owner_set_seqno = multisig
        .owner_set_seqno
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}
