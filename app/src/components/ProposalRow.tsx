'use client';

import type { Address } from '@solana/kit';
import type { MultisigView, ProposalView } from '@/lib/multisig';
import { countApprovals, deriveStatus, isAttributable, type ProposalStatus } from '@/lib/proposal-status';
import { actionBlocks, actionHint } from '@/lib/proposal-actions';
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

/** Строка предложения: индекс, кворум, статус, пипсы одобрений, действия. */
export function ProposalRow({
  view,
  ms,
  index,
  me,
  signerPda,
  busy = false,
  onApprove,
  onExecute,
}: {
  view: ProposalView;
  ms: MultisigView;
  index?: number;
  me?: Address;
  /** Казна мультисига: без неё не отличить чужого подписанта от нашего (см. actionBlocks). */
  signerPda?: Address;
  /** Другое действие уже в работе: диалог открыт или транзакция летит. */
  busy?: boolean;
  onApprove: (view: ProposalView) => void;
  onExecute: (view: ProposalView) => void;
}) {
  const tx = view.data;
  const m = ms.data;
  const status = deriveStatus(
    { didExecute: tx.didExecute, signers: tx.signers, ownerSetSeqno: tx.ownerSetSeqno },
    { threshold: m.threshold, ownerSetSeqno: m.ownerSetSeqno },
  );
  const approvals = countApprovals(tx.signers);
  const meta = STATUS_META[status];

  // Маска заморожена на своём наборе владельцев: сравнивать её с ТЕКУЩИМ порогом
  // можно только пока набор не менялся, иначе «2 / 2» читалось бы как «кворум
  // набран» у заведомо мёртвого предложения.
  const comparable = isAttributable({ ownerSetSeqno: tx.ownerSetSeqno }, { ownerSetSeqno: m.ownerSetSeqno });

  const owners = m.owners as Address[];
  const blocks = actionBlocks(tx, m, me, busy, signerPda);
  const { approve: approveBlock, execute: executeBlock } = blocks;
  // Почему кнопки серые — из tooltip'а на disabled-кнопке не узнать (на тач-устройствах
  // его нет вовсе). Правила показа — в actionHint.
  const hint = actionHint(blocks);

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
            {comparable ? `${approvals} / ${m.threshold}` : `${approvals} ${approvals === 1 ? 'голос' : 'голосов'} по прежним правилам`}
          </span>
          <ApprovalPips
            signers={tx.signers}
            owners={owners}
            txOwnerSetSeqno={tx.ownerSetSeqno}
            msOwnerSetSeqno={m.ownerSetSeqno}
            me={me}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onApprove(view)}
            disabled={approveBlock != null}
            title={approveBlock ?? undefined}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Одобрить
          </button>
          <button
            type="button"
            onClick={() => onExecute(view)}
            disabled={executeBlock != null}
            title={executeBlock ?? undefined}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Исполнить
          </button>
        </div>
      </div>

      {hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}
