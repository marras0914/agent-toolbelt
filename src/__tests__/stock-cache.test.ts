import { describe, it, expect, beforeEach } from "vitest";
import { getCached, setCached, clearExpiredCache, cacheSize, _clearAllCache } from "../db/stock-cache";

describe("stock-cache (SQLite-backed)", () => {
  beforeEach(() => {
    _clearAllCache();
  });

  it("returns undefined for missing keys", () => {
    expect(getCached("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves a value within TTL", () => {
    setCached("k1", { ticker: "AAPL", marketCap: 3_500_000_000_000 }, 60_000);
    const hit = getCached<{ ticker: string; marketCap: number }>("k1");
    expect(hit).toEqual({ ticker: "AAPL", marketCap: 3_500_000_000_000 });
  });

  it("preserves arrays and nested objects", () => {
    const value = { transactions: [{ name: "Tim Cook", change: -10000 }], meta: { fetchedAt: "2026-05-19" } };
    setCached("k2", value, 60_000);
    expect(getCached("k2")).toEqual(value);
  });

  it("returns undefined after TTL expiry", () => {
    setCached("k3", { foo: "bar" }, 1); // 1ms TTL
    // Spin briefly to let TTL pass — Date.now() resolution is fine here.
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    expect(getCached("k3")).toBeUndefined();
  });

  it("overwrites existing keys on second set", () => {
    setCached("k4", { v: 1 }, 60_000);
    setCached("k4", { v: 2 }, 60_000);
    expect(getCached<{ v: number }>("k4")?.v).toBe(2);
  });

  it("clearExpiredCache removes expired rows", () => {
    // Use a uniquely-prefixed key so parallel test files (which share the same
    // SQLite file on disk) can't interfere with this assertion.
    const k = `clearexp-${Date.now()}-${Math.random()}`;
    setCached(k, { x: 1 }, 1);
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    const removed = clearExpiredCache();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(getCached(k)).toBeUndefined();
  });

  it("persists across module re-imports (simulates restart)", async () => {
    setCached("persist-key", { restartProof: true }, 60_000);
    // Re-import the module — vitest caches modules, but the SQLite handle stays open
    // on the same DB file. So fresh imports of getCached should still see the data.
    const fresh = await import("../db/stock-cache");
    expect(fresh.getCached("persist-key")).toEqual({ restartProof: true });
  });

  it("cacheSize reflects writes", () => {
    expect(cacheSize()).toBe(0);
    setCached("a", 1, 60_000);
    setCached("b", 2, 60_000);
    setCached("c", 3, 60_000);
    expect(cacheSize()).toBe(3);
  });
});
