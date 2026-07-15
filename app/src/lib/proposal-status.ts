import type { Address } from "@solana/kit";

export type ProposalStatus = "executed" | "stale" | "executable" | "pending";

export const countApprovals = (signers: boolean[]): number =>
  signers.reduce((n, s) => n + (s ? 1 : 0), 0);

// Порядок веток повторяет проверки программы: did_execute → owner_set_seqno → кворум.
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
 * Маска голосов заморожена на момент создания предложения и соответствует ТОМУ
 * набору владельцев. После set_owners сопоставлять её с текущим списком нельзя —
 * голос припишется не тому владельцу.
 */
export const isAttributable = (
  tx: { ownerSetSeqno: number },
  ms: { ownerSetSeqno: number },
): boolean => tx.ownerSetSeqno === ms.ownerSetSeqno;

export function approvalsByOwner(signers: boolean[], owners: Address[]) {
  if (signers.length !== owners.length) {
    throw new Error(
      `Длина маски голосов (${signers.length}) не совпадает с числом владельцев (${owners.length}): ` +
        "маска относится к другому набору владельцев.",
    );
  }
  return owners.map((owner, i) => ({ owner, approved: signers[i] }));
}
