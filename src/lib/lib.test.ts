import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { makeBackup, parseBackup, transactionsToCsv } from './backup';
import {
  categoryBreakdown, dailySeries, EMPTY_FILTER, filterTotals, findDuplicates, isMissingNote, matchesFilter,
  needsAttention, spendingOf, totalSpending, wholePercents,
} from './calc';
import { BUILT_IN_CATEGORIES } from './categories';
import { CATEGORY_ICONS } from '../components/icons';
import { openDB } from 'idb';
import { DEMO_DB, deleteDatabase, emptyData, LEGACY_DB, openRepo, userDbName } from './db';
import { addDays, formatRange, periodContaining, periodTitle, shiftPeriod, startOfWeek } from './dates';
import { buildDemoData } from './demo';
import { formatMoney, parseMoneyInput } from './money';
import { parseMomoMessage } from './momo';
import { isReminderDue, lastOccurrence } from './reminders';
import type { Transaction } from './types';

let seq = 0;
function tx(p: Partial<Transaction> & Pick<Transaction, 'amount' | 'date'>): Transaction {
  seq += 1;
  return {
    id: `t${seq}`, type: 'expense', fee: 0, time: null, categoryId: 'other', method: 'cash', comment: '', payee: '',
    accountId: null, toAccountId: null, importRef: null, sourceText: null, reviewed: false,
    createdAt: `2026-11-01T10:00:${String(seq % 60).padStart(2, '0')}.000Z`, updatedAt: '2026-11-01T10:00:00.000Z', ...p,
  };
}

const cats = BUILT_IN_CATEGORIES;
const known = new Set(cats.map((c) => c.id));

describe('money', () => {
  it('parses typed amounts into exact minor units', () => {
    expect(parseMoneyInput('120')).toEqual({ ok: true, value: 12000 });
    expect(parseMoneyInput('0.1')).toEqual({ ok: true, value: 10 });
    expect(parseMoneyInput('1,234.56')).toEqual({ ok: true, value: 123456 });
    expect(parseMoneyInput('GH₵ 45.5')).toEqual({ ok: true, value: 4550 });
    expect(parseMoneyInput('.75')).toEqual({ ok: true, value: 75 });
  });
  it('rejects bad input with helpful messages', () => {
    expect(parseMoneyInput('')).toMatchObject({ ok: false, error: 'Enter an amount' });
    expect(parseMoneyInput('12.345')).toMatchObject({ ok: false, error: 'Use at most 2 decimal places' });
    expect(parseMoneyInput('0')).toMatchObject({ ok: false, error: 'Amount must be more than zero' });
    expect(parseMoneyInput('-5')).toMatchObject({ ok: false });
    expect(parseMoneyInput('abc')).toMatchObject({ ok: false });
    expect(parseMoneyInput('1,23')).toMatchObject({ ok: false });
    expect(parseMoneyInput('99999999999999')).toMatchObject({ ok: false, error: 'That amount is too large' });
    expect(parseMoneyInput('-20.50', { allowNegative: true })).toEqual({ ok: true, value: -2050 });
  });
  it('formats consistently', () => {
    expect(formatMoney(348000, 'GHS')).toBe('GH₵3,480.00');
    expect(formatMoney(5, 'GHS')).toBe('GH₵0.05');
    expect(formatMoney(-2050, 'GHS')).toBe('−GH₵20.50');
    expect(formatMoney(2050, 'GHS', { signed: true })).toBe('+GH₵20.50');
    expect(formatMoney(99999999999, 'USD')).toBe('$999,999,999.99');
  });
});

describe('dates', () => {
  it('starts weeks on Monday', () => {
    expect(startOfWeek('2026-11-20')).toBe('2026-11-16'); // Friday → Monday
    expect(startOfWeek('2026-11-22')).toBe('2026-11-16'); // Sunday belongs to the same week
    expect(startOfWeek('2026-11-16')).toBe('2026-11-16');
  });
  it('builds calendar weeks and months and shifts them', () => {
    expect(periodContaining('week', '2026-11-20')).toEqual({ kind: 'week', start: '2026-11-16', end: '2026-11-22' });
    expect(periodContaining('month', '2026-02-10')).toEqual({ kind: 'month', start: '2026-02-01', end: '2026-02-28' });
    expect(shiftPeriod(periodContaining('month', '2026-01-31'), -1)).toEqual({ kind: 'month', start: '2025-12-01', end: '2025-12-31' });
    expect(shiftPeriod(periodContaining('week', '2026-01-01'), -1).start).toBe('2025-12-22');
  });
  it('labels ranges explicitly', () => {
    expect(formatRange('2026-11-16', '2026-11-22')).toBe('16 – 22 Nov 2026');
    expect(formatRange('2025-12-29', '2026-01-04')).toBe('29 Dec 2025 – 4 Jan 2026');
    expect(formatRange('2026-10-26', '2026-11-01')).toBe('26 Oct – 1 Nov 2026');
    expect(periodTitle(periodContaining('week', '2026-11-12'), '2026-11-20')).toBe('Last week');
    expect(periodTitle(periodContaining('month', '2026-09-12'), '2026-11-20')).toBe('September 2026');
  });
  it('survives DST-style month lengths', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 8)).toBe('2026-11-01');
  });
});

