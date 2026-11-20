import { deleteDB, openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import { BUILT_IN_CATEGORIES } from './categories';
import { EPOCH, editTime, type OutboxEntry, type RemoteRecord, type SyncRecord, type SyncTable } from './sync-types';
import type { Account, AppData, Category, Settings, Transaction } from './types';
import { DEFAULT_SETTINGS } from './types';

interface SpendNoteDB extends DBSchema {
  transactions: { key: string; value: Transaction; indexes: { byDate: string } };
  accounts: { key: string; value: Account };
  categories: { key: string; value: Category };
  meta: { key: string; value: unknown };
  outbox: { key: string; value: OutboxEntry };
}

type Store = StoreNames<SpendNoteDB>;

/*
 * One IndexedDB database per signed-in user, so two people sharing a device never see each
 * other's records. Demo data has its own database too, so it can never mix with real data.
 * "spendnote" is the database used before accounts existed; its records can be imported once.
 */
export const LEGACY_DB = 'spendnote';
export const DEMO_DB = 'spendnote-demo';
export const userDbName = (userId: string) => `spendnote-user-${userId}`;

const DB_VERSION = 3;
const DATA_STORES = ['transactions', 'accounts', 'categories', 'meta'] as const;
const ALL_STORES = [...DATA_STORES, 'outbox'] as const;

export interface Changes {
  putTransactions?: Transaction[];
  deleteTransactions?: string[];
  putAccounts?: Account[];
  deleteAccounts?: string[];
  putCategories?: Category[];
  deleteCategories?: string[];
  settings?: Settings;
}

export interface Repo {
  readonly persistent: boolean;
  load(): Promise<AppData>;
  /** Applies every change (and queues it for upload) in one atomic database transaction. */
  commit(changes: Changes): Promise<void>;
  replaceAll(data: AppData): Promise<void>;
  /** Local changes waiting to be uploaded. */
  outbox(): Promise<OutboxEntry[]>;
  /** Clears uploaded entries, unless they changed again while uploading. */
  ackOutbox(entries: OutboxEntry[]): Promise<void>;
  getRecords(table: SyncTable, ids: string[]): Promise<Map<string, SyncRecord>>;
  /** Applies changes from the server, keeping local edits that are newer. Returns how many records changed. */
  applyRemote(table: SyncTable, rows: RemoteRecord[]): Promise<number>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  close(): void;
}

function freshData(): AppData {
  return {
    transactions: [],
    accounts: [],
    categories: BUILT_IN_CATEGORIES.map((c) => ({ ...c })),
    settings: { ...DEFAULT_SETTINGS, reminder: { ...DEFAULT_SETTINGS.reminder } },
  };
}

let seqCounter = 0;
const nextSeq = () => Date.now() * 1000 + (seqCounter = (seqCounter + 1) % 1000);

const STORE_FOR: Record<Exclude<SyncTable, 'settings'>, 'transactions' | 'accounts' | 'categories'> = {
  transactions: 'transactions',
  accounts: 'accounts',
  categories: 'categories',
};

function entry(table: SyncTable, id: string, op: OutboxEntry['op'], at: string | undefined): OutboxEntry {
  return { key: `${table}:${id}`, table, id, op, seq: nextSeq(), at: at ?? EPOCH };
}

class IdbRepo implements Repo {
  readonly persistent = true;
  constructor(
    private db: IDBPDatabase<SpendNoteDB>,
    private trackChanges: boolean,
  ) {}

  async load(): Promise<AppData> {
    const tx = this.db.transaction(DATA_STORES, 'readonly');
    const [transactions, rawAccounts, categories, settings] = await Promise.all([
      tx.objectStore('transactions').getAll(),
      tx.objectStore('accounts').getAll(),
      tx.objectStore('categories').getAll(),
      tx.objectStore('meta').get('settings') as Promise<Settings | undefined>,
    ]);
    await tx.done;
    // Older versions stored balance-tracking fields on accounts; keep only what's used now.
    const accounts: Account[] = rawAccounts.map(({ id, name, method, createdAt, updatedAt }) => ({ id, name, method, createdAt, updatedAt }));
    const data: AppData = {
      transactions,
      accounts,
      categories,
      settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}), reminder: { ...DEFAULT_SETTINGS.reminder, ...(settings?.reminder ?? {}) } },
    };
    // Make sure the built-in categories always exist (first run, or after an upgrade adds one).
    const have = new Set(categories.map((c) => c.id));
    const missing = BUILT_IN_CATEGORIES.filter((c) => !have.has(c.id));
    if (missing.length) {
      await this.commit({ putCategories: missing });
      data.categories = [...categories, ...missing];
    }
    return data;
  }

  private queue(tx: IDBPTransaction<SpendNoteDB, Store[], 'readwrite'>, ops: Promise<unknown>[], e: OutboxEntry) {
    if (this.trackChanges) ops.push(tx.objectStore('outbox').put(e));
  }

  async commit(c: Changes): Promise<void> {
    const tx = this.db.transaction([...ALL_STORES], 'readwrite');
    const ops: Promise<unknown>[] = [];
    const deletedAt = new Date().toISOString();
    const put = <T extends { id: string }>(store: 'transactions' | 'accounts' | 'categories', table: SyncTable, list: T[] | undefined, at: (v: T) => string | undefined) =>
      list?.forEach((v) => {
        ops.push(tx.objectStore(store).put(v as never));
        this.queue(tx, ops, entry(table, v.id, 'upsert', at(v)));
      });
    const del = (store: 'transactions' | 'accounts' | 'categories', table: SyncTable, ids: string[] | undefined) =>
      ids?.forEach((id) => {
        ops.push(tx.objectStore(store).delete(id));
        this.queue(tx, ops, entry(table, id, 'delete', deletedAt));
      });
    put('transactions', 'transactions', c.putTransactions, (v) => v.updatedAt);
    del('transactions', 'transactions', c.deleteTransactions);
    put('accounts', 'accounts', c.putAccounts, (v) => v.updatedAt);
    del('accounts', 'accounts', c.deleteAccounts);
    put('categories', 'categories', c.putCategories, (v) => v.updatedAt);
    del('categories', 'categories', c.deleteCategories);
    if (c.settings) {
      ops.push(tx.objectStore('meta').put(c.settings, 'settings'));
      this.queue(tx, ops, entry('settings', 'settings', 'upsert', c.settings.updatedAt));
    }
    await Promise.all([...ops, tx.done]);
  }

  async replaceAll(data: AppData): Promise<void> {
    const tx = this.db.transaction([...ALL_STORES], 'readwrite');
    const ops: Promise<unknown>[] = [];
    const now = new Date().toISOString();
    if (this.trackChanges) {
      // Anything that exists now but not in the new data must be deleted on the server too.
      const keep = {
        transactions: new Set(data.transactions.map((t) => t.id)),
        accounts: new Set(data.accounts.map((a) => a.id)),
        categories: new Set(data.categories.map((c) => c.id)),
      };
      for (const store of ['transactions', 'accounts', 'categories'] as const) {
        for (const id of await tx.objectStore(store).getAllKeys()) {
          if (!keep[store].has(id)) this.queue(tx, ops, entry(store, id, 'delete', now));
        }
      }
    }
    for (const s of DATA_STORES) ops.push(tx.objectStore(s).clear());
    for (const t of data.transactions) {
      ops.push(tx.objectStore('transactions').put(t));
      this.queue(tx, ops, entry('transactions', t.id, 'upsert', t.updatedAt));
    }
    for (const a of data.accounts) {
      ops.push(tx.objectStore('accounts').put(a));
      this.queue(tx, ops, entry('accounts', a.id, 'upsert', a.updatedAt));
    }
    for (const c of data.categories) {
      ops.push(tx.objectStore('categories').put(c));
      this.queue(tx, ops, entry('categories', c.id, 'upsert', c.updatedAt));
    }
    ops.push(tx.objectStore('meta').put(data.settings, 'settings'));
    this.queue(tx, ops, entry('settings', 'settings', 'upsert', data.settings.updatedAt));
    await Promise.all([...ops, tx.done]);
  }

  async outbox(): Promise<OutboxEntry[]> {
    return this.db.getAll('outbox');
  }

  async ackOutbox(entries: OutboxEntry[]): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    for (const e of entries) {
      const current = await tx.store.get(e.key);
      if (current && current.seq === e.seq) await tx.store.delete(e.key);
    }
    await tx.done;
  }

  async getRecords(table: SyncTable, ids: string[]): Promise<Map<string, SyncRecord>> {
    const out = new Map<string, SyncRecord>();
    if (table === 'settings') {
      const s = (await this.db.get('meta', 'settings')) as Settings | undefined;
      if (s) out.set('settings', s);
      return out;
    }
    const tx = this.db.transaction(STORE_FOR[table], 'readonly');
    for (const id of ids) {
      const v = await tx.store.get(id);
      if (v) out.set(id, v);
    }
    await tx.done;
    return out;
  }

  async applyRemote(table: SyncTable, rows: RemoteRecord[]): Promise<number> {
    if (rows.length === 0) return 0;
    const store = table === 'settings' ? 'meta' : STORE_FOR[table];
    const tx = this.db.transaction([store, 'outbox'], 'readwrite');
    const outbox = tx.objectStore('outbox');
    let changed = 0;
    for (const row of rows) {
      const key = `${table}:${row.id}`;
      const pending = await outbox.get(key);
      if (pending) {
        // Our unsent edit is newer: keep it, it will be uploaded next.
        if (editTime(pending.at) > editTime(row.updatedAt)) continue;
        await outbox.delete(key);
      }
      const local = (await (tx.objectStore(store) as unknown as { get(k: string): Promise<SyncRecord | undefined> }).get(
        table === 'settings' ? 'settings' : row.id,
      )) as { updatedAt?: string } | undefined;
      if (row.deletedAt || !row.record) {
        if (table === 'settings' || !local) continue; // already gone here
        await (tx.objectStore(store) as unknown as { delete(k: string): Promise<void> }).delete(row.id);
      } else {
        // Same version we already have (e.g. re-read in the overlap window): nothing to do.
        if (local && editTime(local.updatedAt) === editTime(row.updatedAt)) continue;
        if (table === 'settings') await tx.objectStore('meta').put(row.record, 'settings');
        else await (tx.objectStore(store) as unknown as { put(v: SyncRecord): Promise<unknown> }).put(row.record);
      }
      changed++;
    }
    await tx.done;
    return changed;
  }

  getMeta<T>(key: string): Promise<T | undefined> {
    return this.db.get('meta', key) as Promise<T | undefined>;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put('meta', value, key);
  }

  close() {
    this.db.close();
  }
}

