use anchor_lang::prelude::*;

use crate::constants::MAX_OWNERS;
use crate::error::ErrorCode;
use crate::state::{assert_unique_owners, Multisig};

/// Контекст управления правилами. Подписант — treasury/authority PDA (`multisig_signer`),
/// объявленный как `Signer` с seed-констрейнтом: подписать за него может ТОЛЬКО `invoke_signed`
/// из `execute_transaction`. Значит `set_owners`/`change_threshold` недоступны напрямую —
/// только «сквозь голосование» (#6). Паттерн из аудированного `coral-xyz/multisig`.
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

pub fn set_owners(ctx: Context<Auth>, owners: Vec<Pubkey>) -> Result<()> {
    require!(!owners.is_empty(), ErrorCode::InvalidThreshold);
    require!(owners.len() <= MAX_OWNERS, ErrorCode::TooManyOwners);
    assert_unique_owners(&owners)?;

    let multisig = &mut ctx.accounts.multisig;

    // Если владельцев стало меньше порога — клампим порог вниз (поведение аудированного
    // эталона: безопаснее, чем оставить недостижимый threshold).
    if (owners.len() as u8) < multisig.threshold {
        multisig.threshold = owners.len() as u8;
    }
    multisig.owners = owners;

    // Инкремент версии набора владельцев инвалидирует все ранее созданные, но не
    // исполненные предложения (#5): уволенный владелец не доисполнит старое.
    multisig.owner_set_seqno = multisig
        .owner_set_seqno
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}

pub fn change_threshold(ctx: Context<Auth>, threshold: u8) -> Result<()> {
    let multisig = &mut ctx.accounts.multisig;
    require!(
        threshold >= 1 && (threshold as usize) <= multisig.owners.len(),
        ErrorCode::InvalidThreshold
    );
    multisig.threshold = threshold;
    Ok(())
}
