import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import { countApprovals, deriveStatus, approvalsByOwner, isAttributable } from "./proposal-status";

const ms = { threshold: 2, ownerSetSeqno: 0 };
const base = { didExecute: false, signers: [true, false, false], ownerSetSeqno: 0 };

describe("proposal-status", () => {
  it("countApprovals counts the trues", () => {
    expect(countApprovals([true, false, true])).toBe(2);
  });

  it("executed on did_execute", () => {
    expect(deriveStatus({ ...base, didExecute: true }, ms)).toBe("executed");
  });

  it("stale on an owner_set_seqno mismatch", () => {
    expect(deriveStatus({ ...base, ownerSetSeqno: 1 }, ms)).toBe("stale");
  });

  it("executable when the approvals reach the threshold", () => {
    expect(deriveStatus({ ...base, signers: [true, true, false] }, ms)).toBe("executable");
  });

  it("pending when the approvals fall short", () => {
    expect(deriveStatus(base, ms)).toBe("pending");
  });

  it("executed outranks stale", () => {
    expect(deriveStatus({ ...base, didExecute: true, ownerSetSeqno: 1 }, ms)).toBe("executed");
  });

  it("stale outranks executable — an outdated proposal cannot be executed", () => {
    expect(deriveStatus({ ...base, signers: [true, true, true], ownerSetSeqno: 1 }, ms)).toBe("stale");
  });

  it("approvalsByOwner zips the mask with the owners", () => {
    const owners = [
      address("So11111111111111111111111111111111111111112"),
      address("SysvarC1ock11111111111111111111111111111111"),
    ];
    expect(approvalsByOwner([true, false], owners)).toEqual([
      { owner: owners[0], approved: true },
      { owner: owners[1], approved: false },
    ]);
  });

  // The approval mask is frozen at the moment the proposal was created, while the owners list
  // could have changed (set_owners). Zipping it with the current list would attribute an
  // approval to the wrong person — silently and plausibly.
  it("isAttributable tells an up-to-date mask from an outdated one", () => {
    expect(isAttributable({ ...base, ownerSetSeqno: 0 }, ms)).toBe(true);
    expect(isAttributable({ ...base, ownerSetSeqno: 1 }, ms)).toBe(false);
  });

  it("approvalsByOwner requires the mask length and the owners list to match", () => {
    const owners = [
      address("So11111111111111111111111111111111111111112"),
      address("SysvarC1ock11111111111111111111111111111111"),
    ];
    expect(() => approvalsByOwner([true, false, true], owners)).toThrow(/mask|length/i);
  });
});
