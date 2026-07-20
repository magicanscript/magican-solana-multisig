use anchor_lang::prelude::*;

/// Maximum number of owners (N). Bounds the size of the `Multisig` account
/// and protects against state bloat.
pub const MAX_OWNERS: usize = 10;

/// Maximum number of accounts in a proposal's inner instruction.
pub const MAX_TX_ACCOUNTS: usize = 16;

/// Maximum size of the inner instruction's serialized data (bytes).
pub const MAX_TX_DATA: usize = 1024;

/// Seed of the multisig PDA account: seeds = [MULTISIG_SEED, creator, seed_le].
#[constant]
pub const MULTISIG_SEED: &[u8] = b"multisig";

/// Seed of the transaction PDA account: seeds = [TRANSACTION_SEED, multisig, index_le].
#[constant]
pub const TRANSACTION_SEED: &[u8] = b"transaction";