/** Used only if the browser refuses IndexedDB (some private-browsing modes). Nothing survives a reload. */
class MemoryRepo implements Repo {
  readonly persistent = false;
  private data = freshData();
  private meta = new Map<string, unknown>();
  async load() {
    return structuredClone(this.data);
  }
  async commit() {}
  async replaceAll(data: AppData) {
    this.data = structuredClone(data);
  }
  async outbox() {
    return [];
  }
  async ackOutbox() {}
  async getRecords() {
    return new Map<string, SyncRecord>();
  }
  async applyRemote() {
    return 0;
  }
  async getMeta<T>(key: string) {
    return this.meta.get(key) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, value);
  }
  close() {}
}

export async function openRepo(name: string, opts: { trackChanges: boolean }): Promise<Repo> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB');
    const db = await openDB<SpendNoteDB>(name, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          const t = database.createObjectStore('transactions', { keyPath: 'id' });
          t.createIndex('byDate', 'date');
          database.createObjectStore('accounts', { keyPath: 'id' });
          database.createObjectStore('categories', { keyPath: 'id' });
          database.createObjectStore('meta');
        }
        // v2 removed balance checks.
        const legacy = 'checks' as never;
        if (database.objectStoreNames.contains(legacy)) database.deleteObjectStore(legacy);
        // v3 added the upload queue for syncing.
        if (!database.objectStoreNames.contains('outbox')) database.createObjectStore('outbox', { keyPath: 'key' });
      },
      blocking() {
        // Another tab needs to upgrade or delete this database; let it.
        db.close();
      },
    });
    return new IdbRepo(db, opts.trackChanges);
  } catch {
    return new MemoryRepo();
  }
}

export async function deleteDatabase(name: string): Promise<void> {
  try {
    await deleteDB(name);
  } catch {
    /* nothing to delete */
  }
}

export function emptyData(): AppData {
  return freshData();
}
