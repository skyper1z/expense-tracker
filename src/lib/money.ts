import type { CurrencyCode } from './types';

export interface CurrencyInfo {
  code: CurrencyCode;
  symbol: string;
  name: string;
}

/** Only two-decimal currencies, so minor units mean the same thing for all of them. */
export const CURRENCIES: CurrencyInfo[] = [
  { code: 'GHS', symbol: 'GH₵', name: 'Ghana cedi' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian naira' },
  { code: 'KES', symbol: 'KSh ', name: 'Kenyan shilling' },
  { code: 'ZAR', symbol: 'R ', name: 'South African rand' },
  { code: 'USD', symbol: '$', name: 'US dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British pound' },
];

export function currencyInfo(code: CurrencyCode): CurrencyInfo {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

export function isCurrencyCode(v: unknown): v is CurrencyCode {
  return typeof v === 'string' && CURRENCIES.some((c) => c.code === v);
}

/** Largest amount we accept: 999,999,999.99 */
export const MAX_MINOR = 99_999_999_999;

function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Format integer minor units, e.g. 12050 → "GH₵120.50". Negative values use a true minus sign. */
export function formatMoney(
  minor: number,
  currency: CurrencyCode,
  opts: { signed?: boolean; hideSymbol?: boolean } = {},
): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const sym = opts.hideSymbol ? '' : currencyInfo(currency).symbol;
  const sign = negative ? '−' : opts.signed && abs > 0 ? '+' : '';
  return `${sign}${sym}${groupDigits(whole)}.${frac}`;
}

/** Plain decimal string for inputs and CSV, e.g. 12050 → "120.50". */
export function minorToDecimal(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Input-friendly string: drops ".00" so editing feels natural. */
export function minorToInput(minor: number): string {
  const s = minorToDecimal(minor);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}

export type MoneyParse = { ok: true; value: number } | { ok: false; error: string };

/**
 * Parse what a person typed into a money field. Uses string arithmetic so
 * "0.1" + "0.2" style float errors can never creep in.
 */
export function parseMoneyInput(
  raw: string,
  opts: { allowNegative?: boolean; allowZero?: boolean; label?: string } = {},
): MoneyParse {
  const label = opts.label ?? 'an amount';
  const cleaned = raw
    .trim()
    .replace(/[\s ]/g, '')
    .replace(/^(GH₵|GH¢|GHS|₵|¢|₦|KSh|R|\$|€|£)/i, '')
    .replace(/−/g, '-');
  if (cleaned === '' || cleaned === '-') return { ok: false, error: `Enter ${label}` };

  let s = cleaned;
  let negative = false;
  if (s.startsWith('-')) {
    if (!opts.allowNegative) return { ok: false, error: 'Enter a positive amount' };
    negative = true;
    s = s.slice(1);
  }
  // Thousands separators are fine only in the right places: 1,200.50
  if (s.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) {
      return { ok: false, error: 'Use numbers only, like 120 or 45.50' };
    }
    s = s.replace(/,/g, '');
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) {
    return { ok: false, error: 'Use numbers only, like 120 or 45.50' };
  }
  const [wholePart, fracPart = ''] = s.split('.');
  if (fracPart.length > 2) return { ok: false, error: 'Use at most 2 decimal places' };
  const whole = wholePart === '' ? 0 : Number(wholePart);
  if (wholePart.length > 12 || !Number.isSafeInteger(whole)) {
    return { ok: false, error: 'That amount is too large' };
  }
  const value = whole * 100 + Number(fracPart.padEnd(2, '0') || '0');
  if (value > MAX_MINOR) return { ok: false, error: 'That amount is too large' };
  if (value === 0 && !opts.allowZero) return { ok: false, error: 'Amount must be more than zero' };
  return { ok: true, value: negative ? -value : value };
}
