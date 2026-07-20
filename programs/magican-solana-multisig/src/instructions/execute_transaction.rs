use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

use crate::error::ErrorCode;
use crate::state::{Multisig, Transaction};

#[derive(Accounts)]
pub struct ExecuteTransaction<'info> {
    pub multisig: Account<'info, Multisig>,
    #[account(mut, has_one = multisig)]
    pub transaction: Account<'info, Transaction>,
    /// CHECK: treasury/authority PDA. Validated by seeds and the canonical bump (#8, #11).
    /// On its behalf the program signs the inner instruction via `invoke_signed`.
    #[account(
        mut,
        seeds = [multisig.key().as_ref()],
        bump = multisig.signer_bump,
    )]
    pub multisig_signer: UncheckedAccount<'info>,
    // The inner instruction's target accounts + its program arrive as `remaining_accounts`.
}

pub fn handler(ctx: Context<ExecuteTransaction>) -> Result<()> {
    let multisig = &ctx.accounts.multisig;
    let transaction = &mut ctx.accounts.transaction;

    // Replay protection (#3).
    require!(!transaction.did_execute, ErrorCode::AlreadyExecuted);
    // The owners have not changed since creation (#5).
    require!(
        transaction.owner_set_seqno == multisig.owner_set_seqno,
        ErrorCode::InvalidOwnerSetForExecute
    );

    // Recount the approvals from the mask (#2). We count `true` entries, not the length.
    let approvals = transaction.signers.iter().filter(|&&s| s).count();
    require!(
        approvals >= multisig.threshold as usize,
        ErrorCode::NotEnoughSigners
    );

    let signer_key = ctx.accounts.multisig_signer.key();

    // Rebuild the inner instruction from the stored metadata. The only signing privilege
    // we add is the one for the treasury PDA (#11). The runtime will not let us sign for
    // foreign accounts without the matching seeds, which closes privilege escalation.
    let account_metas: Vec<AccountMeta> = transaction
        .accounts
        .iter()
        .map(|acc| AccountMeta {
            pubkey: acc.pubkey,
            is_signer: acc.is_signer || acc.pubkey == signer_key,
            is_writable: acc.is_writable,
        })
        .collect();

    let ix = Instruction {
        program_id: transaction.program_id,
        accounts: account_metas,
        data: transaction.data.clone(),
    };

    // Mark it executed BEFORE the CPI (anti-reentrancy at the in-memory state level).
    transaction.did_execute = true;

    // Signing seeds of the treasury PDA: seeds = [multisig.key()], bump = signer_bump.
    let multisig_key = multisig.key();
    let signer_bump = [multisig.signer_bump];
    let signer_seeds: &[&[u8]] = &[multisig_key.as_ref(), &signer_bump];

    // The client passes the inner instruction's target accounts and its program through
    // remaining_accounts (the treasury PDA among them, since the instruction refers to it).
    invoke_signed(&ix, ctx.remaining_accounts, &[signer_seeds])?;

    Ok(())
}
