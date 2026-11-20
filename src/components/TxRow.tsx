import { PenLine } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { isMissingNote } from '../lib/calc';
import { formatShortDate, formatTime } from '../lib/dates';
import { formatMoney } from '../lib/money';
import type { Transaction } from '../lib/types';
import { METHOD_LABEL } from '../lib/types';
import { useData } from '../state/data';
import { useUi } from '../state/ui';
import { CategoryBadge, MethodIcon, tint } from './icons';
import { cx } from './ui';

export function useMoney() {
  const { data } = useData();
  const currency = data.settings.currency;
  return (minor: number, opts?: { signed?: boolean }) => formatMoney(minor, currency, opts);
}

export function useTxLabels() {
  const { categoryMap, accountMap } = useData();
  return (tx: Transaction) => {
    const category = categoryMap.get(tx.categoryId) ?? categoryMap.get('other');
    const acc = (id: string | null) => (id ? (accountMap.get(id)?.name ?? 'Deleted account') : 'Not listed');
    let title = tx.payee.trim();
    let detail = '';
    if (tx.type === 'expense') {
      if (!title) title = category?.name ?? 'Expense';
      detail = category?.name ?? 'Other';
    } else if (tx.type === 'income') {
      if (!title) title = 'Money in';
      detail = tx.accountId ? `Money in · ${acc(tx.accountId)}` : 'Money in';
    } else {
      if (!title) title = 'Transfer';
      detail = `${acc(tx.accountId)} → ${acc(tx.toAccountId)}`;
    }
    return { title, detail, category };
  };
}

/** Long notes show two lines first, with an explicit control to expand (never hover-only). */
export function ExpandableNote({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return (
    <div className={className}>
      <p
        ref={ref}
        className={cx(
          'whitespace-pre-line break-words text-[14px] leading-[1.45] text-white/80',
          !open && 'line-clamp-2',
        )}
      >
        {text}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          aria-expanded={open}
          className="pointer-events-auto relative z-10 mt-1 -ml-1 rounded-full px-1 py-0.5 text-[13px] font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export function TxRow({ tx, showDate = true, today }: { tx: Transaction; showDate?: boolean; today: string }) {
  const { openSheet } = useUi();
  const money = useMoney();
  const labels = useTxLabels();
  const { title, detail, category } = labels(tx);
  const missing = isMissingNote(tx);
  const color = tx.type === 'income' ? '#4ADE80' : tx.type === 'transfer' ? '#d4d4d4' : (category?.color ?? '#A1A1AA');
  const dateLabel = formatShortDate(tx.date, today) + (tx.time ? `, ${formatTime(tx.time)}` : '');
  const amountText = tx.type === 'income' ? money(tx.amount, { signed: true }) : money(tx.amount);
  const typeLabel = tx.type === 'income' ? 'Money in' : tx.type === 'transfer' ? 'Transfer' : METHOD_LABEL[tx.method];

  return (
    <div
      className="relative rounded-[24px] border border-white/[0.06] px-4 py-3.5 transition-colors sm:px-5"
      style={{ background: `linear-gradient(105deg, #151515 32%, ${tint(color, 0.14)} 100%)` }}
    >
      <button
        type="button"
        onClick={() => openSheet({ kind: 'tx-detail', id: tx.id })}
        className="absolute inset-0 rounded-[24px] hover:bg-white/[0.02]"
        aria-label={`${title}, ${amountText}, ${dateLabel}. Open details`}
      />
      <div className="pointer-events-none relative flex gap-3.5">
        <CategoryBadge category={category} type={tx.type} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[16px] font-medium leading-snug text-white">{title}</p>
            <p
              className={cx(
                'tnum shrink-0 text-[16px] font-semibold leading-snug',
                tx.type === 'income' ? 'text-mint-400' : tx.type === 'transfer' ? 'text-white/75' : 'text-white',
              )}
            >
              {amountText}
            </p>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-3 text-[13px] leading-snug text-white/60">
            <p className="min-w-0 truncate">
              {[showDate ? dateLabel : '', detail !== title ? detail : ''].filter(Boolean).join(' · ')}
            </p>
            <p className="flex shrink-0 items-center gap-1">
              <MethodIcon method={tx.method} size={14} />
              {typeLabel}
            </p>
          </div>
          {tx.fee > 0 && (
            <p className="mt-1 text-[13px] text-white/60">
              + {money(tx.fee)} fee{tx.type !== 'expense' && ' (counted as spending)'}
            </p>
          )}
          {tx.comment.trim() ? (
            <ExpandableNote text={tx.comment} className="mt-2" />
          ) : missing ? (
            <button
              type="button"
              onClick={() => openSheet({ kind: 'tx-detail', id: tx.id, focusNote: true })}
              className="pointer-events-auto relative z-10 mt-2 inline-flex items-center gap-1.5 rounded-full border border-dashed border-flame-400/40 px-3 py-1.5 text-[13px] font-medium text-flame-300 hover:border-flame-400/70 hover:text-flame-200"
            >
              <PenLine size={14} strokeWidth={1.8} aria-hidden />
              Add a note
              {tx.reviewed && <span className="text-white/55">· reviewed</span>}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
