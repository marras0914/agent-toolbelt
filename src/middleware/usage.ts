import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { recordUsage, getGlobalStats, getToolStats, getClientUsage } from "../db";
import { reportUsageToStripe } from "./billing";

/**
 * Stable, short fingerprint of the request body. Lets us compute repeat-rate
 * (`COUNT(*) vs COUNT(DISTINCT input_fingerprint)`) per client/tool without
 * storing raw input. 16 hex chars = 64 bits — plenty against collisions at our
 * scale (millions of calls before birthday-paradox issues). Falls back to null
 * if the body is unparseable so we never break the usage write path.
 */
function fingerprintBody(body: unknown): string | null {
  try {
    const json = JSON.stringify(body ?? {});
    return crypto.createHash("sha256").update(json).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

// ----- Middleware -----
export function trackUsage(toolName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    // Capture fingerprint at request entry — req.body could be mutated by the
    // handler before `finish` fires (it usually isn't, but safer this way).
    const fingerprint = fingerprintBody(req.body);

    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const clientId = req.client?.clientId || "anonymous";
      const keyId = req.client?.keyId || "unknown";

      // Write to database
      try {
        recordUsage(clientId, keyId, toolName, res.statusCode, durationMs, fingerprint);
      } catch (err) {
        console.error("Usage recording failed:", err);
      }

      // Report to Stripe for metered billing (fire-and-forget)
      // In production, look up the client's subscription_item_id from the DB
      // reportUsageToStripe(subscriptionItemId, 1);
    });

    next();
  };
}

// ----- Query helpers (for admin endpoints) -----
export function getUsageSummary() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    period: "last_30_days",
    global: getGlobalStats(since),
    byTool: getToolStats(since),
  };
}

export function getClientUsageSummary(clientId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    period: "last_30_days",
    clientId,
    tools: getClientUsage(clientId, since),
  };
}
