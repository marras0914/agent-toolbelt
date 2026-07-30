import Database, { Database as SQLiteDatabase } from "better-sqlite3";
import path from "path";
import { nanoid } from "nanoid";
import { config } from "../config";
import { TIERS, Tier } from "../tiers";

// ----- Database Setup -----
import fs from "fs";
// Use /app/data if Railway volume is mounted there, then /data, then local ./data/
const DEFAULT_DB_PATH = fs.existsSync("/app/data")
  ? "/app/data/toolbelt.db"
  : fs.existsSync("/data")
  ? "/data/toolbelt.db"
  : path.join(process.cwd(), "data", "toolbelt.db");
export const DB_PATH = process.env.DATABASE_PATH || DEFAULT_DB_PATH;

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db: SQLiteDatabase = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

// ----- Schema -----
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    tier TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_subscription_item_id TEXT,
    credit_balance_micros INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id),
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    label TEXT DEFAULT 'default',
    is_active INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usage_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL REFERENCES clients(id),
    api_key_id TEXT NOT NULL REFERENCES api_keys(id),
    tool_name TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    input_fingerprint TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_usage_client ON usage_records(client_id);
  CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_tool ON usage_records(tool_name);
  CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_apikeys_client ON api_keys(client_id);
`);

// Self-serve API-key reissue: short-lived, single-use, hashed tokens emailed as
// a magic link. Like a password-reset token — we store only the hash.
db.exec(`
  CREATE TABLE IF NOT EXISTS key_reissue_tokens (
    token_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id),
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrate existing tables (safe — no-op if column already exists)
try { db.exec(`ALTER TABLE clients ADD COLUMN credit_balance_micros INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE usage_records ADD COLUMN input_fingerprint TEXT`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE usage_records ADD COLUMN cached INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }

// ----- Prepared Statements -----
const stmts = {
  // Clients
  insertClient: db.prepare(`
    INSERT INTO clients (id, email, name, tier) VALUES (?, ?, ?, ?)
  `),
  getClientById: db.prepare(`SELECT * FROM clients WHERE id = ?`),
  getClientByEmail: db.prepare(`SELECT * FROM clients WHERE email = ?`),
  getClientByStripeId: db.prepare(`SELECT * FROM clients WHERE stripe_customer_id = ?`),
  updateClientTier: db.prepare(`
    UPDATE clients SET tier = ?, updated_at = datetime('now') WHERE id = ?
  `),
  updateClientStripe: db.prepare(`
    UPDATE clients SET stripe_customer_id = ?, stripe_subscription_id = ?, stripe_subscription_item_id = ?, tier = ?, updated_at = datetime('now') WHERE id = ?
  `),

  // API Keys
  insertApiKey: db.prepare(`
    INSERT INTO api_keys (id, client_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?, ?)
  `),
  getApiKeyByHash: db.prepare(`SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1`),
  getApiKeysByClient: db.prepare(`SELECT id, key_prefix, label, is_active, last_used_at, created_at FROM api_keys WHERE client_id = ?`),
  revokeApiKey: db.prepare(`UPDATE api_keys SET is_active = 0 WHERE id = ? AND client_id = ?`),
  touchApiKey: db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`),

  // Usage
  insertUsage: db.prepare(`
    INSERT INTO usage_records (client_id, api_key_id, tool_name, status_code, duration_ms, input_fingerprint, cached)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getUsageByClient: db.prepare(`
    SELECT
      tool_name,
      COUNT(*) as calls,
      COUNT(DISTINCT input_fingerprint) as distinct_inputs,
      SUM(cached) as cache_hits,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors,
      AVG(duration_ms) as avg_ms
    FROM usage_records WHERE client_id = ? AND created_at >= ?
    GROUP BY tool_name
  `),
  // status_code has always been recorded but was never read back, so a client
  // whose every call 4xx/5xx'd looked identical to a healthy one in /admin/usage.
  // That is how an 8-week 500 outage on the upgrade-nudge path stayed invisible.
  getClientStatusBreakdown: db.prepare(`
    SELECT tool_name, status_code, COUNT(*) as calls, MAX(created_at) as last_seen
    FROM usage_records WHERE client_id = ? AND created_at >= ?
    GROUP BY tool_name, status_code
    ORDER BY calls DESC
  `),
  // Global error triage: which (client, tool, status) tuples are failing, worst first.
  getErrorBreakdown: db.prepare(`
    SELECT c.email, c.tier, u.tool_name, u.status_code,
           COUNT(*) as calls, MAX(u.created_at) as last_seen
    FROM usage_records u JOIN clients c ON c.id = u.client_id
    WHERE u.status_code >= 400 AND u.created_at >= ?
    GROUP BY u.client_id, u.tool_name, u.status_code
    ORDER BY calls DESC
  `),
  // Credits (PAYG)
  addCredits: db.prepare(`UPDATE clients SET credit_balance_micros = credit_balance_micros + ?, updated_at = datetime('now') WHERE id = ?`),
  deductCredits: db.prepare(`UPDATE clients SET credit_balance_micros = credit_balance_micros - ?, updated_at = datetime('now') WHERE id = ? AND credit_balance_micros >= ?`),
  getBalance: db.prepare(`SELECT credit_balance_micros FROM clients WHERE id = ?`),

  getAllClients: db.prepare(`
    SELECT id, email, name, tier, credit_balance_micros, created_at, updated_at
    FROM clients ORDER BY created_at DESC
  `),

  getRolling30dCallCount: db.prepare(`
    SELECT COUNT(*) as count FROM usage_records
    WHERE client_id = ? AND created_at >= datetime('now', '-30 days')
  `),
  getGlobalStats: db.prepare(`
    SELECT
      COUNT(*) as total_calls,
      COUNT(DISTINCT client_id) as unique_clients,
      SUM(cached) as cache_hits,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors,
      AVG(duration_ms) as avg_duration_ms
    FROM usage_records WHERE created_at >= ?
  `),
  getToolStats: db.prepare(`
    SELECT tool_name, COUNT(*) as calls, SUM(cached) as cache_hits,
           SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors,
           AVG(duration_ms) as avg_ms
    FROM usage_records WHERE created_at >= ?
    GROUP BY tool_name ORDER BY calls DESC
  `),
  // Per-client rolling-30d call counts joined with tier — feeds the cap-watch
  // list. Uses the same '-30 days' window that checkTierLimit enforces.
  getClientCallCounts: db.prepare(`
    SELECT u.client_id as clientId, c.email, c.tier, COUNT(*) as calls
    FROM usage_records u JOIN clients c ON c.id = u.client_id
    WHERE u.created_at >= datetime('now','-30 days')
    GROUP BY u.client_id
    ORDER BY calls DESC
  `),

  // Key reissue tokens
  insertReissueToken: db.prepare(`INSERT INTO key_reissue_tokens (token_hash, client_id, expires_at) VALUES (?, ?, ?)`),
  getReissueToken: db.prepare(`SELECT client_id, expires_at, used FROM key_reissue_tokens WHERE token_hash = ?`),
  markReissueTokenUsed: db.prepare(`UPDATE key_reissue_tokens SET used = 1 WHERE token_hash = ?`),
  revokeAllClientKeys: db.prepare(`UPDATE api_keys SET is_active = 0 WHERE client_id = ?`),
};

// ----- Crypto helpers -----
import crypto from "crypto";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// ----- Client Operations -----
export interface Client {
  id: string;
  email: string;
  name: string | null;
  tier: Tier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_item_id: string | null;
  credit_balance_micros: number;
  created_at: string;
  updated_at: string;
}

export function createClient(email: string, name?: string, tier: Client["tier"] = "free"): Client {
  const id = `cli_${nanoid(16)}`;
  stmts.insertClient.run(id, email, name || null, tier);
  return stmts.getClientById.get(id) as Client;
}

export function getClientById(id: string): Client | undefined {
  return stmts.getClientById.get(id) as Client | undefined;
}

export function getClientByEmail(email: string): Client | undefined {
  return stmts.getClientByEmail.get(email) as Client | undefined;
}

export function getAllClients(): Omit<Client, "stripe_customer_id" | "stripe_subscription_id" | "stripe_subscription_item_id">[] {
  return stmts.getAllClients.all() as any[];
}

export function getClientByStripeId(stripeCustomerId: string): Client | undefined {
  return stmts.getClientByStripeId.get(stripeCustomerId) as Client | undefined;
}

export function updateClientTier(clientId: string, tier: Client["tier"]): void {
  stmts.updateClientTier.run(tier, clientId);
}

export function updateClientStripe(
  clientId: string,
  stripeCustomerId: string,
  subscriptionId: string,
  subscriptionItemId: string,
  tier: Client["tier"]
): void {
  stmts.updateClientStripe.run(stripeCustomerId, subscriptionId, subscriptionItemId, tier, clientId);
}

// ----- API Key Operations -----
export interface ApiKeyRecord {
  id: string;
  client_id: string;
  key_prefix: string;
  label: string;
  is_active: number;
  last_used_at: string | null;
  created_at: string;
}

export function createApiKey(clientId: string, label: string = "default"): { key: string; record: ApiKeyRecord } {
  const rawKey = `atb_${nanoid(32)}`;
  const id = `key_${nanoid(16)}`;
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12) + "...";

  stmts.insertApiKey.run(id, clientId, keyHash, keyPrefix, label);

  return {
    key: rawKey, // Only returned once — never stored in plaintext
    record: stmts.getApiKeysByClient.all(clientId).find((k: any) => k.id === id) as ApiKeyRecord,
  };
}

