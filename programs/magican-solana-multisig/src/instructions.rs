// Glob-реэкспорт нужен, чтобы `#[program]` в lib.rs видел сгенерированные Anchor
// клиентские модули (`__client_accounts_*`), а не только сами Accounts-структуры.
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
