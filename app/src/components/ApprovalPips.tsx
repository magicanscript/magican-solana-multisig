'use client';

import type { Address } from '@solana/kit';
import { approvalsByOwner, isAttributable } from '@/lib/proposal-status';
import { shortAddress } from '@/lib/format';

/**
 * Ряд пипсов по владельцам: зелёный = одобрил, пустой = ещё нет.
 * Пип текущего пользователя (`me`) обведён рамкой.
 *
 * Сопоставлять маску с владельцами можно, только если предложение относится к
 * ТЕКУЩЕМУ набору владельцев (`ownerSetSeqno` совпал). Длина маски — негодный
 * признак: `set_owners` может заменить владельца, не меняя их число, и тогда
 * зелёный пип достался бы тому, кто не голосовал и владельцем тогда не был.
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
        {/* Не «к прежнему набору владельцев»: seqno бампает и change_threshold,
            а владельцы при этом те же (governance.rs). */}
        голоса собраны по прежним правилам мультисига
      </span>
    );
  }

  let pips;
  try {
    pips = approvalsByOwner(signers, owners);
  } catch {
    return (
      <span className="text-xs text-amber-600 dark:text-amber-500">
        маска не соответствует текущему набору владельцев
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {pips.map(({ owner, approved }) => (
        <span
          key={owner}
          title={`${shortAddress(owner, 4, 4)}${approved ? ' — одобрил' : ''}`}
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
