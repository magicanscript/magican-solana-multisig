import { describe, it, expect } from "vitest";
import {
  SolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
} from "@solana/kit";
import { extractCustomErrorCode, humanizeError, simulationFailure } from "./errors";

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

// Симуляция может ВЕРНУТЬСЯ УСПЕШНО и при этом сообщить, что транзакция упала:
// причина лежит структурой в value.err, а не текстом и не исключением RPC.
describe("simulationFailure", () => {
  it("достаёт наш код ошибки из структуры InstructionError/Custom", () => {
    const err = simulationFailure({ InstructionError: [0, { Custom: 6005 }] });
    expect(extractCustomErrorCode(err)).toBe(6005);
    expect(humanizeError(err)).toMatch(/кворум/i);
  });

  it("находит код в логах программы, если структура нераспознаваема", () => {
    const err = simulationFailure("Something opaque", [
      "Program EKYN… failed: custom program error: 0x1774",
    ]);
    expect(humanizeError(err)).toMatch(/уже исполнено/i);
  });

  it("не падает на bigint внутри err (JSON.stringify их не умеет)", () => {
    expect(() => simulationFailure({ InsufficientFundsForRent: { account_index: 1n } })).not.toThrow();
  });

  it("нераспознанное показывает читаемо, а не [object Object]", () => {
    expect(humanizeError(simulationFailure({ AccountNotFound: true }))).not.toMatch(/\[object/);
  });

  // Рантайм отвергает перевод, оставляющий аккаунт ниже rent-exempt. Без своего
  // текста это ловил /insufficient/ и врал: «Недостаточно SOL для комиссии».
  it("InsufficientFundsForRent объясняет ренту, а не комиссию кошелька", () => {
    const err = simulationFailure({ InsufficientFundsForRent: { account_index: 2n } });
    expect(humanizeError(err)).toMatch(/аренд|rent|минимум/i);
    expect(humanizeError(err)).not.toMatch(/комисси/i);
  });
});

describe("коды чужих программ и Anchor", () => {
  // \d{4} без границы резал 60001 до 6000 → чужая ошибка выдавалась за нашу.
  it("не режет коды длиннее четырёх цифр", () => {
    const err = simulationFailure({ InstructionError: [0, { Custom: 60001 }] });
    expect(extractCustomErrorCode(err)).toBe(60001);
    expect(humanizeError(err)).not.toMatch(/Порог должен быть/);
  });

  it("наши четырёхзначные коды по-прежнему разбираются", () => {
    expect(extractCustomErrorCode(simulationFailure({ InstructionError: [0, { Custom: 6005 }] }))).toBe(6005);
  });

  it("hex-код из логов не ломается", () => {
    const err = simulationFailure("opaque", ["Program failed: custom program error: 0xea61"]);
    expect(extractCustomErrorCode(err)).toBe(60001);
  });

  // Гонка индекса предложения: два владельца создают одновременно → Anchor 2006.
  it("ConstraintSeeds подсказывает обновить страницу", () => {
    const err = simulationFailure({ InstructionError: [0, { Custom: 2006 }] });
    expect(humanizeError(err)).toMatch(/обнови|устарел/i);
  });

  // Занятый seed (create_multisig) и занятый индекс (create_transaction) приходят
  // как Custom:0 от System Program — «уже используется» видно только в логах.
  it("занятый аккаунт объясняется человеческим текстом, а не дампом Allocate", () => {
    const err = simulationFailure({ InstructionError: [0, { Custom: 0 }] }, [
      'Allocate: account Address { address: BWxU…UZZP } already in use',
    ]);
    expect(humanizeError(err)).toMatch(/уже существует|уже занят/i);
    expect(humanizeError(err)).not.toMatch(/Allocate/);
  });
});

// deepText сгребает и логи программы; классифицировать по ним нельзя — иначе
// чужое слово «denied» в логе выдаётся за отказ пользователя в кошельке.
describe("классификация не путает логи программы с ответом кошелька", () => {
  it("«access denied» в логах программы НЕ выдаётся за отказ подписи", () => {
    const err = simulationFailure({ InstructionError: [0, "PrivilegeEscalation"] }, [
      "Program log: AnchorError: access denied for this vault",
    ]);
    expect(humanizeError(err)).not.toMatch(/отклонена в кошельке/i);
  });

  it("настоящий отказ кошелька по-прежнему распознаётся", () => {
    expect(humanizeError(new Error("User rejected the request"))).toMatch(/отклонена в кошельке/i);
  });

  it("«insufficient» в логах программы не выдаётся за нехватку SOL на комиссию", () => {
    const err = simulationFailure({ InstructionError: [0, "Custom"] }, [
      "Program log: insufficient liquidity in pool",
    ]);
    expect(humanizeError(err)).not.toMatch(/Недостаточно SOL для комиссии/i);
  });
});
