import { CheckCircle2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { compareTxDesc, isMissingNote } from '../lib/calc';
import { formatShortDate, formatTime } from '../lib/dates';
import type { Transaction } from '../lib/types';
import { METHOD_LABEL } from '../lib/types';
import { CategoryBadge, MethodIcon } from '../components/icons';
import { ReminderBanner } from '../components/ReminderBanner';
import { useMoney, useTxLabels } from '../components/TxRow';
import { Button, EmptyState, Segmented, SectionHeader, TextArea } from '../components/ui';
import { useData } from '../state/data';
import { useToday } from '../state/hooks';
import { useUi } from '../state/ui';

/* ------------------------------------------------------------------ */
/* Missing explanations                                                */
/* ------------------------------------------------------------------ */

function ReviewItem({ tx, today }: { tx: Transaction; today: string }) {
  const { patchTransaction } = useData();
  const { openSheet, toast } = useUi();
  const money = useMoney();
  const labels = useTxLabels();
  const { title, category } = labels(tx);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const uid = useId();

  const save = async () => {
    if (busy || !draft.trim()) return;
    setBusy(true);
    try {
      await patchTransaction(tx.id, { comment: draft.replace(/\s+$/, '') });
      toast(`Note saved for ${title}.`);
    } catch (e) {
      toast(`Couldn’t save: ${(e as Error).message}`, { tone: 'error' });
      setBusy(false);
    }
  };

  const toggleReviewed = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await patchTransaction(tx.id, { reviewed: !tx.reviewed });
      toast(tx.reviewed ? `${title} moved back to “To review”.` : `${title} marked reviewed. It still has no note.`);
    } catch {
      toast('Couldn’t update.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="surface animate-rise rounded-[24px] p-4 sm:p-5">
      <div className="flex gap-3.5">
        <CategoryBadge category={category} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[16px] font-medium text-white">{title}</p>
            <p className="tnum shrink-0 text-[16px] font-semibold text-white">{money(tx.amount)}</p>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-white/60">
            <span>{formatShortDate(tx.date, today)}{tx.time ? `, ${formatTime(tx.time)}` : ''}</span>
            <span aria-hidden>·</span>
            <span>{category?.name}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <MethodIcon method={tx.method} size={13} />
              {METHOD_LABEL[tx.method]}
            </span>
          </p>
        </div>
      </div>
      <label htmlFor={`${uid}-note`} className="mt-4 block text-[14px] font-medium text-white/85">
        What was this for?
      </label>
      <TextArea
        id={`${uid}-note`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
        minRows={2}
        maxRows={6}
        maxLength={1000}
        className="mt-2"
        placeholder="A few words are enough"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={toggleReviewed} disabled={busy} aria-pressed={tx.reviewed}>
            {tx.reviewed ? 'Mark as not reviewed' : 'Mark reviewed without a note'}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => openSheet({ kind: 'tx-detail', id: tx.id })}>
            Details
          </Button>
          <Button size="sm" variant="white" onClick={save} disabled={busy || !draft.trim()}>
            Save note
          </Button>
        </div>
      </div>
    </li>
  );
}

function MissingNotes({ today }: { today: string }) {
  const { data } = useData();
  const [tab, setTab] = useState<'todo' | 'reviewed'>('todo');
  const [limit, setLimit] = useState(20);
  const missing = useMemo(() => data.transactions.filter(isMissingNote).sort(compareTxDesc), [data.transactions]);
  const todo = missing.filter((t) => !t.reviewed);
  const reviewed = missing.filter((t) => t.reviewed);
  const list = tab === 'todo' ? todo : reviewed;
  const totalExpenses = data.transactions.filter((t) => t.type === 'expense').length;

  return (
    <section aria-labelledby="missing-title" className="min-w-0">
      <SectionHeader
        id="missing-title"
        title="Missing explanations"
        subtitle={
          missing.length === 0
            ? 'Every expense has a note.'
            : `${missing.length} ${missing.length === 1 ? 'expense has' : 'expenses have'} no note: ${todo.length} to review, ${reviewed.length} marked reviewed.`
        }
      />
      {missing.length > 0 && (
        <Segmented
          label="Show"
          value={tab}
          onChange={(v) => {
            setTab(v);
            setLimit(20);
          }}
          className="mb-4 flex w-full sm:w-auto"
          options={[
            { value: 'todo', label: 'To review', count: todo.length },
            { value: 'reviewed', label: 'Reviewed, no note', count: reviewed.length },
          ]}
        />
      )}
      {missing.length === 0 ? (
        <div className="surface rounded-[28px]">
          <EmptyState icon={CheckCircle2} title={totalExpenses ? 'All caught up' : 'Nothing to review yet'}>
            {totalExpenses
              ? 'Every expense has a note explaining what it was for.'
              : 'Expenses you save without a note will show up here, so you can explain them later.'}
          </EmptyState>
        </div>
      ) : list.length === 0 ? (
        <div className="surface rounded-[28px]">
          <EmptyState icon={CheckCircle2} title={tab === 'todo' ? 'Nothing left to review' : 'None marked reviewed'}>
            {tab === 'todo'
              ? `The ${reviewed.length} without a note ${reviewed.length === 1 ? 'was' : 'were'} marked reviewed. You can still add notes to them any time.`
              : 'Expenses you mark reviewed without adding a note appear here.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {list.slice(0, limit).map((t) => (
              <ReviewItem key={t.id} tx={t} today={today} />
            ))}
          </ul>
          {list.length > limit && (
            <div className="mt-5 flex justify-center">
              <Button variant="secondary" onClick={() => setLimit((l) => l + 20)}>
                Show more ({list.length - limit} left)
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function Review() {
  const today = useToday();
  return (
    <>
      <header className="mb-6 md:mb-8">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em] md:text-[32px]">Review</h1>
        <p className="mt-1 text-[15px] text-white/60">Add what each expense was for, or mark it reviewed.</p>
      </header>
      <ReminderBanner onReviewScreen />
      <div className="max-w-[760px]">
        <MissingNotes today={today} />
      </div>
    </>
  );
}
