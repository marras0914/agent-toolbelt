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

  CREATE TABLE IF NOT EXISTS watchlist_state (
    watchlist_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    last_insider_buy_date TEXT,
    last_earnings_date TEXT,
    last_price REAL,
    checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (watchlist_id, ticker)
  );

  CREATE TABLE IF NOT EXISTS watchlist_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watchlist_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_watchlist ON watchlist_alerts(watchlist_id, created_at);
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

// ----- Monitoring state + alerts (Phase 1b) -----

export interface WatchlistState {
  watchlist_id: string;
  ticker: string;
  last_insider_buy_date: string | null;
  last_earnings_date: string | null;
  last_price: number | null;
}

export interface WatchlistAlert {
  id: number;
  watchlist_id: string;
  ticker: string;
  type: string;
  message: string;
  created_at: string;
}

/** A watchlist joined with its owning client's tier (for the monitor job's gating). */
export interface WatchlistWithTier extends Watchlist {
  tier: string;
}

const monitorStmts = {
  getState: db.prepare(`SELECT * FROM watchlist_state WHERE watchlist_id = ? AND ticker = ?`),
  upsertState: db.prepare(`
    INSERT INTO watchlist_state (watchlist_id, ticker, last_insider_buy_date, last_earnings_date, last_price, checked_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(watchlist_id, ticker) DO UPDATE SET
      last_insider_buy_date = excluded.last_insider_buy_date,
      last_earnings_date = excluded.last_earnings_date,
      last_price = excluded.last_price,
      checked_at = datetime('now')
  `),
  insertAlert: db.prepare(`INSERT INTO watchlist_alerts (watchlist_id, ticker, type, message, delivered) VALUES (?, ?, ?, ?, ?)`),
  recentAlerts: db.prepare(`SELECT id, watchlist_id, ticker, type, message, created_at FROM watchlist_alerts WHERE watchlist_id = ? ORDER BY created_at DESC LIMIT ?`),
  allWithTier: db.prepare(`SELECT w.*, c.tier as tier FROM watchlists w JOIN clients c ON c.id = w.client_id`),
};

export function getWatchlistState(watchlistId: string, ticker: string): WatchlistState | undefined {
  return monitorStmts.getState.get(watchlistId, ticker) as WatchlistState | undefined;
}

export function upsertWatchlistState(
  watchlistId: string,
  ticker: string,
  s: { lastInsiderBuyDate: string | null; lastEarningsDate: string | null; lastPrice: number | null }
): void {
  monitorStmts.upsertState.run(watchlistId, ticker, s.lastInsiderBuyDate, s.lastEarningsDate, s.lastPrice);
}

export function insertWatchlistAlert(
  watchlistId: string,
  ticker: string,
  type: string,
  message: string,
  delivered = false
): void {
  monitorStmts.insertAlert.run(watchlistId, ticker, type, message, delivered ? 1 : 0);
}

export function getRecentAlerts(watchlistId: string, limit = 50): WatchlistAlert[] {
  return monitorStmts.recentAlerts.all(watchlistId, limit) as WatchlistAlert[];
}

/** All watchlists with their owner's tier — the monitor job filters these by TIERS[tier].watchlistMonitoring. */
export function listAllWatchlistsWithTier(): WatchlistWithTier[] {
  return (monitorStmts.allWithTier.all() as (WatchlistRow & { tier: string })[]).map((row) => ({
    ...rowToWatchlist(row),
    tier: row.tier,
  }));
}
