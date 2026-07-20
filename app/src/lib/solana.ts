import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS } from "@generated";

// NEXT_PUBLIC_* is inlined at build time only on a full static access path.
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const WS_URL = process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? "ws://127.0.0.1:8900";

export const PROGRAM_ID = MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS;

/**
 * The commitment for ALL reads. Without it RPC answers at `finalized` — that is ~13 seconds
 * of lag: a just-created multisig looked "not found", and a fresh approval after approve did
 * not show up, as if the signature had not gone through. We confirm sends at the same level,
 * so that what is read does not lag behind what was sent.
 */
export const READ_COMMITMENT = 'confirmed' as const;

let _rpc: ReturnType<typeof createSolanaRpc> | null = null;
let _subs: ReturnType<typeof createSolanaRpcSubscriptions> | null = null;

export const getRpc = () => (_rpc ??= createSolanaRpc(RPC_URL));
export const getRpcSubscriptions = () => (_subs ??= createSolanaRpcSubscriptions(WS_URL));

export { RPC_URL, WS_URL };
