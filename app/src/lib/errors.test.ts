import { describe, it, expect } from "vitest";
import {
  SolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
} from "@solana/kit";
import { extractCustomErrorCode, humanizeError } from "./errors";

// Так kit сообщает про custom program error: код лежит числом в context,
// а не hex-строкой в message.
const customError = (code: number) =>
  new SolanaError(SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, { code, index: 0 });

// Реальный путь отправки: preflight-ошибка с логами, custom — во вложенном cause.
const preflightError = (cause: unknown, logs: string[] = []) =>
  new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, {
    accounts: null,
    cause,
    innerInstructions: null,
    logs,
    returnData: null,
    unitsConsumed: 1234n, // bigint в context — JSON.stringify на нём падает
  } as never);

describe("extractCustomErrorCode", () => {
  it("берёт код из context настоящего SolanaError", () => {
    expect(extractCustomErrorCode(customError(6005))).toBe(6005);
  });

  it("находит код во вложенном cause под preflight-ошибкой", () => {
    expect(extractCustomErrorCode(preflightError(customError(6003)))).toBe(6003);
  });

  it("не падает на bigint в context", () => {
    expect(extractCustomErrorCode(preflightError(customError(6004), ["log"]))).toBe(6004);
  });

  it("вытаскивает hex-код из логов симуляции, когда структурного кода нет", () => {
    const err = preflightError(undefined, [
      "Program EKYNZ8yeiivzgpmbq5TxC5bphmRnfARLxgzMxDUhHEUG invoke [1]",
      "Program EKYNZ8yeiivzgpmbq5TxC5bphmRnfARLxgzMxDUhHEUG failed: custom program error: 0x1775",
    ]);
    expect(extractCustomErrorCode(err)).toBe(6005);
  });

  it("понимает текстовую форму с решёткой (Custom program error: #6006)", () => {
    expect(extractCustomErrorCode(new Error("Custom program error: #6006 (instruction #1)"))).toBe(6006);
  });

  it("возвращает null, когда кода нет", () => {
    expect(extractCustomErrorCode(new Error("boom"))).toBe(null);
  });
});

describe("humanizeError", () => {
  it("NotEnoughSigners из настоящего SolanaError → про подписи", () => {
    expect(humanizeError(customError(6005))).toMatch(/подпис/i);
  });

  it("InvalidOwnerSetForExecute через preflight+cause → про устаревшее предложение", () => {
    expect(humanizeError(preflightError(customError(6006)))).toMatch(/устарел/i);
  });

  it("NotAnOwner → про владельца", () => {
    expect(humanizeError(customError(6003))).toMatch(/владелец/i);
  });

  it("чужой custom-код (не наш) не выдаётся за нашу ошибку", () => {
    expect(humanizeError(customError(1234))).not.toMatch(/подпис|владелец|кворум/i);
  });

  it("отказ подписи в кошельке распознаётся", () => {
    expect(humanizeError(new Error("User rejected the request"))).toMatch(/отклон/i);
  });

  it("неизвестная ошибка возвращается как есть", () => {
    expect(humanizeError(new Error("boom"))).toContain("boom");
  });
});