describe('spending calculations', () => {
  const data = [
    tx({ amount: 12000, date: '2026-11-17', categoryId: 'food', comment: 'Vegetables' }),
    tx({ amount: 5000, fee: 50, date: '2026-11-18', categoryId: 'transport', method: 'momo' }),
    tx({ type: 'income', amount: 500000, date: '2026-11-18' }),
    tx({ type: 'transfer', amount: 60000, fee: 200, date: '2026-11-19', accountId: 'a', toAccountId: 'b' }),
    tx({ type: 'transfer', amount: 10000, date: '2026-11-19', accountId: 'a', toAccountId: 'b' }),
    tx({ amount: 999, date: '2026-11-10', categoryId: 'food' }), // previous week
    tx({ amount: 700, date: '2026-11-23', categoryId: 'food' }), // next week
    tx({ amount: 300, date: '2026-11-21', categoryId: 'deleted-custom' }), // unknown category → Other
  ];

  it('counts expenses and fees, never income or transfer amounts', () => {
    expect(totalSpending(data, '2026-11-16', '2026-11-22')).toBe(12000 + 5000 + 50 + 200 + 300);
    expect(spendingOf(data[2])).toBe(0);
    expect(spendingOf(data[3])).toBe(200);
  });

  it('keeps category totals equal to the period total', () => {
    const rows = categoryBreakdown(data, cats, '2026-11-16', '2026-11-22');
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBe(totalSpending(data, '2026-11-16', '2026-11-22'));
    expect(rows.find((r) => r.category.id === 'fees')?.amount).toBe(250);
    expect(rows.find((r) => r.category.id === 'other')?.amount).toBe(300);
    expect(rows.reduce((s, r) => s + r.percent, 0)).toBe(100);
  });

  it('builds daily series on the same boundaries', () => {
    const series = dailySeries(data, '2026-11-16', '2026-11-22');
    expect(series).toHaveLength(7);
    expect(series.reduce((s, d) => s + d.amount, 0)).toBe(totalSpending(data, '2026-11-16', '2026-11-22'));
    expect(series[1]).toEqual({ date: '2026-11-17', amount: 12000 });
  });

  it('whole percents always add to 100', () => {
    expect(wholePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(wholePercents([0, 0])).toEqual([0, 0]);
    expect(wholePercents([999, 1]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('filters, and filtered totals match the category breakdown', () => {
    const f = { ...EMPTY_FILTER, from: '2026-11-16', to: '2026-11-22', categoryId: 'fees' };
    const rows = data.filter((t) => matchesFilter(t, f, known));
    expect(rows.map((r) => r.amount).sort()).toEqual([5000, 60000]);
    expect(filterTotals(rows, f, known).spending).toBe(250);
    const spending = data.filter((t) => matchesFilter(t, { ...EMPTY_FILTER }, known));
    expect(spending.some((t) => t.type === 'income')).toBe(false);
    expect(spending.some((t) => t.amount === 10000)).toBe(false); // fee-free transfer isn't spending
  });

  it('searches titles, payees and comments', () => {
    const items = [tx({ amount: 1, date: '2026-11-01', payee: 'Makola Market' }), tx({ amount: 1, date: '2026-11-01', comment: 'Bought VEGETABLES' })];
    expect(items.filter((t) => matchesFilter(t, { ...EMPTY_FILTER, q: 'makola' }, known))).toHaveLength(1);
    expect(items.filter((t) => matchesFilter(t, { ...EMPTY_FILTER, q: 'vegetables' }, known))).toHaveLength(1);
  });

  it('keeps "missing note" and "reviewed" separate', () => {
    const a = tx({ amount: 1, date: '2026-11-01' });
    const b = tx({ amount: 1, date: '2026-11-01', reviewed: true });
    const c = tx({ amount: 1, date: '2026-11-01', comment: '  ' });
    const d = tx({ type: 'income', amount: 1, date: '2026-11-01' });
    expect([a, b, c, d].map(isMissingNote)).toEqual([true, true, true, false]);
    expect([a, b, c, d].map(needsAttention)).toEqual([true, false, true, false]);
  });
});

describe('duplicates', () => {
  const existing = [tx({ amount: 15000, date: '2026-11-18', payee: 'Kofi Mensah', importRef: '50123456789' })];
  it('flags matching references first, then amount + party + date', () => {
    expect(findDuplicates({ importRef: '50123456789', amount: 1, payee: '', date: null }, existing)[0].reason).toBe('reference');
    expect(findDuplicates({ importRef: null, amount: 15000, payee: 'KOFI MENSAH', date: '2026-11-18' }, existing)[0].reason).toBe('similar');
    expect(findDuplicates({ importRef: null, amount: 15000, payee: 'Kofi', date: '2026-11-18' }, existing)).toHaveLength(0);
    expect(findDuplicates({ id: existing[0].id, importRef: '50123456789', amount: 1, payee: '', date: null }, existing)).toHaveLength(0);
  });
});

describe('MoMo parser', () => {
  const today = '2026-11-20';

  it('reads an MTN-style payment with a fee', () => {
    const p = parseMomoMessage(
      'Your payment of GHS 150.00 to KOFI MENSAH 0241234567 has been completed at 2026-11-18 15:58:12. Reference: gas. Your new balance: GHS 412.30. Fee was GHS 1.50 Tax was GHS 0.00. Financial Transaction Id: 50123456789. External Transaction Id: -.',
      today,
    );
    expect(p.ok).toBe(true);
    expect(p.amount.value).toBe(15000);
    expect(p.feeTotal).toBe(150);
    expect(p.feeIncluded).toBe('unknown');
    expect(p.direction.value).toBe('sent');
    expect(p.party.value).toBe('Kofi Mensah');
    expect(p.phone).toBe('0241234567');
    expect(p.date).toMatchObject({ value: '2026-11-18', status: 'found' });
    expect(p.time.value).toBe('15:58');
    expect(p.reference.value).toBe('50123456789');
    expect(p.messageNote).toBe('gas');
    expect(p.balanceAfter).toBe(41230);
    expect(p.suggestedType).toBe('expense');
    expect(p.typeCertain).toBe(false);
  });

  it('reads money received', () => {
    const p = parseMomoMessage(
      'Payment received for GHS 850.00 from KWAME ASANTE Current Balance: GHS 1,200.00 . Available Balance: GHS 1,200.00. Reference: Thanks. Transaction ID: 41234567890. TRANSACTION FEE: 0.00',
      today,
    );
    expect(p.amount.value).toBe(85000);
    expect(p.direction.value).toBe('received');
    expect(p.party.value).toBe('Kwame Asante');
    expect(p.feeTotal).toBe(0);
    expect(p.reference.value).toBe('41234567890');
    expect(p.suggestedType).toBe('income');
    expect(p.date.status).toBe('missing');
  });

  it('reads a Telecel-style message and flags ambiguous day/month dates', () => {
    const p = parseMomoMessage(
      '000012345678 Confirmed. You have sent GHS20.00 to JOHN DOE (0201234567) on 04/03/2026 at 03:58PM. Reference: food. Your Telecel Cash balance is GHS100.00. Transaction fee GHS0.20.',
      today,
    );
    expect(p.amount.value).toBe(2000);
    expect(p.feeTotal).toBe(20);
    expect(p.party.value).toBe('John Doe');
    expect(p.phone).toBe('0201234567');
    expect(p.date).toMatchObject({ value: '2026-03-04', status: 'check' });
    expect(p.time.value).toBe('15:58');
    expect(p.reference.value).toBe('000012345678');
    expect(p.balanceAfter).toBe(10000);
  });

  it('recognises merchant payments as expenses and cash-outs as possible transfers', () => {
    const pay = parseMomoMessage('Payment made for GHS 45.00 to SHOPRITE ACCRA MALL. Current Balance: GHS 300.00. Transaction ID: 7788990011. Fee charged: GHS0.00', today);
    expect(pay.suggestedType).toBe('expense');
    expect(pay.typeCertain).toBe(true);
    expect(pay.party.value).toBe('Shoprite Accra Mall');
    expect(pay.feeTotal).toBe(0);

    const out = parseMomoMessage('Cash Out made for GHS 200.00 to AGENT KAY ENTERPRISE. Current Balance: GHS 50.00. Fee charged: GHS 2.00. Transaction ID: 99887766.', today);
    expect(out.kind).toBe('cash_out');
    expect(out.suggestedType).toBe('transfer');
    expect(out.typeCertain).toBe(false);
    expect(out.feeTotal).toBe(200);
  });

  it('works out when the fee is already included', () => {
    const p = parseMomoMessage('You paid GHS 101.00 including fee of GHS 1.00 to ADJOA. Trans ID: 123456789', today);
    expect(p.feeIncluded).toBe('yes');
    const q = parseMomoMessage('Sent GHS 100.00 to ADJOA. Fee: GHS 1.00. Total: GHS 101.00. Trans ID: 123456789', today);
    expect(q.feeIncluded).toBe('no');
    expect(q.amount.value).toBe(10000);
  });

  it('fails gracefully on text that is not a transaction', () => {
    const p = parseMomoMessage('Hello, are we still meeting tomorrow at 3?', today);
    expect(p.ok).toBe(false);
    expect(p.amount.value).toBeNull();
  });

  it('does not mistake phone numbers or IDs for amounts', () => {
    const p = parseMomoMessage('You have sent GHS 50 to 0271234567 KOFI. Trans ID: 12345678. Fee: GHS 0.50. Bal: GHS 100.00.', today);
    expect(p.amount.value).toBe(5000);
    expect(p.party.value).toBe('Kofi');
    expect(p.phone).toBe('0271234567');
    expect(p.feeTotal).toBe(50);
  });
});

describe('backup & CSV', () => {
  it('round-trips a backup and rejects damaged ones', () => {
    const data = buildDemoData('2026-11-20');
    data.settings.onboarded = true;
    const json = JSON.stringify(makeBackup(data, false));
    const r = parseBackup(json);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.transactions).toHaveLength(data.transactions.length);

    const bad = JSON.parse(json);
    bad.transactions[0].amount = 12.5;
    const rb = parseBackup(JSON.stringify(bad));
    expect(rb.ok).toBe(false);

    expect(parseBackup(JSON.stringify(makeBackup(data, true))).ok).toBe(false); // demo never restores
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup('{"app":"Other"}').ok).toBe(false);
  });

  it('still restores older v1 backups that had balance checks, dropping those parts', () => {
    const data = buildDemoData('2026-11-20');
    const v1 = {
      ...makeBackup(data, false),
      version: 1,
      accounts: data.accounts.map((acc) => ({ ...acc, trackBalance: true, openingBalance: 50000, openingDate: '2026-10-01' })),
      checks: [{ id: 'chk_1', accountId: data.accounts[0].id, date: '2026-11-01', actual: 1, expected: 2, createdAt: '2026-11-01T10:00:00.000Z' }],
    };
    const r = parseBackup(JSON.stringify(v1));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.accounts[0]).toEqual(data.accounts[0]);
      expect('checks' in r.data).toBe(false);
    }
  });

  it('writes safe CSV', () => {
    const data = emptyData();
    data.transactions = [tx({ amount: 12000, date: '2026-11-20', comment: '=SUM(A1) "quoted", and\nnew line', categoryId: 'food' })];
    const csv = transactionsToCsv(data);
    expect(csv.split('\r\n')[0]).toContain('date,time,type,amount');
    expect(csv).toContain('120.00');
    expect(csv).toContain(`"'=SUM(A1) ""quoted"", and\nnew line"`);
  });
});

describe('demo data', () => {
  it('spans several weeks, all methods, and stays internally consistent', () => {
    const d = buildDemoData('2026-11-20');
    const methods = new Set(d.transactions.map((t) => t.method));
    for (const m of ['cash', 'momo', 'bank', 'card']) expect(methods.has(m as never)).toBe(true);
    const weeks = new Set(d.transactions.map((t) => startOfWeek(t.date)));
    expect(weeks.size).toBeGreaterThanOrEqual(8);
    expect(d.transactions.some(needsAttention)).toBe(true);
    expect(d.transactions.some((t) => isMissingNote(t) && t.reviewed)).toBe(true);
    expect(d.transactions.every((t) => t.date <= '2026-11-20')).toBe(true);
    expect(parseBackup(JSON.stringify(makeBackup(d, false))).ok).toBe(true);
  });
});

describe('IndexedDB persistence', () => {
  it('saves atomically and loads back after reopening', async () => {
    const repo = await openRepo(userDbName('user-a'), { trackChanges: true });
    const first = await repo.load();
    expect(first.categories.length).toBe(BUILT_IN_CATEGORIES.length);
    const t = tx({ amount: 12000, date: '2026-11-20', categoryId: 'food', comment: 'Bought vegetables and other things for the week.' });
    await repo.commit({ putTransactions: [t], settings: { ...first.settings, onboarded: true } });
    repo.close();

    const again = await openRepo(userDbName('user-a'), { trackChanges: true });
    const loaded = await again.load();
    expect(loaded.transactions).toEqual([t]);
    expect(loaded.settings.onboarded).toBe(true);

    const other = await openRepo(userDbName('user-b'), { trackChanges: true });
    expect((await other.load()).transactions).toHaveLength(0); // each user has their own database
    other.close();
    const demo = await openRepo(DEMO_DB, { trackChanges: false });
    expect((await demo.load()).transactions).toHaveLength(0); // demo DB is separate
    demo.close();
  });
});

describe('built-in categories', () => {
  it('all have a known icon, a unique id and a name that fits', () => {
    expect(new Set(cats.map((c) => c.id)).size).toBe(cats.length);
    for (const c of cats) {
      expect(CATEGORY_ICONS[c.icon], `${c.id} icon`).toBeDefined();
      expect(c.name.length).toBeLessThanOrEqual(40);
      expect(c.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('adds new built-ins to an existing database, but not over a custom one with the same name', async () => {
    const repo = await openRepo(userDbName('user-upgrade'), { trackChanges: true });
    await repo.load();
    await repo.commit({ deleteCategories: ['fuel', 'salaries'] });
    await repo.commit({ putCategories: [{ id: 'cat_mine', name: 'fuel ', icon: 'sparkles', color: '#FACC15', builtIn: false, order: 50 }] });
    repo.close();

    const again = await openRepo(userDbName('user-upgrade'), { trackChanges: true });
    const loaded = await again.load();
    again.close();
    const names = loaded.categories.map((c) => c.name.trim().toLowerCase());
    expect(names.filter((n) => n === 'fuel')).toHaveLength(1); // the person's own, not a second one
    expect(loaded.categories.some((c) => c.id === 'salaries')).toBe(true); // re-added
  });
});

describe('database upgrade', () => {
  it('upgrades a v1 database (with balance checks) without losing entries', async () => {
    await deleteDatabase('spendnote');
    const old = await openDB('spendnote', 1, {
      upgrade(db) {
        db.createObjectStore('transactions', { keyPath: 'id' }).createIndex('byDate', 'date');
        db.createObjectStore('accounts', { keyPath: 'id' });
        db.createObjectStore('categories', { keyPath: 'id' });
        db.createObjectStore('checks', { keyPath: 'id' });
        db.createObjectStore('meta');
      },
    });
    const t = tx({ amount: 5000, date: '2026-11-20', accountId: 'acc_old', comment: 'Kept through the upgrade' });
    await old.put('transactions', t);
    await old.put('accounts', { id: 'acc_old', name: 'MoMo', method: 'momo', trackBalance: true, openingBalance: 100, openingDate: '2026-11-01', createdAt: 'x', updatedAt: 'y' });
    await old.put('checks', { id: 'chk', accountId: 'acc_old', date: '2026-11-20', actual: 1, expected: 1, createdAt: 'z' });
    old.close();

    const repo = await openRepo(LEGACY_DB, { trackChanges: false });
    const loaded = await repo.load();
    expect(loaded.transactions).toEqual([t]);
    expect(loaded.accounts).toEqual([{ id: 'acc_old', name: 'MoMo', method: 'momo', createdAt: 'x', updatedAt: 'y' }]);
    repo.close();
    const check = await openDB('spendnote');
    expect(check.objectStoreNames.contains('checks')).toBe(false);
    expect(check.objectStoreNames.contains('outbox')).toBe(true);
    check.close();
  });
});

describe('reminders', () => {
  it('finds the last scheduled time and only nags once', () => {
    const r = { enabled: true, weekday: 6, time: '18:00' };
    const now = new Date(2026, 10, 23, 9, 0); // Monday 23 Nov, 09:00
    expect(lastOccurrence(r, now)).toEqual(new Date(2026, 10, 22, 18, 0));
    const s = { currency: 'GHS' as const, onboarded: true, reminder: r, reminderAckAt: new Date(2026, 10, 20).toISOString() };
    expect(isReminderDue(s, now)).toBe(true);
    expect(isReminderDue({ ...s, reminderAckAt: new Date(2026, 10, 22, 19).toISOString() }, now)).toBe(false);
    expect(isReminderDue({ ...s, reminder: { ...r, enabled: false } }, now)).toBe(false);
  });
});
