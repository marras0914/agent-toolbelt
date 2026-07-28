import { Request, Response, NextFunction } from "express";
import { validateApiKey, checkTierLimit, getClientBalance, Client } from "../db";
import { TIERS } from "../tiers";
import { config } from "../config";
import { getRapidApiGatewayClient } from "../rapidapi-gateway";

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

// ----- In-memory rate limiter (per-client, per-minute) -----
const rateBuckets: Map<string, { count: number; resetAt: number }> = new Map();

function checkPerClientRate(clientId: string, tier: Client["tier"]): boolean {
  const now = Date.now();
  const limit = TIERS[tier].requestsPerMinute;
  const bucket = rateBuckets.get(clientId);

  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(clientId, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

/** Test-only — clears all buckets so tests don't carry state. */
export function _clearAuthRateBuckets(): void {
  rateBuckets.clear();
}

// ----- Upgrade nudge -----
/**
 * Concrete next-tier pitch, so nudges name a price instead of a vague "upgrade".
 * Exported so tests can assert the real shipped copy survives header sanitization
 * — this copy is prose, and prose is where the invalid header characters come from.
 */
export const NEXT_TIER_PITCH: Partial<Record<Client["tier"], string>> = {
  free: "Pro is $10/mo for 1,000 calls (4× your current limit)",
  pro: "Starter is $29/mo for 4,000 calls",
  starter: "Enterprise is $499/mo for 75,000 calls",
};

/**
 * Fold a prose string down to printable ASCII so it is safe as an HTTP header
 * value. Node's setHeader throws ERR_INVALID_CHAR on code points > 255, and an
 * em dash in the nudge copy did exactly that: every call from a free/pro/starter
 * client in the 80–100% cap band 500'd in auth before reaching the tool, for
 * ~8 weeks (shipped 7779774, found 2026-07-28). Nudge text is marketing copy, so
 * it will keep attracting typographic punctuation — sanitize rather than trust it.
 *
 * Dropping the rest of the non-ASCII range also strips CR/LF, so this doubles as
 * header-injection protection if any of this copy ever becomes client-influenced.
 */
export function toHeaderSafe(value: string): string {
  return value
    .replace(/[‐-―]/g, "-") // hyphens, en/em dashes
    .replace(/[‘’]/g, "'") // curly single quotes
    .replace(/[“”]/g, '"') // curly double quotes
    .replace(/…/g, "...") // ellipsis
    .replace(/ /g, " ") // non-breaking space
    .replace(/×/g, "x") // multiplication sign, as in "4x your current limit"
    .replace(/[^\x20-\x7E]/g, ""); // anything else non-printable-ASCII
}

/**
 * The nudge message for a client at `used`/`limit`, or null if they aren't close
 * enough to the cap to warrant one. Split out from the middleware so the copy is
 * unit-testable — the original bug survived because nothing asserted on it.
 */
export function buildUpgradeNudge(used: number, limit: number, pitch?: string): string | null {
  if (!Number.isFinite(limit) || limit <= 0) return null; // payg/enterprise are uncapped

  const pct = used / limit;
  if (pct < 0.80) return null;

  const url = "https://www.agenttoolbelt.live/#pricing";
  const prefix = `You've used ${used} of ${limit} calls this month (${Math.round(pct * 100)}%).`;

  return pct >= 0.95
    ? `${prefix} Almost at your limit${pitch ? `, ${pitch}` : ""}: ${url}`
    : `${prefix} ${pitch ? `${pitch}, upgrade` : "Consider upgrading"} before you hit the limit: ${url}`;
}

// ----- Auth Middleware -----
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  // RapidAPI gateway bypass: if the call carries a matching proxy secret, it came
  // through RapidAPI (which already authenticated + metered the buyer). Trust it
  // and run as the uncapped gateway client — no atb_ key needed. (The /api/tools
  // middleware in index.ts already 403s a *wrong* secret; this handles a right one.)
  const proxySecret = req.headers["x-rapidapi-proxy-secret"];
  if (proxySecret && config.rapidApiProxySecret && proxySecret === config.rapidApiProxySecret) {
    const gw = getRapidApiGatewayClient();
    req.client = { clientId: gw.clientId, email: "rapidapi-gateway@agenttoolbelt.live", tier: "enterprise", keyId: gw.keyId };
    next();
    return;
  }

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
  const nudge = buildUpgradeNudge(tierCheck.used, limit, pitch);
  if (nudge) {
    // Belt and braces. toHeaderSafe() should make a throw unreachable, but a
    // cosmetic marketing header must never be the thing that fails a billable
    // request — which is exactly what happened when this was set unguarded.
    try {
      res.setHeader("X-Upgrade-Nudge", toHeaderSafe(nudge));
    } catch (err) {
      console.error("[nudge] failed to set X-Upgrade-Nudge:", err);
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
      message: `Too many requests. Your tier (${client.tier}) allows ${TIERS[client.tier as Client["tier"]].requestsPerMinute} requests/minute.`,
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