export function validateApiKey(rawKey: string): { client: Client; keyId: string } | null {
  const keyHash = hashKey(rawKey);
  const keyRecord = stmts.getApiKeyByHash.get(keyHash) as any;
  if (!keyRecord) return null;

  const client = stmts.getClientById.get(keyRecord.client_id) as Client | undefined;
  if (!client) return null;

  // Touch last_used_at
  stmts.touchApiKey.run(keyRecord.id);

  return { client, keyId: keyRecord.id };
}

export function getClientApiKeys(clientId: string): ApiKeyRecord[] {
  return stmts.getApiKeysByClient.all(clientId) as ApiKeyRecord[];
}

export function revokeApiKey(keyId: string, clientId: string): void {
  stmts.revokeApiKey.run(keyId, clientId);
}

// ----- Usage Operations -----
export function recordUsage(
  clientId: string,
  apiKeyId: string,
  toolName: string,
  statusCode: number,
  durationMs: number,
  inputFingerprint: string | null = null,
  cached: boolean = false
): void {
  stmts.insertUsage.run(clientId, apiKeyId, toolName, statusCode, durationMs, inputFingerprint, cached ? 1 : 0);
}

export function getClientUsage(clientId: string, since: string): any[] {
  return stmts.getUsageByClient.all(clientId, since);
}

