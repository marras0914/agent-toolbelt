import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import { config } from "./config";
import { getUsageSummary, getClientUsageSummary, getCapWatch, getErrorSummary } from "./middleware/usage";
import { getUpstreamHealth } from "./upstream-health";
import { getEmailHealth } from "./email-health";
import { runCacheWarmup, getLastWarmupResult, getWarmTickers, startCacheWarmupScheduler } from "./jobs/warm-cache";
import { buildToolRouter, getRegisteredTools, responseCacheKey, sendToolError } from "./tools/registry";
import { getCached, setCached } from "./db/stock-cache";
import { handleMcpRequest } from "./mcp-http";
import { buildBillingRouter, buildStripeWebhookRouter } from "./middleware/billing";
import {
  createClient,
  createApiKey,
  getClientById,
  getClientByEmail,
  getClientApiKeys,
  revokeApiKey,
  getAllClients,
  createReissueToken,
  consumeReissueToken,
  revokeAllClientKeys,
  deleteClientCascade,
  pingDb,
  backupTo,
  DB_PATH,
} from "./db";
import {
  createWatchlist,
  listWatchlists,
  countWatchlists,
  getOwnedWatchlist,
  updateWatchlist,
  deleteWatchlist,
  getRecentAlerts,
} from "./db/watchlists";
import { runWatchlistMonitor, getLastMonitorResult, startWatchlistMonitorScheduler } from "./jobs/watchlist-monitor";
import { RAPIDAPI_GATEWAY_EMAIL } from "./rapidapi-gateway";
import { authenticate } from "./middleware/auth";
import { TIERS } from "./tiers";
import { isValidUSTicker, US_ONLY_HINT } from "./tools/_stock-helpers";
import { sendOnboardingEmail, sendKeyReissueEmail } from "./email";

// ----- Import tools (auto-registers via side effect) -----
import "./tools/schema-generator";
import "./tools/text-extractor";
import "./tools/cron-builder";
import "./tools/regex-builder";
import "./tools/brand-kit";
import "./tools/markdown-converter";
import "./tools/url-metadata";
import "./tools/token-counter";
import "./tools/csv-to-json";
import "./tools/address-normalizer";
import "./tools/color-palette";
import "./tools/image-metadata-stripper";
import "./tools/meeting-action-items";
import "./tools/prompt-optimizer";
import "./tools/document-comparator";
import "./tools/contract-clause-extractor";
import "./tools/api-response-mocker";
import "./tools/context-window-packer";
import "./tools/dependency-auditor";
import "./tools/web-summarizer";
import "./tools/stock-thesis";
import "./tools/earnings-analysis";
import "./tools/insider-signal";
import "./tools/valuation-snapshot";
import "./tools/bear-vs-bull";
import "./tools/compare-stocks";
import "./tools/moat-analysis";
import "./tools/watchlist-scan";
import "./tools/portfolio-review";

// ----- App Setup -----
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

// ----- Canonical host redirect -----
// Old Reddit and dev.to posts still link to the raw Railway deploy hostname, and
// it was still pulling real visitors as of 2026-07-30 (9 in a week, some from
// Reddit). Those land off-brand and split analytics and SEO across two hosts.
// Send human page views to the branded domain instead.
//
// Deliberately narrow — machine traffic is NOT redirected. Existing API and MCP
// clients may have the old host hardcoded, and a 301 makes many clients replay a
// POST as a GET, which would silently break them. So this only moves GET/HEAD
// requests that actually want HTML, and only from the known legacy host (never
// localhost, so local dev is unaffected).
const CANONICAL_HOST = "www.agenttoolbelt.live";
const LEGACY_HOSTS = new Set(["agent-toolbelt-production.up.railway.app"]);
const MACHINE_PREFIXES = [
  "/api",
  "/admin",
  "/stripe",
  "/billing",
  "/mcp",
  "/openapi",
  "/health",
  "/.well-known",
];

