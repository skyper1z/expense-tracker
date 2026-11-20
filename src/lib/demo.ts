import { BUILT_IN_CATEGORIES } from './categories';
import { addDays, weekdayIndex } from './dates';
import type { Account, AppData, ISODate, PaymentMethod, Transaction } from './types';
import { DEFAULT_SETTINGS } from './types';

/** Small seeded PRNG so the demo looks the same on every run. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS = 62;

export function buildDemoData(today: ISODate): AppData {
  const rand = mulberry32(20261120);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const cedis = (min: number, max: number) => Math.round((min + rand() * (max - min)) * 2) * 50;
  const start = addDays(today, -DAYS);
  const ts = (date: ISODate, h = 12) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00`).toISOString();

  const accounts: Account[] = [
    { id: 'demo_acc_momo', name: 'MoMo wallet', method: 'momo', createdAt: ts(start), updatedAt: ts(start) },
    { id: 'demo_acc_bank', name: 'Bank current account', method: 'bank', createdAt: ts(start), updatedAt: ts(start) },
    { id: 'demo_acc_card', name: 'Debit card', method: 'card', createdAt: ts(start), updatedAt: ts(start) },
  ];
  const accountFor: Record<PaymentMethod, string | null> = {
    momo: 'demo_acc_momo', bank: 'demo_acc_bank', card: 'demo_acc_card', cash: null, other: null,
  };

  const txs: Transaction[] = [];
  let n = 0;
  const add = (p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'date'>) => {
    n += 1;
    const created = ts(p.date, 8 + (n % 12));
    const method = p.method ?? 'cash';
    txs.push({
      id: `demo_tx_${String(n).padStart(4, '0')}`,
      fee: 0,
      time: null,
      categoryId: 'other',
      method,
      comment: '',
      payee: '',
      accountId: p.type === 'expense' ? accountFor[method] : null,
      toAccountId: null,
      importRef: null,
      sourceText: null,
      reviewed: false,
      createdAt: created,
      updatedAt: created,
      ...p,
    });
  };

  const food = [
    { payee: 'Makola market', comment: 'Bought vegetables and other things for the week.' },
    { payee: 'Supermarket', comment: 'Rice, cooking oil, eggs and bread.' },
    { payee: 'Chop bar', comment: 'Lunch with Kwesi after the site visit.' },
    { payee: 'Waakye joint', comment: 'Breakfast before work.' },
    { payee: 'Fruit seller', comment: 'Pineapples and bananas for the house.' },
    { payee: 'Bakery', comment: 'Bread and pastries for Sunday morning.' },
  ];
  const shopping = [
    { payee: 'Tailor', comment: 'Paid balance for the kaba and slit for Ama’s wedding.' },
    { payee: 'Phone accessories shop', comment: 'New charger — the old one stopped working.' },
    { payee: 'Shoe shop', comment: 'Work shoes. The old pair was falling apart, so I finally replaced them after putting it off for weeks. Should last the year if I take care of them.' },
    { payee: 'Hardware store', comment: 'Bulbs and an extension board for the hall.' },
  ];
  const fun = [
    { payee: 'Cinema', comment: 'Movie night with the cousins.' },
    { payee: 'Streaming subscription', comment: 'Monthly subscription.' },
    { payee: 'Beach day', comment: 'Entry and drinks at Labadi with friends.' },
  ];
  const health = [
    { payee: 'Pharmacy', comment: 'Malaria test and drugs for Kojo.' },
    { payee: 'Pharmacy', comment: 'Vitamins and pain relief.' },
  ];

  for (let d = DAYS; d >= 0; d--) {
    const date = addDays(today, -d);
    const wd = weekdayIndex(date);
    if (wd < 5 && rand() < 0.8) {
      add({ type: 'expense', amount: cedis(9, 16), date, categoryId: 'transport', method: 'cash', payee: 'Trotro', comment: 'Trotro to work and back.' });
    }
    if (rand() < 0.16) {
      const m = pick<PaymentMethod>(['momo', 'card']);
      add({ type: 'expense', amount: cedis(35, 75), date, categoryId: 'transport', method: m, payee: 'Ride-hailing', comment: pick(['Ride home after late shift.', 'Ride to Osu for the meeting.', 'Taxi to the airport to pick up Auntie.']) });
    }
    if (rand() < 0.5) {
      const f = pick(food);
      add({ type: 'expense', amount: f.payee === 'Makola market' || f.payee === 'Supermarket' ? cedis(90, 260) : cedis(20, 70), date, categoryId: 'food', method: pick<PaymentMethod>(['cash', 'cash', 'momo', 'card']), ...f });
    }
    if (rand() < 0.07) {
      const s = pick(shopping);
      add({ type: 'expense', amount: cedis(60, 480), date, categoryId: 'shopping', method: pick<PaymentMethod>(['card', 'cash', 'momo']), ...s });
    }
    if (wd >= 4 && rand() < 0.22) {
      const e = pick(fun);
      add({ type: 'expense', amount: cedis(40, 160), date, categoryId: 'entertainment', method: pick<PaymentMethod>(['card', 'momo']), ...e });
    }
    if (rand() < 0.05) {
      const h = pick(health);
      add({ type: 'expense', amount: cedis(35, 140), date, categoryId: 'health', method: 'momo', ...h });
    }
    if (wd === 0) {
      add({ type: 'expense', amount: 5000, date, categoryId: 'bills', method: 'momo', payee: 'Data bundle', comment: 'Weekly internet bundle.' });
    }
    if (d % 28 === 3) {
      add({ type: 'expense', amount: 20000, date, categoryId: 'bills', method: 'momo', payee: 'Electricity (prepaid)', comment: 'Prepaid units for the month.' });
      add({ type: 'expense', amount: 6500, date, categoryId: 'bills', method: 'bank', payee: 'Water bill', comment: 'Monthly water bill.' });
    }
    if (d === 54 || d === 24) {
      add({ type: 'income', amount: 520000, date, method: 'bank', accountId: 'demo_acc_bank', payee: 'Salary', comment: 'Monthly salary.' });
    }
    if (d === 40) {
      add({ type: 'income', amount: 35000, date, method: 'momo', accountId: 'demo_acc_momo', payee: 'Efua Boateng', comment: 'Paid back what she borrowed in September.' });
    }
    if (d === 52 || d === 22) {
      add({ type: 'transfer', amount: 60000, fee: 200, date, method: 'bank', accountId: 'demo_acc_bank', toAccountId: 'demo_acc_momo', payee: '', comment: 'Topped up MoMo wallet from the bank.' });
    }
    if (d === 15) {
      add({ type: 'transfer', amount: 20000, fee: 200, date, method: 'momo', accountId: 'demo_acc_momo', toAccountId: null, payee: 'MoMo agent', comment: 'Cashed out for market money.' });
    }
  }

  // A pasted MoMo message, with an explicit fee charged on top of the payment.
  const momoDate = addDays(today, -2);
  const [y, m, dd] = momoDate.split('-');
  add({
    type: 'expense', amount: 15000, fee: 150, date: momoDate, time: '15:58', categoryId: 'bills', method: 'momo',
    accountId: 'demo_acc_momo', payee: 'Kofi Mensah', comment: 'Gas refill — Kofi delivered two cylinders.',
    importRef: '50123456789',
    sourceText: `Your payment of GHS 150.00 to KOFI MENSAH 0241234567 has been completed at ${y}-${m}-${dd} 15:58:12. Reference: gas. Your new balance: GHS 412.30. Fee was GHS 1.50 Tax was GHS 0.00. Financial Transaction Id: 50123456789.`,
  });

  // Leave a few recent expenses without notes so Review has something to show.
  const recent = txs
    .filter((t) => t.type === 'expense' && t.date >= addDays(today, -12) && t.categoryId !== 'transport' && !t.importRef)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  recent.slice(0, 5).forEach((t, i) => {
    t.comment = '';
    if (i === 4) t.reviewed = true;
  });

  return {
    transactions: txs,
    accounts,
    categories: BUILT_IN_CATEGORIES.map((c) => ({ ...c })),
    settings: { ...DEFAULT_SETTINGS, onboarded: true, reminder: { ...DEFAULT_SETTINGS.reminder } },
  };
}
