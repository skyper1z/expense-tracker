import { FEES_CATEGORY_ID, OTHER_CATEGORY_ID } from './categories';
import { datesInRange, inPeriod } from './dates';
import type { Category, ISODate, PaymentMethod, Transaction } from './types';

/* ------------------------------------------------------------------ */
/* Spending                                                            */
/* ------------------------------------------------------------------ */

export interface SpendPart {
  categoryId: string;
  amount: number;
  kind: 'payment' | 'fee';
}

/**
 * The single source of truth for what counts as spending.
 * - An expense contributes its amount under its category.
 * - Any explicit fee (on an expense, money in, or transfer) contributes under "Fees & charges".
 * - Money in and transfer amounts never count as spending.
 * Each transaction is visited once, so account-linked spending is never double counted.
 */
export function spendingParts(tx: Transaction, knownCategories?: Set<string>): SpendPart[] {
  const parts: SpendPart[] = [];
  if (tx.type === 'expense' && tx.amount > 0) {
    const cat = knownCategories && !knownCategories.has(tx.categoryId) ? OTHER_CATEGORY_ID : tx.categoryId;
    parts.push({ categoryId: cat, amount: tx.amount, kind: 'payment' });
  }
  if (tx.fee > 0) parts.push({ categoryId: FEES_CATEGORY_ID, amount: tx.fee, kind: 'fee' });
  return parts;
}

export function spendingOf(tx: Transaction): number {
  return spendingParts(tx).reduce((s, p) => s + p.amount, 0);
}

export function txInRange(tx: Transaction, from: ISODate | null, to: ISODate | null): boolean {
  return inPeriod(tx.date, from, to);
}

export function totalSpending(txs: Transaction[], from: ISODate | null, to: ISODate | null): number {
  let total = 0;
  for (const tx of txs) if (txInRange(tx, from, to)) total += spendingOf(tx);
  return total;
}

export interface CategoryTotal {
  category: Category;
  amount: number;
  /** Whole-number percentage; all rows sum to exactly 100 when there is any spending. */
  percent: number;
  count: number;
}

/** Spread 100% across values using the largest-remainder method so the shown percentages add up. */
export function wholePercents(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const floors = raw.map(Math.floor);
  let remaining = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem || values[b.i] - values[a.i]);
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i] += 1;
    remaining -= 1;
  }
  return floors;
}

export function categoryBreakdown(
  txs: Transaction[],
  categories: Category[],
  from: ISODate | null,
  to: ISODate | null,
): CategoryTotal[] {
  const known = new Set(categories.map((c) => c.id));
  const sums = new Map<string, { amount: number; txIds: Set<string> }>();
  for (const tx of txs) {
    if (!txInRange(tx, from, to)) continue;
    for (const part of spendingParts(tx, known)) {
      const entry = sums.get(part.categoryId) ?? { amount: 0, txIds: new Set<string>() };
      entry.amount += part.amount;
      entry.txIds.add(tx.id);
      sums.set(part.categoryId, entry);
    }
  }
  const rows = categories
    .filter((c) => (sums.get(c.id)?.amount ?? 0) > 0)
    .map((c) => ({ category: c, amount: sums.get(c.id)!.amount, count: sums.get(c.id)!.txIds.size }))
    .sort((a, b) => b.amount - a.amount || a.category.order - b.category.order);
  const percents = wholePercents(rows.map((r) => r.amount));
  return rows.map((r, i) => ({ ...r, percent: percents[i] }));
}

export interface DayTotal {
  date: ISODate;
  amount: number;
}

export function dailySeries(txs: Transaction[], from: ISODate, to: ISODate): DayTotal[] {
  const byDay = new Map<ISODate, number>();
  for (const tx of txs) {
    if (!txInRange(tx, from, to)) continue;
    const s = spendingOf(tx);
    if (s > 0) byDay.set(tx.date, (byDay.get(tx.date) ?? 0) + s);
  }
  return datesInRange(from, to).map((date) => ({ date, amount: byDay.get(date) ?? 0 }));
}

/* ------------------------------------------------------------------ */
/* Notes & review                                                      */
/* ------------------------------------------------------------------ */