app.use((req, res, next) => {
  const forwarded = req.headers["x-forwarded-host"];
  const rawHost = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.headers.host ?? "";
  const host = rawHost.split(",")[0].trim().toLowerCase();

  if (!LEGACY_HOSTS.has(host)) return next();
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (MACHINE_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
  if (!req.accepts("html")) return next();

  return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
});

// Stripe webhooks need raw body — must come BEFORE express.json()
app.use("/stripe", express.raw({ type: "application/json" }), buildStripeWebhookRouter());

// Standard JSON parsing for everything else
app.use(express.json({ limit: "1mb" }));

// Global rate limiter
app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate_limited", message: "Too many requests. Please slow down." },
  })
);

// RapidAPI proxy secret validation — only reject if header is present but wrong
if (config.rapidApiProxySecret) {
  app.use("/api/tools", (req, res, next) => {
    const proxySecret = req.headers["x-rapidapi-proxy-secret"];
    if (proxySecret && proxySecret !== config.rapidApiProxySecret) {
      res.status(403).json({ error: "forbidden", message: "Invalid proxy secret." });
      return;
    }
    next();
  });
}

// Serve landing page + static files (including openapi/)
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/openapi", express.static(path.join(__dirname, "..", "openapi")));

// ----- OpenAI GPT Actions Discovery -----

// ai-plugin.json — OpenAI looks for this to discover your API
app.get("/.well-known/ai-plugin.json", (_req, res) => {
  const baseUrl = `${_req.protocol}://${_req.get("host")}`;
  res.json({
    schema_version: "v1",
    name_for_human: "Agent Toolbelt",
    name_for_model: "agent_toolbelt",
    description_for_human: "16 focused API tools for AI agents — data extraction, token counting, document analysis, contract review, prompt optimization, and more.",
    description_for_model: "Use Agent Toolbelt to access 16 focused API tools: schema generation, text extraction, token counting, CSV conversion, Markdown conversion, URL metadata, regex/cron building, address normalization, color palettes, brand kits, image metadata stripping, meeting action item extraction, prompt optimization, document comparison, and contract clause extraction. Call getToolCatalog first to see all available tools, then call the appropriate tool. Always include the API key as a Bearer token.",
    auth: {
      type: "service_http",
      authorization_type: "bearer",
      verification_tokens: {}
    },
    api: {
      type: "openapi",
      url: `${baseUrl}/openapi/openapi-gpt-actions.json`
    },
    logo_url: `${baseUrl}/logo.png`,
    contact_email: "support@yourdomain.com",
    legal_info_url: `${baseUrl}/privacy.html`
  });
});

// ----- Public Routes -----

/**
 * Liveness/readiness probe for uptime monitoring.
 *
 * Must be a real route: the `app.get("*")` catch-all at the bottom of this file
 * serves the landing page for anything unmatched, so before this existed a request
 * to /health returned 200 + marketing HTML. An uptime monitor pointed at it would
 * have reported "up" no matter how broken the service was.
 *
 * Returns 503 when the SQLite volume is unreachable, since every tool call needs it
 * for auth and usage recording.
 */
app.get("/health", (_req, res) => {
  const dbOk = pingDb();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ok" : "degraded",
    checks: { database: dbOk ? "ok" : "unreachable" },
    uptimeSeconds: Math.floor(process.uptime()),
    tools: getRegisteredTools().length,
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Service info
app.get("/api", (_req, res) => {
  res.json({
    service: "Agent Toolbelt",
    version: "1.0.0",
    status: "operational",
    catalog: "/api/tools/catalog",
    docs: "/api/docs",
    toolCount: getRegisteredTools().length,
  });
});

// Tool catalog + tool endpoints
app.use("/api/tools", buildToolRouter());

// MCP HTTP endpoint (Streamable HTTP transport — for Smithery and browser-based MCP clients)
app.all("/mcp", async (req, res) => {
  try {
    await handleMcpRequest(req, res);
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: "mcp_error", message: err.message });
    }
  }
});

// ----- Guest Try Endpoint (no auth, IP-limited) -----
const GUEST_DAILY_LIMIT = 10;
const guestBuckets: Map<string, { count: number; date: string }> = new Map();

