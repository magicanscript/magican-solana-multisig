use anchor_lang::prelude::*;

use crate::constants::{MAX_OWNERS, MAX_TX_ACCOUNTS, MAX_TX_DATA};
use crate::error::ErrorCode;

/// A PDA wallet guarded by multiple signatures.
///
/// seeds = [MULTISIG_SEED, creator.key(), seed.to_le_bytes()] — uniqueness per creator.
/// This is the RULES account (owners, threshold, counters). Funds are held, and inner
/// instructions signed, by a separate treasury PDA `multisig_signer` (see `signer_bump`).
/// `creator` and `seed` are stored so the signing seeds can be reconstructed.
#[account]
#[derive(InitSpace)]
pub struct Multisig {
    /// Creator — part of the PDA seeds (needed for `invoke_signed`).
    pub creator: Pubkey,
    /// User-supplied seed — part of the PDA seeds (lets one creator own many multisigs).
    pub seed: u64,
    /// The list of owners (N).
    #[max_len(MAX_OWNERS)]
    pub owners: Vec<Pubkey>,
    /// How many signatures execution requires (M).
    pub threshold: u8,
    /// Owner-set version — invalidates old proposals when the owners change.
    pub owner_set_seqno: u32,
    /// Counter used to derive transaction PDAs.
    pub transaction_count: u64,
    /// Canonical bump of the `Multisig` data PDA itself.
    pub bump: u8,
    /// Canonical bump of the treasury/authority PDA (`multisig_signer`, seeds = [multisig.key()]).
    /// This is a System-owned PDA treasury: it holds the funds and signs inner instructions
    /// via `invoke_signed`. It is split off from the data account because `SystemProgram.transfer`
    /// requires the source account to be System-owned.
    pub signer_bump: u8,
}

/// A proposal (a single inner instruction) going through the voting procedure.
///
/// seeds = [TRANSACTION_SEED, multisig.key(), transaction_index.to_le_bytes()].
#[account]
#[derive(InitSpace)]
pub struct Transaction {
    /// Which multisig it belongs to.
    pub multisig: Pubkey,
    /// Who proposed it.
    pub proposer: Pubkey,
    /// Target program of the inner instruction.
    pub program_id: Pubkey,
    /// Account metadata of the inner instruction.
    #[max_len(MAX_TX_ACCOUNTS)]
    pub accounts: Vec<TransactionAccount>,
    /// Serialized data of the inner instruction.
    #[max_len(MAX_TX_DATA)]
    pub data: Vec<u8>,
    /// Approval mask, with length = owners.len() at creation time.
    #[max_len(MAX_OWNERS)]
    pub signers: Vec<bool>,
    /// Guard against repeated execution (replay).
    pub did_execute: bool,
    /// Snapshot of the owner-set version at creation time.
    pub owner_set_seqno: u32,
}

/// Metadata of a single account of the inner instruction.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct TransactionAccount {
    pub pubkey: Pubkey,
    pub is_signer: bool,
    pub is_writable: bool,
}

/// Validation of the owner set and the threshold — reused by `create_multisig`,
/// `set_owners`, `change_threshold`.
///
/// Checks: non-empty list, the N limit, absence of duplicates, `1 <= threshold <= N`.
pub fn assert_valid_owners_and_threshold(owners: &[Pubkey], threshold: u8) -> Result<()> {
    require!(!owners.is_empty(), ErrorCode::InvalidThreshold);
    require!(owners.len() <= MAX_OWNERS, ErrorCode::TooManyOwners);
    assert_unique_owners(owners)?;
    require!(
        threshold >= 1 && (threshold as usize) <= owners.len(),
        ErrorCode::InvalidThreshold
    );
    Ok(())
}

/// Owner uniqueness check: duplicates would bypass the effective threshold (#10).
pub fn assert_unique_owners(owners: &[Pubkey]) -> Result<()> {
    for (i, owner) in owners.iter().enumerate() {
        require!(
            !owners.iter().skip(i + 1).any(|o| o == owner),
            ErrorCode::DuplicateOwner
        );
    }
    Ok(())
}
