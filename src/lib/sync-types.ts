import type { Account, Category, Settings, Transaction } from './types';

export type SyncTable = 'transactions' | 'accounts' | 'categories' | 'settings';
export const SYNC_TABLES: SyncTable[] = ['settings', 'categories', 'accounts', 'transactions'];

export type SyncRecord = Transaction | Account | Category | Settings;

/** A local change waiting to be uploaded. One entry per record (the latest change wins). */
export interface OutboxEntry {
  key: string; // `${table}:${id}`
  table: SyncTable;
  id: string;
  op: 'upsert' | 'delete';
  /** Increases with every local change, so an upload only clears entries that didn't change meanwhile. */
  seq: number;
  /** The edit time of this change (record.updatedAt, or when it was deleted). */
  at: string;
}

/** A record as stored on the server. */
export interface RemoteRecord {
  id: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Raw server timestamp, used as the "changes since" cursor. */
  serverUpdatedAt: string;
  record: SyncRecord | null;
}

export const EPOCH = '1970-01-01T00:00:00.000Z';

export const editTime = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : 0;
  return Number.isNaN(t) ? 0 : t;
};
