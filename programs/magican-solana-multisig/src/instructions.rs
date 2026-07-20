// The glob re-export is needed so that `#[program]` in lib.rs sees the Anchor-generated
// client modules (`__client_accounts_*`), not just the Accounts structs themselves.
#![allow(ambiguous_glob_reexports)]

pub mod approve;
pub mod create_multisig;
pub mod create_transaction;
pub mod execute_transaction;
pub mod governance;

pub use approve::*;
pub use create_multisig::*;
pub use create_transaction::*;
pub use execute_transaction::*;
pub use governance::*;
