import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { recordUsage, getGlobalStats, getToolStats, getClientUsage } from "../db";
import { reportUsageToStripe } from "./billing";

// ----- Middleware -----
export function trackUsage(toolName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const clientId = req.client?.clientId || "anonymous";
      const keyId = req.client?.keyId || "unknown";

      // Write to database
      try {
        recordUsage(clientId, keyId, toolName, res.statusCode, durationMs);
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
