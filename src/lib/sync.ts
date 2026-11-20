import type { Repo } from './db';
import type { RemoteStore } from './remote';
import { SYNC_TABLES, type OutboxEntry } from './sync-types';

/*
 * Offline-first sync between this device's IndexedDB and the user's Postgres rows.
 *
 * 1. Push: every local change sits in the outbox until the server accepts it. The server keeps
 *    whichever version of a record was edited last, so a late upload of an older edit can't
 *    overwrite a newer one. If the server skips our write for that reason, we fetch its newer
 *    version straight away.
 * 2. Pull: fetch everything that changed on the server since the last sync (with a small
 *    overlap, because re-applying a change is harmless) and apply it, unless this device has an
 *    unsent edit that is newer.
 */

const OVERLAP_MS = 2 * 60 * 1000;
const cursorKey = (table: string) => `sync.cursor.${table}`;

export interface SyncResult {
  pushed: number;
  /** Number of local records changed by data from the server. */
  pulled: number;
}

function groupBy<T>(list: T[], key: (v: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const v of list) m.set(key(v), [...(m.get(key(v)) ?? []), v]);
  return m;
}

export async function syncOnce(repo: Repo, remote: RemoteStore, opts: { pageSize?: number } = {}): Promise<SyncResult> {
  const pageSize = opts.pageSize ?? 500;
  let pushed = 0;
  let pulled = 0;

  // ---- push ----
  const outbox: OutboxEntry[] = await repo.outbox();
  for (const table of SYNC_TABLES) {
    const upserts = outbox.filter((e) => e.table === table && e.op === 'upsert');
    if (upserts.length) {
      const records = await repo.getRecords(table, upserts.map((e) => e.id));
      const present = upserts.filter((e) => records.has(e.id));
      const written = await remote.upsert(table, present.map((e) => records.get(e.id)!));
      pushed += written.size;
      const skipped = present.filter((e) => !written.has(e.id)).map((e) => e.id);
      if (skipped.length) pulled += await repo.applyRemote(table, await remote.fetchByIds(table, skipped));
    }
    const deletes = outbox.filter((e) => e.table === table && e.op === 'delete');
    for (const [at, group] of groupBy(deletes, (e) => e.at)) {
      const ids = group.map((e) => e.id);
      const done = await remote.markDeleted(table, ids, at);
      pushed += done.size;
      const notDone = ids.filter((id) => !done.has(id));
      // Either it never reached the server (nothing to fetch), or someone edited it after we
      // deleted it, in which case the newer edit comes back.
      if (notDone.length) pulled += await repo.applyRemote(table, await remote.fetchByIds(table, notDone));
    }
  }
  await repo.ackOutbox(outbox);

  // ---- pull ----
  for (const table of SYNC_TABLES) {
    const stored = await repo.getMeta<string>(cursorKey(table));
    let since = stored ? new Date(Date.parse(stored) - OVERLAP_MS).toISOString() : null;
    let latest = stored ?? null;
    for (let page = 0; page < 10_000; page++) {
      const rows = await remote.pullSince(table, since, pageSize);
      if (rows.length === 0) break;
      pulled += await repo.applyRemote(table, rows);
      const last = rows[rows.length - 1].serverUpdatedAt;
      // Only ever move the cursor forward (the overlap re-reads slightly older rows).
      if (!latest || Date.parse(last) > Date.parse(latest)) latest = last;
      if (rows.length < pageSize || last === since) break;
      since = last;
    }
    if (latest && latest !== stored) await repo.setMeta(cursorKey(table), latest);
  }

  return { pushed, pulled };
}
