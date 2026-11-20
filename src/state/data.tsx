import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { OTHER_CATEGORY_ID } from '../lib/categories';
import { DEMO_DB, deleteDatabase, emptyData, LEGACY_DB, openRepo, userDbName, type Changes, type Repo } from '../lib/db';
import { todayISO } from '../lib/dates';
import { buildDemoData } from '../lib/demo';
import { nowIso } from '../lib/ids';
import { createSupabaseRemote } from '../lib/remote';
import { supabase } from '../lib/supabase';
import { syncOnce } from '../lib/sync';
import type { Account, AppData, Category, Settings, Transaction } from '../lib/types';
import { useAuth } from './auth';

export type DataMode = 'real' | 'demo';

const MODE_KEY = 'spendnote.mode';
const INITIAL_SYNC_KEY = 'sync.initialDone';

function readMode(): DataMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'real';
  } catch {
    return 'real';
  }
}

function writeMode(m: DataMode) {
  try {
    if (m === 'demo') localStorage.setItem(MODE_KEY, 'demo');
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* storage blocked */
  }
}

function upsert<T extends { id: string }>(list: T[], put?: T[], del?: string[]): T[] {
  if (!put?.length && !del?.length) return list;
  const map = new Map(list.map((x) => [x.id, x]));
  del?.forEach((id) => map.delete(id));
  put?.forEach((x) => map.set(x.id, x));
  return [...map.values()];
}

function applyChanges(d: AppData, c: Changes): AppData {
  return {
    transactions: upsert(d.transactions, c.putTransactions, c.deleteTransactions),
    accounts: upsert(d.accounts, c.putAccounts, c.deleteAccounts),
    categories: upsert(d.categories, c.putCategories, c.deleteCategories),
    settings: c.settings ?? d.settings,
  };
}

/** Stamps every record with the current time so a restored backup wins over older server copies. */
function stampAll(d: AppData): AppData {
  const ts = nowIso();
  return {
    transactions: d.transactions.map((t) => ({ ...t, updatedAt: ts })),
    accounts: d.accounts.map((a) => ({ ...a, updatedAt: ts })),
    categories: d.categories.map((c) => ({ ...c, updatedAt: ts })),
    settings: { ...d.settings, updatedAt: ts },
  };
}

export interface SyncState {
  /** off: demo mode or no backend configured. */
  status: 'off' | 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: string | null;
  /** Local changes not yet saved to the account. */
  pending: number;
  error: string | null;
  /** True on a device's first sign-in until the account's records have been downloaded. */
  initialPending: boolean;
}

export interface LegacySummary {
  transactions: number;
  data: AppData;
}

export interface DataApi {
  ready: boolean;
  mode: DataMode;
  persistent: boolean;
  data: AppData;
  sync: SyncState;
  categoryMap: Map<string, Category>;
  accountMap: Map<string, Account>;
  knownCategories: Set<string>;
  saveTransaction(tx: Transaction): Promise<void>;
  patchTransaction(id: string, patch: Partial<Transaction>): Promise<void>;
  deleteTransaction(id: string): Promise<Transaction | null>;
  restoreTransaction(tx: Transaction): Promise<void>;
  saveAccount(a: Account): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  saveCategory(c: Category): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  replaceAll(data: AppData): Promise<void>;
  eraseAll(): Promise<void>;
  enterDemo(): Promise<void>;
  exitDemo(): Promise<void>;
  /** Push and pull now. Resolves when finished (or immediately when sync is off). */
  syncNow(): Promise<void>;
  countPending(): Promise<number>;
  skipInitialSync(): void;
  /** Records saved on this device before accounts existed, if any. */
  findLegacyRecords(): Promise<LegacySummary | null>;
  importLegacyRecords(legacy: AppData): Promise<void>;
  discardLegacyRecords(): Promise<void>;
}

const DataContext = createContext<DataApi | null>(null);

const SYNC_OFF: SyncState = { status: 'off', lastSyncedAt: null, pending: 0, error: null, initialPending: false };

function errorText(e: unknown): string {
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  return m || 'Unknown error';
}

