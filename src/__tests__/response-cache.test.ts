import { describe, it, expect } from "vitest";
import { responseCacheKey } from "../tools/registry";
import { TIER_LIMITS } from "../middleware/auth";

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

describe("hobby tier", () => {
  it("is registered in TIER_LIMITS with 10k monthly calls", () => {
    expect(TIER_LIMITS.hobby).toEqual({ requestsPerMinute: 30, monthlyRequests: 10_000 });
  });

  it("sits between free and starter", () => {
    expect(TIER_LIMITS.hobby.monthlyRequests).toBeGreaterThan(TIER_LIMITS.free.monthlyRequests);
    expect(TIER_LIMITS.hobby.monthlyRequests).toBeLessThan(TIER_LIMITS.starter.monthlyRequests);
  });
});
