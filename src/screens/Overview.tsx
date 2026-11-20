import {
  ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CirclePlus,
  ClipboardPaste, ListFilter, PenLine, Plus, ReceiptText,
} from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import {
  categoryBreakdown, compareTxDesc, dailySeries, isMissingNote, needsAttention, totalSpending,
} from '../lib/calc';
import {
  formatLongDate, formatRange, isValidISODate, periodContaining, periodTitle, shiftPeriod, type Period, type PeriodKind,
} from '../lib/dates';
import { currencyInfo } from '../lib/money';
import { CategoryBadge, LogoMark } from '../components/icons';
import { ReminderBanner } from '../components/ReminderBanner';
import { TrendBars } from '../components/TrendBars';
import { TxRow, useMoney } from '../components/TxRow';
import { Button, Card, cx, EmptyState, IconButton, Segmented, SectionHeader } from '../components/ui';
import { useData } from '../state/data';
import { setSlabVisible } from '../state/dock';
import { useAnimatedNumber, useLocalStorage, useToday } from '../state/hooks';
import { hrefFor, navigate, useRoute } from '../state/router';
import { useUi } from '../state/ui';

const KINDS = ['week', 'month'] as const;

/** Estimated width of the formatted total in ems, so the big number always fits on one line. */
function totalEm(text: string, symbol: string): number {
  const rest = text.slice(symbol.length);
  let em = symbol.trim().length * 0.66 * 0.62 + 0.12;
  for (const ch of rest) em += /\d/.test(ch) ? 0.6 : 0.27;
  return em;
}

function SummaryCard({ period, today, setPeriod }: { period: Period; today: string; setPeriod: (p: Period) => void }) {
  const { data } = useData();
  const { openSheet } = useUi();
  const money = useMoney();
  const currency = currencyInfo(data.settings.currency);
  const total = useMemo(() => totalSpending(data.transactions, period.start, period.end), [data.transactions, period]);
  const shown = useAnimatedNumber(total);
  const series = useMemo(() => dailySeries(data.transactions, period.start, period.end), [data.transactions, period]);
  const current = periodContaining(period.kind, today);
  const isCurrent = period.start === current.start;
  const latest = data.transactions.reduce((m, t) => (t.date > m ? t.date : m), today);
  const canNext = shiftPeriod(period, 1).start <= latest;
  const title = periodTitle(period, today);
  const finalText = money(total);
  const em = totalEm(finalText, currency.symbol);
  const shownText = money(shown).slice(currency.symbol.length);

  const slab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = slab.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setSlabVisible(e.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => {
      io.disconnect();
      setSlabVisible(false);
    };
  }, []);

  return (
    <section aria-labelledby="summary-title" className="relative">
      <div className="summary-card @container relative z-10 rounded-[34px] border border-white/[0.06] px-5 pb-6 pt-5 sm:px-6">
        <div className="flex items-start justify-between">
          <LogoMark size={56} />
          <IconButton
            icon={ListFilter}
            label={`See expenses for ${title.toLowerCase()}`}
            tone="black"
            size={56}
            iconSize={24}
            onClick={() => navigate('expenses', { from: period.start, to: period.end })}
          />
        </div>

        <div className="mt-1 text-center">
          <h2 id="summary-title" className="text-[15px] font-medium text-white/85">
            Total spent
          </h2>
          <p
            aria-hidden
            className="tnum mt-2 whitespace-nowrap font-[430] leading-none tracking-[-0.045em] text-white"
            style={{ fontSize: `min(4.25rem, calc(92cqw / ${em.toFixed(2)}))` }}
          >
            <span className="mr-[0.06em] align-[0.42em] text-[0.62em] font-medium tracking-[-0.02em]">
              {currency.symbol.trim()}
            </span>
            {shownText}
          </p>
          <p className="sr-only" aria-live="polite">
            {finalText} spent, {title}, {formatRange(period.start, period.end)}
          </p>
          <div className="mt-5 flex justify-center">
            <Segmented
              label="Show totals by"
              size="sm"
              value={period.kind}
              onChange={(k: PeriodKind) => setPeriod(periodContaining(k, isCurrent ? today : period.start))}
              options={[
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
              ]}
              className="min-w-[188px]"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <IconButton
            icon={ChevronLeft}
            label={`Previous ${period.kind}`}
            tone="white"
            size={56}
            iconSize={24}
            onClick={() => setPeriod(shiftPeriod(period, -1))}
          />
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[16px] font-semibold leading-tight text-white">{title}</p>
            <p className="tnum mt-1 flex items-center justify-center gap-1.5 text-[14px] leading-tight text-white/70">
              <CalendarDays size={15} strokeWidth={1.6} aria-hidden className="shrink-0" />
              <span className="text-balance">{formatRange(period.start, period.end)}</span>
            </p>
            {!isCurrent && (
              <button
                type="button"
                onClick={() => setPeriod(periodContaining(period.kind, today))}
                className="mt-1.5 rounded-full px-2 py-0.5 text-[13px] font-semibold text-flame-300 underline decoration-flame-300/40 underline-offset-4 hover:decoration-flame-300"
              >
                Back to this {period.kind}
              </button>
            )}
          </div>
          <IconButton
            icon={ChevronRight}
            label={`Next ${period.kind}`}
            tone="dark"
            size={56}
            iconSize={24}
            disabled={!canNext}
            onClick={() => setPeriod(shiftPeriod(period, 1))}
          />
        </div>

        <div className="mt-6">
          <TrendBars series={series} today={today} kind={period.kind} format={(m) => money(m)} />
        </div>
      </div>

      <button
        ref={slab}
        type="button"
        onClick={() => openSheet({ kind: 'tx-new' })}
        className="add-slab relative z-0 mx-2.5 -mt-12 flex h-[136px] w-[calc(100%-20px)] items-end justify-center gap-3 rounded-b-[34px] pb-[30px] text-white"
      >
        <CirclePlus size={30} strokeWidth={1.3} aria-hidden />
        <span className="text-[18px] font-medium tracking-[-0.01em]">Add expense</span>
      </button>
    </section>
  );
}

