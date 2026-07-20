use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::{Multisig, Transaction};

#[derive(Accounts)]
pub struct Approve<'info> {
    pub multisig: Account<'info, Multisig>,
    /// `has_one = multisig` binds the proposal to the correct multisig (#9).
    #[account(mut, has_one = multisig)]
    pub transaction: Account<'info, Transaction>,
    pub owner: Signer<'info>,
}

pub fn handler(ctx: Context<Approve>) -> Result<()> {
    let multisig = &ctx.accounts.multisig;
    let transaction = &mut ctx.accounts.transaction;

    // Only an owner may approve (#1).
    let owner_index = multisig
        .owners
        .iter()
        .position(|owner| owner == &ctx.accounts.owner.key())
        .ok_or(ErrorCode::NotAnOwner)?;

    // An already executed (#3) or stale (#5) proposal must not be approved.
    require!(!transaction.did_execute, ErrorCode::AlreadyExecuted);
    require!(
        transaction.owner_set_seqno == multisig.owner_set_seqno,
        ErrorCode::InvalidOwnerSetForExecute
    );

    // Idempotent: a boolean mask indexed by owner — a repeat does not inflate the count (#4).
    transaction.signers[owner_index] = true;

    Ok(())
}
