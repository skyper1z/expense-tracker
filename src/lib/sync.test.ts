import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteDatabase, openRepo, type Repo } from './db';
import { fromRow, toRow, type RemoteStore } from './remote';
import { syncOnce } from './sync';
import type { RemoteRecord, SyncRecord, SyncTable } from './sync-types';
import type { Transaction } from './types';

/**
 * In-memory stand-in for the Postgres tables. It mirrors the database rules: rows keyed by id,
 * a server timestamp set on every write, older edits ignored (last write wins), soft deletes.
 */
function memoryServer(userId = 'user-1') {
  const tables = new Map<SyncTable, Map<string, Record<string, unknown>>>();
  let clock = Date.parse('2026-11-20T00:00:00Z');
  const tick = () => new Date((clock += 1000)).toISOString().replace('Z', '+00:00');
  const t = (name: SyncTable) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const key = (table: SyncTable, row: Record<string, unknown>) => (table === 'settings' ? 'settings' : String(row.id));
  let failNext = false;

  const remote: RemoteStore = {
    async upsert(table, records: SyncRecord[]) {
      if (failNext) {
        failNext = false;
        throw new Error('network down');
      }
      const written = new Set<string>();
      for (const rec of records) {
        const row = toRow(table, rec, userId);
        const k = key(table, row);
        const old = t(table).get(k);
        if (old && Date.parse(String(row.updated_at)) < Date.parse(String(old.updated_at))) continue; // stale edit
        t(table).set(k, { ...row, server_updated_at: tick() });
        written.add(k);
      }
      return written;
    },
    async markDeleted(table, ids, at) {
      const done = new Set<string>();
      for (const id of ids) {
        const old = t(table).get(id);
        if (!old || Date.parse(at) < Date.parse(String(old.updated_at))) continue;
        t(table).set(id, { ...old, deleted_at: at, updated_at: at, server_updated_at: tick() });
        done.add(id);
      }
      return done;
    },
    async pullSince(table, since, limit) {
      return [...t(table).values()]
        .filter((r) => !since || Date.parse(String(r.server_updated_at)) >= Date.parse(since))
        .sort((a, b) => Date.parse(String(a.server_updated_at)) - Date.parse(String(b.server_updated_at)))
        .slice(0, limit)
        .map((r) => fromRow(table, r));
    },
    async fetchByIds(table, ids) {
      return ids.flatMap((id): RemoteRecord[] => (t(table).has(id) ? [fromRow(table, t(table).get(id)!)] : []));
    },
  };
  return { remote, rows: (table: SyncTable) => [...t(table).values()], failNextWrite: () => (failNext = true) };
}

let n = 0;
async function device(): Promise<Repo> {
  const name = `sync-test-${++n}`;
  await deleteDatabase(name);
  const repo = await openRepo(name, { trackChanges: true });
  await repo.load(); // seeds built-in categories (queued for upload)
  return repo;
}

const tx = (id: string, p: Partial<Transaction> = {}): Transaction => ({
  id, type: 'expense', amount: 12000, fee: 0, date: '2026-11-20', time: null, categoryId: 'food', method: 'cash',
  comment: '', payee: '', accountId: null, toAccountId: null, importRef: null, sourceText: null, reviewed: false,
  createdAt: '2026-11-20T08:00:00.000Z', updatedAt: '2026-11-20T08:00:00.000Z', ...p,
});