export function getRolling30dCallCount(clientId: string): number {
  const row = stmts.getRolling30dCallCount.get(clientId) as any;
  return row?.count || 0;
}

export function getClientCallCounts(): Array<{ clientId: string; email: string; tier: Tier; calls: number }> {
  return stmts.getClientCallCounts.all() as any[];
}

// ----- Key reissue (self-serve, magic-link) -----
// Returns the plaintext token (emailed to the user); only its hash is stored.
export function createReissueToken(clientId: string, ttlMinutes = 30): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  stmts.insertReissueToken.run(hashKey(token), clientId, expiresAt);
  return token;
}

// Validates + single-use-consumes a token. Returns the clientId, or null if the
// token is unknown, already used, or expired.
export function consumeReissueToken(token: string): string | null {
  const hash = hashKey(token);
  const row = stmts.getReissueToken.get(hash) as { client_id: string; expires_at: string; used: number } | undefined;
  if (!row || row.used || new Date(row.expires_at).getTime() < Date.now()) return null;
  stmts.markReissueTokenUsed.run(hash);
  return row.client_id;
}

export function revokeAllClientKeys(clientId: string): void {
  stmts.revokeAllClientKeys.run(clientId);
}

export function getGlobalStats(since: string): any {
  return stmts.getGlobalStats.get(since);
}

