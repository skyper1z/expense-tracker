import { addDays, isValidISODate, todayISO } from './dates';
import { parseMoneyInput } from './money';
import type { ISODate, TxType } from './types';

/*
 * Reads a pasted mobile-money confirmation message (MTN MoMo, Telecel Cash,
 * AT Money and similar). Everything here is a best guess: each field reports
 * whether it was found, needs checking, or is missing, and nothing uncertain
 * is silently filled in.
 */

export type FieldStatus = 'found' | 'check' | 'missing';

export interface Field<T> {
  value: T | null;
  status: FieldStatus;
  note?: string;
}

export type MomoDirection = 'sent' | 'received';
export type MomoKind = 'payment' | 'transfer' | 'cash_out' | 'cash_in' | 'airtime' | 'unknown';

export interface MomoFee {
  label: string;
  amount: number;
}

export interface MomoParse {
  /** False when we couldn't find an amount or a direction at all. */
  ok: boolean;
  amount: Field<number>;
  /** Explicit, non-zero fees and taxes found in the message. */
  fees: MomoFee[];
  feeTotal: number;
  /** Whether `amount` already includes the fee. Only meaningful when feeTotal > 0. */
  feeIncluded: 'yes' | 'no' | 'unknown';
  direction: Field<MomoDirection>;
  kind: MomoKind;
  suggestedType: TxType | null;
  /** False when the user must confirm whether it's an expense, money in or a transfer. */
  typeCertain: boolean;
  party: Field<string>;
  phone: string | null;
  date: Field<ISODate>;
  time: Field<string>;
  reference: Field<string>;
  /** The free-text "Reference:" the sender typed. Never auto-copied into the user's comment. */
  messageNote: string | null;
  balanceAfter: number | null;
  foundCount: number;
}

