import { describe, it, expect } from "vitest";
import { toPolygonSymbol, toFmpSymbol } from "../tools/_stock-fetchers";
import { usTickerSchema } from "../tools/_stock-helpers";
import { getWarmTickers } from "../jobs/warm-cache";

/**
 * The three upstreams disagree on the share-class separator (verified live 2026-07-28):
 *   Polygon wants BRK.B, FMP wants BRK-B, Finnhub takes either.
 *
 * BRK.B is in the cache warm list, so before normalization it 402'd on all three FMP
 * endpoints every night for ~3 weeks. FMP's 402 body says "not available under your
 * current subscription", which reads as a plan-cap problem and was counted as one,
 * so the real cause (symbol format) stayed hidden behind a billing-shaped symptom.
 */

describe("toPolygonSymbol", () => {
  it("uses a dot for share classes", () => {
    expect(toPolygonSymbol("BRK-B")).toBe("BRK.B");
    expect(toPolygonSymbol("BRK.B")).toBe("BRK.B"); // idempotent
    expect(toPolygonSymbol("BF-B")).toBe("BF.B");
  });

  it("leaves ordinary tickers alone", () => {
    for (const t of ["AAPL", "MSFT", "NVDA", "GOOGL"]) {
      expect(toPolygonSymbol(t)).toBe(t);
    }
  });
});

describe("toFmpSymbol", () => {
  it("uses a hyphen for share classes", () => {
    expect(toFmpSymbol("BRK.B")).toBe("BRK-B");
    expect(toFmpSymbol("BRK-B")).toBe("BRK-B"); // idempotent
    expect(toFmpSymbol("BF.B")).toBe("BF-B");
  });

  it("leaves ordinary tickers alone", () => {
    for (const t of ["AAPL", "MSFT", "NVDA", "GOOGL"]) {
      expect(toFmpSymbol(t)).toBe(t);
    }
  });
});

describe("normalizers agree on a round trip", () => {
  it("both input forms converge to the same per-provider symbol", () => {
    // Whichever separator the caller uses, each provider sees its own form.
    for (const input of ["BRK.B", "BRK-B"]) {
      expect(toPolygonSymbol(input)).toBe("BRK.B");
      expect(toFmpSymbol(input)).toBe("BRK-B");
    }
  });

  it("is idempotent under repeated application", () => {
    expect(toFmpSymbol(toFmpSymbol("BRK.B"))).toBe("BRK-B");
    expect(toPolygonSymbol(toPolygonSymbol("BRK-B"))).toBe("BRK.B");
  });
});

describe("warm list is compatible with both providers", () => {
  const warm = getWarmTickers();

  it("every warm ticker survives the shared input schema", () => {
    for (const t of warm) {
      expect(usTickerSchema.safeParse(t).success, t).toBe(true);
    }
  });

  it("class-share tickers get translated rather than passed through to FMP", () => {
    // Regression guard: if a "." ever reaches FMP again, the nightly warmup 402s.
    for (const t of warm) {
      expect(toFmpSymbol(t), t).not.toContain(".");
      expect(toPolygonSymbol(t), t).not.toContain("-");
    }
  });

  it("still covers BRK.B, the ticker that exposed this", () => {
    expect(warm).toContain("BRK.B");
    expect(toFmpSymbol("BRK.B")).toBe("BRK-B");
  });
});
