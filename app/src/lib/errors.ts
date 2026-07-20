import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
} from "@solana/kit";
import { MAX_OWNERS } from "./limits";

// Program error codes (Anchor: 6000 + the variant's ordinal number).
const MESSAGES: Record<number, string> = {
  6000: "Threshold must be between 1 and the number of owners",
  6001: `Too many owners (maximum ${MAX_OWNERS})`,
  6002: "The owners list contains a duplicate",
  6003: "You are not an owner of this multisig",
  6004: "The proposal has already been executed",
  6005: "Not enough approvals to reach the quorum",
  6006: "The owner set changed — the proposal is outdated",
  6007: "The nested instruction has too many accounts",
  6008: "The nested instruction data is too large",
  6009: "A governance instruction can only be invoked by the multisig itself",
};

// Anchor's own codes (not our program's). We catch the ones actually reachable from the UI:
// a PDA is derived from a data snapshot, and when two owners race it is no longer the same one.
const ANCHOR_MESSAGES: Record<number, string> = {
  2006: "The page data is stale (account address mismatch) — refresh and retry",
};

/** The textual junk that may still hide a code: message + simulation logs. */
function collectText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  // The cause chain: the preflight error on the outside, the instruction error inside.
  while (cur != null) {
    if (cur instanceof Error) parts.push(cur.message);
    if (isSolanaError(cur, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) {
      parts.push(...(cur.context.logs ?? []));
    }
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  if (parts.length === 0) parts.push(String(err));
  return parts.join("\n");
}

/**
 * A deep walk over the whole error graph, including framework-kit's `transactionPlanResult`
 * (the real reason hides there, not in `.cause`, which is declared deprecated).
 *
 * Messages and program logs are returned SEPARATELY: the error code has to be looked for in
 * both, but classifying ("rejected in the wallet") may only rely on the messages — otherwise
 * someone else's "denied" from a program log gets passed off as the user's refusal.
 */
function deepParts(err: unknown): { messages: string[]; logs: string[] } {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  const logs: string[] = [];
  const visit = (v: unknown, depth: number) => {
    if (v == null || depth > 8 || typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (typeof o.message === "string") messages.push(o.message);
    if (Array.isArray(o.logs)) for (const l of o.logs) if (typeof l === "string") logs.push(l);
    for (const k of Object.keys(o)) visit(o[k], depth + 1);
    if (v instanceof Error && v.cause != null) visit(v.cause, depth + 1); // cause is not always enumerable
  };
  visit(err, 0);
  return { messages: [...new Set(messages)], logs: [...new Set(logs)] };
}

const deepText = (err: unknown): string => {
  const { messages, logs } = deepParts(err);
  return [...messages, ...logs].join("\n");
};

export function extractCustomErrorCode(err: unknown): number | null {
  // 1. The structural path: kit puts the code into context as a number, walk the cause chain.
  let cur: unknown = err;
  while (isSolanaError(cur)) {
    if (isSolanaError(cur, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) return cur.context.code;
    cur = cur.cause;
  }

  // 2. The textual path: simulation logs and node/wallet messages + a deep walk of the graph.
  const s = collectText(err) + "\n" + deepText(err);
  const hex = s.match(/custom program error:?\s*0x([0-9a-fA-F]+)/i);
  if (hex) return parseInt(hex[1], 16);
  // \d+, not \d{4}: other programs have longer codes, and 60001 got clipped to our 6000.
  const dec = s.match(/custom(?:\s*program)?\s*error"?[:\s]*#?(\d+)/i) ?? s.match(/"Custom"?:\s*(\d+)/);
  if (dec) return parseInt(dec[1], 10);
  return null;
}

/**
 * The simulation came back successfully, yet reported that the transaction would fail: RPC puts
 * the reason as a structure into `value.err` (`{"InstructionError":[0,{"Custom":6005}]}`) —
 * that is neither an exception nor text, so `humanizeError` alone cannot read it.
 * We wrap it so that the parser finds both the code and the program logs.
 */
export function simulationFailure(err: unknown, logs: readonly string[] = []): Error {
  // A bigint breaks JSON.stringify serialization (lamports inside err are a common thing).
  const json = JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const e = new Error(`Transaction failed simulation: ${json ?? String(err)}`);
  return Object.assign(e, { logs });
}

export function humanizeError(err: unknown): string {
  const code = extractCustomErrorCode(err);
  if (code !== null && MESSAGES[code]) return MESSAGES[code];
  if (code !== null && ANCHOR_MESSAGES[code]) return ANCHOR_MESSAGES[code];

  const { messages, logs } = deepParts(err);
  const all = [...messages, ...logs].join("\n");
  // The runtime refuses on rent with a structure, without any intelligible text; our own message
  // is a must, otherwise /insufficient/ caught this and lied about the wallet fee.
  if (/InsufficientFundsForRent/i.test(all)) {
    return "The transfer would leave an account below the rent-exempt minimum — increase the amount or withdraw the entire balance";
  }
  // A taken multisig seed / a taken proposal index: the System Program answers with
  // Custom:0, and the gist ("already in use") is visible only in the logs.
  if (/already in use/i.test(all)) {
    return "That account already exists (seed or index is taken) — refresh and try again";
  }

  // Classify ONLY by the messages: words about refusal/shortage coming from program logs
  // belong to someone else's logic, not to our wallet and not to our fee.
  const own = messages.join("\n");
  if (/reject|denied|declined/i.test(own)) return "Signature rejected in the wallet";
  if (/insufficient|not enough (sol|lamports)/i.test(own)) return "Not enough SOL for the fee or rent";
  if (/blockhash/i.test(own)) return "Blockhash expired — try again";

  const deep = deepText(err);
  return deep || (err instanceof Error ? err.message : String(err));
}
