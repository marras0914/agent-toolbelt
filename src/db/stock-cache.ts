/**
 * SQLite-backed cache for upstream stock-API responses.
 *
 * Persists across container restarts (unlike the previous in-memory Map),
 * so Railway redeploys don't reset the cache and trigger a cold-start storm
 * against upstream rate limits.
 *
 * Only used for SUCCESSFUL responses. 429s and other failures live in a
 * short-lived in-memory negative cache inside `_stock-fetchers.ts` — we
 * never want failed responses to survive a restart.
 */

import { db } from "./index";

db.exec(`
  CREATE TABLE IF NOT EXISTS stock_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_stock_cache_expires ON stock_cache(expires_at);
`);

const stmts = {
  get: db.prepare(`SELECT value, expires_at FROM stock_cache WHERE key = ?`),
  set: db.prepare(`
    INSERT INTO stock_cache (key, value, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
  `),
  delete: db.prepare(`DELETE FROM stock_cache WHERE key = ?`),
  deleteExpired: db.prepare(`DELETE FROM stock_cache WHERE expires_at <= ?`),
  count: db.prepare(`SELECT COUNT(*) as n FROM stock_cache`),
};

export function getCached<T>(key: string): T | undefined {
  const row = stmts.get.get(key) as { value: string; expires_at: number } | undefined;
  if (!row) return undefined;
  if (row.expires_at <= Date.now()) {
    stmts.delete.run(key);
    return undefined;
  }
  try {
    return JSON.parse(row.value) as T;
  } catch {
    stmts.delete.run(key);
    return undefined;
  }
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  const expiresAt = Date.now() + ttlMs;
  stmts.set.run(key, JSON.stringify(value), expiresAt);
}

export function clearExpiredCache(): number {
  const result = stmts.deleteExpired.run(Date.now()) as { changes: number };
  return result.changes;
}

export function cacheSize(): number {
  return (stmts.count.get() as { n: number }).n;
}

/** Test-only — clears the entire cache so tests don't carry state. */
export function _clearAllCache(): void {
  db.exec(`DELETE FROM stock_cache`);
}