export function DataProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const userId = auth.status === 'signed-in' ? auth.user!.id : null;
  const [mode, setMode] = useState<DataMode>(readMode);
  /** Bumped to force a reload even when the database doesn't change (e.g. resetting the demo). */
  const [epoch, setEpoch] = useState(0);
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [data, setData] = useState<AppData>(emptyData);
  const [sync, setSync] = useState<SyncState>(SYNC_OFF);
  const repoRef = useRef<Repo | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const channel = useRef<BroadcastChannel | null>(null);
  const syncRun = useRef<(() => Promise<void>) | null>(null);
  const syncTimer = useRef<number | undefined>(undefined);

  /** No backend configured (e.g. `npm run dev` before setting up Supabase): records stay on this device only. */
  const localOnly = auth.status === 'unconfigured';
  const dbName = mode === 'demo' ? DEMO_DB : localOnly ? LEGACY_DB : userId ? userDbName(userId) : null;
  const syncing = mode === 'real' && !!userId && !!supabase;

  // Open the right database (demo, or the signed-in user's) and load everything into memory.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setData(emptyData());
    setSync(SYNC_OFF);
    if (!dbName) return;
    openRepo(dbName, { trackChanges: syncing }).then(async (repo) => {
      if (cancelled) {
        repo.close();
        return;
      }
      repoRef.current = repo;
      setPersistent(repo.persistent);
      const loaded = await repo.load();
      const firstSync = syncing && !(await repo.getMeta<boolean>(INITIAL_SYNC_KEY));
      if (!cancelled) {
        setData(loaded);
        setSync({ ...SYNC_OFF, initialPending: firstSync });
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
      repoRef.current?.close();
      repoRef.current = null;
    };
  }, [dbName, epoch]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Re-reads everything from the database, in order with any writes already queued. */
  const reload = useCallback(() => {
    const run = queue.current.then(async () => {
      const repo = repoRef.current;
      if (repo) setData(await repo.load());
    });
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  // Sync with the account while signed in (not in demo mode).
  useEffect(() => {
    if (!ready || !syncing || !repoRef.current) {
      syncRun.current = null;
      return;
    }
    const repo = repoRef.current;
    const remote = createSupabaseRemote(supabase!, userId!);
    let running: Promise<void> | null = null;
    let again = false;
    let disposed = false;

    const pendingCount = async () => (await repo.outbox()).length;

    const run = async (): Promise<void> => {
      if (disposed) return;
      if (running) {
        again = true;
        return running;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const pending = await pendingCount();
        if (!disposed) setSync((s) => ({ ...s, status: 'offline', pending }));
        return;
      }
      running = (async () => {
        setSync((s) => ({ ...s, status: 'syncing' }));
        try {
          const res = await syncOnce(repo, remote);
          if (disposed) return;
          if (res.pulled > 0) await reload();
          await repo.setMeta(INITIAL_SYNC_KEY, true);
          const pending = await pendingCount();
          if (!disposed) setSync({ status: 'idle', lastSyncedAt: nowIso(), pending, error: null, initialPending: false });
        } catch (e) {
          if (disposed) return;
          const pending = await pendingCount().catch(() => 0);
          setSync((s) => ({ ...s, status: navigator.onLine === false ? 'offline' : 'error', error: errorText(e), pending }));
        }
      })();
      try {
        await running;
      } finally {
        running = null;
        if (again && !disposed) {
          again = false;
          void run();
        }
      }
    };

    syncRun.current = run;
    void run();
    const interval = window.setInterval(() => void run(), 60_000);
    const onOnline = () => void run();
    const onOffline = () => setSync((s) => ({ ...s, status: 'offline' }));
    const onVisible = () => document.visibilityState === 'visible' && void run();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      syncRun.current = null;
      window.clearInterval(interval);
      window.clearTimeout(syncTimer.current);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, syncing, userId, reload]);

  /** Uploads shortly after a change, batching quick successive edits. */
  const scheduleSync = useCallback(() => {
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => void syncRun.current?.(), 1000);
  }, []);

  // Keep other open tabs in step.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('spendnote');
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<{ db: string | null; switched?: boolean }>) => {
      if (e.data.switched) {
        setMode(readMode());
        return;
      }
      if (e.data.db && e.data.db === dbName) void reload();
    };
    return () => ch.close();
  }, [dbName, reload]);

  const notifyTabs = useCallback(() => channel.current?.postMessage({ db: dbName }), [dbName]);

  /** Every write goes through here: one atomic DB transaction, applied in order, then mirrored in memory. */
  const commit = useCallback(
    (changes: Changes) => {
      const run = queue.current.then(async () => {
        const repo = repoRef.current;
        if (!repo) throw new Error('Storage is not ready yet.');
        await repo.commit(changes);
        setData((d) => applyChanges(d, changes));
        notifyTabs();
        if (syncRun.current) {
          setSync((s) => ({ ...s, pending: s.pending + 1 }));
          scheduleSync();
        }
      });
      queue.current = run.catch(() => undefined);
      return run;
    },
    [notifyTabs, scheduleSync],
  );

  const replaceWith = useCallback(
    async (next: AppData) => {
      const repo = repoRef.current;
      if (!repo) throw new Error('Storage is not ready yet.');
      await repo.replaceAll(next);
      setData(next);
      notifyTabs();
      if (syncRun.current) scheduleSync();
    },
    [notifyTabs, scheduleSync],
  );

  const api = useMemo<DataApi>(() => {
    const categoryMap = new Map(data.categories.map((c) => [c.id, c]));
    const accountMap = new Map(data.accounts.map((a) => [a.id, a]));
    const switchTo = async (next: DataMode) => {
      setReady(false);
      repoRef.current?.close();
      repoRef.current = null;
      await deleteDatabase(DEMO_DB);
      if (next === 'demo') {
        const repo = await openRepo(DEMO_DB, { trackChanges: false });
        await repo.replaceAll(buildDemoData(todayISO()));
        repo.close();
      }
      writeMode(next);
      channel.current?.postMessage({ db: null, switched: true });
      setMode(next);
      setEpoch((e) => e + 1);
    };
    return {
      ready,
      mode,
      persistent,
      data,
      sync,
      categoryMap,
      accountMap,
      knownCategories: new Set(categoryMap.keys()),
      saveTransaction: (tx) => commit({ putTransactions: [{ ...tx, updatedAt: nowIso() }] }),
      patchTransaction: async (id, patch) => {
        const tx = dataRef.current.transactions.find((t) => t.id === id);
        if (!tx) throw new Error('That entry no longer exists.');
        await commit({ putTransactions: [{ ...tx, ...patch, updatedAt: nowIso() }] });
      },
      deleteTransaction: async (id) => {
        const tx = dataRef.current.transactions.find((t) => t.id === id) ?? null;
        await commit({ deleteTransactions: [id] });
        return tx;
      },
      // A fresh edit time, so the restore wins over the deletion on every device.
      restoreTransaction: (tx) => commit({ putTransactions: [{ ...tx, updatedAt: nowIso() }] }),
      saveAccount: (a) => commit({ putAccounts: [{ ...a, updatedAt: nowIso() }] }),
      deleteAccount: async (id) => {
        const ts = nowIso();
        const unlinked = dataRef.current.transactions
          .filter((t) => t.accountId === id || t.toAccountId === id)
          .map((t) => ({
            ...t,
            accountId: t.accountId === id ? null : t.accountId,
            toAccountId: t.toAccountId === id ? null : t.toAccountId,
            updatedAt: ts,
          }));
        await commit({ deleteAccounts: [id], putTransactions: unlinked });
      },
      saveCategory: (c) => commit({ putCategories: [{ ...c, updatedAt: nowIso() }] }),
      deleteCategory: async (id) => {
        const ts = nowIso();
        const moved = dataRef.current.transactions
          .filter((t) => t.categoryId === id)
          .map((t) => ({ ...t, categoryId: OTHER_CATEGORY_ID, updatedAt: ts }));
        await commit({ deleteCategories: [id], putTransactions: moved });
      },
      updateSettings: (patch) => commit({ settings: { ...dataRef.current.settings, ...patch, updatedAt: nowIso() } }),
      replaceAll: (next) => replaceWith(stampAll(next)),
      eraseAll: () => {
        const fresh = emptyData();
        return replaceWith({ ...fresh, settings: { ...fresh.settings, updatedAt: nowIso() } });
      },
      enterDemo: () => switchTo('demo'),
      exitDemo: () => switchTo('real'),
      syncNow: () => syncRun.current?.() ?? Promise.resolve(),
      countPending: async () => (repoRef.current && syncRun.current ? (await repoRef.current.outbox()).length : 0),
      skipInitialSync: () => setSync((s) => ({ ...s, initialPending: false })),
      findLegacyRecords: async () => {
        if (mode !== 'real' || localOnly) return null;
        if (typeof indexedDB.databases === 'function') {
          const dbs = await indexedDB.databases().catch(() => null);
          if (dbs && !dbs.some((d) => d.name === LEGACY_DB)) return null;
        }
        const legacy = await openRepo(LEGACY_DB, { trackChanges: false });
        const d = await legacy.load();
        legacy.close();
        if (d.transactions.length === 0 && d.accounts.length === 0) {
          await deleteDatabase(LEGACY_DB);
          return null;
        }
        return { transactions: d.transactions.length, data: d };
      },
      importLegacyRecords: async (legacy) => {
        const current = dataRef.current.settings;
        await commit({
          putTransactions: legacy.transactions,
          putAccounts: legacy.accounts,
          putCategories: legacy.categories.filter((c) => !c.builtIn),
          ...(current.onboarded ? {} : { settings: { ...legacy.settings, onboarded: true, updatedAt: nowIso() } }),
        });
        await deleteDatabase(LEGACY_DB);
      },
      discardLegacyRecords: () => deleteDatabase(LEGACY_DB),
    };
  }, [ready, mode, persistent, data, sync, commit, replaceWith, localOnly]);

  return <DataContext.Provider value={api}>{children}</DataContext.Provider>;
}

export function useData(): DataApi {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}
