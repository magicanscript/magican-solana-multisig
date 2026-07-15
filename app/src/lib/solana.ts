import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS } from "@generated";

// NEXT_PUBLIC_* инлайнится на build-time только при статическом полном доступе.
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const WS_URL = process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? "ws://127.0.0.1:8900";

export const PROGRAM_ID = MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS;

let _rpc: ReturnType<typeof createSolanaRpc> | null = null;
let _subs: ReturnType<typeof createSolanaRpcSubscriptions> | null = null;

export const getRpc = () => (_rpc ??= createSolanaRpc(RPC_URL));
export const getRpcSubscriptions = () => (_subs ??= createSolanaRpcSubscriptions(WS_URL));

export { RPC_URL, WS_URL };
