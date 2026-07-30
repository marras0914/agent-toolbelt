import { describe, it, expect, beforeEach } from "vitest";
import {
  createClient,
  createApiKey,
  recordUsage,
  deleteClientCascade,
  getClientById,
  validateApiKey,
  createReissueToken,
  db,
} from "../db";
import { createWatchlist } from "../db/watchlists";

/**
 * A hard delete with foreign keys ON is easy to get subtly wrong in two ways, and
 * both are covered here:
 *
 *  1. Order. `usage_records` references BOTH clients and api_keys, so deleting
 *     api_keys first fails the FK check and aborts the whole thing.
 *  2. Silent orphans. `watchlist_state` and `watchlist_alerts` key off watchlist_id
 *     but declare NO foreign key, so SQLite will happily leave them pointing at a
 *     watchlist that no longer exists. Nothing errors; the rows just rot.
 */

let seq = 0;
const uniqueEmail = () => `del-${process.pid}-${++seq}@example.test`;

function countFor(table: string, column: string, value: string): number {
  return (db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${column} = ?`).get(value) as { n: number }).n;
}

/** A client with something in every dependent table. */
function seedFullClient() {
  const client = createClient(uniqueEmail(), "delete-test");
  const { key, record } = createApiKey(client.id);

  recordUsage(client.id, record.id, "stock-thesis", 200, 1200, "fp_a", false);
  recordUsage(client.id, record.id, "stock-thesis", 422, 30, "fp_b", false);
  createReissueToken(client.id);

  const wl = createWatchlist(client.id, "test-list", ["AAPL", "MSFT"]);
  db.prepare("INSERT INTO watchlist_state (watchlist_id, ticker, last_price) VALUES (?, ?, ?)").run(wl.id, "AAPL", 100);
  db.prepare("INSERT INTO watchlist_alerts (watchlist_id, ticker, type, message) VALUES (?, ?, ?, ?)")
    .run(wl.id, "AAPL", "price", "moved");

  return { client, rawKey: key, keyId: record.id, watchlistId: wl.id };
}

describe("deleteClientCascade", () => {
  let seeded: ReturnType<typeof seedFullClient>;

  beforeEach(() => {
    seeded = seedFullClient();
  });

  it("removes the client and every dependent row", () => {
    const counts = deleteClientCascade(seeded.client.id);

    expect(counts.clients).toBe(1);
    expect(counts.api_keys).toBe(1);
    expect(counts.usage_records).toBe(2);
    expect(counts.key_reissue_tokens).toBe(1);
    expect(counts.watchlists).toBe(1);
    expect(counts.watchlist_state).toBe(1);
    expect(counts.watchlist_alerts).toBe(1);

    expect(getClientById(seeded.client.id)).toBeUndefined();
  });

  it("leaves no orphans in the FK-less watchlist tables", () => {
    deleteClientCascade(seeded.client.id);
    // These have no FK, so nothing would have complained had we skipped them.
    expect(countFor("watchlist_state", "watchlist_id", seeded.watchlistId)).toBe(0);
    expect(countFor("watchlist_alerts", "watchlist_id", seeded.watchlistId)).toBe(0);
  });

  it("leaves the database referentially intact", () => {
    deleteClientCascade(seeded.client.id);
    expect(db.pragma("foreign_key_check")).toHaveLength(0);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  });

  it("revokes access — the deleted client's key stops authenticating", () => {
    expect(validateApiKey(seeded.rawKey)).not.toBeNull();
    deleteClientCascade(seeded.client.id);
    expect(validateApiKey(seeded.rawKey)).toBeNull();
  });

  it("does not touch other clients", () => {
    const bystander = seedFullClient();
    deleteClientCascade(seeded.client.id);

    expect(getClientById(bystander.client.id)).toBeDefined();
    expect(countFor("usage_records", "client_id", bystander.client.id)).toBe(2);
    expect(countFor("watchlists", "client_id", bystander.client.id)).toBe(1);
    expect(validateApiKey(bystander.rawKey)).not.toBeNull();
  });

  it("is a no-op for an unknown id", () => {
    const counts = deleteClientCascade("cli_does_not_exist");
    expect(counts.clients).toBe(0);
    expect(counts.usage_records).toBe(0);
  });
});

describe("deleteClientCascade dry run", () => {
  it("reports the real blast radius but deletes nothing", () => {
    const seeded = seedFullClient();
    const preview = deleteClientCascade(seeded.client.id, true);

    // Same numbers a real delete would produce...
    expect(preview.clients).toBe(1);
    expect(preview.usage_records).toBe(2);
    expect(preview.watchlist_alerts).toBe(1);

    // ...but everything is still there.
    expect(getClientById(seeded.client.id)).toBeDefined();
    expect(countFor("usage_records", "client_id", seeded.client.id)).toBe(2);
    expect(countFor("api_keys", "client_id", seeded.client.id)).toBe(1);
    expect(countFor("watchlist_state", "watchlist_id", seeded.watchlistId)).toBe(1);
    expect(validateApiKey(seeded.rawKey)).not.toBeNull();
  });

  it("a dry run followed by a real delete agrees", () => {
    const seeded = seedFullClient();
    const preview = deleteClientCascade(seeded.client.id, true);
    const actual = deleteClientCascade(seeded.client.id, false);
    expect(actual).toEqual(preview);
  });
});