app.post("/api/try/:toolName", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip || "unknown";
  const today = new Date().toISOString().split("T")[0];

  const bucket = guestBuckets.get(ip);
  if (bucket && bucket.date === today && bucket.count >= GUEST_DAILY_LIMIT) {
    res.status(429).json({
      error: "guest_limit_reached",
      message: `Free trial limit reached (${GUEST_DAILY_LIMIT} tries/day). Register for 250 free calls/month.`,
      registerUrl: "/api/clients/register",
    });
    return;
  }

  if (!bucket || bucket.date !== today) {
    guestBuckets.set(ip, { count: 1, date: today });
  } else {
    bucket.count++;
  }
  const used = guestBuckets.get(ip)!.count;
  const remaining = GUEST_DAILY_LIMIT - used;

  const tool = getRegisteredTools().find((t) => t.name === req.params.toolName);
  if (!tool) {
    res.status(404).json({ error: "not_found", message: `Tool '${req.params.toolName}' not found.` });
    return;
  }

  const parsed = tool.inputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    return;
  }

  try {
    const startTime = Date.now();
    // Stock tools: reuse the 6h response cache so guest tries of popular
    // tickers don't burn LLM spend (same freshness as authed calls).
    const isStockTool = tool.metadata?.tags?.includes("stocks") ?? false;
    let result: any;
    let cached = false;
    const cacheKey = isStockTool ? responseCacheKey(tool.name, parsed.data) : null;
    if (cacheKey) {
      const hit = getCached<any>(cacheKey);
      if (hit !== undefined) {
        result = hit;
        cached = true;
      }
    }
    if (!cached) {
      result = await tool.handler(parsed.data);
      if (cacheKey) setCached(cacheKey, result, 24 * 60 * 60 * 1000);
    }
    const durationMs = Date.now() - startTime;
    res.json({
      success: true,
      tool: tool.name,
      durationMs,
      cached,
      result,
      guest: true,
      trialCallsRemaining: remaining,
      ...(remaining <= 3 && {
        nudge: `${remaining} free tries left today. Register for 250 free calls/month → POST /api/clients/register`,
      }),
    });
  } catch (err: any) {
    // Shared with the authenticated router so an unusable ticker returns the same
    // terminal 422 here. This path is a prospective user's first impression.
    sendToolError(res, tool.name, err, "Guest tool error");
  }
});

// Billing routes
app.use("/billing", buildBillingRouter());

// ----- Client Self-Service Routes -----

// Register a new client
app.post("/api/clients/register", (req, res) => {
  const { email, name } = req.body;
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  // Check if client already exists
  const existing = getClientByEmail(email);
  if (existing) {
    res.status(409).json({ error: "Client with this email already exists", clientId: existing.id });
    return;
  }

  const client = createClient(email, name);

  // Attribution capture — log source/referer/UA so we can trace where signups come from.
  // `source` is an explicit ?source=... param (or body.source) we tag on curl examples in
  // different surfaces (npm README, MCP banner, blog posts, directory listings).
  const source = (req.query.source as string) || (req.body?.source as string) || "none";
  const referer = req.headers.referer || req.headers.referrer || "none";
  const userAgent = req.headers["user-agent"] || "none";
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip || "unknown";
  console.log(`[register] ${email} | source=${source} | referer=${referer} | ua=${userAgent} | ip=${ip}`);

  // Auto-generate their first API key
  const { key, record } = createApiKey(client.id, "default");

  // Send onboarding email (fire-and-forget — don't block the response)
  sendOnboardingEmail({ email: client.email, name: client.name, apiKey: key, keyPrefix: record.key_prefix, clientId: client.id })
    .catch((err) => console.error("[email] Failed to send onboarding email:", err.message));

  res.status(201).json({
    message: "Welcome to Agent Toolbelt! Store your API key securely - it won't be shown again.",
    client: {
      id: client.id,
      email: client.email,
      tier: client.tier,
    },
    apiKey: {
      key, // Only shown once!
      prefix: record.key_prefix,
      label: record.label,
    },
    quickstart: {
      catalog: "GET /api/tools/catalog",
      callTool: `curl -X POST /api/tools/schema-generator -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d '{"description": "a user profile"}'`,
      upgrade: "POST /billing/checkout",
    },
  });
});

