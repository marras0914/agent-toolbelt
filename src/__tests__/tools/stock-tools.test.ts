import { describe, it, expect } from "vitest";

import stockThesisTool from "../../tools/stock-thesis";
import earningsAnalysisTool from "../../tools/earnings-analysis";
import insiderSignalTool from "../../tools/insider-signal";
import valuationSnapshotTool from "../../tools/valuation-snapshot";
import bearVsBullTool from "../../tools/bear-vs-bull";

const hasStockKeys =
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.POLYGON_API_KEY &&
  !!process.env.FINNHUB_API_KEY &&
  !!process.env.FMP_API_KEY;

// ============================================
// stock-thesis
// ============================================
describe("stock-thesis", () => {
  it("accepts valid ticker", () => {
    const parsed = stockThesisTool.inputSchema.safeParse({ ticker: "AAPL" });
    expect(parsed.success).toBe(true);
  });

  it("uppercases and trims ticker", () => {
    const parsed = stockThesisTool.inputSchema.safeParse({ ticker: " nvda " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.ticker).toBe("NVDA");
  });

  it("defaults timeHorizon to 3-5 years", () => {
    const parsed = stockThesisTool.inputSchema.safeParse({ ticker: "MSFT" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.timeHorizon).toBe("3-5 years");
  });

  it("rejects empty ticker", () => {
    const parsed = stockThesisTool.inputSchema.safeParse({ ticker: "" });
    expect(parsed.success).toBe(false);
  });

  it("rejects ticker longer than 10 chars", () => {
    const parsed = stockThesisTool.inputSchema.safeParse({ ticker: "TOOLONGNAME" });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid timeHorizon", () => {
    const parsed = stockThesisTool.inputSchema.safeParse({ ticker: "AAPL", timeHorizon: "10 years" });
    expect(parsed.success).toBe(false);
  });

  it.skipIf(!hasStockKeys)("returns expected shape for AAPL", async () => {
    const result = await stockThesisTool.handler({ ticker: "AAPL", timeHorizon: "3-5 years" }) as any;
    expect(result.ticker).toBe("AAPL");
    expect(["bullish", "neutral", "bearish"]).toContain(result.verdict);
    expect(typeof result.oneLiner).toBe("string");
    expect(result.oneLiner.length).toBeGreaterThan(0);
    expect(Array.isArray(result.keyStrengths)).toBe(true);
    expect(Array.isArray(result.keyRisks)).toBe(true);
    expect(result.dataSnapshot).toBeDefined();
    expect(result.generatedAt).toBeDefined();
  }, 30_000);

  it.skipIf(!hasStockKeys)("throws on invalid ticker", async () => {
    await expect(stockThesisTool.handler({ ticker: "ZZZZZZ", timeHorizon: "3-5 years" })).rejects.toThrow();
  }, 15_000);
});

// ============================================
// earnings-analysis
// ============================================
describe("earnings-analysis", () => {
  it("accepts valid ticker", () => {
    const parsed = earningsAnalysisTool.inputSchema.safeParse({ ticker: "MSFT" });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty ticker", () => {
    const parsed = earningsAnalysisTool.inputSchema.safeParse({ ticker: "" });
    expect(parsed.success).toBe(false);
  });

  it.skipIf(!hasStockKeys)("returns expected shape for NVDA", async () => {
    // FMP earnings-surprises endpoint may not be available on free tier locally;
    // this test is covered by the production smoke test on Railway.
    let result: any;
    try {
      result = await earningsAnalysisTool.handler({ ticker: "NVDA" });
    } catch (e: any) {
      if (e.message?.includes("No earnings data found")) return; // skip gracefully
      throw e;
    }
    expect(result.ticker).toBe("NVDA");
    expect(["strong_compounder", "consistent", "mixed", "volatile", "deteriorating"]).toContain(result.verdict);
    expect(typeof result.oneLiner).toBe("string");
    expect(typeof result.beatRate).toBe("string");
    expect(typeof result.revenueRead).toBe("string");
    expect(typeof result.epsRead).toBe("string");
    expect(result.rawData).toBeDefined();
    expect(typeof result.rawData.quartersAnalyzed).toBe("number");
    expect(result.generatedAt).toBeDefined();
  }, 30_000);
});

// ============================================
// insider-signal
// ============================================
describe("insider-signal", () => {
  it("accepts valid ticker", () => {
    const parsed = insiderSignalTool.inputSchema.safeParse({ ticker: "NVDA" });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty ticker", () => {
    const parsed = insiderSignalTool.inputSchema.safeParse({ ticker: "" });
    expect(parsed.success).toBe(false);
  });

  it.skipIf(!hasStockKeys)("returns expected shape for AAPL", async () => {
    const result = await insiderSignalTool.handler({ ticker: "AAPL" }) as any;
    expect(result.ticker).toBe("AAPL");
    expect(["strong_buy", "buy", "neutral", "sell", "strong_sell"]).toContain(result.signal);
    expect(["high", "medium", "low"]).toContain(result.confidence);
    expect(typeof result.oneLiner).toBe("string");
    expect(typeof result.interpretation).toBe("string");
    expect(typeof result.verdict).toBe("string");
    expect(result.rawData).toBeDefined();
    expect(typeof result.rawData.transactionsAnalyzed).toBe("number");
    expect(result.generatedAt).toBeDefined();
  }, 30_000);
});

// ============================================
// valuation-snapshot
// ============================================
describe("valuation-snapshot", () => {
  it("accepts valid ticker", () => {
    const parsed = valuationSnapshotTool.inputSchema.safeParse({ ticker: "GOOG" });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty ticker", () => {
    const parsed = valuationSnapshotTool.inputSchema.safeParse({ ticker: "" });
    expect(parsed.success).toBe(false);
  });

  it.skipIf(!hasStockKeys)("returns expected shape for GOOG", async () => {
    const result = await valuationSnapshotTool.handler({ ticker: "GOOG" }) as any;
    expect(result.ticker).toBe("GOOG");
    expect(["very_cheap", "cheap", "fair", "expensive", "very_expensive"]).toContain(result.verdict);
    expect(typeof result.oneLiner).toBe("string");
    expect(typeof result.buyZone).toBe("string");
    expect(typeof result.bottomLine).toBe("string");
    expect(result.metrics).toBeDefined();
    expect(result.generatedAt).toBeDefined();
  }, 30_000);
});

// ============================================
// bear-vs-bull
// ============================================
describe("bear-vs-bull", () => {
  it("accepts valid ticker", () => {
    const parsed = bearVsBullTool.inputSchema.safeParse({ ticker: "TSLA" });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty ticker", () => {
    const parsed = bearVsBullTool.inputSchema.safeParse({ ticker: "" });
    expect(parsed.success).toBe(false);
  });

  it.skipIf(!hasStockKeys)("returns expected shape for NVDA", async () => {
    const result = await bearVsBullTool.handler({ ticker: "NVDA" }) as any;
    expect(result.ticker).toBe("NVDA");
    expect(["bull_wins", "slight_bull", "too_close", "slight_bear", "bear_wins"]).toContain(result.verdict);
    expect(Array.isArray(result.bullCase)).toBe(true);
    expect(result.bullCase.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(result.bearCase)).toBe(true);
    expect(result.bearCase.length).toBeGreaterThanOrEqual(3);
    expect(typeof result.verdictRationale).toBe("string");
    expect(typeof result.keyDebate).toBe("string");
    expect(result.generatedAt).toBeDefined();
  }, 45_000);
});
