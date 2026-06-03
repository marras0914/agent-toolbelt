import { Request, Response, NextFunction } from "express";
import { validateApiKey, checkTierLimit, getClientBalance, Client } from "../db";

// ----- Types -----
export interface AuthenticatedClient {
  clientId: string;
  email: string;
  tier: Client["tier"];
  keyId: string;
}

declare global {
  namespace Express {
    interface Request {
      client?: AuthenticatedClient;
    }
  }
}

// ----- Tier Limits -----
export const TIER_LIMITS: Record<Client["tier"], { requestsPerMinute: number; monthlyRequests: number }> = {
  free: { requestsPerMinute: 10, monthlyRequests: 1_000 },
  payg: { requestsPerMinute: 60, monthlyRequests: Infinity },
  hobby: { requestsPerMinute: 30, monthlyRequests: 10_000 },
  starter: { requestsPerMinute: 60, monthlyRequests: 50_000 },
  pro: { requestsPerMinute: 300, monthlyRequests: 500_000 },
  enterprise: { requestsPerMinute: 1_000, monthlyRequests: 5_000_000 },
};

// ----- In-memory rate limiter (per-client, per-minute) -----
const rateBuckets: Map<string, { count: number; resetAt: number }> = new Map();

function checkPerClientRate(clientId: string, tier: Client["tier"]): boolean {
  const now = Date.now();
  const limit = TIER_LIMITS[tier].requestsPerMinute;
  const bucket = rateBuckets.get(clientId);

  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(clientId, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

// ----- Auth Middleware -----
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer atb_")) {
    res.status(401).json({
      error: "unauthorized",
      message: "Missing or invalid API key. Pass: Authorization: Bearer atb_...",
      docs: "/api/tools/catalog",
    });
    return;
  }

  const rawKey = authHeader.replace("Bearer ", "");

  // Validate against database
  const result = validateApiKey(rawKey);
  if (!result) {
    res.status(403).json({
      error: "forbidden",
      message: "Invalid or revoked API key.",
    });
    return;
  }

  const { client, keyId } = result;

  // Concrete next-tier pitch, so nudges name a price instead of a vague "upgrade"
  const NEXT_TIER_PITCH: Partial<Record<Client["tier"], string>> = {
    free: "Hobby is $10/mo for 10,000 calls (10× your current limit)",
    hobby: "Starter is $29/mo for 50,000 calls",
    starter: "Pro is $99/mo for 500,000 calls",
  };
  const pitch = NEXT_TIER_PITCH[client.tier as Client["tier"]];

  // Check monthly usage limit
  const tierCheck = checkTierLimit(client.id, client.tier as Client["tier"]);
  if (!tierCheck.allowed) {
    res.status(429).json({
      error: "quota_exceeded",
      message: `Monthly limit reached (${tierCheck.used}/${tierCheck.limit}).${pitch ? ` ${pitch}.` : " Upgrade your plan to keep going."}`,
      used: tierCheck.used,
      limit: tierCheck.limit,
      tier: client.tier,
      upgradeUrl: "https://www.agenttoolbelt.live/#pricing",
    });
    return;
  }

  // Attach usage headers so clients always know where they stand
  const limit = tierCheck.limit;
  res.setHeader("X-Usage-Used", tierCheck.used);
  res.setHeader("X-Usage-Limit", limit === Infinity ? "unlimited" : limit);
  res.setHeader("X-Usage-Tier", client.tier);

  // Proactive nudge at 80% and 95% — before they hit the wall
  if (limit !== Infinity) {
    const pct = tierCheck.used / limit;
    if (pct >= 0.95) {
      res.setHeader(
        "X-Upgrade-Nudge",
        `You've used ${tierCheck.used} of ${limit} calls this month (${Math.round(pct * 100)}%). Almost at your limit${pitch ? ` — ${pitch}` : ""}: https://www.agenttoolbelt.live/#pricing`
      );
    } else if (pct >= 0.80) {
      res.setHeader(
        "X-Upgrade-Nudge",
        `You've used ${tierCheck.used} of ${limit} calls this month (${Math.round(pct * 100)}%). ${pitch ? `${pitch} — upgrade` : "Consider upgrading"} before you hit the limit: https://www.agenttoolbelt.live/#pricing`
      );
    }
  }

  // PAYG: require positive credit balance
  if (client.tier === "payg") {
    const balance = getClientBalance(client.id);
    if (balance <= 0) {
      res.status(402).json({
        error: "insufficient_credits",
        message: "Your credit balance is empty. Top up at POST /billing/topup",
        balanceMicros: balance,
        topupUrl: "/billing/topup",
      });
      return;
    }
  }

  // Check per-minute rate limit
  if (!checkPerClientRate(client.id, client.tier as Client["tier"])) {
    res.status(429).json({
      error: "rate_limited",
      message: `Too many requests. Your tier (${client.tier}) allows ${TIER_LIMITS[client.tier as Client["tier"]].requestsPerMinute} requests/minute.`,
    });
    return;
  }

  // Attach client info to request
  req.client = {
    clientId: client.id,
    email: client.email,
    tier: client.tier as Client["tier"],
    keyId,
  };

  next();
}
