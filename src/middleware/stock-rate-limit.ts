/**
 * Per-client rate limit specifically for stock tools.
 *
 * Stock tools fan out to 3-5 upstream API calls per invocation (Polygon,
 * Finnhub, FMP endpoints in parallel). FMP's free tier caps at 250 calls/day,
 * so a single user hammering valuation-snapshot in a watchlist loop can blow
 * the daily cap in ~25 minutes at the global per-tier rate of 10/min.
 *
 * This middleware enforces a stricter, stock-only rate budget so a watchlist
 * pattern gets paced over minutes instead of seconds — giving the 6h response
 * cache time to actually catch repeat ticker hits.
 *
 * Applied selectively in `registry.ts` only to tools whose metadata tags
 * include `"stocks"`.
 */

import { Request, Response, NextFunction } from "express";
import { Client } from "../db";

const STOCK_LIMITS: Record<Client["tier"], number> = {
  free: 5,
  payg: 20,
  hobby: 20,
  starter: 30,
  pro: 120,
  enterprise: Infinity,
};

const buckets: Map<string, { count: number; resetAt: number }> = new Map();

function checkRate(clientId: string, tier: Client["tier"]): { allowed: boolean; limit: number; remaining: number; resetInMs: number } {
  const now = Date.now();
  const limit = STOCK_LIMITS[tier] ?? STOCK_LIMITS.free;
  const bucket = buckets.get(clientId);

  if (!bucket || now > bucket.resetAt) {
    const resetAt = now + 60_000;
    buckets.set(clientId, { count: 1, resetAt });
    return { allowed: true, limit, remaining: limit - 1, resetInMs: 60_000 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, limit, remaining: 0, resetInMs: bucket.resetAt - now };
  }
  bucket.count++;
  return { allowed: true, limit, remaining: limit - bucket.count, resetInMs: bucket.resetAt - now };
}

export function stockRateLimit(req: Request, res: Response, next: NextFunction): void {
  // `authenticate` runs before this, so req.client is always set on success paths.
  const client = req.client;
  if (!client) {
    res.status(401).json({ error: "unauthorized", message: "Authentication required." });
    return;
  }

  const { allowed, limit, remaining, resetInMs } = checkRate(client.clientId, client.tier);

  res.setHeader("X-Stock-RateLimit-Limit", String(limit));
  res.setHeader("X-Stock-RateLimit-Remaining", String(Math.max(0, remaining)));
  res.setHeader("X-Stock-RateLimit-Reset", String(Math.ceil(resetInMs / 1000)));

  if (!allowed) {
    res.status(429).json({
      error: "stock_rate_limited",
      message: `Stock tools are rate-limited to ${limit} calls/minute on the ${client.tier} tier (you've called ${limit} in the last minute). Retry in ${Math.ceil(resetInMs / 1000)}s, or upgrade for higher limits.`,
      tier: client.tier,
      limit,
      resetInSeconds: Math.ceil(resetInMs / 1000),
    });
    return;
  }

  next();
}

/** Test-only — clears all buckets so tests don't carry state. */
export function _clearStockRateBuckets(): void {
  buckets.clear();
}
