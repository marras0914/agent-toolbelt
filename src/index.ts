import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { config } from "./config";
import { getUsageSummary, getClientUsageSummary } from "./middleware/usage";
import { buildToolRouter, getRegisteredTools } from "./tools/registry";
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
} from "./db";
import { sendOnboardingEmail } from "./email";

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

// ----- App Setup -----
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

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

// Health check / service info
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
      message: `Free trial limit reached (${GUEST_DAILY_LIMIT} tries/day). Register for 1,000 free calls/month.`,
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
    const result = await tool.handler(parsed.data);
    const durationMs = Date.now() - startTime;
    res.json({
      success: true,
      tool: tool.name,
      durationMs,
      result,
      guest: true,
      trialCallsRemaining: remaining,
      ...(remaining <= 3 && {
        nudge: `${remaining} free tries left today. Register for 1,000 free calls/month → POST /api/clients/register`,
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: "tool_error", message: err.message });
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

  // Auto-generate their first API key
  const { key, record } = createApiKey(client.id, "default");

  // Send onboarding email (fire-and-forget — don't block the response)
  sendOnboardingEmail({ email: client.email, name: client.name, apiKey: key, clientId: client.id })
    .catch((err) => console.error("[email] Failed to send onboarding email:", err.message));

  res.status(201).json({
    message: "Welcome to Agent Toolbelt! Store your API key securely — it won't be shown again.",
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

// Global usage dashboard
app.get("/admin/usage", (_req, res) => {
  res.json(getUsageSummary());
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

// ----- Catch-all: serve landing page for non-API routes -----
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// ----- Start Server -----
app.listen(config.port, () => {
  const tools = getRegisteredTools();
  console.log(`
╔═══════════════════════════════════════════════════╗
║            🔧 Agent Toolbelt v1.0.0               ║
╠═══════════════════════════════════════════════════╣
║  Port:    ${String(config.port).padEnd(41)}║
║  Env:     ${config.nodeEnv.padEnd(41)}║
║  Tools:   ${String(tools.length).padEnd(41)}║
║  Stripe:  ${(config.stripeSecretKey ? "Connected ✅" : "Not configured (dev mode)").padEnd(41)}║
║  DB:      SQLite (./data/toolbelt.db)${" ".repeat(14)}║
╠═══════════════════════════════════════════════════╣
║  Public:                                           ║
║    GET  /                      Landing page        ║
║    GET  /api                   Service info        ║
║    GET  /api/tools/catalog     Tool discovery      ║
║    GET  /api/docs              API documentation   ║
║    POST /api/clients/register  Sign up + get key   ║
║    POST /api/tools/:name       Call a tool         ║
║    POST /billing/checkout      Upgrade plan        ║
║  Admin:                                            ║
║    GET  /admin/usage           Global stats        ║
║    *    /admin/clients/:id/*   Client management   ║
╚═══════════════════════════════════════════════════╝
  `);
});

export default app;
