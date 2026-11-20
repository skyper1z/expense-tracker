import type { ISODate } from './types';

/*
 * All transaction dates are plain local calendar dates (YYYY-MM-DD).
 * They compare correctly as strings, and we only turn them into Date objects
 * at local midnight for arithmetic, so time zones and DST never shift a day.
 */

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISODate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = fromISODate(s);
  return toISODate(d) === s && d.getFullYear() >= 1970 && d.getFullYear() <= 2200;
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = fromISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Monday-first weekday index: 0 = Monday … 6 = Sunday. */
export function weekdayIndex(iso: ISODate): number {
  return (fromISODate(iso).getDay() + 6) % 7;
}

export function startOfWeek(iso: ISODate): ISODate {
  return addDays(iso, -weekdayIndex(iso));
}

export function startOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: ISODate): ISODate {
  const d = fromISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export type PeriodKind = 'week' | 'month';

/** An inclusive range of calendar dates. */
export interface Period {
  kind: PeriodKind;
  start: ISODate;
  end: ISODate;
}

export function periodContaining(kind: PeriodKind, iso: ISODate): Period {
  if (kind === 'week') {
    const start = startOfWeek(iso);
    return { kind, start, end: addDays(start, 6) };
  }
  return { kind, start: startOfMonth(iso), end: endOfMonth(iso) };
}

export function shiftPeriod(p: Period, delta: number): Period {
  if (p.kind === 'week') return periodContaining('week', addDays(p.start, delta * 7));
  const d = fromISODate(p.start);
  return periodContaining('month', toISODate(new Date(d.getFullYear(), d.getMonth() + delta, 1)));
}

export function inPeriod(iso: ISODate, from: ISODate | null, to: ISODate | null): boolean {
  return (!from || iso >= from) && (!to || iso <= to);
}

export function datesInRange(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function parts(iso: ISODate) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** "17 – 23 Nov 2026", "29 Dec 2025 – 4 Jan 2026", "1 – 30 Nov 2026" */
export function formatRange(start: ISODate, end: ISODate): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.d} ${MONTHS[a.m - 1]} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${a.d} – ${b.d} ${MONTHS[a.m - 1]} ${a.y}`;
}

export function periodTitle(p: Period, today: ISODate): string {
  const current = periodContaining(p.kind, today);
  if (p.start === current.start) return p.kind === 'week' ? 'This week' : 'This month';
  if (p.start === shiftPeriod(current, -1).start) return p.kind === 'week' ? 'Last week' : 'Last month';
  if (p.kind === 'month') {
    const { y, m } = parts(p.start);
    return `${MONTHS_LONG[m - 1]} ${y}`;
  }
  return `Week of ${formatShortDate(p.start, today)}`;
}

/** "Today", "Yesterday", "17 Nov", or "17 Nov 2025" for other years. */
export function formatShortDate(iso: ISODate, today: ISODate): string {
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const { y, m, d } = parts(iso);
  return y === parts(today).y ? `${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Today", "Yesterday", "Mon 17 Nov", "Mon 17 Nov 2025" */
export function formatDayHeading(iso: ISODate, today: ISODate): string {
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const { y, m, d } = parts(iso);
  const wd = WEEKDAYS[weekdayIndex(iso)];
  return y === parts(today).y ? `${wd} ${d} ${MONTHS[m - 1]}` : `${wd} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Friday 20 November 2026" */
export function formatLongDate(iso: ISODate): string {
  const { y, m, d } = parts(iso);
  return `${WEEKDAYS_LONG[weekdayIndex(iso)]} ${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

export function formatMonthDay(iso: ISODate): string {
  const { m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "3:58 PM" from "15:58" */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

export function formatTimestamp(isoTs: string): string {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${formatTime(`${d.getHours()}:${d.getMinutes()}`)}`;
}

export const MONTH_NAMES = MONTHS;