// ----- Self-serve API key reissue (magic link) -----
// Lost-your-key flow. Request emails a single-use link; confirming it revokes
// the client's old keys and mints a fresh one. Always responds generically to
// avoid email enumeration, and is IP-rate-limited to deter spamming inboxes.
const reissueBuckets: Map<string, { count: number; resetAt: number }> = new Map();
function reissueRateOk(ip: string): boolean {
  const now = Date.now();
  const b = reissueBuckets.get(ip);
  if (!b || now > b.resetAt) {
    reissueBuckets.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 }); // 5/hour/IP
    return true;
  }
  if (b.count >= 5) return false;
  b.count++;
  return true;
}

app.post("/api/clients/reissue-key", (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip || "unknown";
  if (!reissueRateOk(ip)) {
    res.status(429).json({ error: "rate_limited", message: "Too many requests. Please try again later." });
    return;
  }
  const { email } = req.body || {};
  // Generic response regardless of whether the account exists (no enumeration).
  const generic = { message: "If an account exists for that email, we've sent a link to reissue your API key. Check your inbox." };
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email is required" });
    return;
  }
  const client = getClientByEmail(email.trim());
  if (client) {
    const token = createReissueToken(client.id);
    const link = `https://www.agenttoolbelt.live/reissue?token=${token}`;
    sendKeyReissueEmail({ email: client.email, name: client.name, link }).catch((err) =>
      console.error("[email] reissue send failed:", err.message)
    );
  }
  res.json(generic);
});

app.post("/api/clients/reissue-key/confirm", (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "token is required" });
    return;
  }
  const clientId = consumeReissueToken(token);
  if (!clientId) {
    res.status(400).json({ error: "invalid_or_expired", message: "This link is invalid or has expired. Request a new one." });
    return;
  }
  // Revoke-and-replace: any prior keys (incl. the lost one) are invalidated.
  revokeAllClientKeys(clientId);
  const { key, record } = createApiKey(clientId, "default");
  res.json({
    message: "New API key issued. Your previous key(s) have been revoked. Store this securely — it won't be shown again.",
    apiKey: { key, prefix: record.key_prefix },
  });
});

// ----- Watchlists (saved ticker lists; foundation for monitoring, Phase 1a) -----
// Validate + normalize an incoming tickers array against the caller's tier cap.
// Returns { tickers } on success or { error } with a user-facing message.
function validateTickers(raw: unknown, maxTickers: number): { tickers: string[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "tickers must be a non-empty array of US tickers, e.g. [\"NVDA\",\"AMD\"]" };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") return { error: `Invalid ticker: ${JSON.stringify(t)}` };
    const sym = t.toUpperCase().trim();
    if (!isValidUSTicker(sym)) return { error: `"${t}" is not a valid US ticker. ${US_ONLY_HINT}` };
    if (!seen.has(sym)) { seen.add(sym); out.push(sym); }
  }
  if (out.length > maxTickers) {
    return { error: `This tier allows up to ${maxTickers} tickers per watchlist (got ${out.length}). Upgrade for larger watchlists.` };
  }
  return { tickers: out };
}

// Shape a watchlist for the API response, adding a monitoring hint by tier.
function watchlistResponse(wl: ReturnType<typeof createWatchlist>, tier: keyof typeof TIERS) {
  const monitored = TIERS[tier].watchlistMonitoring;
  return {
    id: wl.id,
    name: wl.name,
    tickers: wl.tickers,
    emailAlerts: wl.email_alerts,
    monitored,
    ...(monitored
      ? {}
      : { monitoringHint: "This watchlist isn't monitored on your current plan. Upgrade to Pro for daily monitoring + alerts: https://www.agenttoolbelt.live/#pricing" }),
    createdAt: wl.created_at,
    updatedAt: wl.updated_at,
  };
}

