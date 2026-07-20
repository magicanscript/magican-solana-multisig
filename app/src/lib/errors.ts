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

// Коды самого Anchor (не нашей программы). Ловим те, что реально достижимы из UI:
// PDA считается от снапшота данных, и при гонке двух владельцев он уже не тот.
const ANCHOR_MESSAGES: Record<number, string> = {
  2006: "Данные на странице устарели (адрес аккаунта не совпал) — обновите страницу и повторите",
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

/**
 * Глубокий обход всего графа ошибки, включая `transactionPlanResult` framework-kit
 * (настоящая причина прячется там, а не в `.cause`, который объявлен deprecated).
 *
 * Сообщения и логи программы возвращаем ОТДЕЛЬНО: искать код ошибки нужно в обоих,
 * а вот классифицировать («отклонено в кошельке») можно только по сообщениям —
 * иначе чужое «denied» из лога программы выдаётся за отказ пользователя.
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
    if (v instanceof Error && v.cause != null) visit(v.cause, depth + 1); // cause не всегда enumerable
  };
  visit(err, 0);
  return { messages: [...new Set(messages)], logs: [...new Set(logs)] };
}

const deepText = (err: unknown): string => {
  const { messages, logs } = deepParts(err);
  return [...messages, ...logs].join("\n");
};

export function extractCustomErrorCode(err: unknown): number | null {
  // 1. Структурный путь: kit кладёт код числом в context, обходим цепочку cause.
  let cur: unknown = err;
  while (isSolanaError(cur)) {
    if (isSolanaError(cur, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) return cur.context.code;
    cur = cur.cause;
  }

  // 2. Текстовый путь: логи симуляции и сообщения нод/кошельков + глубокий обход графа.
  const s = collectText(err) + "\n" + deepText(err);
  const hex = s.match(/custom program error:?\s*0x([0-9a-fA-F]+)/i);
  if (hex) return parseInt(hex[1], 16);
  // \d+, а не \d{4}: у чужих программ коды длиннее, и 60001 резался до нашего 6000.
  const dec = s.match(/custom(?:\s*program)?\s*error"?[:\s]*#?(\d+)/i) ?? s.match(/"Custom"?:\s*(\d+)/);
  if (dec) return parseInt(dec[1], 10);
  return null;
}

/**
 * Симуляция вернулась успешно, но сообщила, что транзакция упала бы: RPC кладёт
 * причину структурой в `value.err` (`{"InstructionError":[0,{"Custom":6005}]}`) —
 * это не исключение и не текст, сам по себе `humanizeError` его не прочитает.
 * Заворачиваем так, чтобы разбор нашёл и код, и логи программы.
 */
export function simulationFailure(err: unknown, logs: readonly string[] = []): Error {
  // bigint в JSON.stringify роняет сериализацию (лампорты в err — обычное дело).
  const json = JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const e = new Error(`Транзакция не прошла симуляцию: ${json ?? String(err)}`);
  return Object.assign(e, { logs });
}

export function humanizeError(err: unknown): string {
  const code = extractCustomErrorCode(err);
  if (code !== null && MESSAGES[code]) return MESSAGES[code];
  if (code !== null && ANCHOR_MESSAGES[code]) return ANCHOR_MESSAGES[code];

  const { messages, logs } = deepParts(err);
  const all = [...messages, ...logs].join("\n");
  // Рантайм отказывает по ренте структурой, без внятного текста; своё сообщение
  // обязательно, иначе это ловил /insufficient/ и врал про комиссию кошелька.
  if (/InsufficientFundsForRent/i.test(all)) {
    return "Перевод оставил бы аккаунт ниже минимума для аренды (rent-exempt) — увеличьте сумму или выведите весь остаток";
  }
  // Занятый seed мультисига / занятый индекс предложения: System Program отвечает
  // Custom:0, а суть («already in use») видна только в логах.
  if (/already in use/i.test(all)) {
    return "Такой аккаунт уже существует (seed или индекс заняты) — обновите страницу и попробуйте снова";
  }

  // Классифицируем ТОЛЬКО по сообщениям: слова из логов программы про отказ/нехватку
  // относятся к чужой логике, а не к нашему кошельку и не к нашей комиссии.
  const own = messages.join("\n");
  if (/reject|denied|declined/i.test(own)) return "Подпись отклонена в кошельке";
  if (/insufficient|not enough (sol|lamports)/i.test(own)) return "Недостаточно SOL для комиссии или аренды";
  if (/blockhash/i.test(own)) return "Blockhash устарел — попробуйте ещё раз";

  const deep = deepText(err);
  return deep || (err instanceof Error ? err.message : String(err));
}
