import { Request, Response, NextFunction } from "express";
import { validateApiKey, checkTierLimit, Client } from "../db";

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

  // Check monthly usage limit
  const tierCheck = checkTierLimit(client.id, client.tier as Client["tier"]);
  if (!tierCheck.allowed) {
    res.status(429).json({
      error: "quota_exceeded",
      message: `Monthly limit reached (${tierCheck.used}/${tierCheck.limit}). Upgrade your tier at /billing/checkout`,
      used: tierCheck.used,
      limit: tierCheck.limit,
      tier: client.tier,
    });
    return;
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
