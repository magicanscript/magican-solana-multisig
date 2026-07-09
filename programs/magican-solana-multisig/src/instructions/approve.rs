use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::{Multisig, Transaction};

#[derive(Accounts)]
pub struct Approve<'info> {
    pub multisig: Account<'info, Multisig>,
    /// `has_one = multisig` привязывает предложение к правильному мультисигу (#9).
    #[account(mut, has_one = multisig)]
    pub transaction: Account<'info, Transaction>,
    pub owner: Signer<'info>,
}

pub fn handler(ctx: Context<Approve>) -> Result<()> {
    let multisig = &ctx.accounts.multisig;
    let transaction = &mut ctx.accounts.transaction;

    // Только владелец может одобрять (#1).
    let owner_index = multisig
        .owners
        .iter()
        .position(|owner| owner == &ctx.accounts.owner.key())
        .ok_or(ErrorCode::NotAnOwner)?;

    // Нельзя одобрять уже исполненное (#3) или устаревшее предложение (#5).
    require!(!transaction.did_execute, ErrorCode::AlreadyExecuted);
    require!(
        transaction.owner_set_seqno == multisig.owner_set_seqno,
        ErrorCode::InvalidOwnerSetForExecute
    );

    // Идемпотентно: булева маска по индексу — повтор не накручивает счётчик (#4).
    transaction.signers[owner_index] = true;

    Ok(())
}
