import { describe, it, expect } from "vitest";
import { responseCacheKey } from "../tools/registry";
import { TIERS, SUBSCRIPTION_TIERS } from "../tiers";
import { withHitRate, getCapWatch } from "../middleware/usage";
import { checkTierLimit } from "../db";

describe("responseCacheKey", () => {
  it("is deterministic regardless of input key order", () => {
    const a = responseCacheKey("stock-thesis", { ticker: "NVDA", timeHorizon: "3-5 years" });
    const b = responseCacheKey("stock-thesis", { timeHorizon: "3-5 years", ticker: "NVDA" });
    expect(a).toBe(b);
  });

  it("differs across tools for the same input", () => {
    expect(responseCacheKey("stock-thesis", { ticker: "NVDA" }))
      .not.toBe(responseCacheKey("moat-analysis", { ticker: "NVDA" }));
  });

  it("differs across inputs for the same tool", () => {
    expect(responseCacheKey("stock-thesis", { ticker: "NVDA" }))
      .not.toBe(responseCacheKey("stock-thesis", { ticker: "AMD" }));
  });

  it("handles array inputs (compare-stocks)", () => {
    const a = responseCacheKey("compare-stocks", { tickers: ["NVDA", "AMD"] });
    const b = responseCacheKey("compare-stocks", { tickers: ["AMD", "NVDA"] });
    expect(a).not.toBe(b); // order is meaningful for ticker lists
    expect(a).toBe(responseCacheKey("compare-stocks", { tickers: ["NVDA", "AMD"] }));
  });

  it("handles empty/undefined input without throwing", () => {
    expect(responseCacheKey("some-tool", undefined)).toBe("resp:v1:some-tool:");
    expect(responseCacheKey("some-tool", {})).toBe("resp:v1:some-tool:");
  });
});

describe("withHitRate", () => {
  it("computes a 2-d.p. hit rate from calls + cache_hits", () => {
    expect(withHitRate({ calls: 100, cache_hits: 75 }).cacheHitRate).toBe(0.75);
    expect(withHitRate({ calls: 3, cache_hits: 1 }).cacheHitRate).toBe(0.33);
  });

  it("returns 0 for zero calls and treats null hits as 0", () => {
    expect(withHitRate({ calls: 0, cache_hits: 0 }).cacheHitRate).toBe(0);
    expect(withHitRate({ calls: 10, cache_hits: null }).cacheHitRate).toBe(0);
  });

  it("uses total_calls for the global stats row (regression: global was stuck at 0)", () => {
    expect(withHitRate({ total_calls: 100, cache_hits: 15 }).cacheHitRate).toBe(0.15);
  });

  it("preserves the original row fields", () => {
    const out = withHitRate({ tool_name: "stock-thesis", calls: 4, cache_hits: 2 } as any);
    expect(out.tool_name).toBe("stock-thesis");
    expect(out.cacheHitRate).toBe(0.5);
  });
});

describe("pro tier ($10/mo, 10k calls)", () => {
  it("is registered in TIERS with 10k monthly calls and 30 req/min", () => {
    expect(TIERS.pro.monthlyRequests).toBe(10_000);
    expect(TIERS.pro.requestsPerMinute).toBe(30);
    expect(TIERS.pro.monthlyUsd).toBe(10);
  });

  it("sits between free and starter", () => {
    expect(TIERS.pro.monthlyRequests).toBeGreaterThan(TIERS.free.monthlyRequests);
    expect(TIERS.pro.monthlyRequests).toBeLessThan(TIERS.starter.monthlyRequests);
  });

  it("is enforced by checkTierLimit (regression: was missing from the enforced map)", () => {
    const limit = checkTierLimit("nonexistent-client", "pro").limit;
    expect(limit).toBe(10_000);
  });
});

describe("getCapWatch", () => {
  it("returns the expected shape and excludes uncapped tiers", () => {
    const w = getCapWatch(0.8);
    expect(w.period).toBe("rolling_30_days");
    expect(w.threshold).toBe(0.8);
    expect(Array.isArray(w.clients)).toBe(true);
    // every returned client must be on a capped tier and at/over threshold
    for (const c of w.clients) {
      expect(c.limit).not.toBe(Infinity);
      expect(c.pctOfCap).toBeGreaterThanOrEqual(0.8);
      expect(typeof c.overCap).toBe("boolean");
    }
  });

  it("defaults threshold to 0.8 and accepts an override", () => {
    expect(getCapWatch().threshold).toBe(0.8);
    expect(getCapWatch(0.5).threshold).toBe(0.5);
  });
});

describe("tier source of truth", () => {
  it("checkTierLimit agrees with TIERS for every tier (no drift between maps)", () => {
    for (const tier of Object.keys(TIERS) as (keyof typeof TIERS)[]) {
      expect(checkTierLimit("nonexistent-client", tier).limit).toBe(TIERS[tier].monthlyRequests);
    }
  });

  it("subscription tiers are exactly pro, starter, enterprise", () => {
    expect([...SUBSCRIPTION_TIERS].sort()).toEqual(["enterprise", "pro", "starter"]);
  });

  it("free and payg are not subscription tiers", () => {
    expect(SUBSCRIPTION_TIERS).not.toContain("free");
    expect(SUBSCRIPTION_TIERS).not.toContain("payg");
  });
});
