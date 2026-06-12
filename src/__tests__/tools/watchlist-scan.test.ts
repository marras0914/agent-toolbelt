import { describe, it, expect } from "vitest";
import tool from "../../tools/watchlist-scan";

const parse = (input: unknown) => tool.inputSchema.safeParse(input);

describe("watchlist-scan input schema", () => {
  it("accepts 2–15 valid tickers and defaults focus to value", () => {
    const r = parse({ tickers: ["nvda", "amd"] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tickers).toEqual(["NVDA", "AMD"]); // uppercased
      expect(r.data.focus).toBe("value");
    }
  });

  it("rejects fewer than 2 tickers", () => {
    expect(parse({ tickers: ["NVDA"] }).success).toBe(false);
  });

  it("rejects more than 15 tickers", () => {
    const many = Array.from({ length: 16 }, (_, i) => `T${i}A`);
    expect(parse({ tickers: many }).success).toBe(false);
  });

  it("rejects an invalid ticker in the list", () => {
    expect(parse({ tickers: ["NVDA", "002714"] }).success).toBe(false); // numeric A-share
  });

  it("accepts the four focus lenses and rejects others", () => {
    for (const focus of ["value", "quality", "growth", "income"]) {
      expect(parse({ tickers: ["NVDA", "AMD"], focus }).success).toBe(true);
    }
    expect(parse({ tickers: ["NVDA", "AMD"], focus: "momentum" }).success).toBe(false);
  });

  it("is registered with stocks tag and $0.05 pricing", () => {
    expect(tool.name).toBe("watchlist-scan");
    expect(tool.metadata?.tags).toContain("stocks");
    expect(tool.metadata?.pricingMicros).toBe(50_000);
  });
});
