// A mirror of the on-chain constants from programs/magican-solana-multisig/src/constants.rs.
// Kept in one place: the client-side validation and the error texts must not drift apart
// from the program when the limits change.
export const MAX_OWNERS = 10;
export const MAX_TX_ACCOUNTS = 16;
export const MAX_TX_DATA = 1024;
