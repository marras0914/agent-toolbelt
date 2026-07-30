import { describe, it, expect } from "vitest";
import { UnsupportedTickerError, usTickerSchema, US_ONLY_HINT } from "../tools/_stock-helpers";

/**
 * Why this exists: `buildToolRouter` turns every thrown error into a 500, and a 500
 * means "transient, retry me". A ticker with no upstream data can never succeed, so
 * that was a permanent retry trap. One client hit `WIN` (Windstream, delisted) 250
 * times across six weeks — burning their entire free-tier quota on a request that
 * could not work, and pushing the global error rate to 0.43 so real incidents were
 * invisible underneath it.
 *
 * The shape check (`usTickerSchema`) can't catch this: WIN is a perfectly well-formed
 * US ticker. Only the upstream lookup knows, so the distinction has to survive as far
 * as the router — hence a typed error rather than a message-sniffed string.
 */

describe("UnsupportedTickerError", () => {
  it("is an Error, so existing catch-alls still work", () => {
    const err = new UnsupportedTickerError("WIN");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UnsupportedTickerError);
    expect(err.name).toBe("UnsupportedTickerError");
  });

  it("keeps the user-facing message and coverage hint", () => {
    const err = new UnsupportedTickerError("WIN");
    expect(err.message).toContain('No data found for ticker "WIN"');
    expect(err.message).toContain(US_ONLY_HINT);
  });

  it("carries the tickers as data, not just prose", () => {
    // The router echoes these back so a caller can act without parsing the message.
    expect(new UnsupportedTickerError("WIN").tickers).toEqual(["WIN"]);
    expect(new UnsupportedTickerError(["WIN", "ZZZZ"]).tickers).toEqual(["WIN", "ZZZZ"]);
  });

  it("pluralizes for the multi-ticker case (compare-stocks)", () => {
    const err = new UnsupportedTickerError(["WIN", "ZZZZ"]);
    expect(err.message).toContain("tickers: WIN, ZZZZ");
    expect(err.message).not.toContain('ticker "WIN"');
  });

  it("is distinguishable from a generic failure", () => {
    // This is the whole point: the router branches on the type, so a real upstream
    // fault still 500s while an unusable ticker does not.
    expect(new Error("Anthropic timeout") instanceof UnsupportedTickerError).toBe(false);
  });
});

describe("shape validation vs. data availability are different failures", () => {
  it("WIN passes shape validation — only the upstream lookup can reject it", () => {
    const parsed = usTickerSchema.safeParse("WIN");
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toBe("WIN");
  });

  it("malformed tickers are still caught earlier, as a 400", () => {
    // These never reach the handler, so they never become UnsupportedTickerError.
    for (const bad of ["002714", "2DG", ""]) {
      expect(usTickerSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
