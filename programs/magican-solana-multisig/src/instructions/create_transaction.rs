use anchor_lang::prelude::*;

use crate::constants::{MAX_TX_ACCOUNTS, MAX_TX_DATA, TRANSACTION_SEED};
use crate::error::ErrorCode;
use crate::state::{Multisig, Transaction, TransactionAccount};

#[derive(Accounts)]
pub struct CreateTransaction<'info> {
    /// mut — we increment `transaction_count` (the transaction PDA derivation counter).
    #[account(mut)]
    pub multisig: Account<'info, Multisig>,
    /// The new proposal. Its PDA is bound to the multisig's current `transaction_count`.
    #[account(
        init,
        payer = proposer,
        space = 8 + Transaction::INIT_SPACE,
        seeds = [TRANSACTION_SEED, multisig.key().as_ref(), &multisig.transaction_count.to_le_bytes()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,
    #[account(mut)]
    pub proposer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateTransaction>,
    program_id: Pubkey,
    accounts: Vec<TransactionAccount>,
    data: Vec<u8>,
) -> Result<()> {
    let multisig = &mut ctx.accounts.multisig;

    // Only an owner may propose (#1). The index is needed for the auto-vote.
    let proposer_index = multisig
        .owners
        .iter()
        .position(|owner| owner == &ctx.accounts.proposer.key())
        .ok_or(ErrorCode::NotAnOwner)?;

    require!(
        accounts.len() <= MAX_TX_ACCOUNTS,
        ErrorCode::TooManyAccounts
    );
    require!(data.len() <= MAX_TX_DATA, ErrorCode::DataTooLarge);

    // Vote mask with length = number of owners; the proposer votes automatically.
    let mut signers = vec![false; multisig.owners.len()];
    signers[proposer_index] = true;

    let transaction = &mut ctx.accounts.transaction;
    transaction.multisig = multisig.key();
    transaction.proposer = ctx.accounts.proposer.key();
    transaction.program_id = program_id;
    transaction.accounts = accounts;
    transaction.data = data;
    transaction.signers = signers;
    transaction.did_execute = false;
    // Owner-set version snapshot — invalidates the proposal on a future owner change (#5).
    transaction.owner_set_seqno = multisig.owner_set_seqno;

    multisig.transaction_count = multisig
        .transaction_count
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}
