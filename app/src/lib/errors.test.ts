import { describe, it, expect } from "vitest";
import {
  SolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
} from "@solana/kit";
import { extractCustomErrorCode, humanizeError, simulationFailure } from "./errors";

// This is how kit reports a custom program error: the code sits in context as a number,
// not as a hex string in the message.
const customError = (code: number) =>
  new SolanaError(SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, { code, index: 0 });

// The real sending path: a preflight error with logs, custom — in the nested cause.
const preflightError = (cause: unknown, logs: string[] = []) =>
  new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, {
    accounts: null,
    cause,
    innerInstructions: null,
    logs,
    returnData: null,
    unitsConsumed: 1234n, // a bigint in context — JSON.stringify chokes on it
  } as never);

describe("extractCustomErrorCode", () => {
  it("takes the code from the context of a real SolanaError", () => {
    expect(extractCustomErrorCode(customError(6005))).toBe(6005);
  });

  it("finds the code in the nested cause under a preflight error", () => {
    expect(extractCustomErrorCode(preflightError(customError(6003)))).toBe(6003);
  });

  it("does not choke on a bigint in context", () => {
    expect(extractCustomErrorCode(preflightError(customError(6004), ["log"]))).toBe(6004);
  });

  it("pulls the hex code out of the simulation logs when there is no structural code", () => {
    const err = preflightError(undefined, [
      "Program EKYNZ8yeiivzgpmbq5TxC5bphmRnfARLxgzMxDUhHEUG invoke [1]",
      "Program EKYNZ8yeiivzgpmbq5TxC5bphmRnfARLxgzMxDUhHEUG failed: custom program error: 0x1775",
    ]);
    expect(extractCustomErrorCode(err)).toBe(6005);
  });

  it("understands the textual form with a hash sign (Custom program error: #6006)", () => {
    expect(extractCustomErrorCode(new Error("Custom program error: #6006 (instruction #1)"))).toBe(6006);
  });

  it("returns null when there is no code", () => {
    expect(extractCustomErrorCode(new Error("boom"))).toBe(null);
  });
});

describe("humanizeError", () => {
  it("NotEnoughSigners from a real SolanaError → about approvals", () => {
    expect(humanizeError(customError(6005))).toMatch(/approvals/i);
  });

  it("InvalidOwnerSetForExecute via preflight+cause → about an outdated proposal", () => {
    expect(humanizeError(preflightError(customError(6006)))).toMatch(/outdated/i);
  });

  it("NotAnOwner → about the owner", () => {
    expect(humanizeError(customError(6003))).toMatch(/owner/i);
  });

  it("someone else's custom code (not ours) is not passed off as our error", () => {
    expect(humanizeError(customError(1234))).not.toMatch(/approval|owner|quorum/i);
  });

  it("a signature refusal in the wallet is recognized", () => {
    expect(humanizeError(new Error("User rejected the request"))).toMatch(/rejected/i);
  });

  it("an unknown error is returned as is", () => {
    expect(humanizeError(new Error("boom"))).toContain("boom");
  });
});

// A simulation can COME BACK SUCCESSFULLY and still report that the transaction failed:
// the reason sits as a structure in value.err, not as text and not as an RPC exception.
describe("simulationFailure", () => {
  it("digs our error code out of the InstructionError/Custom structure", () => {
    const err = simulationFailure({ InstructionError: [0, { Custom: 6005 }] });
    expect(extractCustomErrorCode(err)).toBe(6005);
    expect(humanizeError(err)).toMatch(/quorum/i);
  });

  it("finds the code in the program logs when the structure is unrecognizable", () => {
    const err = simulationFailure("Something opaque", [
      "Program EKYN… failed: custom program error: 0x1774",
    ]);
    expect(humanizeError(err)).toMatch(/already been executed/i);
  });

  it("does not choke on bigints inside err (JSON.stringify cannot handle them)", () => {
    expect(() => simulationFailure({ InsufficientFundsForRent: { account_index: 1n } })).not.toThrow();
  });

  it("shows the unrecognized readably, not as [object Object]", () => {
    expect(humanizeError(simulationFailure({ AccountNotFound: true }))).not.toMatch(/\[object/);
  });

  // The runtime rejects a transfer that leaves an account below rent-exempt. Without its own
  // text, /insufficient/ caught it and lied: "Not enough SOL for the fee".
  it("InsufficientFundsForRent explains the rent, not the wallet fee", () => {
    const err = simulationFailure({ InsufficientFundsForRent: { account_index: 2n } });
    expect(humanizeError(err)).toMatch(/rent|minimum/i);
    expect(humanizeError(err)).not.toMatch(/fee/i);
  });
});

describe("codes of other programs and of Anchor", () => {
  // \d{4} without a boundary clipped 60001 to 6000 → someone else's error was passed off as ours.
  it("does not clip codes longer than four digits", () => {
    const err = simulationFailure({ InstructionError: [0, { Custom: 60001 }] });
    expect(extractCustomErrorCode(err)).toBe(60001);
    expect(humanizeError(err)).not.toMatch(/Threshold must be/);
  });

  it("our four-digit codes are still parsed", () => {
    expect(extractCustomErrorCode(simulationFailure({ InstructionError: [0, { Custom: 6005 }] }))).toBe(6005);
  });

  it("a hex code from the logs does not break", () => {
    const err = simulationFailure("opaque", ["Program failed: custom program error: 0xea61"]);
    expect(extractCustomErrorCode(err)).toBe(60001);
  });

  // A proposal index race: two owners create at the same time → Anchor 2006.
  it("ConstraintSeeds hints at refreshing the page", () => {
    const err = simulationFailure({ InstructionError: [0, { Custom: 2006 }] });
    expect(humanizeError(err)).toMatch(/refresh|stale/i);
  });

  // A taken seed (create_multisig) and a taken index (create_transaction) arrive
  // as Custom:0 from the System Program — "already in use" is visible only in the logs.
  it("a taken account is explained in human text, not as an Allocate dump", () => {
    const err = simulationFailure({ InstructionError: [0, { Custom: 0 }] }, [
      'Allocate: account Address { address: BWxU…UZZP } already in use',
    ]);
    expect(humanizeError(err)).toMatch(/already exists|is taken/i);
    expect(humanizeError(err)).not.toMatch(/Allocate/);
  });
});

// deepText rakes in the program logs too; classifying by them is not allowed — otherwise
// someone else's word "denied" in a log gets passed off as the user's refusal in the wallet.
describe("classification does not confuse program logs with the wallet's answer", () => {
  it('"access denied" in the program logs is NOT passed off as a signature refusal', () => {
    const err = simulationFailure({ InstructionError: [0, "PrivilegeEscalation"] }, [
      "Program log: AnchorError: access denied for this vault",
    ]);
    expect(humanizeError(err)).not.toMatch(/rejected in the wallet/i);
  });

  it("a real wallet refusal is still recognized", () => {
    expect(humanizeError(new Error("User rejected the request"))).toMatch(/rejected in the wallet/i);
  });

  it('"insufficient" in the program logs is not passed off as not enough SOL for the fee', () => {
    const err = simulationFailure({ InstructionError: [0, "Custom"] }, [
      "Program log: insufficient liquidity in pool",
    ]);
    expect(humanizeError(err)).not.toMatch(/Not enough SOL for the fee/i);
  });
});