/** An expense with a blank comment. Independent of whether it was marked reviewed. */
export function isMissingNote(tx: Transaction): boolean {
  return tx.type === 'expense' && tx.comment.trim() === '';
}

/** Missing a note AND not yet marked reviewed — these are what "Needs attention" counts. */
export function needsAttention(tx: Transaction): boolean {
  return isMissingNote(tx) && !tx.reviewed;
}

/* ------------------------------------------------------------------ */
/* Sorting, filtering, search                                          */
/* ------------------------------------------------------------------ */

export function compareTxDesc(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const at = a.time ?? '';
  const bt = b.time ?? '';
  if (at !== bt) return at < bt ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export type TypeFilter = 'spending' | 'income' | 'transfer' | 'all';

export interface TxFilter {
  q: string;
  from: ISODate | null;
  to: ISODate | null;
  categoryId: string | null;
  method: PaymentMethod | null;
  type: TypeFilter;
  missingNote: boolean;
}

export const EMPTY_FILTER: TxFilter = {
  q: '',
  from: null,
  to: null,
  categoryId: null,
  method: null,
  type: 'spending',
  missingNote: false,
};

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function matchesSearch(tx: Transaction, q: string): boolean {
  const terms = normalizeText(q).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = normalizeText(`${tx.payee}\n${tx.comment}\n${tx.importRef ?? ''}`);
  return terms.every((t) => hay.includes(t));
}

export function matchesFilter(tx: Transaction, f: TxFilter, known: Set<string>): boolean {
  if (!txInRange(tx, f.from, f.to)) return false;
  if (f.method && tx.method !== f.method) return false;
  if (f.type === 'spending' && spendingOf(tx) <= 0) return false;
  if (f.type === 'income' && tx.type !== 'income') return false;
  if (f.type === 'transfer' && tx.type !== 'transfer') return false;
  if (f.missingNote && !isMissingNote(tx)) return false;
  if (f.categoryId && !spendingParts(tx, known).some((p) => p.categoryId === f.categoryId)) return false;
  return matchesSearch(tx, f.q);
}

export interface FilterTotals {
  spending: number;
  moneyIn: number;
  transfers: number;
}

/** Totals for a filtered list. With a category filter, only that category's share of spending counts. */
export function filterTotals(txs: Transaction[], f: TxFilter, known: Set<string>): FilterTotals {
  const totals: FilterTotals = { spending: 0, moneyIn: 0, transfers: 0 };
  for (const tx of txs) {
    for (const p of spendingParts(tx, known)) {
      if (!f.categoryId || p.categoryId === f.categoryId) totals.spending += p.amount;
    }
    if (tx.type === 'income') totals.moneyIn += tx.amount;
    if (tx.type === 'transfer') totals.transfers += tx.amount;
  }
  return totals;
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export function touchesAccount(tx: Transaction, accountId: string): boolean {
  return tx.accountId === accountId || (tx.type === 'transfer' && tx.toAccountId === accountId);
}

/* ------------------------------------------------------------------ */
/* Duplicates                                                          */
/* ------------------------------------------------------------------ */

export interface DuplicateMatch {
  tx: Transaction;
  reason: 'reference' | 'similar';
}

function normParty(s: string): string {
  return normalizeText(s).replace(/[^a-z0-9]/g, '');
}

/**
 * Flags likely duplicates. A matching transaction reference is a strong signal;
 * matching amount + party + date is a weaker fallback. Nothing is ever discarded.
 */
export function findDuplicates(
  candidate: { id?: string; importRef: string | null; amount: number | null; payee: string; date: ISODate | null },
  txs: Transaction[],
): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  const ref = candidate.importRef?.trim().toLowerCase();
  const party = normParty(candidate.payee);
  for (const tx of txs) {
    if (candidate.id && tx.id === candidate.id) continue;
    if (ref && tx.importRef && tx.importRef.trim().toLowerCase() === ref) {
      out.push({ tx, reason: 'reference' });
    } else if (
      candidate.amount !== null &&
      candidate.date &&
      party &&
      tx.amount === candidate.amount &&
      tx.date === candidate.date &&
      normParty(tx.payee) === party
    ) {
      out.push({ tx, reason: 'similar' });
    }
  }
  return out;
}
