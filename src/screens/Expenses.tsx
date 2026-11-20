import { ClipboardPaste, PenLine, Plus, ReceiptText, RotateCcw, Search, SearchX, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  compareTxDesc, EMPTY_FILTER, filterTotals, matchesFilter, spendingParts, type TxFilter, type TypeFilter,
} from '../lib/calc';
import { sortCategories } from '../lib/categories';
import {
  addDays, formatDayHeading, formatRange, isValidISODate, periodContaining, shiftPeriod,
} from '../lib/dates';
import { METHOD_LABEL, PAYMENT_METHODS, type PaymentMethod } from '../lib/types';
import { TxRow, useMoney } from '../components/TxRow';
import { Button, cx, EmptyState, Select, TextInput } from '../components/ui';
import { useData } from '../state/data';
import { useToday } from '../state/hooks';
import { navigate, useRoute, type Params } from '../state/router';
import { useUi } from '../state/ui';

const TYPES: { value: TypeFilter; label: string }[] = [
  { value: 'spending', label: 'Spending' },
  { value: 'income', label: 'Money in' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'all', label: 'Everything' },
];

function parseFilter(params: URLSearchParams): TxFilter {
  const d = (k: string) => {
    const v = params.get(k);
    return v && isValidISODate(v) ? v : null;
  };
  const method = params.get('method');
  const type = params.get('type');
  return {
    q: params.get('q') ?? '',
    from: d('from'),
    to: d('to'),
    categoryId: params.get('cat') || null,
    method: PAYMENT_METHODS.some((m) => m.id === method) ? (method as PaymentMethod) : null,
    type: TYPES.some((t) => t.value === type) ? (type as TypeFilter) : 'spending',
    missingNote: params.get('missing') === '1',
  };
}

function toParams(f: TxFilter): Params {
  return {
    q: f.q.trim() || null,
    from: f.from,
    to: f.to,
    cat: f.categoryId,
    method: f.method,
    type: f.type === 'spending' ? null : f.type,
    missing: f.missingNote,
  };
}

const PAGE = 60;

