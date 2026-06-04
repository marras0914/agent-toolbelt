import { describe, it, expect } from "vitest";
import { responseCacheKey } from "../tools/registry";
import { TIER_LIMITS } from "../middleware/auth";
import { withHitRate } from "../middleware/usage";

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

  it("preserves the original row fields", () => {
    const out = withHitRate({ tool_name: "stock-thesis", calls: 4, cache_hits: 2 } as any);
    expect(out.tool_name).toBe("stock-thesis");
    expect(out.cacheHitRate).toBe(0.5);
  });
});

describe("hobby tier", () => {
  it("is registered in TIER_LIMITS with 10k monthly calls", () => {
    expect(TIER_LIMITS.hobby).toEqual({ requestsPerMinute: 30, monthlyRequests: 10_000 });
  });

  it("sits between free and starter", () => {
    expect(TIER_LIMITS.hobby.monthlyRequests).toBeGreaterThan(TIER_LIMITS.free.monthlyRequests);
    expect(TIER_LIMITS.hobby.monthlyRequests).toBeLessThan(TIER_LIMITS.starter.monthlyRequests);
  });
});
