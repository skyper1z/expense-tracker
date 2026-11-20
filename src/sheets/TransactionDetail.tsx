import { MessageSquareText, PenLine, SquarePen, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { spendingOf } from '../lib/calc';
import { formatLongDate, formatTime, formatTimestamp } from '../lib/dates';
import { METHOD_LABEL, TYPE_LABEL } from '../lib/types';
import { CategoryBadge, MethodIcon } from '../components/icons';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '../components/Sheet';
import { useMoney, useTxLabels } from '../components/TxRow';
import { Button, cx, IconButton, Switch, TextArea } from '../components/ui';
import { useData } from '../state/data';
import { useUi } from '../state/ui';

export function TransactionDetail({ id, focusNote, closing }: { id: string; focusNote?: boolean; closing: boolean }) {
  const { data, patchTransaction, deleteTransaction, restoreTransaction, accountMap } = useData();
  const { requestCloseSheet, closeSheet, openSheet, toast, setCloseGuard, confirm } = useUi();
  const money = useMoney();
  const labels = useTxLabels();
  const uid = useId();
  const tx = data.transactions.find((t) => t.id === id);
  const [editingNote, setEditingNote] = useState(!!focusNote || (tx ? !tx.comment.trim() && tx.type === 'expense' : false));
  const [draft, setDraft] = useState(tx?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedRef = useRef(tx?.comment ?? '');
  savedRef.current = tx?.comment ?? '';
  useEffect(() => {
    setCloseGuard(async () => {
      if (draftRef.current.trim() === savedRef.current.trim()) return true;
      return confirm({
        title: 'Discard this note?',
        body: 'Your note hasn’t been saved yet.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      });
    });
    return () => setCloseGuard(null);
  }, [setCloseGuard, confirm]);

  useEffect(() => {
    if (focusNote) {
      const t = window.setTimeout(() => noteRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [focusNote]);

  const titleId = `${uid}-title`;
  if (!tx) {
    return (
      <Sheet labelledBy={titleId} onClose={closeSheet} closing={closing}>
        <SheetHeader id={titleId} title="Entry not found" onClose={closeSheet} />
        <SheetBody>
          <p className="text-white/70">This entry has been deleted.</p>
        </SheetBody>
      </Sheet>
    );
  }

  const { title, category } = labels(tx);
  const acc = (aid: string | null) => (aid ? (accountMap.get(aid)?.name ?? 'Deleted account') : 'Not listed');
  const spend = spendingOf(tx);

  const saveNote = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await patchTransaction(tx.id, { comment: draft.replace(/\s+$/, '') });
      setEditingNote(false);
      toast(draft.trim() ? 'Note saved.' : 'Note removed.');
    } catch (e) {
      toast(`Couldn’t save the note: ${(e as Error).message}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const removed = await deleteTransaction(tx.id);
      closeSheet();
      if (removed) {
        toast(`${TYPE_LABEL[removed.type]} deleted.`, {
          action: { label: 'Undo', onAction: () => restoreTransaction(removed).then(() => toast('Restored.')) },
        });
      }
    } catch (e) {
      toast(`Couldn’t delete: ${(e as Error).message}`, { tone: 'error' });
      setBusy(false);
    }
  };

  const rows: [string, React.ReactNode][] = [
    ['Date', `${formatLongDate(tx.date)}${tx.time ? `, ${formatTime(tx.time)}` : ''}`],
  ];
  if (tx.type === 'expense') rows.push(['Category', category?.name ?? 'Other']);
  rows.push([
    tx.type === 'income' ? 'Received by' : 'Paid with',
    <span className="inline-flex items-center gap-1.5">
      <MethodIcon method={tx.method} size={16} />
      {METHOD_LABEL[tx.method]}
    </span>,
  ]);
  if (tx.type === 'transfer') {
    rows.push(['From', acc(tx.accountId)], ['To', acc(tx.toAccountId)]);
  } else {
    rows.push([tx.type === 'income' ? 'Received into' : 'Account', tx.accountId ? acc(tx.accountId) : 'Not linked']);
  }
  if (tx.fee > 0) rows.push(['Fee', money(tx.fee)]);
  rows.push(['Counts as spending', spend > 0 ? money(spend) : 'No']);
  if (tx.importRef) rows.push(['Transaction ID', tx.importRef]);
  rows.push(['Added', formatTimestamp(tx.createdAt)]);
  if (tx.updatedAt !== tx.createdAt) rows.push(['Last changed', formatTimestamp(tx.updatedAt)]);

  return (
    <Sheet labelledBy={titleId} onClose={requestCloseSheet} closing={closing}>
      <SheetHeader
        id={titleId}
        title={title}
        subtitle={tx.type === 'expense' ? category?.name : TYPE_LABEL[tx.type]}
        onClose={requestCloseSheet}
        leading={<CategoryBadge category={category} type={tx.type} size={44} />}
      />
      <SheetBody>
        <p
          className={cx(
            'tnum mt-1 text-[40px] font-[450] leading-tight tracking-[-0.035em]',
            tx.type === 'income' ? 'text-mint-400' : 'text-white',
          )}
        >
          {tx.type === 'income' ? money(tx.amount, { signed: true }) : money(tx.amount)}
        </p>
        {tx.fee > 0 && <p className="tnum text-[14px] text-white/65">+ {money(tx.fee)} fee</p>}

        <section aria-labelledby={`${uid}-note`} className="mt-5 rounded-[24px] border border-white/[0.07] bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 id={`${uid}-note`} className="text-[15px] font-medium text-white">
              {tx.type === 'expense' ? 'What was this for?' : 'Note'}
            </h3>
            {!editingNote && (
              <Button size="sm" variant="ghost" icon={PenLine} onClick={() => setEditingNote(true)}>
                {tx.comment.trim() ? 'Edit note' : 'Add a note'}
              </Button>
            )}
          </div>
          {editingNote ? (
            <div className="mt-3">
              <label htmlFor={`${uid}-draft`} className="sr-only">
                Note
              </label>
              <TextArea
                ref={noteRef}
                id={`${uid}-draft`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                minRows={3}
                maxLength={1000}
                placeholder="A few words about this expense"
              />
              <div className="mt-3 flex justify-end gap-2">
                {tx.comment.trim() && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDraft(tx.comment);
                      setEditingNote(false);
                    }}
                  >
                    Cancel
                  </Button>
                )}
                <Button size="sm" variant="white" onClick={saveNote} disabled={busy || draft.trim() === tx.comment.trim()}>
                  Save note
                </Button>
              </div>
            </div>
          ) : tx.comment.trim() ? (
            <p className="mt-2 whitespace-pre-line break-words text-[15px] leading-relaxed text-white/85">{tx.comment}</p>
          ) : (
            <p className="mt-2 text-[14px] text-white/60">No note yet.</p>
          )}
        </section>

        <dl className="mt-5 divide-y divide-white/[0.06] rounded-[24px] border border-white/[0.07] bg-white/[0.02] px-4">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 py-3">
              <dt className="shrink-0 text-[14px] text-white/60">{k}</dt>
              <dd className="tnum min-w-0 break-words text-right text-[14px] font-medium text-white">{v}</dd>
            </div>
          ))}
        </dl>

        {tx.type === 'expense' && (
          <div className="mt-5 rounded-[24px] border border-white/[0.07] bg-white/[0.03] p-4">
            <Switch
              checked={tx.reviewed}
              onChange={(v) =>
                patchTransaction(tx.id, { reviewed: v })
                  .then(() => toast(v ? 'Marked as reviewed.' : 'Marked as not reviewed.'))
                  .catch(() => toast('Couldn’t update.', { tone: 'error' }))
              }
              label="Marked as reviewed"
              description="Separate from the note. An expense can be reviewed and still have no note."
            />
          </div>
        )}

        {tx.sourceText && (
          <details className="group mt-5 rounded-[24px] border border-white/[0.07] bg-white/[0.03]">
            <summary className="flex items-center gap-2 px-4 py-3.5 text-[14px] font-medium text-white/85">
              <MessageSquareText size={16} strokeWidth={1.6} aria-hidden />
              Original MoMo message
            </summary>
            <p className="whitespace-pre-wrap break-words px-4 pb-4 font-mono text-[13px] leading-relaxed text-white/75">
              {tx.sourceText}
            </p>
          </details>
        )}
      </SheetBody>
      <SheetFooter>
        <div className="flex gap-3">
          <IconButton icon={Trash2} label="Delete" size={48} onClick={remove} className="text-danger-300" disabled={busy} />
          <Button variant="primary" icon={SquarePen} className="flex-1" onClick={() => openSheet({ kind: 'tx-edit', id: tx.id })}>
            Edit details
          </Button>
        </div>
      </SheetFooter>
    </Sheet>
  );
}
