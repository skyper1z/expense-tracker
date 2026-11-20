import type { SupabaseClient } from '@supabase/supabase-js';
import { isCurrencyCode } from './money';
import { EPOCH, type RemoteRecord, type SyncRecord, type SyncTable } from './sync-types';
import type { Account, Category, PaymentMethod, Settings, Transaction, TxType } from './types';
import { DEFAULT_SETTINGS } from './types';

/** The server side of sync. The Supabase implementation is below; tests use an in-memory one. */
export interface RemoteStore {
  /** Writes records; returns the ids the server accepted (it skips edits older than what it has). */
  upsert(table: SyncTable, records: SyncRecord[]): Promise<Set<string>>;
  /** Soft-deletes records; returns the ids actually marked deleted. */
  markDeleted(table: SyncTable, ids: string[], at: string): Promise<Set<string>>;
  /** Records changed at or after `since` (server time), oldest first. */
  pullSince(table: SyncTable, since: string | null, limit: number): Promise<RemoteRecord[]>;
  fetchByIds(table: SyncTable, ids: string[]): Promise<RemoteRecord[]>;
}

type Row = Record<string, unknown>;

const TABLE_NAME: Record<SyncTable, string> = {
  transactions: 'transactions',
  accounts: 'accounts',
  categories: 'categories',
  settings: 'user_settings',
};

const iso = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export function toRow(table: SyncTable, rec: SyncRecord, userId: string): Row {
  switch (table) {
    case 'transactions': {
      const t = rec as Transaction;
      return {
        user_id: userId, id: t.id, type: t.type, amount: t.amount, fee: t.fee, tx_date: t.date, tx_time: t.time,
        category_id: t.categoryId, method: t.method, comment: t.comment, payee: t.payee, account_id: t.accountId,
        to_account_id: t.toAccountId, import_ref: t.importRef, source_text: t.sourceText, reviewed: t.reviewed,
        created_at: t.createdAt, updated_at: t.updatedAt, deleted_at: null,
      };
    }
    case 'accounts': {
      const a = rec as Account;
      return { user_id: userId, id: a.id, name: a.name, method: a.method, created_at: a.createdAt, updated_at: a.updatedAt, deleted_at: null };
    }
    case 'categories': {
      const c = rec as Category;
      return {
        user_id: userId, id: c.id, name: c.name, icon: c.icon, color: c.color, built_in: c.builtIn, sort_order: c.order,
        updated_at: c.updatedAt ?? EPOCH, deleted_at: null,
      };
    }
    case 'settings': {
      const s = rec as Settings;
      return {
        user_id: userId, currency: s.currency, onboarded: s.onboarded, reminder: s.reminder,
        reminder_ack_at: s.reminderAckAt, updated_at: s.updatedAt ?? EPOCH,
      };
    }
  }
}

export function fromRow(table: SyncTable, row: Row): RemoteRecord {
  const updatedAt = iso(row.updated_at) ?? EPOCH;
  const deletedAt = iso(row.deleted_at);
  const base = { updatedAt, deletedAt, serverUpdatedAt: String(row.server_updated_at ?? '') };
  switch (table) {
    case 'transactions': {
      const record: Transaction = {
        id: String(row.id), type: row.type as TxType, amount: Number(row.amount), fee: Number(row.fee ?? 0),
        date: String(row.tx_date), time: (row.tx_time as string | null) ?? null, categoryId: String(row.category_id ?? 'other'),
        method: row.method as PaymentMethod, comment: String(row.comment ?? ''), payee: String(row.payee ?? ''),
        accountId: (row.account_id as string | null) ?? null, toAccountId: (row.to_account_id as string | null) ?? null,
        importRef: (row.import_ref as string | null) ?? null, sourceText: (row.source_text as string | null) ?? null,
        reviewed: row.reviewed === true, createdAt: iso(row.created_at) ?? updatedAt, updatedAt,
      };
      return { id: record.id, ...base, record: deletedAt ? null : record };
    }
    case 'accounts': {
      const record: Account = {
        id: String(row.id), name: String(row.name), method: row.method as PaymentMethod,
        createdAt: iso(row.created_at) ?? updatedAt, updatedAt,
      };
      return { id: record.id, ...base, record: deletedAt ? null : record };
    }
    case 'categories': {
      const record: Category = {
        id: String(row.id), name: String(row.name), icon: String(row.icon), color: String(row.color),
        builtIn: row.built_in === true, order: Number(row.sort_order ?? 50),
        ...(updatedAt !== EPOCH ? { updatedAt } : {}),
      };
      return { id: record.id, ...base, record: deletedAt ? null : record };
    }
    case 'settings': {
      const r = (row.reminder ?? {}) as Partial<Settings['reminder']>;
      const record: Settings = {
        currency: isCurrencyCode(row.currency) ? row.currency : DEFAULT_SETTINGS.currency,
        onboarded: row.onboarded === true,
        reminder: {
          enabled: r.enabled === true,
          weekday: Number.isInteger(r.weekday) && r.weekday! >= 0 && r.weekday! <= 6 ? r.weekday! : 6,
          time: typeof r.time === 'string' && /^\d{2}:\d{2}$/.test(r.time) ? r.time : '18:00',
        },
        reminderAckAt: iso(row.reminder_ack_at),
        ...(updatedAt !== EPOCH ? { updatedAt } : {}),
      };
      return { id: 'settings', ...base, deletedAt: null, record };
    }
  }
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function createSupabaseRemote(client: SupabaseClient, userId: string): RemoteStore {
  const keyCol = (table: SyncTable) => (table === 'settings' ? 'user_id' : 'id');
  const keyOf = (table: SyncTable, r: Row) => (table === 'settings' ? 'settings' : String(r.id));

  return {
    async upsert(table, records) {
      const written = new Set<string>();
      for (const chunk of chunks(records.map((r) => toRow(table, r, userId)), 200)) {
        const { data, error } = await client
          .from(TABLE_NAME[table])
          .upsert(chunk, { onConflict: table === 'settings' ? 'user_id' : 'user_id,id' })
          .select(keyCol(table));
        if (error) throw error;
        for (const r of (data ?? []) as unknown as Row[]) written.add(keyOf(table, r));
      }
      return written;
    },

    async markDeleted(table, ids, at) {
      const done = new Set<string>();
      if (table === 'settings') return done;
      for (const chunk of chunks(ids, 100)) {
        const { data, error } = await client
          .from(TABLE_NAME[table])
          .update({ deleted_at: at, updated_at: at })
          .in('id', chunk)
          .select('id');
        if (error) throw error;
        for (const r of (data ?? []) as unknown as Row[]) done.add(String(r.id));
      }
      return done;
    },

    async pullSince(table, since, limit) {
      let q = client.from(TABLE_NAME[table]).select('*').order('server_updated_at', { ascending: true }).limit(limit);
      if (since) q = q.gte('server_updated_at', since);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as Row[]).map((r) => fromRow(table, r));
    },

    async fetchByIds(table, ids) {
      const out: RemoteRecord[] = [];
      if (table === 'settings') {
        const { data, error } = await client.from(TABLE_NAME.settings).select('*');
        if (error) throw error;
        return ((data ?? []) as Row[]).map((r) => fromRow(table, r));
      }
      for (const chunk of chunks(ids, 100)) {
        const { data, error } = await client.from(TABLE_NAME[table]).select('*').in('id', chunk);
        if (error) throw error;
        out.push(...((data ?? []) as Row[]).map((r) => fromRow(table, r)));
      }
      return out;
    },
  };
}