app.post("/api/watchlists", authenticate, (req, res) => {
  const client = req.client!;
  const tier = client.tier as keyof typeof TIERS;
  const { name, tickers, emailAlerts } = req.body || {};
  if (!name || typeof name !== "string" || name.length > 100) {
    res.status(400).json({ error: "name is required (max 100 chars)" });
    return;
  }
  if (countWatchlists(client.clientId) >= TIERS[tier].maxWatchlists) {
    res.status(403).json({
      error: "watchlist_limit_reached",
      message: `Your plan allows ${TIERS[tier].maxWatchlists} watchlist(s). Upgrade for more: https://www.agenttoolbelt.live/#pricing`,
    });
    return;
  }
  const v = validateTickers(tickers, TIERS[tier].maxWatchlistTickers);
  if ("error" in v) { res.status(400).json({ error: "validation_error", message: v.error }); return; }
  const wl = createWatchlist(client.clientId, name, v.tickers, emailAlerts !== false);
  res.status(201).json({ watchlist: watchlistResponse(wl, tier) });
});

app.get("/api/watchlists", authenticate, (req, res) => {
  const client = req.client!;
  const tier = client.tier as keyof typeof TIERS;
  const lists = listWatchlists(client.clientId).map((wl) => watchlistResponse(wl, tier));
  res.json({ watchlists: lists, count: lists.length });
});

app.get("/api/watchlists/:id", authenticate, (req, res) => {
  const client = req.client!;
  const wl = getOwnedWatchlist(req.params.id, client.clientId);
  if (!wl) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ watchlist: watchlistResponse(wl, client.tier as keyof typeof TIERS) });
});

app.patch("/api/watchlists/:id", authenticate, (req, res) => {
  const client = req.client!;
  const tier = client.tier as keyof typeof TIERS;
  const existing = getOwnedWatchlist(req.params.id, client.clientId);
  if (!existing) { res.status(404).json({ error: "not_found" }); return; }
  const { name, tickers, emailAlerts } = req.body || {};
  const newName = name !== undefined ? name : existing.name;
  if (typeof newName !== "string" || !newName || newName.length > 100) {
    res.status(400).json({ error: "name must be a non-empty string (max 100 chars)" });
    return;
  }
  let newTickers = existing.tickers;
  if (tickers !== undefined) {
    const v = validateTickers(tickers, TIERS[tier].maxWatchlistTickers);
    if ("error" in v) { res.status(400).json({ error: "validation_error", message: v.error }); return; }
    newTickers = v.tickers;
  }
  const newEmail = emailAlerts !== undefined ? emailAlerts !== false : existing.email_alerts;
  updateWatchlist(req.params.id, client.clientId, { name: newName, tickers: newTickers, emailAlerts: newEmail });
  const updated = getOwnedWatchlist(req.params.id, client.clientId)!;
  res.json({ watchlist: watchlistResponse(updated, tier) });
});

app.delete("/api/watchlists/:id", authenticate, (req, res) => {
  const client = req.client!;
  const ok = deleteWatchlist(req.params.id, client.clientId);
  if (!ok) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ message: "Watchlist deleted", id: req.params.id });
});

// Recent monitor alerts for a watchlist (pull; agents poll this). Empty for
// non-monitored tiers since the job only runs on monitored watchlists.
app.get("/api/watchlists/:id/alerts", authenticate, (req, res) => {
  const client = req.client!;
  const wl = getOwnedWatchlist(req.params.id, client.clientId);
  if (!wl) { res.status(404).json({ error: "not_found" }); return; }
  const monitored = TIERS[client.tier as keyof typeof TIERS].watchlistMonitoring;
  const alerts = getRecentAlerts(req.params.id, 50).map((a) => ({
    ticker: a.ticker, type: a.type, message: a.message, at: a.created_at,
  }));
  res.json({
    watchlistId: req.params.id,
    monitored,
    alerts,
    ...(monitored ? {} : { monitoringHint: "Upgrade to Pro for daily monitoring + alerts: https://www.agenttoolbelt.live/#pricing" }),
  });
});