function NeedsAttention() {
  const { data } = useData();
  const expenses = data.transactions.filter((t) => t.type === 'expense');
  if (expenses.length === 0) return null;
  const toReview = expenses.filter(needsAttention).length;
  const reviewedNoNote = expenses.filter((t) => isMissingNote(t) && t.reviewed).length;

  if (toReview === 0) {
    return (
      <section aria-labelledby="attention-title" className="surface flex items-center gap-4 rounded-[28px] p-4 sm:p-5">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-mint-400/12 text-mint-400">
          <CheckCircle2 size={22} strokeWidth={1.7} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="attention-title" className="text-[16px] font-semibold text-white">
            All caught up
          </h2>
          <p className="mt-0.5 text-[14px] leading-snug text-white/60">
            Every expense has a note
            {reviewedNoNote > 0 && ` or was marked reviewed (${reviewedNoNote} without a note)`}.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="attention-title">
      <a
        href={hrefFor('review')}
        className="surface group flex items-center gap-4 rounded-[28px] p-4 pr-3.5 transition-colors hover:bg-ink-850 sm:p-5"
      >
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-flame-400/30 bg-flame-500/10 text-flame-300">
          <PenLine size={21} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="attention-title" className="text-[16px] font-semibold text-white">
            <span className="tnum">{toReview}</span> {toReview === 1 ? 'expense needs' : 'expenses need'} a note
          </h2>
          <p className="mt-0.5 text-[14px] leading-snug text-white/60">Add what they were for, or mark them reviewed.</p>
        </div>
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/[0.09] bg-ink-950 text-white transition-transform group-hover:translate-x-0.5">
          <ArrowRight size={19} strokeWidth={1.7} aria-hidden />
        </span>
      </a>
    </section>
  );
}

function CategoryBreakdown({ period, today }: { period: Period; today: string }) {
  const { data } = useData();
  const money = useMoney();
  const { openSheet } = useUi();
  const rows = useMemo(
    () => categoryBreakdown(data.transactions, data.categories, period.start, period.end),
    [data.transactions, data.categories, period],
  );
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <Card aria-labelledby="cat-title">
      <SectionHeader
        id="cat-title"
        title="Where it went"
        subtitle={`${periodTitle(period, today)} · ${formatRange(period.start, period.end)}`}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={`Nothing spent ${period.kind === 'week' ? 'this week' : 'this month'} yet`}
          action={
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => openSheet({ kind: 'tx-new' })}>
              Add expense
            </Button>
          }
        >
          {periodContaining(period.kind, today).start === period.start
            ? 'When you add expenses, you’ll see how they split across categories.'
            : 'No expenses were recorded in this period.'}
        </EmptyState>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {rows.map((r) => (
            <li key={r.category.id}>
              <a
                href={hrefFor('expenses', { from: period.start, to: period.end, cat: r.category.id })}
                className="flex items-center gap-3.5 rounded-2xl px-2 py-2.5 transition-colors hover:bg-white/[0.04]"
              >
                <CategoryBadge category={r.category} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[15px] font-medium text-white">{r.category.name}</span>
                    <span className="tnum shrink-0 text-[15px] font-semibold text-white">{money(r.amount)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${Math.max(2, (r.amount / total) * 100)}%`, background: r.category.color }}
                      />
                    </div>
                    <span className="tnum w-11 shrink-0 text-right text-[13px] text-white/65">
                      {r.percent === 0 ? '<1' : r.percent}%
                    </span>
                  </div>
                  <span className="sr-only">
                    , {r.count} {r.count === 1 ? 'entry' : 'entries'}. Open these expenses.
                  </span>
                </div>
                <ChevronRight size={18} strokeWidth={1.6} aria-hidden className="shrink-0 text-white/35" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentExpenses({ today }: { today: string }) {
  const { data, enterDemo, mode } = useData();
  const { openSheet } = useUi();
  const recent = useMemo(
    () => data.transactions.filter((t) => t.type === 'expense').sort(compareTxDesc).slice(0, 5),
    [data.transactions],
  );
  return (
    <section aria-labelledby="recent-title">
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h2 id="recent-title" className="text-[18px] font-semibold tracking-[-0.01em] text-white">
          Recent expenses
        </h2>
        <a
          href={hrefFor('expenses')}
          aria-label="See all expenses"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.09] bg-ink-950 text-white hover:bg-black"
        >
          <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full border-[1.5px] border-flame-200/90 text-flame-200">
            <ArrowRight size={15} strokeWidth={2} aria-hidden />
          </span>
        </a>
      </div>
      {recent.length === 0 ? (
        <div className="surface rounded-[28px]">
          <EmptyState
            icon={ReceiptText}
            title="No expenses yet"
            action={
              <div className="flex flex-col items-center gap-2 sm:flex-row">
                <Button variant="primary" icon={Plus} onClick={() => openSheet({ kind: 'tx-new' })}>
                  Add expense
                </Button>
                {mode === 'real' && (
                  <Button variant="ghost" onClick={() => enterDemo()}>
                    Explore demo
                  </Button>
                )}
              </div>
            }
          >
            Add what you spend and a quick note about what it was for.
          </EmptyState>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {recent.map((t) => (
            <li key={t.id}>
              <TxRow tx={t} today={today} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PeriodGlance({ period, today }: { period: Period; today: string }) {
  const { data } = useData();
  const money = useMoney();
  const stats = useMemo(() => {
    const inP = data.transactions.filter((t) => t.date >= period.start && t.date <= period.end);
    const expenses = inP.filter((t) => t.type === 'expense');
    const total = totalSpending(data.transactions, period.start, period.end);
    const prev = shiftPeriod(period, -1);
    const prevTotal = totalSpending(data.transactions, prev.start, prev.end);
    const lastDay = today < period.end && today >= period.start ? today : period.end;
    const days = Math.round((new Date(lastDay).getTime() - new Date(period.start).getTime()) / 86400000) + 1;
    const biggest = expenses.reduce<(typeof expenses)[number] | null>((b, t) => (!b || t.amount > b.amount ? t : b), null);
    const moneyIn = inP.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    return {
      count: expenses.length,
      withNote: expenses.filter((t) => t.comment.trim()).length,
      avg: days > 0 && today >= period.start ? Math.round(total / days) : 0,
      total,
      prevTotal,
      prevLabel: periodTitle(prev, today).toLowerCase(),
      biggest,
      moneyIn,
    };
  }, [data.transactions, period, today]);

  const diff = stats.total - stats.prevTotal;
  const tiles = [
    { label: 'Expenses recorded', value: String(stats.count), sub: stats.count ? `${stats.withNote} with a note` : 'None yet' },
    { label: 'Daily average', value: money(stats.avg), sub: today < period.start ? 'Not started yet' : 'Per day so far' },
    {
      label: 'Biggest expense',
      value: stats.biggest ? money(stats.biggest.amount) : '—',
      sub: stats.biggest ? stats.biggest.payee || data.categories.find((c) => c.id === stats.biggest!.categoryId)?.name || 'Expense' : 'Nothing yet',
    },
    {
      label: `Compared with ${stats.prevLabel}`,
      value: diff === 0 ? 'Same' : `${money(Math.abs(diff))}`,
      sub: diff === 0 ? 'No change in spending' : diff > 0 ? 'more spent' : 'less spent',
      icon: diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : null,
    },
  ];

  return (
    <Card aria-labelledby="glance-title">
      <SectionHeader id="glance-title" title="At a glance" subtitle={periodTitle(period, today)} />
      <dl className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0 rounded-[20px] border border-white/[0.06] bg-white/[0.03] p-3.5">
            <dt className="text-[13px] leading-snug text-white/60">{t.label}</dt>
            <dd className="tnum mt-1.5 flex items-center gap-1 truncate text-[18px] font-semibold tracking-[-0.01em] text-white">
              {t.icon && <t.icon size={18} strokeWidth={1.9} aria-hidden className="shrink-0 text-white/80" />}
              <span className="truncate">{t.value}</span>
            </dd>
            <dd className="mt-0.5 truncate text-[13px] text-white/60">{t.sub}</dd>
          </div>
        ))}
      </dl>
      {stats.moneyIn > 0 && (
        <p className="mt-3.5 text-[13px] leading-snug text-white/60">
          <span className="tnum font-semibold text-mint-400">{money(stats.moneyIn, { signed: true })}</span> money in
          this period. Money in and transfers never count as spending.
        </p>
      )}
    </Card>
  );
}

export function Overview() {
  const today = useToday();
  const route = useRoute();
  const { openSheet } = useUi();
  const [prefKind, setPrefKind] = useLocalStorage<PeriodKind>('spendnote.periodKind', 'week', KINDS);

  const viewParam = route.params.get('view');
  const kind: PeriodKind = viewParam === 'week' || viewParam === 'month' ? viewParam : prefKind;
  const dParam = route.params.get('d');
  const anchor = dParam && isValidISODate(dParam) ? dParam : today;
  const period = useMemo(() => periodContaining(kind, anchor), [kind, anchor]);

  const setPeriod = (p: Period) => {
    if (p.kind !== prefKind) setPrefKind(p.kind);
    const isCurrent = p.start === periodContaining(p.kind, today).start;
    navigate('overview', { view: p.kind, d: isCurrent ? null : p.start }, { replace: true });
  };

  // Home-screen shortcut: /#/overview?add=1 opens the Add expense sheet.
  useEffect(() => {
    if (route.params.get('add') === '1') {
      navigate('overview', {}, { replace: true });
      openSheet({ kind: 'tx-new' });
    }
  }, [route.params, openSheet]);

  return (
    <>
      <header className="mb-0 md:mb-8 md:flex md:items-end md:justify-between md:gap-4">
        <div>
          <p className="hidden text-[15px] text-white/60 md:block">{formatLongDate(today)}</p>
          <h1 className="sr-only md:not-sr-only md:mt-1 md:text-[32px] md:font-semibold md:tracking-[-0.03em]">
            Overview
          </h1>
        </div>
        <div className="hidden gap-3 md:flex">
          <Button icon={ClipboardPaste} onClick={() => openSheet({ kind: 'tx-new', paste: true })}>
            Paste a MoMo message
          </Button>
        </div>
      </header>

      <ReminderBanner />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(380px,440px)_minmax(0,1fr)] lg:gap-8">
        <div className="flex flex-col gap-6">
          <SummaryCard period={period} today={today} setPeriod={setPeriod} />
          <NeedsAttention />
          <div className="hidden lg:block">
            <PeriodGlance period={period} today={today} />
          </div>
        </div>
        <div className="flex flex-col gap-6 lg:gap-8">
          <div className={cx('order-2 lg:order-1')}>
            <CategoryBreakdown period={period} today={today} />
          </div>
          <div className="order-1 lg:order-2">
            <RecentExpenses today={today} />
          </div>
          <div className="order-3 lg:hidden">
            <PeriodGlance period={period} today={today} />
          </div>
        </div>
      </div>
    </>
  );
}
