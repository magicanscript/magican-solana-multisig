'use client';

import type { Address } from '@solana/kit';
import type { MultisigView, ProposalView } from '@/lib/multisig';
import { countApprovals, deriveStatus, type ProposalStatus } from '@/lib/proposal-status';
import { shortAddress } from '@/lib/format';
import { ApprovalPips } from './ApprovalPips';

const STATUS_META: Record<ProposalStatus, { label: string; cls: string }> = {
  executed: {
    label: 'Исполнено',
    cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  },
  executable: {
    label: 'Готово к исполнению',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  },
  pending: {
    label: 'Ждёт подписей',
    cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  },
  stale: {
    label: 'Устарело',
    cls: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  },
};

/**
 * Строка предложения: индекс, кворум X/M, статус, пипсы одобрений, действия.
 * Полные дизейблы/состояния кнопок — Task 14; здесь базовая логика по статусу.
 */
export function ProposalRow({
  view,
  ms,
  index,
  me,
  onApprove,
  onExecute,
}: {
  view: ProposalView;
  ms: MultisigView;
  index?: number;
  me?: Address;
  onApprove: (proposal: Address) => void;
  onExecute: (proposal: Address) => void;
}) {
  const tx = view.data;
  const m = ms.data;
  const status = deriveStatus(
    { didExecute: tx.didExecute, signers: tx.signers, ownerSetSeqno: tx.ownerSetSeqno },
    { threshold: m.threshold, ownerSetSeqno: m.ownerSetSeqno },
  );
  const approvals = countApprovals(tx.signers);
  const meta = STATUS_META[status];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            #{index ?? '?'}
          </span>
          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {shortAddress(view.address, 4, 4)}
          </span>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.cls}`}>
          {meta.label}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {approvals} / {m.threshold}
          </span>
          <ApprovalPips signers={tx.signers} owners={m.owners} me={me} />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onApprove(view.address)}
            disabled={status === 'executed' || status === 'stale'}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Одобрить
          </button>
          <button
            type="button"
            onClick={() => onExecute(view.address)}
            disabled={status !== 'executable'}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Исполнить
          </button>
        </div>
      </div>
    </div>
  );
}
