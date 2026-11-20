/** A calendar date in the user's local time zone, formatted YYYY-MM-DD. */
export type ISODate = string;

export type TxType = 'expense' | 'income' | 'transfer';
export type PaymentMethod = 'cash' | 'momo' | 'bank' | 'card' | 'other';
export type CurrencyCode = 'GHS' | 'NGN' | 'KES' | 'ZAR' | 'USD' | 'EUR' | 'GBP';

/**
 * Every money value is stored as an integer number of minor units
 * (pesewas for GH₵), never as a floating-point amount.
 *
 * - expense:  money spent. `accountId` = account it was paid from (optional).
 * - income:   money in.    `accountId` = account it was received into (optional).
 * - transfer: money moved between the user's own accounts. A single record holds
 *             both sides (`accountId` = from, `toAccountId` = to), so it can never
 *             be half-created or half-edited. `null` on a side means "not listed".
 *
 * `fee` is an explicit transaction charge. It always counts as spending and is
 * reported under the "Fees & charges" category, separately from `amount`.
 */
export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  fee: number;
  date: ISODate;
  time: string | null;
  categoryId: string;
  method: PaymentMethod;
  comment: string;
  payee: string;
  accountId: string | null;
  toAccountId: string | null;
  importRef: string | null;
  sourceText: string | null;
  reviewed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  builtIn: boolean;
  order: number;
  /** When it was last changed on any device (used to resolve sync conflicts). Missing for untouched built-ins. */
  updatedAt?: string;
}

/** An optional label for where money is paid from or received into (e.g. "MoMo wallet"). */
export interface Account {
  id: string;
  name: string;
  method: PaymentMethod;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderPrefs {
  enabled: boolean;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  /** HH:MM, 24h, local time */
  time: string;
}

export interface Settings {
  currency: CurrencyCode;
  onboarded: boolean;
  reminder: ReminderPrefs;
  /** When the user last enabled, opened, or dismissed the weekly reminder. */
  reminderAckAt: string | null;
  /** When settings were last changed (used to resolve sync conflicts). */
  updatedAt?: string;
}

export interface AppData {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  settings: Settings;
}

export const PAYMENT_METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'momo', label: 'MoMo' },
  { id: 'bank', label: 'Bank' },
  { id: 'card', label: 'Card' },
  { id: 'other', label: 'Other' },
];

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  momo: 'MoMo',
  bank: 'Bank',
  card: 'Card',
  other: 'Other',
};

export const TYPE_LABEL: Record<TxType, string> = {
  expense: 'Expense',
  income: 'Money in',
  transfer: 'Transfer',
};

export const DEFAULT_SETTINGS: Settings = {
  currency: 'GHS',
  onboarded: false,
  reminder: { enabled: false, weekday: 6, time: '18:00' },
  reminderAckAt: null,
};
