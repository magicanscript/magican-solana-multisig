'use client';

import type { Address } from '@solana/kit';
import { approvalsByOwner, isAttributable } from '@/lib/proposal-status';
import { shortAddress } from '@/lib/format';

/**
 * A row of pips, one per owner: green = approved, empty = not yet.
 * The current user's pip (`me`) gets a ring around it.
 *
 * The mask may be matched against the owners only if the proposal belongs to the
 * CURRENT owner set (`ownerSetSeqno` matches). The mask length is a useless
 * criterion: `set_owners` can replace an owner without changing their count, and
 * then a green pip would go to someone who never voted and wasn't an owner back then.
 */
export function ApprovalPips({
  signers,
  owners,
  txOwnerSetSeqno,
  msOwnerSetSeqno,
  me,
}: {
  signers: boolean[];
  owners: Address[];
  txOwnerSetSeqno: number;
  msOwnerSetSeqno: number;
  me?: Address;
}) {
  if (!isAttributable({ ownerSetSeqno: txOwnerSetSeqno }, { ownerSetSeqno: msOwnerSetSeqno })) {
    return (
      <span className="text-xs text-amber-600 dark:text-amber-500">
        {/* Not "under the previous owner set": the seqno is also bumped by
            change_threshold, while the owners stay the same (governance.rs). */}
        approvals were collected under the previous multisig rules
      </span>
    );
  }

  let pips;
  try {
    pips = approvalsByOwner(signers, owners);
  } catch {
    return (
      <span className="text-xs text-amber-600 dark:text-amber-500">
        the mask doesn&apos;t match the current owner set
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {pips.map(({ owner, approved }) => (
        // The approval is encoded in colour alone — for a screen reader and for a
        // test that simply does not exist. `role="img"` plus a label make the state
        // readable, and `data-*` makes it assertable without leaning on CSS classes
        // (otherwise the test would guard the styling instead of the meaning).
        <span
          key={owner}
          role="img"
          aria-label={`${shortAddress(owner, 4, 4)}${me && owner === me ? ' (you)' : ''} — ${
            approved ? 'approved' : 'not approved'
          }`}
          data-approved={approved}
          data-me={me != null && owner === me}
          title={`${shortAddress(owner, 4, 4)}${approved ? ' — approved' : ''}`}
          className={[
            'h-3 w-3 rounded-full border',
            approved
              ? 'border-emerald-500 bg-emerald-500'
              : 'border-zinc-300 bg-transparent dark:border-zinc-600',
            me && owner === me ? 'ring-2 ring-indigo-400 ring-offset-1 dark:ring-offset-black' : '',
          ].join(' ')}
        />
      ))}
    </div>
  );
}
