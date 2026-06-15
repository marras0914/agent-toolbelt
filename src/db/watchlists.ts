/**
 * Stateful watchlists — saved ticker lists per client, the foundation for
 * scheduled monitoring + alerts (the paid "watchdog" value, see
 * docs/watchlist-monitor-plan.md).
 *
 * Phase 1a: the watchlists table + CRUD. The watchlist_state / watchlist_alerts
 * tables and the monitor job land in Phase 1b.
 *
 * Same module pattern as stock-cache.ts: import the shared db handle, create
 * the table on load, expose typed functions. Tickers are stored as a JSON
 * array of strings (validated/normalized by the endpoint before it gets here).
 */

import { db } from "./index";

db.exec(`
  CREATE TABLE IF NOT EXISTS watchlists (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id),
    name TEXT NOT NULL,
    tickers TEXT NOT NULL DEFAULT '[]',
    email_alerts INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_watchlists_client ON watchlists(client_id);
`);

export interface Watchlist {
  id: string;
  client_id: string;
  name: string;
  tickers: string[];
  email_alerts: boolean;
  created_at: string;
  updated_at: string;
}

interface WatchlistRow {
  id: string;
  client_id: string;
  name: string;
  tickers: string;
  email_alerts: number;
  created_at: string;
  updated_at: string;
}

const stmts = {
  insert: db.prepare(`INSERT INTO watchlists (id, client_id, name, tickers, email_alerts) VALUES (?, ?, ?, ?, ?)`),
  listByClient: db.prepare(`SELECT * FROM watchlists WHERE client_id = ? ORDER BY created_at DESC`),
  countByClient: db.prepare(`SELECT COUNT(*) as n FROM watchlists WHERE client_id = ?`),
  getById: db.prepare(`SELECT * FROM watchlists WHERE id = ?`),
  update: db.prepare(`UPDATE watchlists SET name = ?, tickers = ?, email_alerts = ?, updated_at = datetime('now') WHERE id = ? AND client_id = ?`),
  remove: db.prepare(`DELETE FROM watchlists WHERE id = ? AND client_id = ?`),
};

function rowToWatchlist(row: WatchlistRow): Watchlist {
  let tickers: string[] = [];
  try {
    const parsed = JSON.parse(row.tickers);
    if (Array.isArray(parsed)) tickers = parsed;
  } catch {
    /* malformed — treat as empty */
  }
  return {
    id: row.id,
    client_id: row.client_id,
    name: row.name,
    tickers,
    email_alerts: row.email_alerts === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// nanoid is already a dependency (used for client/key ids elsewhere).
import { nanoid } from "nanoid";

export function createWatchlist(clientId: string, name: string, tickers: string[], emailAlerts = true): Watchlist {
  const id = `wl_${nanoid(16)}`;
  stmts.insert.run(id, clientId, name, JSON.stringify(tickers), emailAlerts ? 1 : 0);
  return rowToWatchlist(stmts.getById.get(id) as WatchlistRow);
}

export function listWatchlists(clientId: string): Watchlist[] {
  return (stmts.listByClient.all(clientId) as WatchlistRow[]).map(rowToWatchlist);
}

export function countWatchlists(clientId: string): number {
  return (stmts.countByClient.get(clientId) as { n: number }).n;
}

/** Returns the watchlist only if it belongs to the given client (ownership scoping). */
export function getOwnedWatchlist(id: string, clientId: string): Watchlist | undefined {
  const row = stmts.getById.get(id) as WatchlistRow | undefined;
  if (!row || row.client_id !== clientId) return undefined;
  return rowToWatchlist(row);
}

/** Returns true if a row was updated (i.e. it existed and belonged to the client). */
export function updateWatchlist(
  id: string,
  clientId: string,
  fields: { name: string; tickers: string[]; emailAlerts: boolean }
): boolean {
  const res = stmts.update.run(fields.name, JSON.stringify(fields.tickers), fields.emailAlerts ? 1 : 0, id, clientId) as {
    changes: number;
  };
  return res.changes > 0;
}

/** Returns true if a row was deleted. */
export function deleteWatchlist(id: string, clientId: string): boolean {
  const res = stmts.remove.run(id, clientId) as { changes: number };
  return res.changes > 0;
}
