import type { Address } from "@solana/kit";
import { deriveStatus, isAttributable } from "./proposal-status";
import type { ProposalAccount } from "./ix";

/** Why the button is disabled. `null` — the action is available. */
export type Blocks = { approve: string | null; execute: string | null };

const NO_WALLET = "Connect your wallet";
const EXECUTED = "The proposal has already been executed";
/**
 * `owner_set_seqno` is the shared version of the rules, not just of the owners list: it is
 * bumped by both `set_owners` and `change_threshold` (governance.rs). Saying "the owner set
 * changed" after a threshold change is a lie: the person will go looking for a removal that
 * never happened. The wording has to cover both reasons.
 */
const STALE = "The multisig rules changed (owners or threshold) — the proposal is outdated";
const FOREIGN_SIGNER =
  "The nested instruction has a foreign signer — such a proposal can never be executed";
/** A temporary reason: in a second it will be gone. `isTransient` tells it apart. */
export const BUSY_REASON = "Wait for the current action to finish";

/** The reason will go away by itself — it is not a verdict on the action, but "busy right now". */
export const isTransient = (reason: string | null): boolean => reason === BUSY_REASON;

/**
 * The blocking reasons for approve/execute — exactly the same checks the program makes, only
 * ahead of time: the user learns about the block before signing, not from a simulation error.
 *
 * Two rules that are easy to break here unnoticed:
 *  - the reason has to be the REAL one. Lumping an executed and an outdated proposal into
 *    "waiting for the quorum" means sending a person to wait for approvals on a dead proposal;
 *  - a permanent reason outranks a temporary one (`busy`): "wait" on someone else's multisig
 *    promises access that will never come.
 *
 * `signerPda` is the multisig treasury; without it the foreign-signer check is impossible,
 * so it is optional, but it should always be passed.
 */
export function actionBlocks(
  tx: {
    didExecute: boolean;
    signers: boolean[];
    ownerSetSeqno: number;
    accounts?: readonly ProposalAccount[];
  },
  ms: { owners: readonly Address[]; threshold: number; ownerSetSeqno: number },
  me: Address | undefined,
  busy: boolean,
  signerPda?: Address,
): Blocks {
  const status = deriveStatus(tx, ms);
  // An approval belongs to an owner by its INDEX in the mask, and the mask is frozen on its
  // own owner set: after set_owners it must not be matched against the current list.
  const comparable = isAttributable(tx, ms);
  const myIndex = me ? ms.owners.indexOf(me) : -1;

  // The program can sign a nested instruction only for its own treasury (invoke_signed), and
  // it keeps a foreign `is_signer` in the AccountMeta as is (execute_transaction.rs).
  // Our UI won't let such a proposal be created (lib/ix.ts), but it could have come from a CLI —
  // and then it is doomed FOREVER, no matter how many approvals it collects.
  const hasForeignSigner =
    signerPda != null && (tx.accounts?.some((a) => a.isSigner && a.pubkey !== signerPda) ?? false);

  const approve = !me
    ? NO_WALLET
    : status === "executed"
      ? EXECUTED
      : status === "stale"
        ? STALE
        : myIndex < 0
          ? "You are not an owner of this multisig"
          : comparable && tx.signers[myIndex] === true
            ? "You have already approved this proposal"
            : busy
              ? BUSY_REASON
              : null;

  // Execute requires nobody as a signer (it is permissionless) — only a wallet to pay the
  // fee, which is why we don't forbid it to a non-owner.
  const execute = !me
    ? NO_WALLET
    : status === "executed"
      ? EXECUTED
      : status === "stale"
        ? STALE
        : hasForeignSigner
          ? FOREIGN_SIGNER
          : status !== "executable"
            ? "Available once the quorum is reached"
            : busy
              ? BUSY_REASON
              : null;

  return { approve, execute };
}

/**
 * The text under a proposal row: why it is needed at all — a tooltip on a disabled button
 * is not shown on touch devices, and the person runs into a grey button with no explanation.
 *
 * We print it only when BOTH actions are dead and dead for good: "wait" is a reason that
 * lasts a second, and the dialog for the current action is on screen anyway. And if the
 * reasons differ, both are needed: "you have already approved" without "waiting for the
 * quorum" leaves the question of why it can't be executed unanswered.
 */
export function actionHint(blocks: Blocks): string | null {
  const { approve, execute } = blocks;
  if (!approve || !execute) return null;
  if (isTransient(approve) || isTransient(execute)) return null;
  return approve === execute ? approve : `${approve}. ${execute}`;
}
