import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
} from "@solana/kit";
import { MAX_OWNERS } from "./limits";

// Коды ошибок программы (Anchor: 6000 + порядковый номер варианта).
const MESSAGES: Record<number, string> = {
  6000: "Порог должен быть от 1 до числа владельцев",
  6001: `Слишком много владельцев (максимум ${MAX_OWNERS})`,
  6002: "В списке владельцев есть дубликат",
  6003: "Вы не владелец этого мультисига",
  6004: "Предложение уже исполнено",
  6005: "Недостаточно подписей для набора кворума",
  6006: "Набор владельцев изменился — предложение устарело",
  6007: "Во вложенной инструкции слишком много аккаунтов",
  6008: "Данные вложенной инструкции слишком велики",
  6009: "Governance-инструкцию может вызвать только сам мультисиг",
};

/** Текстовый мусор, в котором ещё может найтись код: message + логи симуляции. */
function collectText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  // cause-цепочка: preflight-ошибка снаружи, instruction-ошибка внутри.
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

export function extractCustomErrorCode(err: unknown): number | null {
  // 1. Структурный путь: kit кладёт код числом в context, обходим цепочку cause.
  let cur: unknown = err;
  while (isSolanaError(cur)) {
    if (isSolanaError(cur, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) return cur.context.code;
    cur = cur.cause;
  }

  // 2. Текстовый путь: логи симуляции и сообщения нод/кошельков.
  const s = collectText(err);
  const hex = s.match(/custom program error:?\s*0x([0-9a-fA-F]+)/i);
  if (hex) return parseInt(hex[1], 16);
  const dec = s.match(/custom(?:\s*program)?\s*error"?[:\s]*#?(\d{4})/i) ?? s.match(/"Custom"?:\s*(\d{4})/);
  if (dec) return parseInt(dec[1], 10);
  return null;
}

export function humanizeError(err: unknown): string {
  const code = extractCustomErrorCode(err);
  if (code !== null && MESSAGES[code]) return MESSAGES[code];
  const s = err instanceof Error ? err.message : String(err);
  if (/reject/i.test(s)) return "Подпись отклонена в кошельке";
  if (/insufficient|not enough (sol|lamports)/i.test(s)) return "Недостаточно SOL для комиссии или аренды";
  if (/blockhash/i.test(s)) return "Blockhash устарел — попробуйте ещё раз";
  return s;
}
