import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import { actionBlocks, actionHint, BUSY_REASON } from "./proposal-actions";

const A = address("So11111111111111111111111111111111111111112");
const B = address("SysvarC1ock11111111111111111111111111111111");
const STRANGER = address("11111111111111111111111111111111");

const ms = { owners: [A, B], threshold: 2, ownerSetSeqno: 0 };
const tx = { didExecute: false, signers: [true, false], ownerSetSeqno: 0 };

describe("actionBlocks", () => {
  it("an owner who hasn't voted yet is allowed to approve", () => {
    expect(actionBlocks(tx, ms, B, false).approve).toBeNull();
  });

  it("without a wallet everything is blocked", () => {
    const b = actionBlocks(tx, ms, undefined, false);
    expect(b.approve).toMatch(/wallet/i);
    expect(b.execute).toMatch(/wallet/i);
  });

  it("a non-owner may not approve, but may execute (execute is permissionless)", () => {
    const ready = { ...tx, signers: [true, true] };
    const b = actionBlocks(ready, ms, STRANGER, false);
    expect(b.approve).toMatch(/not an owner/i);
    expect(b.execute).toBeNull();
  });

  it("a repeated vote is forbidden: the mask is boolean, a second time changes nothing", () => {
    expect(actionBlocks(tx, ms, A, false).approve).toMatch(/already approved/i);
  });

  it("execution is unavailable until the quorum is reached", () => {
    expect(actionBlocks(tx, ms, B, false).execute).toMatch(/quorum/i);
  });

  it("after execution both buttons are blocked — and the reason is stated honestly", () => {
    const done = { ...tx, didExecute: true, signers: [true, true] };
    const b = actionBlocks(done, ms, B, false);
    // Not "waiting for the quorum": the quorum is in fact reached. Lying with the reason is
    // not allowed — the user would wait for approvals on a proposal that is already executed.
    expect(b.approve).toMatch(/executed/i);
    expect(b.execute).toMatch(/executed/i);
  });

  it("an outdated proposal: both buttons are blocked by the owner set change", () => {
    const stale = { ...tx, signers: [true, true], ownerSetSeqno: 1 };
    const b = actionBlocks(stale, ms, B, false);
    expect(b.approve).toMatch(/owners/i);
    expect(b.execute).toMatch(/owners/i);
  });

  // The mask is frozen on ITS OWN owner set: matching it against the current list is not
  // allowed. Otherwise "you have already approved" would be shown to someone whose approval
  // belongs to a different person — and the real reason (the proposal is dead) would be lost.
  it("for an outdated proposal the reason is the owner set, not someone else's approval", () => {
    const stale = { ...tx, signers: [true, false], ownerSetSeqno: 1 };
    expect(actionBlocks(stale, ms, A, false).approve).not.toMatch(/already approved/i);
  });

  // After set_owners the mask length and the owners list length diverge. Reading the mask by
  // an index in the NEW list means going out of bounds (undefined) or hitting someone else's
  // approval. Only the branch order saves us: stale is checked before the mask. This test holds it.
  it("the mask is shorter than the new owners list — indexing is never reached", () => {
    const grown = { owners: [A, B, STRANGER], threshold: 2, ownerSetSeqno: 1 };
    const old = { didExecute: false, signers: [true, true], ownerSetSeqno: 0 };
    const b = actionBlocks(old, grown, STRANGER, false);
    expect(b.approve).toMatch(/owners/i);
    expect(b.execute).toMatch(/owners/i);
  });

  it("during another action everything is blocked — but the reason is temporary", () => {
    // A proposal where BOTH actions would otherwise be available: the quorum is reached,
    // and my own approval is not in yet.
    const ready = { ...tx, signers: [true, true], ownerSetSeqno: 0 };
    const three = { ...ms, owners: [A, B, STRANGER], threshold: 2 };
    const b = actionBlocks({ ...ready, signers: [true, true, false] }, three, STRANGER, true);
    expect(b.approve).toMatch(/wait/i);
    expect(b.execute).toMatch(/wait/i);
  });

  // A permanent reason outranks a temporary one: "wait" on someone else's multisig would be
  // confusing — waiting is pointless, approving is forbidden anyway.
  it("the permanent reason is shown instead of the temporary one", () => {
    expect(actionBlocks(tx, ms, STRANGER, true).approve).toMatch(/not an owner/i);
  });

  // change_threshold bumps the same owner_set_seqno as set_owners (governance.rs: "we use it
  // as the shared version of the configuration"). Saying "the owner set changed" is a lie:
  // the owners are the same, the threshold was changed, and the person will go looking for a
  // removal that never happened.
  it("the staleness reason talks about the rules, not only about the owners", () => {
    const stale = { ...tx, ownerSetSeqno: 1 };
    const b = actionBlocks(stale, ms, B, false);
    expect(b.approve).toMatch(/rules/i);
    expect(b.approve).not.toMatch(/^The owner set changed/);
  });

  // A proposal with a foreign signer cannot be created through our UI (lib/ix.ts rejects it),
  // but it could have come from a CLI. execute_transaction.rs keeps the foreign is_signer in
  // the AccountMeta, while the program can only sign for its own treasury — such a proposal
  // is doomed FOREVER. The "Execute" button has to know this.
  it("execution is closed if the nested instruction has a foreign signer", () => {
    const ready = { ...tx, signers: [true, true] };
    const foreign = { ...ready, accounts: [{ pubkey: STRANGER, isSigner: true, isWritable: false }] };
    const b = actionBlocks(foreign, ms, B, false, A);
    expect(b.execute).toMatch(/foreign signer/i);
  });

  it("the treasury as a signer does not block execution — that is the whole point", () => {
    const ready = { ...tx, signers: [true, true] };
    const ok = { ...ready, accounts: [{ pubkey: A, isSigner: true, isWritable: true }] };
    expect(actionBlocks(ok, ms, B, false, A).execute).toBeNull();
  });
});

describe("actionHint", () => {
  it("stays silent while at least one action is available", () => {
    expect(actionHint({ approve: null, execute: "no quorum" })).toBeNull();
  });

  // "Wait" is a reason that lasts a second; printing it as a verdict on the row is not
  // allowed, all the more so since the dialog for the current action is on screen anyway.
  it("does not show a temporary reason as an explanation", () => {
    expect(
      actionHint({ approve: "You are not an owner of this multisig", execute: BUSY_REASON }),
    ).toBeNull();
  });

  it("prints a single shared reason only once", () => {
    const same = "The proposal has already been executed";
    expect(actionHint({ approve: same, execute: same })).toBe(same);
  });

  // A frequent case: the approval is in, the quorum is not. The approve reason without the
  // execute reason leaves the question "so why can't it be executed" unanswered.
  it("shows both reasons when they differ", () => {
    const hint = actionHint({ approve: "You have already approved", execute: "Available once the quorum is reached" });
    expect(hint).toMatch(/already approved/i);
    expect(hint).toMatch(/quorum/i);
  });
});