// ----- Admin Routes -----

// Admin auth
app.use("/admin", (req, res, next) => {
  if (!config.adminSecret) { next(); return; }
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${config.adminSecret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
});

// Generate additional API key for a client
app.post("/admin/clients/:clientId/keys", (req, res) => {
  const { clientId } = req.params;
  const { label = "default" } = req.body;

  const client = getClientById(clientId);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const { key, record } = createApiKey(clientId, label);
  res.status(201).json({
    message: "API key created. Store it securely — it won't be shown again.",
    apiKey: { key, prefix: record.key_prefix, label: record.label },
  });
});

// List client's API keys
app.get("/admin/clients/:clientId/keys", (req, res) => {
  const { clientId } = req.params;
  const keys = getClientApiKeys(clientId);
  res.json({ clientId, keys });
});

// Revoke an API key
app.delete("/admin/clients/:clientId/keys/:keyId", (req, res) => {
  const { clientId, keyId } = req.params;
  revokeApiKey(keyId, clientId);
  res.json({ message: "API key revoked", keyId });
});

// Client usage
app.get("/admin/clients/:clientId/usage", (req, res) => {
  res.json(getClientUsageSummary(req.params.clientId));
});

// List all clients
app.get("/admin/clients", (_req, res) => {
  const clients = getAllClients();
  res.json({ total: clients.length, clients });
});

/**
 * Hard-delete a client and every row that hangs off it. There is no undo.
 *
 * Guards, in order of how easy the mistake is to make:
 *  - `?confirm=<email>` must match the client's email exactly. Client IDs are opaque
 *    nanoids, so a typo or a stale ID from a scrollback is otherwise indistinguishable
 *    from the intended target. This makes you name the victim.
 *  - The RapidAPI gateway client is refused outright. It is infrastructure, not a
 *    customer: all RapidAPI traffic authenticates as it, and deleting it detaches
 *    that channel's usage history.
 *  - Paid tiers and non-zero credit balances are refused unless `?force=true`, so a
 *    cleanup sweep can't quietly delete someone who has given us money.
 *  - `?dryRun=true` reports the exact row counts without deleting anything.
 *
 * Take a backup first if the target is anything but obvious junk: GET /admin/backup.
 */
app.delete("/admin/clients/:clientId", (req, res) => {
  const { clientId } = req.params;
  const confirm = typeof req.query.confirm === "string" ? req.query.confirm : "";
  const dryRun = req.query.dryRun === "true";
  const force = req.query.force === "true";

  const client = getClientById(clientId);
  if (!client) {
    res.status(404).json({ error: "not_found", message: `Client '${clientId}' not found.` });
    return;
  }

  if (client.email === RAPIDAPI_GATEWAY_EMAIL) {
    res.status(409).json({
      error: "protected_client",
      message: "The RapidAPI gateway client is infrastructure — all RapidAPI traffic authenticates as it. Refusing to delete.",
    });
    return;
  }

  if (confirm !== client.email) {
    res.status(400).json({
      error: "confirmation_required",
      message: "Pass ?confirm=<email> matching the client's email exactly. Client IDs are opaque, so this is the guard against deleting the wrong row.",
      expected: client.email,
      received: confirm || null,
    });
    return;
  }

  const paidTier = client.tier !== "free";
  const hasCredits = (client.credit_balance_micros ?? 0) > 0;
  if ((paidTier || hasCredits) && !force) {
    res.status(409).json({
      error: "paying_client",
      message: "This client is on a paid tier or holds credits. Re-send with &force=true if you really mean it.",
      tier: client.tier,
      creditBalanceMicros: client.credit_balance_micros ?? 0,
    });
    return;
  }

  try {
    const deleted = deleteClientCascade(clientId, dryRun);
    console.log(`[admin] ${dryRun ? "dry-run delete" : "DELETED"} client ${clientId} <${client.email}>: ${JSON.stringify(deleted)}`);
    res.json({
      ...(dryRun ? { dryRun: true, message: "Nothing was deleted." } : { deleted: true }),
      clientId,
      email: client.email,
      tier: client.tier,
      rows: deleted,
    });
  } catch (err: any) {
    console.error(`[admin] delete client ${clientId} failed:`, err);
    res.status(500).json({ error: "delete_failed", message: err?.message || "Unknown error" });
  }
});

// Global usage dashboard
app.get("/admin/usage", (_req, res) => {
  res.json(getUsageSummary());
});

// Error triage — every failing (client, tool, status) tuple in the window, worst
// first. ?days=N (default 30). Answers "is anyone silently broken?" directly, which
// used to require inferring it from cache-hit rate and average latency.
app.get("/admin/errors", (req, res) => {
  const d = parseInt(String(req.query.days), 10);
  res.json(getErrorSummary(Number.isFinite(d) && d > 0 ? d : 30));
});

// Cap-watch — clients at/over a fraction of their tier's monthly cap (rolling
// 30d). Conversion-candidate radar: ?threshold=0.8 (default). See getCapWatch.
app.get("/admin/cap-watch", (req, res) => {
  const t = parseFloat(String(req.query.threshold));
  res.json(getCapWatch(Number.isFinite(t) ? t : 0.8));
});

// Upstream API health — surfaces FMP/Finnhub/Polygon non-2xx counts (esp. 429
// rate-limits) since the last process restart. See src/upstream-health.ts.
app.get("/admin/upstream-health", (_req, res) => {
  res.json(getUpstreamHealth());
});

/**
 * Full database snapshot, for offsite backup.
 *
 * This database is SQLite on a Railway volume, so there is no connection string
 * a CI job could dial into the way a managed Postgres would allow. Exposing the
 * snapshot over the existing admin auth is what makes an automated offsite backup
 * possible at all — see .github/workflows/db-backup.yml, which curls this weekly
 * and ships the result to private R2 storage.
 *
 * Security note: this returns the entire database. `api_keys` rows contain
 * `key_hash`, not recoverable plaintext keys, so a leaked snapshot does not hand
 * over working credentials — but it does contain every customer email and their
 * usage history. Treat the output as sensitive and keep the bucket private.
 */
app.get("/admin/backup", (_req, res) => {
  const stamp = new Date().toISOString().split("T")[0];
  // VACUUM INTO refuses to overwrite, so the name has to be unique per call.
  const tmp = path.join(os.tmpdir(), `agent-toolbelt-backup-${Date.now()}-${process.pid}.db`);

  try {
    backupTo(tmp);
  } catch (err: any) {
    res.status(500).json({ error: "backup_failed", message: err.message });
    return;
  }

  // Stream it, then clean up whether or not the transfer succeeded — otherwise a
  // client that hangs up mid-download leaves a full DB copy on the volume, and
  // the volume is the thing we are trying to protect.
  res.download(tmp, `agent-toolbelt-backup-${stamp}.db`, () => {
    fs.promises.unlink(tmp).catch(() => {});
  });
});

// Outbound email (Resend) health — status ok/failing/unknown, success/failure
// counts, and recent failure reasons since the last restart. Catches silent
// email outages (provider down, quota, bad key). See src/email-health.ts.
app.get("/admin/email-health", (_req, res) => {
  res.json(getEmailHealth());
});

// Cache warmup status + manual trigger. The scheduler runs daily at 00:30 UTC
// in production; POST here to force-run after a deploy or to repopulate the
// cache mid-day if FMP recovers. See src/jobs/warm-cache.ts.
app.get("/admin/warm-cache", (_req, res) => {
  res.json({ tickers: getWarmTickers(), lastRun: getLastWarmupResult() });
});
app.post("/admin/warm-cache", async (_req, res) => {
  try {
    const result = await runCacheWarmup();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Watchlist monitor — status + manual trigger (daily job at 23:00 UTC in prod).
app.get("/admin/watchlist-monitor", (_req, res) => {
  res.json({ lastRun: getLastMonitorResult() });
});
app.post("/admin/watchlist-monitor", async (_req, res) => {
  try {
    const result = await runWatchlistMonitor();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// API docs endpoint — Redoc UI for browsers, JSON for agents
app.get("/api/docs", (req, res) => {
  const acceptsHtml = req.accepts(["html", "json"]) === "html";
  if (acceptsHtml) {
    res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>Agent Toolbelt API Docs</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <redoc spec-url='/openapi/openapi-gpt-actions.json' hide-download-button></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc@latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`);
    return;
  }
  const tools = getRegisteredTools();
  res.json({
    title: "Agent Toolbelt API",
    version: "1.0.0",
    baseUrl: "/api",
    authentication: {
      type: "Bearer token",
      header: "Authorization: Bearer atb_...",
      getKey: "POST /api/clients/register with {email}",
    },
    endpoints: {
      "GET /api": "Service info",
      "GET /api/tools/catalog": "List all available tools",
      "GET /api/docs": "This documentation",
      "POST /api/clients/register": "Register + get API key",
      "POST /billing/checkout": "Upgrade subscription",
    },
    tools: tools.map((t) => {
      const { pricing, pricingMicros, ...publicMetadata } = t.metadata || {};
      return {
        name: t.name,
        description: t.description,
        version: t.version,
        endpoint: `POST /api/tools/${t.name}`,
        metadata: publicMetadata,
      };
    }),
  });
});

// ----- Registration page -----
app.get("/register", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "register.html"));
});

// ----- Terms of Service & Privacy Policy -----
app.get("/terms", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "terms.html"));
});

// ----- Self-serve key reissue page (request link + reveal new key) -----
app.get("/reissue", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "reissue.html"));
});

// ----- Catch-all: serve landing page for non-API routes -----
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

/**
 * Bind the port and kick off the background schedulers.
 *
 * Deliberately NOT executed on import. `src/index.ts` is the entry point and calls
 * this; everything else — tests especially — can `import app from "./app"` and get a
 * fully wired Express app without opening a socket or arming a cron.
 *
 * Before this split, importing the app started a server, so the guest /api/try route
 * and the admin delete guards could not be tested against the real handlers. Both had
 * to be mirrored in test files instead, and a mirrored copy is a copy that drifts.
 */
export function startServer(): Server {
  return app.listen(config.port, () => {
    const tools = getRegisteredTools();
    console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║            🔧 Agent Toolbelt v1.0.0               ║
  ╠═══════════════════════════════════════════════════╣
  ║  Port:    ${String(config.port).padEnd(41)}║
  ║  Env:     ${config.nodeEnv.padEnd(41)}║
  ║  Tools:   ${String(tools.length).padEnd(41)}║
  ║  Stripe:  ${(config.stripeSecretKey ? "Connected ✅" : "Not configured (dev mode)").padEnd(41)}║
  ║  DB:      SQLite (${DB_PATH.padEnd(32)})║
  ╠═══════════════════════════════════════════════════╣
  ║  Public:                                           ║
  ║    GET  /                      Landing page        ║
  ║    GET  /health                Liveness probe      ║
  ║    GET  /api                   Service info        ║
  ║    GET  /api/tools/catalog     Tool discovery      ║
  ║    GET  /api/docs              API documentation   ║
  ║    POST /api/clients/register  Sign up + get key   ║
  ║    POST /api/tools/:name       Call a tool         ║
  ║    POST /billing/checkout      Upgrade plan        ║
  ║  Admin:                                            ║
  ║    GET  /admin/usage           Global stats        ║
  ║    GET  /admin/errors          Failing calls       ║
  ║    DEL  /admin/clients/:id     Delete client       ║
  ║    *    /admin/clients/:id/*   Client management   ║
  ║    *    /admin/warm-cache      Cache warmup        ║
  ╚═══════════════════════════════════════════════════╝
    `);
    startCacheWarmupScheduler();
    startWatchlistMonitorScheduler();
  });
}

export default app;
