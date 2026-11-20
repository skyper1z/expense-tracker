import {
  ArrowLeft, ClipboardPaste, MessageSquareText, Plus, Smartphone, Trash2, TriangleAlert, X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { findDuplicates } from '../lib/calc';
import { CUSTOM_COLORS, sortCategories } from '../lib/categories';
import { addDays, formatShortDate, formatTime, isValidISODate } from '../lib/dates';
import { newId, nowIso } from '../lib/ids';
import { currencyInfo, formatMoney, minorToInput, parseMoneyInput } from '../lib/money';
import { parseMomoMessage, type MomoParse } from '../lib/momo';
import type { Account, PaymentMethod, Transaction, TxType } from '../lib/types';
import { PAYMENT_METHODS, TYPE_LABEL } from '../lib/types';
import { CATEGORY_ICONS, MethodIcon } from '../components/icons';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '../components/Sheet';
import { useTxLabels } from '../components/TxRow';
import {
  Button, Callout, Chip, cx, describedBy, Field, IconButton, Segmented, Select, Switch, TextArea, TextInput,
} from '../components/ui';
import { useData } from '../state/data';
import { useToday } from '../state/hooks';
import { useUi } from '../state/ui';

interface FormState {
  type: TxType;
  amount: string;
  fee: string;
  showFee: boolean;
  comment: string;
  categoryId: string | null;
  method: PaymentMethod;
  date: string;
  time: string | null;
  payee: string;
  accountId: string;
  toAccountId: string;
  reviewed: boolean;
  importRef: string | null;
  sourceText: string | null;
}

interface MomoMeta {
  parse: MomoParse;
  typeChoice: TxType | null;
  feeMode: 'ontop' | 'included' | null;
}

type Errors = Partial<Record<'amount' | 'fee' | 'feeMode' | 'date' | 'comment' | 'payee' | 'kind' | 'transfer' | 'time', string>>;

const LAST_METHOD_KEY = 'spendnote.lastMethod';

function lastMethod(): PaymentMethod {
  try {
    const v = localStorage.getItem(LAST_METHOD_KEY);
    if (v && PAYMENT_METHODS.some((m) => m.id === v)) return v as PaymentMethod;
  } catch {
    /* ignore */
  }
  return 'cash';
}

function fromTx(tx: Transaction): FormState {
  return {
    type: tx.type,
    amount: minorToInput(tx.amount),
    fee: tx.fee ? minorToInput(tx.fee) : '',
    showFee: tx.fee > 0,
    comment: tx.comment,
    categoryId: tx.categoryId,
    method: tx.method,
    date: tx.date,
    time: tx.time,
    payee: tx.payee,
    accountId: tx.accountId ?? '',
    toAccountId: tx.toAccountId ?? '',
    reviewed: tx.reviewed,
    importRef: tx.importRef,
    sourceText: tx.sourceText,
  };
}

function blank(today: string, preset?: Partial<Transaction>): FormState {
  return {
    type: preset?.type ?? 'expense',
    amount: preset?.amount ? minorToInput(preset.amount) : '',
    fee: '',
    showFee: false,
    comment: '',
    categoryId: preset?.categoryId ?? null,
    method: preset?.method ?? lastMethod(),
    date: preset?.date ?? today,
    time: null,
    payee: preset?.payee ?? '',
    accountId: preset?.accountId ?? '',
    toAccountId: preset?.toAccountId ?? '',
    reviewed: false,
    importRef: null,
    sourceText: null,
  };
}

function momoAccounts(type: TxType, p: MomoParse, accounts: Account[]) {
  const momo = accounts.find((a) => a.method === 'momo')?.id ?? '';
  const cash = accounts.find((a) => a.method === 'cash')?.id ?? '';
  if (type === 'transfer') {
    if (p.kind === 'cash_out') return { accountId: momo, toAccountId: cash };
    if (p.kind === 'cash_in') return { accountId: cash, toAccountId: momo };
    if (p.direction.value === 'received') return { accountId: '', toAccountId: momo };
    return { accountId: momo, toAccountId: '' };
  }
  return { accountId: momo, toAccountId: '' };
}

export function TransactionSheet({
  existing,
  preset,
  startWithPaste,
  closing,
}: {
  existing?: Transaction;
  preset?: Partial<Transaction>;
  startWithPaste?: boolean;
  closing: boolean;
}) {
  const today = useToday();
  const { data, saveTransaction, deleteTransaction, restoreTransaction, saveCategory } = useData();
  const { requestCloseSheet, closeSheet, setCloseGuard, toast, confirm } = useUi();
  const labels = useTxLabels();
  const uid = useId();
  const currency = data.settings.currency;
  const symbol = currencyInfo(currency).symbol.trim();
  const money = (m: number) => formatMoney(m, currency);

  const initial = useMemo(() => (existing ? fromTx(existing) : blank(today, preset)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [s, setS] = useState<FormState>(initial);
  const [momo, setMomo] = useState<MomoMeta | null>(null);
  const [view, setView] = useState<'form' | 'paste'>(startWithPaste && !existing ? 'paste' : 'form');
  const [pasteText, setPasteText] = useState('');
  const [pasteFailed, setPasteFailed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [newCat, setNewCat] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const accounts = data.accounts;
  const categories = useMemo(() => sortCategories(data.categories), [data.categories]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((p) => ({ ...p, [k]: v }));

  const dirty = JSON.stringify(s) !== JSON.stringify(initial) || momo !== null || pasteText.trim() !== '';
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    setCloseGuard(async () => {
      if (!dirtyRef.current) return true;
      return confirm({
        title: existing ? 'Discard your changes?' : 'Discard this entry?',
        body: 'What you’ve typed won’t be saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      });
    });
    return () => setCloseGuard(null);
  }, [setCloseGuard, confirm, existing]);

  /* ---------------- validation ---------------- */

  const parsedAmount = parseMoneyInput(s.amount);
  const parsedFee = s.showFee && s.fee.trim() ? parseMoneyInput(s.fee, { allowZero: true, label: 'a fee' }) : null;
  const feeValue = parsedFee?.ok ? parsedFee.value : 0;
  const savedAmount = parsedAmount.ok ? (momo?.feeMode === 'included' ? parsedAmount.value - feeValue : parsedAmount.value) : null;

  const errors: Errors = useMemo(() => {
    const e: Errors = {};
    if (!parsedAmount.ok) e.amount = parsedAmount.error;
    if (parsedFee && !parsedFee.ok) e.fee = parsedFee.error;
    if (momo && feeValue > 0 && momo.feeMode === null) e.feeMode = 'Choose whether the fee is included in the amount.';
    if (momo?.feeMode === 'included' && parsedAmount.ok && feeValue >= parsedAmount.value) {
      e.fee = 'The fee can’t be as much as the whole amount.';
    }
    if (!s.date) e.date = 'Choose a date.';
    else if (!isValidISODate(s.date)) e.date = 'Enter a valid date.';
    else if (s.date > addDays(today, 366)) e.date = 'That date is more than a year away.';
    if (s.time !== null && !/^\d{2}:\d{2}$/.test(s.time)) e.time = 'Enter a valid time or remove it.';
    if (s.comment.length > 1000) e.comment = `Keep notes under 1,000 characters (now ${s.comment.length}).`;
    if (s.payee.length > 80) e.payee = 'Keep this under 80 characters.';
    if (momo && !momo.typeChoice) e.kind = 'Choose what kind of transaction this is.';
    if (s.type === 'transfer' && s.accountId && s.accountId === s.toAccountId) {
      e.transfer = 'Choose two different accounts.';
    }
    return e;
  }, [s, parsedAmount, parsedFee, feeValue, momo, today]);
  const shownErrors = attempted ? errors : {};

  const duplicates = useMemo(
    () =>
      findDuplicates(
        { id: existing?.id, importRef: s.importRef, amount: savedAmount, payee: s.payee, date: s.date || null },
        data.transactions,
      ).slice(0, 3),
    [existing?.id, s.importRef, savedAmount, s.payee, s.date, data.transactions],
  );

  /* ---------------- MoMo ---------------- */

  const readMessage = () => {
    const text = pasteText.trim();
    if (!text) {
      setPasteFailed(true);
      return;
    }
    const p = parseMomoMessage(text, today);
    if (!p.ok) {
      setPasteFailed(true);
      return;
    }
    const type = p.suggestedType ?? 'expense';
    setS((prev) => ({
      ...prev,
      type,
      amount: p.amount.value !== null ? minorToInput(p.amount.value) : '',
      fee: p.feeTotal > 0 ? minorToInput(p.feeTotal) : '',
      showFee: p.feeTotal > 0,
      payee: p.party.value ?? '',
      date: p.date.value ?? '',
      time: p.time.value,
      method: 'momo',
      importRef: p.reference.value,
      sourceText: text,
      ...momoAccounts(type, p, accounts),
    }));
    setMomo({
      parse: p,
      typeChoice: p.typeCertain ? p.suggestedType : null,
      feeMode: p.feeTotal > 0 ? (p.feeIncluded === 'yes' ? 'included' : p.feeIncluded === 'no' ? 'ontop' : null) : null,
    });
    setPasteFailed(false);
    setAttempted(false);
    setView('form');
    requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: 0 }));
  };

  const enterManually = () => {
    setS((prev) => ({ ...prev, method: 'momo', sourceText: pasteText.trim() || null }));
    setPasteFailed(false);
    setView('form');
  };

  const chooseKind = (t: TxType) => {
    if (!momo) return;
    setMomo({ ...momo, typeChoice: t });
    setS((prev) => ({ ...prev, type: t, ...momoAccounts(t, momo.parse, accounts) }));
  };

  /* ---------------- save ---------------- */

  const focusFirstError = (e: Errors) => {
    const order: (keyof Errors)[] = ['kind', 'amount', 'fee', 'feeMode', 'transfer', 'comment', 'date', 'time', 'payee'];
    const first = order.find((k) => e[k]);
    if (!first) return;
    const el = document.getElementById(`${uid}-${first}`);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const build = (): Transaction => {
    const ts = nowIso();
    return {
      id: existing?.id ?? newId('tx'),
      type: s.type,
      amount: savedAmount!,
      fee: feeValue,
      date: s.date,
      time: s.time,
      categoryId: s.type === 'expense' ? (s.categoryId ?? 'other') : (existing?.categoryId ?? 'other'),
      method: s.method,
      comment: s.comment.replace(/\s+$/, ''),
      payee: s.payee.trim(),
      accountId: s.accountId || null,
      toAccountId: s.type === 'transfer' ? s.toAccountId || null : null,
      importRef: s.importRef,
      sourceText: s.sourceText,
      reviewed: s.reviewed,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };
  };

  const submit = async (addAnother: boolean) => {
    if (savingRef.current) return; // no double submits
    setAttempted(true);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const tx = build();
      await saveTransaction(tx);
      try {
        localStorage.setItem(LAST_METHOD_KEY, tx.method);
      } catch {
        /* ignore */
      }
      const what = tx.type === 'expense' ? 'Expense' : TYPE_LABEL[tx.type];
      const noteHint = tx.type === 'expense' && !tx.comment.trim() && !tx.reviewed ? ' Add a note any time from Review.' : '';
      toast(`${what} ${existing ? 'updated' : 'saved'} · ${money(tx.amount + tx.fee)}.${noteHint}`);
      if (addAnother) {
        setS((prev) => ({
          ...blank(today),
          type: prev.type,
          method: prev.method,
          date: prev.date,
          accountId: prev.accountId,
          toAccountId: prev.toAccountId,
        }));
        setMomo(null);
        setPasteText('');
        setAttempted(false);
        bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        amountRef.current?.focus();
      } else {
        closeSheet();
      }
    } catch (err) {
      toast(`Couldn’t save: ${(err as Error).message || 'storage error'}. Your entry is still here.`, { tone: 'error' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing || savingRef.current) return;
    savingRef.current = true;
    try {
      const removed = await deleteTransaction(existing.id);
      closeSheet();
      if (removed) {
        toast(`${TYPE_LABEL[removed.type]} deleted.`, {
          action: { label: 'Undo', onAction: () => restoreTransaction(removed).then(() => toast('Restored.')) },
        });
      }
    } catch (err) {
      toast(`Couldn’t delete: ${(err as Error).message}`, { tone: 'error' });
    } finally {
      savingRef.current = false;
    }
  };

  const addCategory = async () => {
    const name = (newCat ?? '').trim();
    if (!name) return;
    if (data.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      const match = data.categories.find((c) => c.name.toLowerCase() === name.toLowerCase())!;
      set('categoryId', match.id);
      setNewCat(null);
      return;
    }
    const used = new Set(data.categories.map((c) => c.color));
    const cat = {
      id: newId('cat'),
      name: name.slice(0, 40),
      icon: 'sparkles',
      color: CUSTOM_COLORS.find((c) => !used.has(c)) ?? CUSTOM_COLORS[0],
      builtIn: false,
      order: 50 + data.categories.length,
    };
    try {
      await saveCategory(cat);
      set('categoryId', cat.id);
      setNewCat(null);
    } catch {
      toast('Couldn’t add that category.', { tone: 'error' });
    }
  };

  /* ---------------- render ---------------- */

  const titleId = `${uid}-title`;
  const typeName = s.type === 'expense' ? 'expense' : s.type === 'income' ? 'money in' : 'transfer';
  const title =
    view === 'paste' ? 'Paste a MoMo message' : existing ? `Edit ${typeName}` : `Add ${typeName}`;
  // Money in and transfers stay out of the way until you've set up an account (or are editing one).
  const showTypeTabs = !momo && (accounts.length > 0 || s.type !== 'expense');
  const id = (k: string) => `${uid}-${k}`;

  const accountOptions = (list: Account[]) =>
    list.map((a) => (
      <option key={a.id} value={a.id}>
        {a.name}
      </option>
    ));

  if (view === 'paste') {
    const canReadClipboard = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;
    return (
      <Sheet labelledBy={titleId} onClose={requestCloseSheet} closing={closing}>
        <SheetHeader
          id={titleId}
          title={title}
          onClose={requestCloseSheet}
          leading={<IconButton icon={ArrowLeft} label="Back to the form" onClick={() => setView('form')} size={42} />}
        />
        <SheetBody>
          <p className="text-[15px] leading-relaxed text-white/70">
            Copy the confirmation SMS from your phone and paste it below. SpendNote reads only the text you paste here.
            It can’t open your SMS inbox or your MoMo account.
          </p>
          <Field label="Message" htmlFor={id('paste')} className="mt-5">
            <TextArea
              id={id('paste')}
              data-autofocus
              value={pasteText}
              onChange={(e) => {
                setPasteText(e.target.value);
                setPasteFailed(false);
              }}
              minRows={6}
              maxRows={12}
              placeholder="e.g. Payment made for GHS 45.00 to … Transaction ID: …"
              spellCheck={false}
            />
          </Field>
          {canReadClipboard && (
            <Button
              size="sm"
              variant="ghost"
              icon={ClipboardPaste}
              className="mt-2"
              onClick={async () => {
                try {
                  const t = await navigator.clipboard.readText();
                  if (t) setPasteText(t);
                  else toast('Your clipboard is empty.');
                } catch {
                  toast('Your browser didn’t allow reading the clipboard. Long-press the box and choose Paste.', { tone: 'error' });
                }
              }}
            >
              Paste from clipboard
            </Button>
          )}
          {pasteFailed && (
            <Callout
              tone="warn"
              className="mt-4"
              title={pasteText.trim() ? 'We couldn’t find a transaction in this message' : 'Paste a message first'}
              action={
                pasteText.trim() ? (
                  <Button size="sm" variant="white" onClick={enterManually}>
                    Enter details myself
                  </Button>
                ) : undefined
              }
            >
              {pasteText.trim()
                ? 'Check that you copied the whole confirmation message. Or enter the details yourself. We’ll keep the message with the entry.'
                : 'Copy the confirmation text from your messages app, then paste it in the box above.'}
            </Callout>
          )}
        </SheetBody>
        <SheetFooter>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setView('form')}>
              Cancel
            </Button>
            <Button variant="primary" className="flex-[1.4]" onClick={readMessage}>
              Read message
            </Button>
          </div>
        </SheetFooter>
      </Sheet>
    );
  }

  const p = momo?.parse;
  const flag = (status: 'found' | 'check' | 'missing' | undefined, note?: string) =>
    status === 'check' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-300/10 px-2 py-0.5 text-[12px] font-semibold text-amber-300">
        <TriangleAlert size={12} strokeWidth={2} aria-hidden /> Check{note ? <span className="sr-only">: {note}</span> : null}
      </span>
    ) : status === 'found' ? (
      <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[12px] font-medium text-white/70">From message</span>
    ) : null;

  const feeLine =
    savedAmount !== null && feeValue > 0
      ? s.type === 'expense'
        ? `You’ll record ${money(savedAmount)} + ${money(feeValue)} fee = ${money(savedAmount + feeValue)} spent.`
        : s.type === 'income'
          ? `You’ll record ${money(savedAmount)} received. The ${money(feeValue)} fee counts as spending.`
          : `You’ll record a ${money(savedAmount)} transfer. Only the ${money(feeValue)} fee counts as spending.`
      : null;

  return (
    <Sheet labelledBy={titleId} onClose={requestCloseSheet} closing={closing}>
      <SheetHeader id={titleId} title={title} onClose={requestCloseSheet} />
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-1 sm:px-7">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
          className="space-y-6"
        >
          {!existing && !momo && (
            <button
              type="button"
              onClick={() => setView('paste')}
              className="flex w-full items-center gap-3 rounded-[20px] border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.06]"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.07]">
                <ClipboardPaste size={19} strokeWidth={1.6} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-white">Paste a MoMo message</span>
                <span className="block text-[13px] text-white/60">Fill this in from a confirmation SMS you copy</span>
              </span>
            </button>
          )}

          {momo && p && (
            <section aria-label="Details read from your MoMo message" className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.07]">
                  <Smartphone size={19} strokeWidth={1.6} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-white">Read from your MoMo message</p>
                  <p className="mt-0.5 text-[14px] leading-snug text-white/65">
                    We filled in what we found. Check everything before saving, especially anything marked “Check”.
                  </p>
                </div>
                <IconButton
                  icon={X}
                  label="Clear message details"
                  size={36}
                  tone="ghost"
                  onClick={() => {
                    setMomo(null);
                    setS((prev) => ({ ...prev, importRef: null, sourceText: null }));
                  }}
                />
              </div>
              {[
                p.amount.status !== 'found' && p.amount.note,
                p.date.status !== 'found' && p.date.note,
                p.party.status !== 'found' && p.party.note,
                p.reference.status !== 'found' && p.reference.note,
                p.direction.status !== 'found' && p.direction.note,
              ].filter(Boolean).length > 0 && (
                <ul className="mt-3 space-y-1.5 text-[14px] text-white/75">
                  {[
                    p.amount.status !== 'found' && p.amount.note,
                    p.date.status !== 'found' && p.date.note,
                    p.party.status !== 'found' && p.party.note,
                    p.reference.status !== 'found' && p.reference.note,
                    p.direction.status !== 'found' && p.direction.note,
                  ]
                    .filter(Boolean)
                    .map((n) => (
                      <li key={n as string} className="flex gap-2">
                        <TriangleAlert size={15} strokeWidth={1.8} className="mt-[3px] shrink-0 text-amber-300" aria-hidden />
                        {n}
                      </li>
                    ))}
                </ul>
              )}
              {(p.messageNote || p.balanceAfter !== null || s.importRef) && (
                <dl className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3 text-[14px]">
                  {s.importRef && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-white/60">Transaction ID</dt>
                      <dd className="tnum truncate text-white">{s.importRef}</dd>
                    </div>
                  )}
                  {p.balanceAfter !== null && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-white/60">Balance after (from message)</dt>
                      <dd className="tnum text-white">{money(p.balanceAfter)}</dd>
                    </div>
                  )}
                  {p.messageNote && (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-white/60">Reference in message</dt>
                      <dd className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-white">“{p.messageNote}”</span>
                        {!s.comment.includes(p.messageNote) && (
                          <button
                            type="button"
                            onClick={() => set('comment', s.comment ? `${s.comment} ${p.messageNote}` : p.messageNote!)}
                            className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-white/10"
                          >
                            Use in note
                          </button>
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              <details className="group mt-3 rounded-2xl bg-black/30">
                <summary className="flex items-center justify-between px-3.5 py-2.5 text-[14px] font-medium text-white/80">
                  Original message
                  <span className="text-[12px] text-white/50 group-open:hidden">Show</span>
                  <span className="hidden text-[12px] text-white/50 group-open:inline">Hide</span>
                </summary>
                <p className="whitespace-pre-wrap break-words px-3.5 pb-3.5 font-mono text-[13px] leading-relaxed text-white/75">
                  {s.sourceText}
                </p>
              </details>
            </section>
          )}

          {momo && p && (
            <fieldset id={id('kind')} tabIndex={-1} aria-describedby={shownErrors.kind ? `${id('kind')}-error` : undefined}>
              <legend className="mb-2.5 text-[15px] font-medium text-white">What kind of transaction is this?</legend>
              <div className="grid grid-cols-1 gap-2">
                {(
                  [
                    ['expense', 'Expense', 'Money I spent. Counts as spending.'],
                    ['income', 'Money in', 'Money I received. Not spending.'],
                    ['transfer', 'Transfer', 'Moved between my own accounts. Not spending.'],
                  ] as const
                ).map(([value, label, desc]) => (
                  <label
                    key={value}
                    className={cx(
                      'flex items-start gap-3 rounded-2xl border px-4 py-3 transition-colors',
                      momo.typeChoice === value ? 'border-white bg-white/[0.07]' : 'border-white/[0.09] hover:bg-white/[0.03]',
                    )}
                  >
                    <input
                      type="radio"
                      name={id('kind-radio')}
                      checked={momo.typeChoice === value}
                      onChange={() => chooseKind(value)}
                      className="mt-1 h-4 w-4 accent-[#ff6a1a]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium text-white">
                        {label}
                        {!p.typeCertain && p.suggestedType === value && (
                          <span className="ml-2 text-[12px] font-semibold text-flame-300">Suggested</span>
                        )}
                      </span>
                      <span className="block text-[13px] text-white/60">{desc}</span>
                    </span>
                  </label>
                ))}
              </div>
              {shownErrors.kind && (
                <p id={`${id('kind')}-error`} className="mt-2 text-[14px] text-danger-300">
                  {shownErrors.kind}
                </p>
              )}
            </fieldset>
          )}

          {showTypeTabs && (
            <Segmented
              label="Entry type"
              value={s.type}
              onChange={(t) => set('type', t)}
              className="flex w-full"
              options={[
                { value: 'expense', label: 'Expense' },
                { value: 'income', label: 'Money in' },
                { value: 'transfer', label: 'Transfer' },
              ]}
            />
          )}

          {/* Amount */}
          <div
            className={cx(
              'rounded-[28px] border bg-[radial-gradient(120%_140%_at_50%_120%,rgba(255,106,26,0.16)_0%,rgba(18,18,18,0)_60%)] px-4 pb-5 pt-4 text-center transition-colors',
              shownErrors.amount ? 'border-danger-400/60' : 'border-white/[0.08] focus-within:border-flame-400/60',
            )}
          >
            <div className="flex items-center justify-center gap-2">
              <label htmlFor={id('amount')} className="text-[14px] font-medium text-white/70">
                Amount
              </label>
              {momo && flag(p?.amount.status, p?.amount.note)}
            </div>
            <div className="mt-1.5 flex items-baseline justify-center gap-1.5">
              <span aria-hidden className="text-[26px] font-medium text-white/65">
                {symbol}
              </span>
              <input
                ref={amountRef}
                id={id('amount')}
                data-autofocus={existing ? undefined : true}
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                placeholder="0.00"
                value={s.amount}
                onChange={(e) => set('amount', e.target.value.replace(/[^\d.,]/g, ''))}
                aria-invalid={!!shownErrors.amount || undefined}
                aria-describedby={describedBy(id('amount'), shownErrors.amount)}
                className="tnum min-w-0 bg-transparent text-center text-[46px] font-[450] leading-tight tracking-[-0.035em] text-white outline-none placeholder:text-white/25"
                style={{ width: `${Math.min(14, Math.max(4, s.amount.length + 0.5))}ch` }}
              />
            </div>
            {shownErrors.amount && (
              <p id={`${id('amount')}-error`} className="mt-1 text-[14px] text-danger-300">
                {shownErrors.amount}
              </p>
            )}
          </div>

          {/* Fee */}
          {s.showFee ? (
            <div className="space-y-3">
              <Field
                label="Transaction fee"
                htmlFor={id('fee')}
                error={shownErrors.fee}
                hint="Counted as spending under Fees & charges, separately from the amount."
                labelExtra={
                  <div className="flex items-center gap-2">
                    {momo && flag(p?.feeTotal ? 'found' : undefined)}
                    {!momo && (
                      <button
                        type="button"
                        onClick={() => setS((prev) => ({ ...prev, showFee: false, fee: '' }))}
                        className="text-[13px] font-medium text-white/60 underline underline-offset-4 hover:text-white"
                      >
                        Remove fee
                      </button>
                    )}
                  </div>
                }
              >
                <div className="relative">
                  <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/55">
                    {symbol}
                  </span>
                  <TextInput
                    id={id('fee')}
                    inputMode="decimal"
                    autoComplete="off"
                    value={s.fee}
                    onChange={(e) => set('fee', e.target.value.replace(/[^\d.,]/g, ''))}
                    invalid={!!shownErrors.fee}
                    aria-describedby={describedBy(id('fee'), shownErrors.fee, true)}
                    className="tnum pl-14"
                    placeholder="0.00"
                  />
                </div>
              </Field>
              {momo && feeValue > 0 && p?.feeIncluded === 'unknown' && (
                <fieldset id={id('feeMode')} tabIndex={-1}>
                  <legend className="mb-2 text-[14px] text-white/80">
                    Is the {money(feeValue)} fee already included in the amount{parsedAmount.ok ? ` of ${money(parsedAmount.value)}` : ''}?
                  </legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(
                      [
                        ['ontop', 'No, charged on top'],
                        ['included', 'Yes, it’s included'],
                      ] as const
                    ).map(([v, label]) => (
                      <label
                        key={v}
                        className={cx(
                          'flex items-center gap-3 rounded-2xl border px-4 py-3 text-[14px] font-medium',
                          momo.feeMode === v ? 'border-white bg-white/[0.07] text-white' : 'border-white/[0.09] text-white/85',
                        )}
                      >
                        <input
                          type="radio"
                          name={id('feeMode-radio')}
                          checked={momo.feeMode === v}
                          onChange={() => setMomo({ ...momo, feeMode: v })}
                          className="h-4 w-4 accent-[#ff6a1a]"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  {shownErrors.feeMode && <p className="mt-2 text-[14px] text-danger-300">{shownErrors.feeMode}</p>}
                </fieldset>
              )}
              {feeLine && (momo?.feeMode !== null || !momo) && (
                <p className="tnum rounded-2xl bg-white/[0.04] px-4 py-3 text-[14px] text-white/80">{feeLine}</p>
              )}
            </div>
          ) : null}

          {/* Comment */}
          <Field
            label={s.type === 'expense' ? 'What was this for?' : 'Note'}
            htmlFor={id('comment')}
            error={shownErrors.comment}
            hint={
              s.type === 'expense'
                ? 'Optional. You can add it later, but a quick note now helps when you look back.'
                : 'Optional. Say what this was for.'
            }
          >
            <TextArea
              id={id('comment')}
              value={s.comment}
              onChange={(e) => set('comment', e.target.value)}
              minRows={2}
              maxRows={8}
              maxLength={1200}
              placeholder={s.type === 'expense' ? 'e.g. Vegetables and other things for the week' : ''}
              invalid={!!shownErrors.comment}
              aria-describedby={describedBy(id('comment'), shownErrors.comment, true)}
            />
          </Field>

          {/* Category */}
          {s.type === 'expense' && (
            <fieldset>
              <legend className="mb-2.5 text-[15px] font-medium text-white">
                Category
                {s.categoryId === null && <span className="ml-2 text-[13px] font-normal text-white/60">Other, if you don’t pick one</span>}
              </legend>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => {
                  const Icon = CATEGORY_ICONS[c.icon] ?? CATEGORY_ICONS.shapes;
                  return (
                    <Chip
                      key={c.id}
                      selected={s.categoryId === c.id}
                      onClick={() => set('categoryId', s.categoryId === c.id ? null : c.id)}
                      icon={
                        <span
                          aria-hidden
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                          style={{ background: c.color, color: '#121212' }}
                        >
                          <Icon size={13} strokeWidth={2} />
                        </span>
                      }
                    >
                      {c.name}
                    </Chip>
                  );
                })}
                {newCat === null ? (
                  <button
                    type="button"
                    onClick={() => setNewCat('')}
                    className="inline-flex h-11 items-center gap-1.5 rounded-full border border-dashed border-white/20 px-3.5 text-[14px] font-medium text-white/75 hover:border-white/40 hover:text-white"
                  >
                    <Plus size={16} strokeWidth={1.8} aria-hidden /> New category
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-2">
                    <label htmlFor={id('newcat')} className="sr-only">
                      New category name
                    </label>
                    <TextInput
                      id={id('newcat')}
                      autoFocus
                      value={newCat}
                      maxLength={40}
                      placeholder="Category name, e.g. Church"
                      onChange={(e) => setNewCat(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCategory();
                        }
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setNewCat(null);
                        }
                      }}
                      className="h-11 flex-1 rounded-full"
                    />
                    <Button size="sm" variant="white" onClick={addCategory} disabled={!newCat.trim()}>
                      Add
                    </Button>
                    <IconButton icon={X} label="Cancel new category" size={40} tone="ghost" onClick={() => setNewCat(null)} />
                  </div>
                )}
              </div>
            </fieldset>
          )}

          {/* Payment method */}
          <fieldset>
            <legend className="mb-2.5 text-[15px] font-medium text-white">
              {s.type === 'income' ? 'Received by' : s.type === 'transfer' ? 'Moved by' : 'Paid with'}
            </legend>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <Chip
                  key={m.id}
                  selected={s.method === m.id}
                  onClick={() => set('method', m.id)}
                  icon={<MethodIcon method={m.id} size={17} />}
                >
                  {m.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          {/* Date */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              label="Date"
              htmlFor={id('date')}
              error={shownErrors.date}
              labelExtra={momo ? flag(p?.date.status, p?.date.note) : undefined}
              hint={momo && p?.date.status !== 'found' ? p?.date.note : undefined}
            >
              <TextInput
                id={id('date')}
                type="date"
                value={s.date}
                onChange={(e) => set('date', e.target.value)}
                invalid={!!shownErrors.date}
                aria-describedby={describedBy(id('date'), shownErrors.date, momo && p?.date.status !== 'found' ? true : undefined)}
              />
              <div className="mt-2 flex gap-2">
                {[
                  [today, 'Today'],
                  [addDays(today, -1), 'Yesterday'],
                ].map(([d, label]) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={s.date === d}
                    onClick={() => set('date', d)}
                    className={cx(
                      'h-9 rounded-full px-3.5 text-[13px] font-medium',
                      s.date === d ? 'bg-white text-black' : 'bg-white/[0.06] text-white/80 hover:bg-white/10',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            {s.time !== null ? (
              <Field
                label="Time"
                htmlFor={id('time')}
                error={shownErrors.time}
                labelExtra={
                  <button
                    type="button"
                    onClick={() => set('time', null)}
                    className="text-[13px] font-medium text-white/60 underline underline-offset-4 hover:text-white"
                  >
                    Remove
                  </button>
                }
              >
                <TextInput
                  id={id('time')}
                  type="time"
                  value={s.time}
                  onChange={(e) => set('time', e.target.value)}
                  invalid={!!shownErrors.time}
                />
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
          </div>

          {/* Payee */}
          <Field
            label={
              <>
                {s.type === 'income' ? 'From' : s.type === 'transfer' ? 'Title' : 'Title or payee'}{' '}
                <span className="font-normal text-white/55">(optional)</span>
              </>
            }
            htmlFor={id('payee')}
            error={shownErrors.payee}
            labelExtra={momo && s.type !== 'transfer' ? flag(p?.party.status, p?.party.note) : undefined}
          >
            <TextInput
              id={id('payee')}
              value={s.payee}
              maxLength={100}
              onChange={(e) => set('payee', e.target.value)}
              placeholder={s.type === 'income' ? 'e.g. Salary, or who sent it' : 'e.g. Makola market'}
              invalid={!!shownErrors.payee}
              autoComplete="off"
            />
          </Field>

          {/* Accounts */}
          {s.type === 'transfer' ? (
            <div id={id('transfer')} tabIndex={-1} className="space-y-4 outline-none">
              {accounts.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="From" htmlFor={id('from')}>
                    <Select id={id('from')} value={s.accountId} onChange={(e) => set('accountId', e.target.value)} invalid={!!shownErrors.transfer}>
                      <option value="">Not listed</option>
                      {accountOptions(accounts)}
                    </Select>
                  </Field>
                  <Field label="To" htmlFor={id('to')}>
                    <Select id={id('to')} value={s.toAccountId} onChange={(e) => set('toAccountId', e.target.value)} invalid={!!shownErrors.transfer}>
                      <option value="">Not listed</option>
                      {accountOptions(accounts)}
                    </Select>
                  </Field>
                </div>
              )}
              {shownErrors.transfer ? (
                <p className="text-[14px] text-danger-300">{shownErrors.transfer}</p>
              ) : (
                <p className="text-[13px] leading-snug text-white/60">
                  Transfers move money between your own accounts. They’re saved as one linked record and never count as
                  spending. Only a fee does.
                </p>
              )}
            </div>
          ) : accounts.length > 0 ? (
            <Field
              label={
                <>
                  {s.type === 'income' ? 'Received into' : 'Paid from account'}{' '}
                  <span className="font-normal text-white/55">(optional)</span>
                </>
              }
              htmlFor={id('account')}
            >
              <Select id={id('account')} value={s.accountId} onChange={(e) => set('accountId', e.target.value)}>
                <option value="">Not linked to an account</option>
                {accountOptions(accounts)}
              </Select>
            </Field>
          ) : null}

          {!s.showFee && (
            <button
              type="button"
              onClick={() => set('showFee', true)}
              className="inline-flex items-center gap-1.5 rounded-full px-1 text-[14px] font-medium text-white/75 underline decoration-white/25 underline-offset-4 hover:text-white"
            >
              <Plus size={15} strokeWidth={1.8} aria-hidden /> Add a transaction fee
            </button>
          )}

          {existing && s.type === 'expense' && (
            <div className="rounded-[20px] border border-white/[0.07] bg-white/[0.03] p-4">
              <Switch
                checked={s.reviewed}
                onChange={(v) => set('reviewed', v)}
                label="Marked as reviewed"
                description="Separate from the note. You can mark an expense reviewed even if it has no note."
              />
            </div>
          )}

          {existing?.sourceText && !momo && (
            <details className="group rounded-[20px] border border-white/[0.07] bg-white/[0.03]">
              <summary className="flex items-center gap-2 px-4 py-3 text-[14px] font-medium text-white/80">
                <MessageSquareText size={16} strokeWidth={1.6} aria-hidden />
                Original MoMo message
              </summary>
              <p className="whitespace-pre-wrap break-words px-4 pb-4 font-mono text-[13px] leading-relaxed text-white/75">
                {existing.sourceText}
              </p>
            </details>
          )}

          {duplicates.length > 0 && (
            <Callout
              tone="warn"
              title={duplicates.some((d) => d.reason === 'reference') ? 'You may have saved this already' : 'This looks similar to an entry you have'}
            >
              <ul className="space-y-1">
                {duplicates.map((d) => {
                  const l = labels(d.tx);
                  return (
                    <li key={d.tx.id} className="tnum">
                      {l.title} · {money(d.tx.amount)} · {formatShortDate(d.tx.date, today)}
                      {d.tx.time ? `, ${formatTime(d.tx.time)}` : ''}
                      {d.reason === 'reference' ? ' · same transaction ID' : ' · same amount, name and date'}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2">Nothing is removed automatically. Save anyway if this is a separate transaction.</p>
            </Callout>
          )}

          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </div>
      <SheetFooter>
        {attempted && Object.keys(errors).length > 0 && (
          <p role="alert" className="mb-3 text-center text-[14px] text-danger-300">
            Please fix the highlighted {Object.keys(errors).length === 1 ? 'field' : 'fields'}. Nothing you typed was lost.
          </p>
        )}
        <div className="flex gap-3">
          {existing ? (
            <>
              <IconButton icon={Trash2} label={`Delete this ${typeName}`} size={48} tone="dark" onClick={remove} className="text-danger-300" />
              <Button variant="primary" className="flex-1" onClick={() => submit(false)} disabled={saving}>
                {saving ? 'Saving…' : duplicates.length ? 'Save anyway' : 'Save changes'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" className="flex-1 whitespace-nowrap !px-3 !text-[14px]" onClick={() => submit(true)} disabled={saving}>
                Save &amp; add another
              </Button>
              <Button variant="primary" className="flex-1" onClick={() => submit(false)} disabled={saving}>
                {saving ? 'Saving…' : duplicates.length ? 'Save anyway' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </SheetFooter>
    </Sheet>
  );
}