export function Expenses() {
  const route = useRoute();
  const today = useToday();
  const money = useMoney();
  const { data, knownCategories, categoryMap } = useData();
  const { openSheet } = useUi();
  const f = useMemo(() => parseFilter(route.params), [route.params]);
  const update = (patch: Partial<TxFilter>) => navigate('expenses', toParams({ ...f, ...patch }), { replace: true });

  // Search updates the URL shortly after typing stops.
  const [q, setQ] = useState(f.q);
  useEffect(() => setQ(f.q), [f.q]);
  useEffect(() => {
    if (q === f.q) return;
    const t = window.setTimeout(() => update({ q }), 220);
    return () => window.clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const presets = useMemo(() => {
    const w = periodContaining('week', today);
    const m = periodContaining('month', today);
    const lw = shiftPeriod(w, -1);
    const lm = shiftPeriod(m, -1);
    return [
      { id: 'all', label: 'All time', from: null, to: null },
      { id: 'this-week', label: 'This week', from: w.start, to: w.end },
      { id: 'last-week', label: 'Last week', from: lw.start, to: lw.end },
      { id: 'this-month', label: 'This month', from: m.start, to: m.end },
      { id: 'last-month', label: 'Last month', from: lm.start, to: lm.end },
      { id: 'last-90', label: 'Last 90 days', from: addDays(today, -89), to: today },
    ] as { id: string; label: string; from: string | null; to: string | null }[];
  }, [today]);
  const matchedPreset = presets.find((p) => p.from === f.from && p.to === f.to)?.id ?? 'custom';
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = matchedPreset === 'custom' || customOpen;

  const results = useMemo(
    () => data.transactions.filter((t) => matchesFilter(t, f, knownCategories)).sort(compareTxDesc),
    [data.transactions, f, knownCategories],
  );
  const totals = useMemo(() => filterTotals(results, f, knownCategories), [results, f, knownCategories]);

  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [route.params]);

  const groups = useMemo(() => {
    const out: { date: string; items: typeof results; spend: number }[] = [];
    for (const t of results.slice(0, limit)) {
      let g = out[out.length - 1];
      if (!g || g.date !== t.date) {
        g = { date: t.date, items: [], spend: 0 };
        out.push(g);
      }
      g.items.push(t);
      for (const p of spendingParts(t, knownCategories)) if (!f.categoryId || p.categoryId === f.categoryId) g.spend += p.amount;
    }
    return out;
  }, [results, limit, f.categoryId, knownCategories]);

  const rangeLabel = f.from || f.to
    ? f.from && f.to
      ? formatRange(f.from, f.to)
      : f.from
        ? `From ${formatRange(f.from, f.from)}`
        : `Up to ${formatRange(f.to!, f.to!)}`
    : 'All time';

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (f.q.trim()) chips.push({ key: 'q', label: `“${f.q.trim()}”`, clear: () => { setQ(''); update({ q: '' }); } });
  if (f.from || f.to) chips.push({ key: 'date', label: presets.find((p) => p.id === matchedPreset)?.label ?? rangeLabel, clear: () => { setCustomOpen(false); update({ from: null, to: null }); } });
  if (f.categoryId) chips.push({ key: 'cat', label: categoryMap.get(f.categoryId)?.name ?? 'Unknown category', clear: () => update({ categoryId: null }) });
  if (f.method) chips.push({ key: 'method', label: METHOD_LABEL[f.method], clear: () => update({ method: null }) });
  if (f.type !== 'spending') chips.push({ key: 'type', label: TYPES.find((t) => t.value === f.type)!.label, clear: () => update({ type: 'spending' }) });
  if (f.missingNote) chips.push({ key: 'missing', label: 'Missing notes', clear: () => update({ missingNote: false }) });

  const reset = () => {
    setQ('');
    setCustomOpen(false);
    navigate('expenses', toParams(EMPTY_FILTER), { replace: true });
  };

  const categories = sortCategories(data.categories);
  const catName = f.categoryId ? categoryMap.get(f.categoryId)?.name : null;

  return (
    <>
      <header className="mb-5 flex items-end justify-between gap-4 md:mb-8">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] md:text-[32px]">Expenses</h1>
          <p className="mt-1 text-[15px] text-white/60">Search, filter and edit everything you’ve recorded.</p>
        </div>
        <div className="hidden gap-3 md:flex">
          <Button icon={ClipboardPaste} onClick={() => openSheet({ kind: 'tx-new', paste: true })}>
            Paste a MoMo message
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => openSheet({ kind: 'tx-new' })}>
            Add expense
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
        <div className="min-w-0 lg:order-2">
          <div className="space-y-4 lg:sticky lg:top-8">
            <div className="relative">
              <Search size={19} strokeWidth={1.7} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/55" />
              <label htmlFor="exp-search" className="sr-only">
                Search titles, payees and notes
              </label>
              <TextInput
                id="exp-search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search titles, payees and notes"
                className="h-[52px] rounded-full pl-12 pr-12 [&::-webkit-search-cancel-button]:hidden"
                enterKeyHint="search"
              />
              {q && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setQ('');
                    update({ q: '' });
                  }}
                  className="absolute right-2 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.07] hover:text-white"
                >
                  <X size={18} strokeWidth={1.8} aria-hidden />
                </button>
              )}
            </div>

            <div
              role="group"
              aria-label="Filters"
              className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 lg:grid lg:grid-cols-1 lg:gap-3"
            >
              <label htmlFor="f-date" className="sr-only">Date range</label>
              <Select
                id="f-date"
                compact
                className="w-[168px] shrink-0 lg:w-full"
                value={customOpen ? 'custom' : matchedPreset}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'custom') {
                    setCustomOpen(true);
                    if (!f.from && !f.to) {
                      const m = periodContaining('month', today);
                      update({ from: m.start, to: m.end });
                    }
                    return;
                  }
                  setCustomOpen(false);
                  const p = presets.find((x) => x.id === v)!;
                  update({ from: p.from, to: p.to });
                }}
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">{matchedPreset === 'custom' ? `Custom: ${rangeLabel}` : 'Custom range…'}</option>
              </Select>
              <label htmlFor="f-cat" className="sr-only">Category</label>
              <Select
                id="f-cat"
                compact
                className="w-[180px] shrink-0 lg:w-full"
                value={f.categoryId ?? ''}
                onChange={(e) => update({ categoryId: e.target.value || null })}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <label htmlFor="f-method" className="sr-only">Payment method</label>
              <Select
                id="f-method"
                compact
                className="w-[150px] shrink-0 lg:w-full"
                value={f.method ?? ''}
                onChange={(e) => update({ method: (e.target.value || null) as PaymentMethod | null })}
              >
                <option value="">All methods</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
              <label htmlFor="f-type" className="sr-only">Entry type</label>
              <Select
                id="f-type"
                compact
                className="w-[150px] shrink-0 lg:w-full"
                value={f.type}
                onChange={(e) => update({ type: e.target.value as TypeFilter })}
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                aria-pressed={f.missingNote}
                onClick={() => update({ missingNote: !f.missingNote })}
                className={cx(
                  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border px-4 text-[15px] font-medium transition-colors',
                  f.missingNote ? 'border-white bg-white text-black' : 'border-white/[0.08] bg-ink-800 text-white/85 hover:bg-ink-750',
                )}
              >
                <PenLine size={16} strokeWidth={1.7} aria-hidden />
                Missing notes
              </button>
            </div>

            {showCustom && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="f-from" className="mb-1.5 block text-[13px] font-medium text-white/70">From</label>
                  <TextInput
                    id="f-from"
                    type="date"
                    value={f.from ?? ''}
                    max={f.to ?? undefined}
                    onChange={(e) => update({ from: e.target.value || null })}
                  />
                </div>
                <div>
                  <label htmlFor="f-to" className="mb-1.5 block text-[13px] font-medium text-white/70">To</label>
                  <TextInput
                    id="f-to"
                    type="date"
                    value={f.to ?? ''}
                    min={f.from ?? undefined}
                    onChange={(e) => update({ to: e.target.value || null })}
                  />
                </div>
                {f.from && f.to && f.from > f.to && (
                  <p className="col-span-2 text-[14px] text-danger-300">The start date is after the end date, so nothing can match.</p>
                )}
              </div>
            )}

            <div className="surface rounded-[24px] p-4 sm:p-5">
              <p className="text-[14px] text-white/65">
                {catName ? `Spent on ${catName}` : f.type === 'income' ? 'Spending (fees only)' : f.type === 'transfer' ? 'Spending (transfer fees only)' : 'Spent'} · {rangeLabel}
              </p>
              <p className="tnum mt-1 text-[30px] font-semibold leading-tight tracking-[-0.025em] text-white" aria-live="polite">
                {money(totals.spending)}
              </p>
              <p className="tnum mt-1 text-[14px] text-white/60">
                {results.length} {results.length === 1 ? 'entry' : 'entries'}
                {totals.moneyIn > 0 && <> · <span className="text-mint-400">{money(totals.moneyIn, { signed: true })}</span> money in</>}
                {totals.transfers > 0 && <> · {money(totals.transfers)} moved</>}
              </p>
              {(f.type === 'income' || f.type === 'transfer' || f.type === 'all') && (
                <p className="mt-2 text-[13px] leading-snug text-white/55">Money in and transfers never count as spending; only their fees do.</p>
              )}
            </div>

            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
                {chips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={c.clear}
                    aria-label={`Remove filter: ${c.label}`}
                    className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] pl-3.5 pr-2.5 text-[13px] font-medium text-white hover:bg-white/[0.09]"
                  >
                    <span className="truncate">{c.label}</span>
                    <X size={14} strokeWidth={2} aria-hidden className="shrink-0 text-white/60" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold text-flame-300 hover:text-flame-200"
                >
                  <RotateCcw size={14} strokeWidth={2} aria-hidden />
                  Reset filters
                </button>
              </div>
            )}
          </div>
        </div>

        <section aria-label="Results" className="min-w-0 lg:order-1">
          {data.transactions.length === 0 ? (
            <div className="surface rounded-[28px]">
              <EmptyState
                icon={ReceiptText}
                title="No expenses yet"
                action={
                  <Button variant="primary" icon={Plus} onClick={() => openSheet({ kind: 'tx-new' })}>
                    Add expense
                  </Button>
                }
              >
                Everything you record shows up here, grouped by day.
              </EmptyState>
            </div>
          ) : results.length === 0 ? (
            <div className="surface rounded-[28px]">
              <EmptyState
                icon={SearchX}
                title="Nothing matches these filters"
                action={
                  <Button variant="secondary" icon={RotateCcw} onClick={reset}>
                    Reset filters
                  </Button>
                }
              >
                Try a different date range or search word.
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="space-y-7">
                {groups.map((g) => (
                  <section key={g.date} aria-labelledby={`day-${g.date}`}>
                    <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
                      <h2 id={`day-${g.date}`} className="text-[15px] font-semibold text-white">
                        {formatDayHeading(g.date, today)}
                      </h2>
                      {g.spend > 0 && (
                        <p className="tnum text-[14px] text-white/60">
                          <span className="sr-only">Spent that day: </span>
                          {money(g.spend)}
                        </p>
                      )}
                    </div>
                    <ul className="space-y-2.5">
                      {g.items.map((t) => (
                        <li key={t.id}>
                          <TxRow tx={t} today={today} showDate={false} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              {results.length > limit && (
                <div className="mt-8 flex justify-center">
                  <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>
                    Show more ({results.length - limit} left)
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
