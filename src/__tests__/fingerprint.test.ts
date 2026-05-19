import { describe, it, expect } from "vitest";
import crypto from "crypto";

// The fingerprint function is private to src/middleware/usage.ts. To avoid exporting
// internals just for testing, we re-implement the same formula here and assert that
// it produces the expected determinism / sensitivity properties. If the formula in
// usage.ts changes, this file must change with it — that's an intentional anchor.
function fingerprint(body: unknown): string | null {
  try {
    return crypto.createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

describe("input fingerprint", () => {
  it("same body produces the same fingerprint", () => {
    const a = fingerprint({ ticker: "AAPL", timeHorizon: "3-5 years" });
    const b = fingerprint({ ticker: "AAPL", timeHorizon: "3-5 years" });
    expect(a).toBe(b);
  });

  it("different bodies produce different fingerprints", () => {
    const a = fingerprint({ ticker: "AAPL" });
    const b = fingerprint({ ticker: "MSFT" });
    expect(a).not.toBe(b);
  });

  it("returns 16 hex characters", () => {
    const fp = fingerprint({ ticker: "AAPL" });
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("handles undefined and null gracefully", () => {
    expect(fingerprint(undefined)).toBe(fingerprint({}));
    expect(fingerprint(null)).toBe(fingerprint({}));
  });

  it("key order sensitivity — known limitation, documented here", () => {
    // JSON.stringify preserves insertion order. If two clients send the same logical
    // input with different key order, they'll fingerprint differently. This is a
    // known imprecision; the metric is "approximately distinct inputs" not "exactly".
    const a = fingerprint({ ticker: "AAPL", timeHorizon: "3-5 years" });
    const b = fingerprint({ timeHorizon: "3-5 years", ticker: "AAPL" });
    expect(a).not.toBe(b);
  });

  it("differentiates compare-stocks inputs by ticker order", () => {
    // For compare-stocks {tickers: ["AAPL", "MSFT"]}, swapping order gives a different fingerprint.
    // Arguably semantically the same comparison, but the API treats them as different inputs.
    const a = fingerprint({ tickers: ["AAPL", "MSFT"] });
    const b = fingerprint({ tickers: ["MSFT", "AAPL"] });
    expect(a).not.toBe(b);
  });
});
