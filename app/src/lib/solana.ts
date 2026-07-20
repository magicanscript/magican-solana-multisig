import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS } from "@generated";

// NEXT_PUBLIC_* инлайнится на build-time только при статическом полном доступе.
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const WS_URL = process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? "ws://127.0.0.1:8900";

export const PROGRAM_ID = MAGICAN_SOLANA_MULTISIG_PROGRAM_ADDRESS;

/**
 * Commitment для ВСЕХ чтений. Без него RPC отвечает по `finalized` — это ~13 секунд
 * отставания: только что созданный мультисиг выглядел «не найден», а свежий голос
 * после approve не появлялся, будто подпись не прошла. Отправку подтверждаем тем же
 * уровнем, чтобы прочитанное не отставало от отправленного.
 */
export const READ_COMMITMENT = 'confirmed' as const;

let _rpc: ReturnType<typeof createSolanaRpc> | null = null;
let _subs: ReturnType<typeof createSolanaRpcSubscriptions> | null = null;

export const getRpc = () => (_rpc ??= createSolanaRpc(RPC_URL));
export const getRpcSubscriptions = () => (_subs ??= createSolanaRpcSubscriptions(WS_URL));

export { RPC_URL, WS_URL };