describe('sync', () => {
  it('uploads local changes and brings them to a second device', async () => {
    const server = memoryServer();
    const phone = await device();
    const laptop = await device();
    await phone.commit({ putTransactions: [tx('tx_1', { comment: 'Bought vegetables and other things for the week.' })] });
    expect(await phone.outbox()).toHaveLength(9); // 8 built-in categories + 1 expense

    const r1 = await syncOnce(phone, server.remote);
    expect(r1.pushed).toBe(9);
    expect(await phone.outbox()).toHaveLength(0);
    expect(server.rows('transactions')).toHaveLength(1);

    await syncOnce(laptop, server.remote);
    const onLaptop = await laptop.load();
    expect(onLaptop.transactions).toEqual([tx('tx_1', { comment: 'Bought vegetables and other things for the week.' })]);
  });

  it('keeps the newest edit when two devices change the same expense', async () => {
    const server = memoryServer();
    const a = await device();
    const b = await device();
    await a.commit({ putTransactions: [tx('tx_1')] });
    await syncOnce(a, server.remote);
    await syncOnce(b, server.remote);

    // Both edit while offline; B's edit is later.
    await a.commit({ putTransactions: [tx('tx_1', { amount: 13000, updatedAt: '2026-11-20T09:00:00.000Z' })] });
    await b.commit({ putTransactions: [tx('tx_1', { amount: 15000, updatedAt: '2026-11-20T10:00:00.000Z' })] });
    await syncOnce(b, server.remote); // newer edit reaches the server first
    await syncOnce(a, server.remote); // older edit arrives late and must not win

    expect((await a.load()).transactions[0].amount).toBe(15000);
    expect((await b.load()).transactions[0].amount).toBe(15000);
    expect(server.rows('transactions')[0].amount).toBe(15000);
  });

  it('does not let an older server copy overwrite a newer unsent local edit', async () => {
    const server = memoryServer();
    const a = await device();
    const b = await device();
    await a.commit({ putTransactions: [tx('tx_1', { comment: 'old' })] });
    await syncOnce(a, server.remote);
    await b.commit({ putTransactions: [tx('tx_1', { comment: 'newer, made offline', updatedAt: '2026-11-20T12:00:00.000Z' })] });
    server.failNextWrite(); // B's upload fails, so its edit is still waiting
    await expect(syncOnce(b, server.remote)).rejects.toThrow('network down');
    expect(await b.outbox()).not.toHaveLength(0);
    expect((await b.load()).transactions[0].comment).toBe('newer, made offline');
    await syncOnce(b, server.remote); // retry succeeds
    expect(server.rows('transactions')[0].comment).toBe('newer, made offline');
  });

  it('syncs deletions, and an undo after deleting brings the expense back everywhere', async () => {
    const server = memoryServer();
    const a = await device();
    const b = await device();
    await a.commit({ putTransactions: [tx('tx_1'), tx('tx_2')] });
    await syncOnce(a, server.remote);
    await syncOnce(b, server.remote);

    await a.commit({ deleteTransactions: ['tx_1'] });
    await syncOnce(a, server.remote);
    await syncOnce(b, server.remote);
    expect((await b.load()).transactions.map((t) => t.id)).toEqual(['tx_2']);

    // Undo = put it back with a fresh edit time.
    await a.commit({ putTransactions: [tx('tx_1', { updatedAt: new Date(Date.now() + 1000).toISOString() })] });
    await syncOnce(a, server.remote);
    await syncOnce(b, server.remote);
    expect((await b.load()).transactions.map((t) => t.id).sort()).toEqual(['tx_1', 'tx_2']);
  });

  it('creating and deleting offline never reaches the server', async () => {
    const server = memoryServer();
    const a = await device();
    await a.commit({ putTransactions: [tx('tx_tmp')] });
    await a.commit({ deleteTransactions: ['tx_tmp'] });
    await syncOnce(a, server.remote);
    expect(server.rows('transactions')).toHaveLength(0);
    expect(await a.outbox()).toHaveLength(0);
  });

  it('syncs settings and pages through many changes', async () => {
    const server = memoryServer();
    const a = await device();
    const b = await device();
    const settings = (await a.load()).settings;
    await a.commit({ settings: { ...settings, currency: 'USD', onboarded: true, updatedAt: '2026-11-20T09:00:00.000Z' } });
    await a.commit({ putTransactions: Array.from({ length: 23 }, (_, i) => tx(`tx_${i}`)) });
    await syncOnce(a, server.remote, { pageSize: 5 });
    await syncOnce(b, server.remote, { pageSize: 5 });
    const onB = await b.load();
    expect(onB.settings.currency).toBe('USD');
    expect(onB.settings.onboarded).toBe(true);
    expect(onB.transactions).toHaveLength(23);
    // A second sync with nothing new changes nothing locally.
    expect((await syncOnce(b, server.remote, { pageSize: 5 })).pulled).toBe(0);
  });

  it('a restore replaces records on the server too', async () => {
    const server = memoryServer();
    const a = await device();
    await a.commit({ putTransactions: [tx('tx_keep'), tx('tx_gone')] });
    await syncOnce(a, server.remote);
    const data = await a.load();
    await a.replaceAll({ ...data, transactions: [tx('tx_keep', { updatedAt: new Date().toISOString() })] });
    await syncOnce(a, server.remote);
    const live = server.rows('transactions').filter((r) => !r.deleted_at).map((r) => r.id);
    expect(live).toEqual(['tx_keep']);
  });
});
