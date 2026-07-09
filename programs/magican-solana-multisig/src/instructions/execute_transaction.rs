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
    /// CHECK: treasury/authority PDA. Валидируется сидами и каноническим bump (#8, #11).
    /// От его имени программа подписывает вложенную инструкцию через `invoke_signed`.
    #[account(
        mut,
        seeds = [multisig.key().as_ref()],
        bump = multisig.signer_bump,
    )]
    pub multisig_signer: UncheckedAccount<'info>,
    // Целевые аккаунты вложенной инструкции + её программа приходят как `remaining_accounts`.
}

pub fn handler(ctx: Context<ExecuteTransaction>) -> Result<()> {
    let multisig = &ctx.accounts.multisig;
    let transaction = &mut ctx.accounts.transaction;

    // Replay-защита (#3).
    require!(!transaction.did_execute, ErrorCode::AlreadyExecuted);
    // Владельцы не менялись с момента создания (#5).
    require!(
        transaction.owner_set_seqno == multisig.owner_set_seqno,
        ErrorCode::InvalidOwnerSetForExecute
    );

    // Пересчёт одобрений по маске (#2). Считаем именно `true`, а не длину.
    let approvals = transaction.signers.iter().filter(|&&s| s).count();
    require!(
        approvals >= multisig.threshold as usize,
        ErrorCode::NotEnoughSigners
    );

    let signer_key = ctx.accounts.multisig_signer.key();

    // Собираем вложенную инструкцию из сохранённых метаданных. Единственная привилегия
    // подписи, которую мы добавляем, — для treasury-PDA (#11). Рантайм не даст подписать
    // за чужие аккаунты без соответствующих сидов, что закрывает эскалацию привилегий.
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

    // Помечаем исполненным ДО CPI (anti-reentrancy на уровне in-memory состояния).
    transaction.did_execute = true;

    // Сиды подписи treasury-PDA: seeds = [multisig.key()], bump = signer_bump.
    let multisig_key = multisig.key();
    let signer_bump = [multisig.signer_bump];
    let signer_seeds: &[&[u8]] = &[multisig_key.as_ref(), &signer_bump];

    // Целевые аккаунты вложенной инструкции и её программу клиент передаёт через
    // remaining_accounts (treasury-PDA среди них, раз инструкция на него ссылается).
    invoke_signed(&ix, ctx.remaining_accounts, &[signer_seeds])?;

    Ok(())
}