export function getToolStats(since: string): any[] {
  return stmts.getToolStats.all(since);
}

/** Whether a table is present in this database file. */
function tableExists(name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name) !== undefined;
}

/** Row counts removed by deleteClientCascade, per table. */
export interface ClientDeletionCounts {
  watchlist_alerts: number;
  watchlist_state: number;
  watchlists: number;
  key_reissue_tokens: number;
  usage_records: number;
  api_keys: number;
  clients: number;
}

/**
 * Hard-delete a client and everything hanging off it, atomically.
 *
 * Order is not cosmetic. Foreign keys are ON, so children must go before parents,
 * and `usage_records` references BOTH clients and api_keys — delete it before
 * api_keys or the api_keys delete fails.
 *
 * `watchlist_state` and `watchlist_alerts` key off watchlist_id but declare NO
 * foreign key, so SQLite will happily let them be orphaned silently. They are
 * cleaned explicitly here; a plain "DELETE FROM clients" would leave them behind
 * with nothing pointing at them.
 *
 * Wrapped in a transaction so a failure part-way cannot leave a half-deleted
 * client whose keys still authenticate.
 *
 * `dryRun` runs the same counting queries and rolls back, so callers can preview
 * the blast radius before committing to it.
 */
export function deleteClientCascade(clientId: string, dryRun = false): ClientDeletionCounts {
  const counts: ClientDeletionCounts = {
    watchlist_alerts: 0, watchlist_state: 0, watchlists: 0,
    key_reissue_tokens: 0, usage_records: 0, api_keys: 0, clients: 0,
  };

  const run = db.transaction((): void => {
    // The watchlist tables are created by a side effect in ./watchlists.ts, which
    // this module does not import (that would be circular — watchlists.ts imports
    // `db` from here). So they exist only if something else loaded that module
    // first. src/index.ts does, but a job, script, or test entry point might not,
    // and an unguarded DELETE then dies with "no such table: watchlists" — taking
    // the whole transaction with it and deleting nothing.
    if (tableExists("watchlists")) {
      const watchlistIds = (db.prepare("SELECT id FROM watchlists WHERE client_id = ?").all(clientId) as Array<{ id: string }>)
        .map((r) => r.id);

      for (const wid of watchlistIds) {
        if (tableExists("watchlist_alerts")) {
          counts.watchlist_alerts += (db.prepare("DELETE FROM watchlist_alerts WHERE watchlist_id = ?").run(wid) as { changes: number }).changes;
        }
        if (tableExists("watchlist_state")) {
          counts.watchlist_state += (db.prepare("DELETE FROM watchlist_state WHERE watchlist_id = ?").run(wid) as { changes: number }).changes;
        }
      }

      counts.watchlists = (db.prepare("DELETE FROM watchlists WHERE client_id = ?").run(clientId) as { changes: number }).changes;
    }
    counts.key_reissue_tokens = (db.prepare("DELETE FROM key_reissue_tokens WHERE client_id = ?").run(clientId) as { changes: number }).changes;
    // Before api_keys: usage_records has an FK to both.
    counts.usage_records = (db.prepare("DELETE FROM usage_records WHERE client_id = ?").run(clientId) as { changes: number }).changes;
    counts.api_keys = (db.prepare("DELETE FROM api_keys WHERE client_id = ?").run(clientId) as { changes: number }).changes;
    counts.clients = (db.prepare("DELETE FROM clients WHERE id = ?").run(clientId) as { changes: number }).changes;

    if (dryRun) {
      // Abort the transaction so nothing is persisted; better-sqlite3 surfaces the
      // throw to the caller, which we swallow below.
      throw new DryRunAbort();
    }
  });

  try {
    run();
  } catch (err) {
    if (!(err instanceof DryRunAbort)) throw err;
  }

  return counts;
}

