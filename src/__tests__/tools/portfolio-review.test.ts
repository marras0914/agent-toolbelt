import { describe, it, expect } from "vitest";
import tool, {
  weightedAvg,
  weightedHarmonic,
  concentrationLabel,
  mapWithConcurrency,
  Position,
} from "../../tools/portfolio-review";

const parse = (input: unknown) => tool.inputSchema.safeParse(input);

const hasStockKeys =
  !!process.env.ANTHROPIC_API_KEY && !!process.env.FINNHUB_API_KEY && !!process.env.FMP_API_KEY;

/** Minimal Position with only the fields a given test needs. */
const pos = (ticker: string, weightPct: number, extra: Partial<Position> = {}): Position =>
  ({
    ticker,
    name: ticker,
    sector: null,
    industry: null,
    price: null,
    marketCapB: null,
    pe: null,
    ps: null,
    fcfYield: null,
    roe: null,
    netMargin: null,
    divYield: null,
    revGrowth3Y: null,
    debtToEquity: null,
    beta: null,
    weightPct,
    ...extra,
  }) as Position;

describe("portfolio-review input schema", () => {
  it("accepts 2 holdings with weights and uppercases tickers", () => {
    const r = parse({ holdings: [{ ticker: "nvda", weight: 60 }, { ticker: "msft", weight: 40 }] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.holdings.map((h) => h.ticker)).toEqual(["MSFT", "NVDA"]); // sorted
  });

  it("sorts holdings by ticker so input order does not change the cache key", () => {
    const a = parse({ holdings: [{ ticker: "NVDA", weight: 1 }, { ticker: "AMD", weight: 2 }] });
    const b = parse({ holdings: [{ ticker: "AMD", weight: 2 }, { ticker: "NVDA", weight: 1 }] });
    expect(a.success && b.success).toBe(true);
    if (a.success && b.success) expect(a.data).toEqual(b.data);
  });

  it("accepts holdings with no sizing at all (equal-weighted)", () => {
    expect(parse({ holdings: [{ ticker: "AAPL" }, { ticker: "MSFT" }] }).success).toBe(true);
  });

  it("accepts share counts", () => {
    expect(parse({ holdings: [{ ticker: "AAPL", shares: 10 }, { ticker: "MSFT", shares: 4 }] }).success).toBe(true);
  });

  it("rejects mixing weight and shares across the portfolio", () => {
    const r = parse({ holdings: [{ ticker: "AAPL", weight: 50 }, { ticker: "MSFT", shares: 4 }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("one sizing method");
  });

  it("rejects weight and shares on the same holding", () => {
    expect(parse({ holdings: [{ ticker: "AAPL", weight: 50, shares: 4 }, { ticker: "MSFT", weight: 50 }] }).success).toBe(
      false
    );
  });

  it("rejects a partially weighted portfolio", () => {
    const r = parse({ holdings: [{ ticker: "AAPL", weight: 50 }, { ticker: "MSFT" }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("on all of them");
  });

  it("rejects fewer than 2 holdings", () => {
    expect(parse({ holdings: [{ ticker: "AAPL", weight: 100 }] }).success).toBe(false);
  });

  it("rejects more than 20 holdings", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ticker: `T${i}A`, weight: 1 }));
    expect(parse({ holdings: many }).success).toBe(false);
  });

  it("rejects a non-US ticker in the list", () => {
    const r = parse({ holdings: [{ ticker: "NVDA", weight: 50 }, { ticker: "002714", weight: 50 }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain("US-listed");
  });

  it("rejects non-positive weights", () => {
    expect(parse({ holdings: [{ ticker: "AAPL", weight: 0 }, { ticker: "MSFT", weight: 50 }] }).success).toBe(false);
    expect(parse({ holdings: [{ ticker: "AAPL", weight: -5 }, { ticker: "MSFT", weight: 50 }] }).success).toBe(false);
  });

  it("is registered with stocks tag and $0.05 pricing", () => {
    expect(tool.name).toBe("portfolio-review");
    expect(tool.metadata?.tags).toContain("stocks");
    expect(tool.metadata?.pricingMicros).toBe(50_000);
  });
});

describe("portfolio-review weighting math", () => {
  it("weights the arithmetic mean by position size", () => {
    const positions = [pos("A", 75, { roe: 0.2 }), pos("B", 25, { roe: 0.4 })];
    expect(weightedAvg(positions, (p) => p.roe)).toBeCloseTo(0.25, 6);
  });

  it("renormalizes over the positions that have the metric", () => {
    // B has no ROE, so A carries the whole weight despite being 50% of the book.
    const positions = [pos("A", 50, { roe: 0.3 }), pos("B", 50)];
    expect(weightedAvg(positions, (p) => p.roe)).toBeCloseTo(0.3, 6);
  });

  it("returns null when no position has the metric", () => {
    expect(weightedAvg([pos("A", 50), pos("B", 50)], (p) => p.roe)).toBeNull();
  });

  it("aggregates multiples harmonically, not arithmetically", () => {
    // Equal weights on 10x and 30x: arithmetic says 20x, but the portfolio's
    // actual price-to-earnings is 15x (earnings yields of 10% and 3.33% average
    // to 6.67%). Getting this wrong overstates how expensive the book is.
    const positions = [pos("A", 50, { pe: 10 }), pos("B", 50, { pe: 30 })];
    expect(weightedHarmonic(positions, (p) => p.pe)).toBeCloseTo(15, 6);
  });

  it("ignores non-positive multiples (a loss-making holding has no meaningful P/E)", () => {
    const positions = [pos("A", 50, { pe: 20 }), pos("B", 50, { pe: 0 })];
    expect(weightedHarmonic(positions, (p) => p.pe)).toBeCloseTo(20, 6);
  });

  it("returns null when nothing has a usable multiple", () => {
    expect(weightedHarmonic([pos("A", 50), pos("B", 50)], (p) => p.pe)).toBeNull();
  });
});

describe("portfolio-review bounded fan-out", () => {
  it("preserves input order regardless of completion order", async () => {
    const delays = [40, 5, 30, 1, 20, 10];
    const out = await mapWithConcurrency(delays, 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual(delays);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return i;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("handles a list shorter than the limit", async () => {
    expect(await mapWithConcurrency([1, 2], 8, async (n) => n * 2)).toEqual([2, 4]);
  });
});

describe("portfolio-review concentration labels", () => {
  it("flags a book dominated by three names", () => {
    expect(concentrationLabel(70, 4)).toBe("highly_concentrated");
  });

  it("flags a low effective position count even when top-3 looks tame", () => {
    expect(concentrationLabel(35, 2.5)).toBe("highly_concentrated");
  });

  it("calls a moderately concentrated book concentrated", () => {
    expect(concentrationLabel(45, 6)).toBe("concentrated");
  });

  it("calls a spread book diversified", () => {
    expect(concentrationLabel(30, 8)).toBe("diversified");
  });
});

describe("portfolio-review handler (live)", () => {
  it.skipIf(!hasStockKeys)("returns the expected shape and sums weights to 100", async () => {
    const parsed = parse({
      holdings: [
        { ticker: "AAPL", weight: 40 },
        { ticker: "KO", weight: 35 },
        { ticker: "XOM", weight: 25 },
      ],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const result = (await tool.handler(parsed.data)) as any;

    expect(result.weightingMode).toBe("weight");
    expect(result.holdings).toHaveLength(3);
    const sum = result.holdings.reduce((s: number, h: any) => s + h.weightPct, 0);
    expect(sum).toBeGreaterThan(99.9);
    expect(sum).toBeLessThan(100.1);

    expect(["diversified", "concentrated", "highly_concentrated"]).toContain(result.concentration.label);
    expect(result.concentration.positionCount).toBe(3);
    expect(result.concentration.effectivePositions).toBeGreaterThan(0);
    expect(result.sectorExposure.length).toBeGreaterThan(0);
    expect(result.portfolioMetrics).toBeDefined();
    expect(typeof result.oneLiner).toBe("string");
    expect(Array.isArray(result.overlappingBets)).toBe(true);
    expect(Array.isArray(result.gaps)).toBe(true);
    expect(result.weakestLink?.ticker).toBeDefined();
    expect(result.generatedAt).toBeDefined();
  }, 60_000);

  it.skipIf(!hasStockKeys)("throws UnsupportedTicker when nothing resolves", async () => {
    const parsed = parse({ holdings: [{ ticker: "ZZZZZZ", weight: 50 }, { ticker: "QQQQQQ", weight: 50 }] });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await expect(tool.handler(parsed.data)).rejects.toThrow(/No data found/);
  }, 30_000);
});
