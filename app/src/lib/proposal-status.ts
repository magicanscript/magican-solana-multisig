import type { Address } from "@solana/kit";

export type ProposalStatus = "executed" | "stale" | "executable" | "pending";

export const countApprovals = (signers: boolean[]): number =>
  signers.reduce((n, s) => n + (s ? 1 : 0), 0);

// The branch order mirrors the program's checks: did_execute → owner_set_seqno → quorum.
export function deriveStatus(
  tx: { didExecute: boolean; signers: boolean[]; ownerSetSeqno: number },
  ms: { threshold: number; ownerSetSeqno: number },
): ProposalStatus {
  if (tx.didExecute) return "executed";
  if (tx.ownerSetSeqno !== ms.ownerSetSeqno) return "stale";
  if (countApprovals(tx.signers) >= ms.threshold) return "executable";
  return "pending";
}

/**
 * The approval mask is frozen at the moment the proposal was created and corresponds to THAT
 * owner set. After set_owners it must not be matched against the current list — an approval
 * would be attributed to the wrong owner.
 *
 * Important for the UI wording: `owner_set_seqno` is the version of the RULES as a whole, not
 * only of the owners list. It is bumped by `change_threshold` too (governance.rs), so
 * "the owner set changed" is not always true; see STALE in proposal-actions.ts.
 */
export const isAttributable = (
  tx: { ownerSetSeqno: number },
  ms: { ownerSetSeqno: number },
): boolean => tx.ownerSetSeqno === ms.ownerSetSeqno;

export function approvalsByOwner(signers: boolean[], owners: Address[]) {
  if (signers.length !== owners.length) {
    throw new Error(
      `The approval mask length (${signers.length}) doesn't match the number of owners (${owners.length}): ` +
        "the mask belongs to a different owner set.",
    );
  }
  return owners.map((owner, i) => ({ owner, approved: signers[i] }));
}