/** Sentinel used to roll back a dry-run transaction. Never escapes this module. */
class DryRunAbort extends Error {}

/**
 * SQLite writes `created_at` as "YYYY-MM-DD HH:MM:SS" (UTC) via datetime('now'), and
 * every usage query filters it with a string comparison. Date#toISOString() produces
 * "YYYY-MM-DDTHH:MM:SS.mmmZ" — the 'T' at index 10 sorts ABOVE the ' ' in the stored
 * form, so any window whose start falls on the same calendar day as the rows excludes
 * all of them. Multi-day windows (the only ones we shipped) happened to compare on the
 * date digits first, which is why this never surfaced. Bind through here instead.
 */
export function sqliteTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** Window start `days` ago, in SQLite's stored timestamp format. */
export function sqliteSince(days: number): string {
  return sqliteTimestamp(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

/**
 * Cheap liveness probe for /health. Runs a real query rather than just checking that
 * the handle exists, so a corrupt or unwritable volume surfaces as unhealthy instead
 * of the process happily reporting ok while every tool call fails.
 */
export function pingDb(): boolean {
  try {
    const row = db.prepare("SELECT 1 as ok").get() as { ok?: number } | undefined;
    return row?.ok === 1;
  } catch {
    return false;
  }
}

export function getClientStatusBreakdown(clientId: string, since: string): Array<{
  tool_name: string; status_code: number; calls: number; last_seen: string;
}> {
  return stmts.getClientStatusBreakdown.all(clientId, since) as any[];
}

export function getErrorBreakdown(since: string): Array<{
  email: string; tier: string; tool_name: string; status_code: number; calls: number; last_seen: string;
}> {
  return stmts.getErrorBreakdown.all(since) as any[];
}

// ----- Credit Operations (PAYG) -----
export function addCredits(clientId: string, micros: number): void {
  stmts.addCredits.run(micros, clientId);
}

export function deductCredits(clientId: string, micros: number): boolean {
  const result = stmts.deductCredits.run(micros, clientId, micros) as { changes: number };
  return result.changes > 0;
}

export function getClientBalance(clientId: string): number {
  const row = stmts.getBalance.get(clientId) as { credit_balance_micros: number } | undefined;
  return row?.credit_balance_micros ?? 0;
}

// ----- Tier Limit Checking -----
// Rolling 30-day quota is read from the single source of truth in src/tiers.ts.
export function checkTierLimit(clientId: string, tier: Client["tier"]): { allowed: boolean; used: number; limit: number } {
  const used = getRolling30dCallCount(clientId);
  const limit = TIERS[tier]?.monthlyRequests ?? TIERS.free.monthlyRequests;

  return { allowed: used < limit, used, limit };
}

// ----- Backup -----

/**
 * Write a consistent snapshot of the database to `destPath`.
 *
 * Uses SQLite's `VACUUM INTO` rather than copying the file. That matters here:
 * this database runs in WAL mode, so a plain file copy captures a torn state and
 * silently drops anything still sitting in the -wal file. `VACUUM INTO` is safe
 * to run against a live database, includes committed WAL contents, and compacts
 * the result.
 *
 * `destPath` must not already exist — SQLite refuses to overwrite.
 * Not parameterizable (VACUUM takes no bound values), so the quote is escaped;
 * callers pass a server-generated path, never user input.
 */
export function backupTo(destPath: string): void {
  db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
}

export { db };
