import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import { countApprovals, deriveStatus, approvalsByOwner, isAttributable } from "./proposal-status";

const ms = { threshold: 2, ownerSetSeqno: 0 };
const base = { didExecute: false, signers: [true, false, false], ownerSetSeqno: 0 };

describe("proposal-status", () => {
  it("countApprovals считает true", () => {
    expect(countApprovals([true, false, true])).toBe(2);
  });

  it("executed при did_execute", () => {
    expect(deriveStatus({ ...base, didExecute: true }, ms)).toBe("executed");
  });

  it("stale при рассинхроне owner_set_seqno", () => {
    expect(deriveStatus({ ...base, ownerSetSeqno: 1 }, ms)).toBe("stale");
  });

  it("executable при голосах >= порога", () => {
    expect(deriveStatus({ ...base, signers: [true, true, false] }, ms)).toBe("executable");
  });

  it("pending при недоборе голосов", () => {
    expect(deriveStatus(base, ms)).toBe("pending");
  });

  it("executed приоритетнее stale", () => {
    expect(deriveStatus({ ...base, didExecute: true, ownerSetSeqno: 1 }, ms)).toBe("executed");
  });

  it("stale приоритетнее executable — устаревшее предложение не исполнить", () => {
    expect(deriveStatus({ ...base, signers: [true, true, true], ownerSetSeqno: 1 }, ms)).toBe("stale");
  });

  it("approvalsByOwner зипует маску и владельцев", () => {
    const owners = [
      address("So11111111111111111111111111111111111111112"),
      address("SysvarC1ock11111111111111111111111111111111"),
    ];
    expect(approvalsByOwner([true, false], owners)).toEqual([
      { owner: owners[0], approved: true },
      { owner: owners[1], approved: false },
    ]);
  });

  // Маска голосов заморожена на момент создания предложения, а список владельцев
  // мог смениться (set_owners). Зипование с текущим списком приписало бы голос
  // не тому человеку — молча и правдоподобно.
  it("isAttributable отличает актуальную маску от устаревшей", () => {
    expect(isAttributable({ ...base, ownerSetSeqno: 0 }, ms)).toBe(true);
    expect(isAttributable({ ...base, ownerSetSeqno: 1 }, ms)).toBe(false);
  });

  it("approvalsByOwner требует совпадения длины маски и списка владельцев", () => {
    const owners = [
      address("So11111111111111111111111111111111111111112"),
      address("SysvarC1ock11111111111111111111111111111111"),
    ];
    expect(() => approvalsByOwner([true, false, true], owners)).toThrow(/маск|длин/i);
  });
});