interface MoneyHit {
  start: number;
  end: number;
  value: number;
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
const CURRENCY_BEFORE = new RegExp(String.raw`(?:GHS|GH₵|GH¢|GHC|GH\s₵|₵|¢)\s?${NUM}(?!\d)`, 'gi');
const CURRENCY_AFTER = new RegExp(String.raw`(?<![\d.,])${NUM}\s?(?:GHS|cedis?)\b`, 'gi');
const BARE_DECIMAL = /(?<![\d/:.,-])(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?!\.?\d)(?![/:-]\d)/g;

function toMinor(numText: string): number | null {
  const r = parseMoneyInput(numText, { allowZero: true });
  return r.ok ? r.value : null;
}

function findMoney(text: string): MoneyHit[] {
  const hits: MoneyHit[] = [];
  const overlaps = (s: number, e: number) => hits.some((h) => s < h.end && e > h.start);
  for (const re of [CURRENCY_BEFORE, CURRENCY_AFTER, BARE_DECIMAL]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      const value = toMinor(m[1]);
      if (value !== null) hits.push({ start, end, value });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

type MoneyClass = 'principal' | 'balance' | 'fee' | 'tax' | 'total';

const BALANCE_KW = /\b(?:balance|bal)\b/i;
const TAX_KW = /\b(?:tax|taxes|levy|e-?levy|vat)\b/i;
const FEE_KW = /\b(?:fee|fees|charge|charges|charged|commission)\b/i;
const TOTAL_KW = /\btotal\b/i;

function classify(text: string, hit: MoneyHit, prevEnd: number): MoneyClass {
  const before = text.slice(0, hit.start);
  // Start of the current sentence: a full stop followed by a space, or a newline.
  let boundary = 0;
  const b = /(?:[.!?;](?=\s)|\n)/g;
  let m: RegExpExecArray | null;
  while ((m = b.exec(before))) boundary = m.index + 1;
  const segment = before.slice(Math.max(boundary, prevEnd));
  if (BALANCE_KW.test(segment)) return 'balance';
  if (TAX_KW.test(segment)) return 'tax';
  if (FEE_KW.test(segment)) return 'fee';
  if (TOTAL_KW.test(segment)) return 'total';
  return 'principal';
}

const SENT_PATTERNS = [
  /\bpayment made\b/i,
  /\byou (?:have )?(?:sent|paid|transferred)\b/i,
  /\byour payment\b/i,
  /\bpayment (?:of|for)\b.{0,60}?\bto\b/i,
  /\bsent to\b/i,
  /\bpaid to\b/i,
  /\btransfer(?:red)? to\b/i,
  /\bcash[\s-]?out\b/i,
  /\bwithdraw(?:al|n)?\b/i,
  /\bdebited\b/i,
  /\bpurchased?\b/i,
  /\bairtime\b/i,
];

const RECEIVED_PATTERNS = [
  /\bpayment received\b/i,
  /\byou (?:have )?received\b/i,
  /\breceived (?:GHS|GH₵|GH¢|₵|¢|\d|a payment)/i,
  /\bcash[\s-]?in\b/i,
  /\bcredited\b/i,
  /\bdeposit(?:ed)?\b/i,
];

function detectKind(text: string, direction: MomoDirection | null): MomoKind {
  if (/\bcash[\s-]?out\b|\bwithdraw/i.test(text)) return 'cash_out';
  if (/\bcash[\s-]?in\b|\bdeposit/i.test(text)) return 'cash_in';
  if (/\bairtime\b|\bdata bundle|\bbundle purchase/i.test(text)) return 'airtime';
  if (/\bpayment made\b|\bmerchant\b|\bpaid to\b|\bpurchase|\bbill pay/i.test(text)) return 'payment';
  if (direction) return 'transfer';
  return 'unknown';
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s'’\-.])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());

function cleanName(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim().replace(/[.,;:\-]+$/, '').trim();
  if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) s = titleCase(s);
  return s;
}

const NAME_STOP = String.raw`(?=\s*(?:\(|\+?\d{9,}|[.,;](?:\s|$)|$|\b(?:on|at|current|reference|ref|has|have|with|transaction|trans|fee|your|via|for|and|new|available|balance|bal|id|financial|is|was)\b))`;
const NAME = String.raw`([A-Za-z][A-Za-z0-9&'’.\- ]{0,60}?)`;
const PHONE = String.raw`(\+?\d{9,13})`;

function findParty(text: string, direction: MomoDirection | null, after: number) {
  const word = direction === 'received' ? 'from' : 'to';
  const tail = text.slice(after);
  const re = new RegExp(String.raw`\b${word}\s+(?:${PHONE}\s+)?${NAME}${NAME_STOP}`, 'i');
  const m = re.exec(tail);
  let phone: string | null = null;
  let name: string | null = null;
  if (m) {
    phone = m[1] ?? null;
    name = cleanName(m[2]);
    if (!phone) {
      const rest = tail.slice(m.index + m[0].length);
      const pm = /^\s*\(?\s*(\+?\d{9,13})\s*\)?/.exec(rest);
      if (pm) phone = pm[1];
    }
  } else {
    const pm = new RegExp(String.raw`\b${word}\s+${PHONE}`, 'i').exec(tail);
    if (pm) phone = pm[1];
  }
  if (name && /^(you|your|me|my)$/i.test(name)) name = null;
  return { name, phone };
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function monthFromName(name: string): number | null {
  const key = name.toLowerCase().slice(0, name.toLowerCase().startsWith('sept') ? 4 : 3);
  return MONTH_INDEX[key] ?? null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function makeDate(y: number, m: number, d: number): ISODate | null {
  const year = y < 100 ? 2000 + y : y;
  const iso = `${year}-${pad(m)}-${pad(d)}`;
  return isValidISODate(iso) ? iso : null;
}

function findDate(text: string, today: ISODate): { date: Field<ISODate>; dateEnd: number } {
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (m) {
    const iso = makeDate(+m[1], +m[2], +m[3]);
    if (iso) return { date: withFutureCheck({ value: iso, status: 'found' }, today), dateEnd: m.index + m[0].length };
  }
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(text);
  if (m) {
    const d = +m[1];
    const mo = +m[2];
    const iso = makeDate(+m[3], mo, d);
    if (iso) {
      const ambiguous = d <= 12 && mo <= 12 && d !== mo;
      const field: Field<ISODate> = ambiguous
        ? { value: iso, status: 'check', note: `Read as day/month (${m[0]}). Check it's right.` }
        : { value: iso, status: 'found' };
      return { date: withFutureCheck(field, today), dateEnd: m.index + m[0].length };
    }
  }
  m = /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]([A-Za-z]{3,9})[\s,-]+(\d{4}|\d{2})\b/.exec(text);
  if (m && monthFromName(m[2])) {
    const iso = makeDate(+m[3], monthFromName(m[2])!, +m[1]);
    if (iso) return { date: withFutureCheck({ value: iso, status: 'found' }, today), dateEnd: m.index + m[0].length };
  }
  m = /\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/.exec(text);
  if (m && monthFromName(m[1])) {
    const iso = makeDate(+m[3], monthFromName(m[1])!, +m[2]);
    if (iso) return { date: withFutureCheck({ value: iso, status: 'found' }, today), dateEnd: m.index + m[0].length };
  }
  return { date: { value: null, status: 'missing', note: 'No date in the message.' }, dateEnd: 0 };
}

function withFutureCheck(f: Field<ISODate>, today: ISODate): Field<ISODate> {
  if (f.value && f.value > addDays(today, 1)) {
    return { ...f, status: 'check', note: 'This date is in the future. Check it’s right.' };
  }
  return f;
}

function findTime(text: string, from: number): Field<string> {
  const re = /(?<![\d:])(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?\.?\s*([Mm])?\.?/g;
  const search = (start: number) => {
    re.lastIndex = start;
    return re.exec(text);
  };
  const m = search(from) ?? search(0);
  if (!m) return { value: null, status: 'missing' };
  let h = +m[1];
  const min = +m[2];
  const ampm = m[3] && m[4] ? m[3].toLowerCase() : null;
  if (ampm === 'p' && h < 12) h += 12;
  if (ampm === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return { value: null, status: 'missing' };
  return { value: `${pad(h)}:${pad(min)}`, status: 'found' };
}

const REF_PATTERNS = [
  /\bFinancial\s+Transaction\s+Id\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9.\-]{3,})/i,
  /\bTrans(?:action)?\.?\s*ID\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9.\-]{3,})/i,
  /\bTxn\.?\s*(?:ID)?\s*[:#]\s*([A-Za-z0-9][A-Za-z0-9.\-]{3,})/i,
  /\bTID\s*[:#]?\s*([A-Za-z0-9]{4,})/,
  /^\s*([A-Z0-9]{8,})\s+Confirmed\b/i,
  /\bRef(?:erence)?\s*(?:No\.?|Number|#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9.\-]{3,})/i,
];

function findReference(text: string): Field<string> {
  for (const re of REF_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const v = m[1].replace(/[.\-]+$/, '');
      if (v.length >= 4 && /\d/.test(v)) return { value: v, status: 'found' };
    }
  }
  return { value: null, status: 'missing', note: 'No transaction ID in the message.' };
}

function findMessageNote(text: string): string | null {
  const m = /\bReference\s*:\s*([^\n]*?)(?=\.\s|\.$|\n|$)/i.exec(text);
  if (!m) return null;
  const v = m[1].trim();
  if (!v || /^(-|n\/?a|null|none|\.)$/i.test(v)) return null;
  return v.slice(0, 200);
}

export function parseMomoMessage(raw: string, today: ISODate = todayISO()): MomoParse {
  const text = raw.replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').trim();

  // Money
  const hits = findMoney(text);
  const classified = hits.map((h, i) => ({ ...h, cls: classify(text, h, i > 0 ? hits[i - 1].end : 0) }));
  const principal = classified.find((h) => h.cls === 'principal') ?? null;
  const total = classified.find((h) => h.cls === 'total') ?? null;
  const balance = classified.find((h) => h.cls === 'balance') ?? null;
  const fees: MomoFee[] = classified
    .filter((h) => (h.cls === 'fee' || h.cls === 'tax') && h.value > 0)
    .map((h) => ({ label: h.cls === 'tax' ? 'Tax / levy' : 'Fee', amount: h.value }));
  const feeTotal = fees.reduce((s, f) => s + f.amount, 0);

  let amount: Field<number> = { value: null, status: 'missing', note: 'We couldn’t find the amount.' };
  let feeIncluded: MomoParse['feeIncluded'] = 'unknown';
  if (principal) {
    amount = { value: principal.value, status: 'found' };
    if (total && feeTotal > 0) {
      if (total.value === principal.value + feeTotal) feeIncluded = 'no';
      else if (total.value === principal.value) feeIncluded = 'yes';
    }
  } else if (total) {
    amount = { value: total.value, status: 'check', note: 'Only a total was found.' };
    if (feeTotal > 0) feeIncluded = 'yes';
  }
  if (feeTotal > 0 && feeIncluded === 'unknown') {
    if (/\b(?:incl\.?|including|inclusive of)\s+(?:the\s+|all\s+)?(?:fees?|charges?)\b|\bfees?\s+(?:included|inclusive)\b/i.test(text)) {
      feeIncluded = 'yes';
    } else if (/\b(?:excl\.?|excluding|exclusive of|plus)\s+(?:the\s+)?(?:fees?|charges?)\b/i.test(text)) {
      feeIncluded = 'no';
    }
  }

  // Direction
  const sent = SENT_PATTERNS.filter((p) => p.test(text)).length;
  const received = RECEIVED_PATTERNS.filter((p) => p.test(text)).length;
  let direction: Field<MomoDirection>;
  if (sent > 0 && received === 0) direction = { value: 'sent', status: 'found' };
  else if (received > 0 && sent === 0) direction = { value: 'received', status: 'found' };
  else if (sent !== received) {
    direction = {
      value: sent > received ? 'sent' : 'received',
      status: 'check',
      note: 'The message mentions both sending and receiving.',
    };
  } else direction = { value: null, status: 'missing', note: 'We couldn’t tell if money was sent or received.' };

  const kind = detectKind(text, direction.value);
  let suggestedType: TxType | null = null;
  let typeCertain = false;
  if (kind === 'cash_out' || kind === 'cash_in') suggestedType = 'transfer';
  else if (direction.value === 'sent') {
    suggestedType = 'expense';
    typeCertain = direction.status === 'found' && (kind === 'payment' || kind === 'airtime');
  } else if (direction.value === 'received') suggestedType = 'income';

  // Party
  const { name, phone } = findParty(text, direction.value, principal?.start ?? 0);
  const party: Field<string> = name
    ? { value: name, status: 'found' }
    : phone
      ? { value: phone, status: 'check', note: 'Only a phone number was found.' }
      : { value: null, status: 'missing', note: 'No name in the message.' };

  // Date, time, reference
  const { date, dateEnd } = findDate(text, today);
  const time = findTime(text, dateEnd);
  const reference = findReference(text);

  const foundCount = [amount, direction, party, date, time, reference].filter((f) => f.value !== null).length +
    (feeTotal > 0 ? 1 : 0);

  return {
    ok: amount.value !== null || direction.value !== null,
    amount,
    fees,
    feeTotal,
    feeIncluded,
    direction,
    kind,
    suggestedType,
    typeCertain,
    party,
    phone,
    date,
    time,
    reference,
    messageNote: findMessageNote(text),
    balanceAfter: balance?.value ?? null,
    foundCount,
  };
}
