use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Threshold must be >= 1 and <= number of owners")]
    InvalidThreshold,
    #[msg("Too many owners")]
    TooManyOwners,
    #[msg("Owners list contains a duplicate")]
    DuplicateOwner,
    #[msg("Signer is not one of the multisig owners")]
    NotAnOwner,
    #[msg("Transaction has already been executed")]
    AlreadyExecuted,
    #[msg("Not enough approvals to reach the threshold")]
    NotEnoughSigners,
    #[msg("Owner set changed since this transaction was created")]
    InvalidOwnerSetForExecute,
    #[msg("The nested instruction has too many accounts")]
    TooManyAccounts,
    #[msg("The nested instruction data is too large")]
    DataTooLarge,
    #[msg("This instruction can only be invoked by the multisig itself")]
    UnauthorizedGovernance,
}
