import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateHeaderValue } from "node:http";
import type { Request, Response } from "express";

/**
 * The unit tests in upgrade-nudge.test.ts cover the copy and the sanitizer. This
 * file covers the thing that actually broke: the middleware must *apply* the
 * sanitizer, and must not let a bad header value fail the request. A green
 * sanitizer with an unsanitized call site is exactly the 8-week outage that
 * shipped in 7779774 — so drive `authenticate` end to end and validate the header
 * it sets through Node's own check.
 */

// vi.hoisted so the mock factory can read this state. vi.mock is hoisted above a
// plain `let`, and auth.ts imports ../db at module load, so a normal variable would
// be read in its temporal dead zone. (Top-level `await import` also works but trips
// TS1378 under this tsconfig's module setting, and CI type checks.)
const mock = vi.hoisted(() => ({ used: 200, limit: 250, tier: "free" }));

vi.mock("../db", () => ({
  validateApiKey: () => ({
    client: { id: "cli_test", email: "nudge@example.com", tier: mock.tier },
    keyId: "key_test",
  }),
  checkTierLimit: () => ({ allowed: true, used: mock.used, limit: mock.limit }),
  getClientBalance: () => 1_000_000,
}));

import { authenticate, _clearAuthRateBuckets } from "../middleware/auth";

// res mock whose setHeader enforces the same rule as a real ServerResponse, so an
// invalid value throws here just as it does in production.
function makeCtx() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let nextCalled = false;

  const req = { headers: { authorization: "Bearer atb_testkey" } } as unknown as Request;

  const res = {
    setHeader(name: string, value: unknown) {
      const v = String(value);
      validateHeaderValue(name, v); // throws ERR_INVALID_CHAR, like the real thing
      headers[name] = v;
    },
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  } as unknown as Response;

  return {
    req, res,
    next: () => { nextCalled = true; },
    get headers() { return headers; },
    get statusCode() { return statusCode; },
    get nextCalled() { return nextCalled; },
  };
}

describe("authenticate: X-Upgrade-Nudge header", () => {
  beforeEach(() => {
    mock.tier = "free";
    mock.limit = 250;
    mock.used = 200;
    // The per-minute limiter is module state; free tier allows only 10 req/min,
    // so without this the multi-call tests below 429 instead of exercising the nudge.
    _clearAuthRateBuckets();
  });

  it("sets a valid nudge header at 80% of cap and still calls next()", () => {
    const ctx = makeCtx();
    expect(() => authenticate(ctx.req, ctx.res, ctx.next)).not.toThrow();

    expect(ctx.nextCalled).toBe(true);
    expect(ctx.statusCode).toBe(200);
    expect(ctx.headers["X-Upgrade-Nudge"]).toContain("200 of 250");
    expect(ctx.headers["X-Upgrade-Nudge"]).toContain("Pro is $10/mo");
  });

  it("the nudge header contains no characters Node would reject", () => {
    const ctx = makeCtx();
    authenticate(ctx.req, ctx.res, ctx.next);

    const value = ctx.headers["X-Upgrade-Nudge"];
    expect(value).toBeDefined();
    // Every code point printable ASCII: this is the invariant that was violated.
    expect([...value].every((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) <= 0x7e)).toBe(true);
    expect(value).not.toMatch(/[‐-―]/); // no en/em dashes
  });

  it("does not set the header below 80% of cap", () => {
    mock.used = 100;
    const ctx = makeCtx();
    authenticate(ctx.req, ctx.res, ctx.next);

    expect(ctx.headers["X-Upgrade-Nudge"]).toBeUndefined();
    expect(ctx.nextCalled).toBe(true);
  });

  it("passes the request through across the whole 80-100% band", () => {
    for (let used = 200; used <= 250; used++) {
      mock.used = used;
      _clearAuthRateBuckets(); // isolate each call from the per-minute limiter
      const ctx = makeCtx();
      expect(() => authenticate(ctx.req, ctx.res, ctx.next), `used=${used}`).not.toThrow();
      expect(ctx.nextCalled, `used=${used}`).toBe(true);
      expect(ctx.statusCode, `used=${used}`).toBe(200);
    }
  });

  it("a throwing setHeader cannot fail the request (guard holds)", () => {
    const ctx = makeCtx();
    const res = {
      ...ctx.res,
      setHeader(name: string) {
        if (name === "X-Upgrade-Nudge") throw new TypeError("boom");
      },
      status() { return this; },
      json() { return this; },
    } as unknown as Response;

    let nextCalled = false;
    expect(() => authenticate(ctx.req, res, () => { nextCalled = true; })).not.toThrow();
    expect(nextCalled).toBe(true);
  });

  it("still nudges the pro and starter tiers without throwing", () => {
    for (const [t, limit] of [["pro", 1000], ["starter", 4000]] as const) {
      mock.tier = t;
      mock.limit = limit;
      mock.used = Math.round(limit * 0.9);
      _clearAuthRateBuckets();

      const ctx = makeCtx();
      expect(() => authenticate(ctx.req, ctx.res, ctx.next), t).not.toThrow();
      expect(ctx.headers["X-Upgrade-Nudge"], t).toBeDefined();
    }
  });
});
