'use client';

import type { Address } from '@solana/kit';
import { approvalsByOwner } from '@/lib/proposal-status';
import { shortAddress } from '@/lib/format';

/**
 * Ряд пипсов по владельцам: зелёный = одобрил, пустой = ещё нет.
 * Пип текущего пользователя (`me`) обведён рамкой.
 *
 * Если длина маски не совпадает с числом владельцев (маска относится к другому
 * набору — предложение устарело после set_owners), сопоставление невозможно.
 */
export function ApprovalPips({
  signers,
  owners,
  me,
}: {
  signers: boolean[];
  owners: Address[];
  me?: Address;
}) {
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
