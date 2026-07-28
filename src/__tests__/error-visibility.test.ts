import { describe, it, expect, beforeEach } from "vitest";
import { withHitRate, getClientUsageSummary, getErrorSummary } from "../middleware/usage";
import {
  createClient,
  createApiKey,
  recordUsage,
  getClientStatusBreakdown,
  getErrorBreakdown,
  pingDb,
  sqliteTimestamp,
  sqliteSince,
} from "../db";

/**
 * `status_code` was recorded on every call from day one but never read back, so a
 * client whose every request 500'd was indistinguishable from a healthy one in
 * /admin/usage. That is how an 8-week outage on the upgrade-nudge path stayed
 * invisible, and why diagnosing it needed guesswork from cache-hit rate and latency.
 */

// createApiKey returns { key, record } — the FK we need is record.id.
function seedClient(email: string): { clientId: string; keyId: string } {
  const client = createClient(email, "test");
  const { record } = createApiKey(client.id);
  return { clientId: client.id, keyId: record.id };
}

let seq = 0;
function uniqueEmail(): string {
  return `errvis-${process.pid}-${++seq}@example.com`;
}

describe("withHitRate", () => {
  it("still reports cache hit rate", () => {
    expect(withHitRate({ calls: 100, cache_hits: 75 }).cacheHitRate).toBe(0.75);
    expect(withHitRate({ total_calls: 100, cache_hits: 15 }).cacheHitRate).toBe(0.15);
  });

  it("reports error rate alongside it", () => {
    expect(withHitRate({ calls: 100, errors: 100 }).errorRate).toBe(1);
    expect(withHitRate({ calls: 100, errors: 3 }).errorRate).toBe(0.03);
    expect(withHitRate({ calls: 3, errors: 1 }).errorRate).toBe(0.33);
  });

  it("treats missing/null counts as zero rather than NaN", () => {
    expect(withHitRate({ calls: 10, cache_hits: null, errors: null }).errorRate).toBe(0);
    expect(withHitRate({ calls: 10 }).errorRate).toBe(0);
    expect(withHitRate({ calls: 0, errors: 0 }).errorRate).toBe(0);
  });

  it("distinguishes a quiet client from a broken one", () => {
    const quiet = withHitRate({ calls: 12, cache_hits: 6, errors: 0 });
    const broken = withHitRate({ calls: 196, cache_hits: 0, errors: 196 });
    expect(quiet.errorRate).toBe(0);
    expect(broken.errorRate).toBe(1);
  });
});

describe("status_code is queryable", () => {
  let clientId = "";
  let keyId = "";

  beforeEach(() => {
    ({ clientId, keyId } = seedClient(uniqueEmail()));
  });

  it("splits a client's calls by tool and status", () => {
    recordUsage(clientId, keyId, "stock-thesis", 200, 4200, "fp_ok", false);
    recordUsage(clientId, keyId, "stock-thesis", 500, 680, "fp_bad", false);
    recordUsage(clientId, keyId, "stock-thesis", 500, 690, "fp_bad", false);
    recordUsage(clientId, keyId, "insider-signal", 429, 12, "fp_rl", false);

    const since = sqliteSince(1 / 1440); // 1 minute ago, in SQLite format
    const rows = getClientStatusBreakdown(clientId, since);

    const thesis500 = rows.find((r) => r.tool_name === "stock-thesis" && r.status_code === 500);
    expect(thesis500?.calls).toBe(2);
    expect(rows.find((r) => r.tool_name === "stock-thesis" && r.status_code === 200)?.calls).toBe(1);
    expect(rows.find((r) => r.tool_name === "insider-signal" && r.status_code === 429)?.calls).toBe(1);
  });

  it("surfaces the error count and rate in the client usage summary", () => {
    for (let i = 0; i < 4; i++) recordUsage(clientId, keyId, "valuation-snapshot", 500, 700, "fp_same", false);
    recordUsage(clientId, keyId, "valuation-snapshot", 200, 3000, "fp_good", false);

    const summary = getClientUsageSummary(clientId);
    const tool = summary.tools.find((t: any) => t.tool_name === "valuation-snapshot");

    expect(tool.calls).toBe(5);
    expect(tool.errors).toBe(4);
    expect(tool.errorRate).toBe(0.8);
    expect(summary.byStatus.length).toBeGreaterThan(0);
  });

  it("counts only 4xx/5xx as errors, not slow 2xx calls", () => {
    recordUsage(clientId, keyId, "moat-analysis", 200, 9800, "fp_slow", false);
    recordUsage(clientId, keyId, "moat-analysis", 304, 5, "fp_nm", false);
    recordUsage(clientId, keyId, "moat-analysis", 400, 8, "fp_bad", false);

    const summary = getClientUsageSummary(clientId);
    const tool = summary.tools.find((t: any) => t.tool_name === "moat-analysis");
    expect(tool.calls).toBe(3);
    expect(tool.errors).toBe(1); // only the 400
  });

  it("global error breakdown attributes failures to a client and tool", () => {
    recordUsage(clientId, keyId, "bear-vs-bull", 500, 600, "fp_x", false);
    recordUsage(clientId, keyId, "bear-vs-bull", 500, 610, "fp_x", false);

    const since = sqliteSince(1 / 1440); // 1 minute ago, in SQLite format
    const rows = getErrorBreakdown(since);
    const mine = rows.find((r) => r.tool_name === "bear-vs-bull" && r.status_code === 500);

    expect(mine).toBeDefined();
    expect(mine!.calls).toBeGreaterThanOrEqual(2);
    expect(mine!.email).toContain("@example.com");
    expect(mine!.last_seen).toBeTruthy();
  });

  it("error summary totals and excludes successful calls", () => {
    recordUsage(clientId, keyId, "compare-stocks", 200, 10_000, "fp_ok", false);
    recordUsage(clientId, keyId, "compare-stocks", 502, 40, "fp_err", false);

    const summary = getErrorSummary(1);
    expect(summary.period).toBe("last_1_days");
    expect(summary.totalErrors).toBeGreaterThanOrEqual(1);
    expect(summary.errors.every((r) => r.status_code >= 400)).toBe(true);
  });
});

describe("sqlite timestamp binding", () => {
  it("formats to SQLite's stored shape, not ISO-8601", () => {
    const d = new Date("2026-07-28T20:36:11.123Z");
    expect(sqliteTimestamp(d)).toBe("2026-07-28 20:36:11");
  });

  it("compares correctly against a stored timestamp on the same day", () => {
    // The bug: 'T' (0x54) sorts above ' ' (0x20), so an ISO `since` on the same
    // calendar day excluded every row. Multi-day windows hid it by comparing the
    // date digits first, which is why 30-day admin stats looked fine.
    const stored = "2026-07-28 20:36:11";
    const isoSince = new Date("2026-07-28T20:35:11.123Z").toISOString();
    const fixedSince = sqliteTimestamp(new Date("2026-07-28T20:35:11.123Z"));

    expect(stored >= isoSince).toBe(false); // what we used to bind
    expect(stored >= fixedSince).toBe(true); // what we bind now
  });

  it("sqliteSince produces the same shape", () => {
    expect(sqliteSince(30)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(sqliteSince(1)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("pingDb", () => {
  it("reports healthy against a working database", () => {
    expect(pingDb()).toBe(true);
  });
});
