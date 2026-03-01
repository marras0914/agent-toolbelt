import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { config } from "./config";
import { getUsageSummary, getClientUsageSummary } from "./middleware/usage";
import { buildToolRouter, getRegisteredTools } from "./tools/registry";
import { buildBillingRouter, buildStripeWebhookRouter } from "./middleware/billing";
import {
  createClient,
  createApiKey,
  getClientById,
  getClientByEmail,
  getClientApiKeys,
  revokeApiKey,
} from "./db";

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
    description_for_human: "API microservices for generating schemas, extracting structured data from text, and more.",
    description_for_model: "Use Agent Toolbelt to generate JSON Schema / TypeScript / Zod schemas from natural language descriptions, and to extract structured data (emails, URLs, phone numbers, dates, currencies, addresses, names) from raw text. Call getToolCatalog first to see all available tools, then call the appropriate tool. Always include the API key as a Bearer token.",
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

// Global usage dashboard
app.get("/admin/usage", (_req, res) => {
  res.json(getUsageSummary());
});

// API docs endpoint
app.get("/api/docs", (_req, res) => {
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
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      version: t.version,
      endpoint: `POST /api/tools/${t.name}`,
      metadata: t.metadata,
    })),
    tiers: {
      free: { price: "$0/mo", monthlyRequests: "1,000", rateLimit: "10/min" },
      starter: { price: "$29/mo", monthlyRequests: "50,000", rateLimit: "60/min" },
      pro: { price: "$99/mo", monthlyRequests: "500,000", rateLimit: "300/min" },
      enterprise: { price: "Custom", monthlyRequests: "5,000,000", rateLimit: "1,000/min" },
    },
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
