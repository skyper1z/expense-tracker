import { spendingOf } from './calc';
import { isValidISODate } from './dates';
import { isCurrencyCode, MAX_MINOR, minorToDecimal } from './money';
import type { Account, AppData, Category, Settings, Transaction } from './types';
import { DEFAULT_SETTINGS, METHOD_LABEL, PAYMENT_METHODS, TYPE_LABEL } from './types';

export const BACKUP_APP = 'SpendNote';
/** v2 dropped balance checks and account opening balances. v1 backups still restore; those parts are ignored. */
export const BACKUP_VERSION = 2;

export interface Backup {
  app: typeof BACKUP_APP;
  kind: 'backup';
  version: number;
  exportedAt: string;
  demo: boolean;
  settings: Settings;
  categories: Category[];
  accounts: Account[];
  transactions: Transaction[];
}

export function makeBackup(data: AppData, demo: boolean): Backup {
  return {
    app: BACKUP_APP,
    kind: 'backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    demo,
    settings: data.settings,
    categories: data.categories,
    accounts: data.accounts,
    transactions: data.transactions,
  };
}

export type RestoreResult = { ok: true; data: AppData; exportedAt: string } | { ok: false; errors: string[] };

const METHODS = new Set(PAYMENT_METHODS.map((m) => m.id));
const TYPES = new Set(['expense', 'income', 'transfer']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isId = (v: unknown): v is string => isStr(v) && v.length > 0 && v.length <= 100;
const isMinor = (v: unknown, min = 0) => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= MAX_MINOR;
const isTs = (v: unknown) => isStr(v) && !Number.isNaN(Date.parse(v));
const isNullableStr = (v: unknown, max: number) => v === null || (isStr(v) && v.length <= max);

/** Validates every record before anything is replaced. Returns readable errors (first few only). */
export function parseBackup(text: string): RestoreResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['This file isn’t valid JSON. Choose a SpendNote backup file (.json).'] };
  }
  if (!isObj(json) || json.app !== BACKUP_APP || json.kind !== 'backup') {
    return { ok: false, errors: ['This doesn’t look like a SpendNote backup.'] };
  }
  if (!Number.isInteger(json.version) || (json.version as number) < 1) {
    return { ok: false, errors: ['The backup has no valid version number.'] };
  }
  if ((json.version as number) > BACKUP_VERSION) {
    return { ok: false, errors: ['This backup was made by a newer version of SpendNote. Update the app and try again.'] };
  }
  if (json.demo === true) {
    return { ok: false, errors: ['This backup contains demo data, so it can’t be restored into your own records.'] };
  }

  const errors: string[] = [];
  const err = (m: string) => {
    if (errors.length < 6) errors.push(m);
  };

  for (const key of ['categories', 'accounts', 'transactions'] as const) {
    if (!Array.isArray(json[key])) err(`Missing the “${key}” list.`);
  }
  if (!isObj(json.settings)) err('Missing settings.');
  if (errors.length) return { ok: false, errors };

  const s = json.settings as Record<string, unknown>;
  const r = isObj(s.reminder) ? s.reminder : {};
  const settings: Settings = {
    currency: isCurrencyCode(s.currency) ? s.currency : DEFAULT_SETTINGS.currency,
    onboarded: true,
    reminder: {
      enabled: r.enabled === true,
      weekday: Number.isInteger(r.weekday) && (r.weekday as number) >= 0 && (r.weekday as number) <= 6 ? (r.weekday as number) : 6,
      time: isStr(r.time) && /^\d{2}:\d{2}$/.test(r.time) ? r.time : '18:00',
    },
    reminderAckAt: isTs(s.reminderAckAt) ? (s.reminderAckAt as string) : null,
  };
  if (!isCurrencyCode(s.currency)) err('Settings: unknown currency.');

  const categories: Category[] = [];
  (json.categories as unknown[]).forEach((c, i) => {
    if (!isObj(c) || !isId(c.id) || !isStr(c.name) || !c.name.trim() || c.name.length > 40 || !isStr(c.icon) || !isStr(c.color)) {
      err(`Category ${i + 1} is incomplete.`);
      return;
    }
    categories.push({
      id: c.id,
      name: c.name.trim(),
      icon: c.icon,
      color: c.color,
      builtIn: c.builtIn === true,
      order: Number.isFinite(c.order) ? (c.order as number) : 50,
    });
  });
  const catIds = new Set(categories.map((c) => c.id));
  for (const req of ['other', 'fees']) if (!catIds.has(req)) err(`Built-in category “${req}” is missing.`);

  const accounts: Account[] = [];
  (json.accounts as unknown[]).forEach((a, i) => {
    if (
      !isObj(a) || !isId(a.id) || !isStr(a.name) || !a.name.trim() || a.name.length > 60 ||
      !METHODS.has(a.method as never) || !isTs(a.createdAt) || !isTs(a.updatedAt)
    ) {
      err(`Account ${i + 1} is incomplete or has an invalid value.`);
      return;
    }
    accounts.push({
      id: a.id,
      name: a.name,
      method: a.method as Account['method'],
      createdAt: a.createdAt as string,
      updatedAt: a.updatedAt as string,
    });
  });
  const accIds = new Set(accounts.map((a) => a.id));

  const transactions: Transaction[] = [];
  const seen = new Set<string>();
  (json.transactions as unknown[]).forEach((t, i) => {
    const n = `Transaction ${i + 1}`;
    if (!isObj(t) || !isId(t.id)) return err(`${n} has no ID.`);
    if (seen.has(t.id)) return err(`${n} repeats an ID used earlier.`);
    if (!TYPES.has(t.type as string)) return err(`${n} has an unknown type.`);
    if (!isMinor(t.amount, 1)) return err(`${n}: amount must be a positive whole number of minor units.`);
    if (!isMinor(t.fee)) return err(`${n}: fee must be zero or a positive whole number.`);
    if (!isValidISODate(t.date)) return err(`${n}: invalid date.`);
    if (!(t.time === null || (isStr(t.time) && /^\d{2}:\d{2}$/.test(t.time)))) return err(`${n}: invalid time.`);
    if (!isStr(t.categoryId) || !catIds.has(t.categoryId)) return err(`${n}: unknown category.`);
    if (!METHODS.has(t.method as never)) return err(`${n}: unknown payment method.`);
    if (!isStr(t.comment) || t.comment.length > 2000) return err(`${n}: invalid comment.`);
    if (!isStr(t.payee) || t.payee.length > 120) return err(`${n}: invalid payee.`);
    if (!(t.accountId === null || (isStr(t.accountId) && accIds.has(t.accountId)))) return err(`${n}: links to a missing account.`);
    if (!(t.toAccountId === null || (isStr(t.toAccountId) && accIds.has(t.toAccountId)))) return err(`${n}: links to a missing account.`);
    if (t.type === 'transfer' && t.accountId !== null && t.accountId === t.toAccountId) return err(`${n}: transfer uses the same account twice.`);
    if (!isNullableStr(t.importRef, 100) || !isNullableStr(t.sourceText, 5000)) return err(`${n}: invalid import details.`);
    if (typeof t.reviewed !== 'boolean') return err(`${n}: invalid review status.`);
    if (!isTs(t.createdAt) || !isTs(t.updatedAt)) return err(`${n}: invalid timestamps.`);
    seen.add(t.id);
    transactions.push(t as unknown as Transaction);
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    exportedAt: isTs(json.exportedAt) ? (json.exportedAt as string) : '',
    data: { settings, categories, accounts, transactions },
  };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function csvCell(v: string | number | boolean | null): string {
  if (v === null) return '';
  let s = String(v);
  // Stop spreadsheet apps from treating text as a formula.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function transactionsToCsv(data: AppData): string {
  const cats = new Map(data.categories.map((c) => [c.id, c.name]));
  const accs = new Map(data.accounts.map((a) => [a.id, a.name]));
  const header = [
    'date', 'time', 'type', 'amount', 'fee', 'counts_as_spending', 'currency', 'category', 'payment_method',
    'account', 'to_account', 'title_or_payee', 'comment', 'reviewed', 'import_reference', 'created_at', 'updated_at', 'id',
  ];
  const rows = [...data.transactions]
    .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)))
    .map((t) => [
      t.date,
      t.time,
      TYPE_LABEL[t.type],
      minorToDecimal(t.amount),
      minorToDecimal(t.fee),
      minorToDecimal(spendingOf(t)),
      data.settings.currency,
      t.type === 'expense' ? (cats.get(t.categoryId) ?? 'Other') : '',
      METHOD_LABEL[t.method],
      t.accountId ? (accs.get(t.accountId) ?? '') : '',
      t.toAccountId ? (accs.get(t.toAccountId) ?? '') : '',
      t.payee,
      t.comment,
      t.reviewed,
      t.importRef,
      t.createdAt,
      t.updatedAt,
      t.id,
    ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
