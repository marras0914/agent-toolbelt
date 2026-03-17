import Database, { Database as SQLiteDatabase } from "better-sqlite3";
import path from "path";
import { nanoid } from "nanoid";
import { config } from "../config";

// ----- Database Setup -----
import fs from "fs";
// Use /app/data if Railway volume is mounted there, then /data, then local ./data/
console.log("[db] /app/data exists:", fs.existsSync("/app/data"), "| /data exists:", fs.existsSync("/data"), "| cwd:", process.cwd());
const DEFAULT_DB_PATH = fs.existsSync("/app/data")
  ? "/app/data/toolbelt.db"
  : fs.existsSync("/data")
  ? "/data/toolbelt.db"
  : path.join(process.cwd(), "data", "toolbelt.db");
const DB_PATH = process.env.DATABASE_PATH || DEFAULT_DB_PATH;

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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_usage_client ON usage_records(client_id);
  CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_tool ON usage_records(tool_name);
  CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_apikeys_client ON api_keys(client_id);
`);

// Migrate existing tables (safe — no-op if column already exists)
try { db.exec(`ALTER TABLE clients ADD COLUMN credit_balance_micros INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }

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
    INSERT INTO usage_records (client_id, api_key_id, tool_name, status_code, duration_ms) VALUES (?, ?, ?, ?, ?)
  `),
  getUsageByClient: db.prepare(`
    SELECT tool_name, COUNT(*) as calls, AVG(duration_ms) as avg_ms
    FROM usage_records WHERE client_id = ? AND created_at >= ?
    GROUP BY tool_name
  `),
  // Credits (PAYG)
  addCredits: db.prepare(`UPDATE clients SET credit_balance_micros = credit_balance_micros + ?, updated_at = datetime('now') WHERE id = ?`),
  deductCredits: db.prepare(`UPDATE clients SET credit_balance_micros = credit_balance_micros - ?, updated_at = datetime('now') WHERE id = ? AND credit_balance_micros >= ?`),
  getBalance: db.prepare(`SELECT credit_balance_micros FROM clients WHERE id = ?`),

  getAllClients: db.prepare(`
    SELECT id, email, name, tier, credit_balance_micros, created_at, updated_at
    FROM clients ORDER BY created_at DESC
  `),

  getMonthlyCallCount: db.prepare(`
    SELECT COUNT(*) as count FROM usage_records
    WHERE client_id = ? AND created_at >= date('now', 'start of month')
  `),
  getGlobalStats: db.prepare(`
    SELECT
      COUNT(*) as total_calls,
      COUNT(DISTINCT client_id) as unique_clients,
      AVG(duration_ms) as avg_duration_ms
    FROM usage_records WHERE created_at >= ?
  `),
  getToolStats: db.prepare(`
    SELECT tool_name, COUNT(*) as calls, AVG(duration_ms) as avg_ms
    FROM usage_records WHERE created_at >= ?
    GROUP BY tool_name ORDER BY calls DESC
  `),
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
  tier: "free" | "payg" | "starter" | "pro" | "enterprise";
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
  durationMs: number
): void {
  stmts.insertUsage.run(clientId, apiKeyId, toolName, statusCode, durationMs);
}

export function getClientUsage(clientId: string, since: string): any[] {
  return stmts.getUsageByClient.all(clientId, since);
}

export function getMonthlyCallCount(clientId: string): number {
  const row = stmts.getMonthlyCallCount.get(clientId) as any;
  return row?.count || 0;
}

export function getGlobalStats(since: string): any {
  return stmts.getGlobalStats.get(since);
}

export function getToolStats(since: string): any[] {
  return stmts.getToolStats.all(since);
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
export function checkTierLimit(clientId: string, tier: Client["tier"]): { allowed: boolean; used: number; limit: number } {
  const LIMITS: Record<string, number> = {
    free: 1_000,
    payg: Infinity,   // no monthly cap — gated by credit balance instead
    starter: 50_000,
    pro: 500_000,
    enterprise: 5_000_000,
  };

  const used = getMonthlyCallCount(clientId);
  const limit = LIMITS[tier] ?? 1_000;

  return { allowed: used < limit, used, limit };
}

export { db };
