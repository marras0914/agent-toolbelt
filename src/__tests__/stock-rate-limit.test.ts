import { describe, it, expect, beforeEach } from "vitest";
import { Request, Response } from "express";
import { stockRateLimit, _clearStockRateBuckets } from "../middleware/stock-rate-limit";
import type { Client } from "../db";

// Build a minimal mock req/res so we can drive the middleware directly without spinning Express.
function makeReqRes(tier: Client["tier"], clientId = "cli_test") {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let jsonBody: any = null;
  let nextCalled = false;

  const req = {
    client: { clientId, email: "test@example.com", tier, keyId: "key_test" },
  } as unknown as Request;

  const res = {
    setHeader(name: string, value: string) { headers[name] = value; },
    status(code: number) { statusCode = code; return this; },
    json(body: any) { jsonBody = body; return this; },
  } as unknown as Response;

  const next = () => { nextCalled = true; };

  return { req, res, next, get headers() { return headers; }, get statusCode() { return statusCode; }, get jsonBody() { return jsonBody; }, get nextCalled() { return nextCalled; } };
}

describe("stockRateLimit middleware", () => {
  beforeEach(() => {
    _clearStockRateBuckets();
  });

  it("allows the first 5 calls on free tier and blocks the 6th", () => {
    for (let i = 0; i < 5; i++) {
      const ctx = makeReqRes("free");
      stockRateLimit(ctx.req, ctx.res, ctx.next);
      expect(ctx.nextCalled).toBe(true);
      expect(ctx.statusCode).toBe(200);
    }

    const blocked = makeReqRes("free");
    stockRateLimit(blocked.req, blocked.res, blocked.next);
    expect(blocked.nextCalled).toBe(false);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.jsonBody.error).toBe("stock_rate_limited");
    expect(blocked.jsonBody.tier).toBe("free");
    expect(blocked.jsonBody.limit).toBe(5);
  });

  it("payg tier allows 20 calls/min", () => {
    for (let i = 0; i < 20; i++) {
      const ctx = makeReqRes("payg");
      stockRateLimit(ctx.req, ctx.res, ctx.next);
      expect(ctx.nextCalled).toBe(true);
    }
    const blocked = makeReqRes("payg");
    stockRateLimit(blocked.req, blocked.res, blocked.next);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.jsonBody.limit).toBe(20);
  });

  it("enterprise tier is effectively unlimited", () => {
    for (let i = 0; i < 200; i++) {
      const ctx = makeReqRes("enterprise");
      stockRateLimit(ctx.req, ctx.res, ctx.next);
      expect(ctx.nextCalled).toBe(true);
    }
  });

  it("buckets are independent across clients", () => {
    // Exhaust client A's bucket
    for (let i = 0; i < 5; i++) {
      const a = makeReqRes("free", "cli_A");
      stockRateLimit(a.req, a.res, a.next);
      expect(a.nextCalled).toBe(true);
    }
    // Client B unaffected
    const b = makeReqRes("free", "cli_B");
    stockRateLimit(b.req, b.res, b.next);
    expect(b.nextCalled).toBe(true);
    expect(b.statusCode).toBe(200);
  });

  it("sets X-Stock-RateLimit-* headers on every response", () => {
    const ctx = makeReqRes("free");
    stockRateLimit(ctx.req, ctx.res, ctx.next);
    expect(ctx.headers["X-Stock-RateLimit-Limit"]).toBe("5");
    expect(ctx.headers["X-Stock-RateLimit-Remaining"]).toBe("4");
    expect(ctx.headers["X-Stock-RateLimit-Reset"]).toBeDefined();
  });

  it("rejects with 401 if req.client is missing", () => {
    const ctx = makeReqRes("free");
    delete (ctx.req as any).client;
    stockRateLimit(ctx.req, ctx.res, ctx.next);
    expect(ctx.statusCode).toBe(401);
    expect(ctx.nextCalled).toBe(false);
  });

  it("429 response includes resetInSeconds within the next minute", () => {
    for (let i = 0; i < 5; i++) {
      const ctx = makeReqRes("free");
      stockRateLimit(ctx.req, ctx.res, ctx.next);
    }
    const blocked = makeReqRes("free");
    stockRateLimit(blocked.req, blocked.res, blocked.next);
    expect(blocked.jsonBody.resetInSeconds).toBeGreaterThan(0);
    expect(blocked.jsonBody.resetInSeconds).toBeLessThanOrEqual(60);
  });
});
