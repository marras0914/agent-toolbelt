import { describe, it, expect, beforeEach, vi } from "vitest";

// Offline coverage for watchlist-scan's DATA SOURCING, which the schema-only tests
// in watchlist-scan.test.ts cannot see. This is the regression guard for the
// 2026-08-13 change that moved name/price/market cap off the Polygon
// overview + prev-close pair onto a single fetchFMPProfile() call and bounded the
// per-ticker fan-out.
//
// That bug was invisible to assertions on the tool's shape: a rate-limited fetcher
// returns {} instead of throwing, so an affected ticker still got ranked — just
// nameless, with a null market cap. Only the call pattern reveals it, so that is
// what these tests pin.
//
// Everything is mocked, so these run in CI whether or not upstream keys are set.

const state = vi.hoisted(() => ({
  calls: [] as string[],
  inFlight: 0,
  peakInFlight: 0,
  /** Tickers that should behave as though no upstream has data for them. */
  noData: new Set<string>(),
}));

// Spread the real config so only the API keys are faked — other modules in the
// import graph (db, auth middleware via registry) keep their genuine settings.
vi.mock("../../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config")>();
  return {
    ...actual,
    config: {
      ...actual.config,
      anthropicApiKey: "test-key",
      finnhubApiKey: "test-key",
      fmpApiKey: "test-key",
      // Deliberately populated even though the tool no longer needs it. Leaving it
      // blank would make these tests pass for the wrong reason: a reintroduced
      // Polygon dependency would trip its own "not configured" guard before any
      // fetch, so the call-pattern assertions below would never get to run.
      polygonApiKey: "test-key",
    },
  };
});

vi.mock("../../tools/_stock-fetchers", () => {
  const track = (name: string, build: (ticker: string) => any) => async (ticker: string) => {
    state.calls.push(`${name}:${ticker}`);
    state.inFlight++;
    state.peakInFlight = Math.max(state.peakInFlight, state.inFlight);
    await new Promise((r) => setTimeout(r, 3));
    state.inFlight--;
    return state.noData.has(ticker) ? {} : build(ticker);
  };

  return {
    fetchFMPProfile: track("profile", (t) => ({
      companyName: `${t} Inc.`,
      price: 100,
      marketCap: 2_000_000_000,
      sector: "Technology",
      industry: "Software",
      beta: 1.1,
    })),
    fetchFMPKeyMetrics: track("keymetrics", () => ({
      freeCashFlowYieldTTM: 0.04,
      returnOnEquityTTM: 0.3,
    })),
    fetchFMPRatiosTTM: track("ratios", () => ({
      priceToEarningsRatioTTM: 20,
      priceToSalesRatioTTM: 5,
      netProfitMarginTTM: 0.2,
      dividendYieldTTM: 0.01,
    })),
    fetchFinnhubMetrics: track("finnhub", () => ({ revenueGrowth3Y: 12 })),
    // Present so an accidental re-introduction is caught by the assertions below
    // rather than blowing up with "not a function".
    fetchPolygonOverview: track("polygon-overview", () => ({})),
    fetchPolygonPrevClose: track("polygon-prevclose", () => ({})),
  };
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              focus: "value",
              ranked: [{ ticker: "AAA", rank: 1, read: "cheap" }],
              topPick: { ticker: "AAA", why: "cheapest" },
              avoid: { ticker: "BBB", why: "priciest" },
              watchlistTakeaway: "mixed",
            }),
          },
        ],
      }),
    };
  },
}));

import tool from "../../tools/watchlist-scan";

const run = async (tickers: string[]) => {
  const parsed = tool.inputSchema.safeParse({ tickers, focus: "value" });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return (await tool.handler(parsed.data)) as any;
};

const callsFor = (prefix: string) => state.calls.filter((c) => c.startsWith(`${prefix}:`));

beforeEach(() => {
  state.calls = [];
  state.inFlight = 0;
  state.peakInFlight = 0;
  state.noData.clear();
});

describe("watchlist-scan data sourcing", () => {
  it("never calls Polygon", async () => {
    await run(["AAA", "BBB", "CCC"]);
    expect(callsFor("polygon-overview")).toHaveLength(0);
    expect(callsFor("polygon-prevclose")).toHaveLength(0);
  });

  it("fetches the FMP profile once per ticker", async () => {
    await run(["AAA", "BBB", "CCC"]);
    expect(callsFor("profile").sort()).toEqual(["profile:AAA", "profile:BBB", "profile:CCC"]);
  });

  it("takes name, price and market cap from the profile", async () => {
    const r = await run(["AAA", "BBB"]);
    for (const m of r.metrics) {
      expect(m.name).toBe(`${m.ticker} Inc.`);
      expect(m.price).toBe(100);
      expect(m.marketCapB).toBe(2); // 2e9 → 2.0B
    }
  });

  it("costs 4 upstream calls per ticker, not 5", async () => {
    await run(["AAA", "BBB", "CCC"]);
    expect(state.calls).toHaveLength(12);
  });
});

describe("watchlist-scan bounded fan-out", () => {
  it("keeps concurrent upstream calls bounded at the 15-ticker maximum", async () => {
    const tickers = Array.from({ length: 15 }, (_, i) => `T${i}A`);
    await run(tickers);
    // 4 tickers in flight × 4 calls each. An unbounded Promise.all would peak at 60,
    // which is what rate-limited the real thing.
    expect(state.peakInFlight).toBeLessThanOrEqual(16);
    expect(callsFor("profile")).toHaveLength(15);
  });
});

describe("watchlist-scan partial upstream failure", () => {
  it("reports tickers with no data instead of silently ranking them", async () => {
    state.noData.add("BBB");
    const r = await run(["AAA", "BBB", "CCC"]);
    expect(r.noDataFor).toEqual(["BBB"]);
    expect(r.scanned).toEqual(["AAA", "CCC"]);
    expect(r.metrics.map((m: any) => m.ticker)).toEqual(["AAA", "CCC"]);
  });

  it("refuses to scan when fewer than 2 tickers resolve", async () => {
    state.noData.add("BBB");
    state.noData.add("CCC");
    await expect(run(["AAA", "BBB", "CCC"])).rejects.toThrow(/at least 2 tickers/i);
  });
});
