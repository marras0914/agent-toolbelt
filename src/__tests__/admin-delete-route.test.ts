import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import {
  createClient,
  createApiKey,
  recordUsage,
  getClientById,
  deleteClientCascade,
  db,
} from "../db";
import { RAPIDAPI_GATEWAY_EMAIL } from "../rapidapi-gateway";
// Mirrors src/index.ts, which imports this for its side effect (creates the
// watchlist tables). deleteClientCascade tolerates their absence, but the route
// should be exercised against the same schema production has.
import { createWatchlist } from "../db/watchlists";

/**
 * The guards, not the cascade, are what stand between a cleanup sweep and deleting a
 * paying customer. They only exist at the route layer, so they are tested there —
 * over a real socket, against a real router.
 *
 * This mounts a local copy of the route rather than importing index.ts, which calls
 * app.listen() at import. Keep in sync with the handler in src/index.ts; the shared
 * destructive logic (deleteClientCascade) is imported, not duplicated.
 */

const ADMIN_SECRET = "test-admin-secret";
const app = express();
let server: Server;
let baseUrl = "";

let seq = 0;
const uniqueEmail = () => `adm-del-${process.pid}-${++seq}@example.test`;

function seedClient(tier: "free" | "pro" = "free", credits = 0) {
  const c = createClient(uniqueEmail(), "admin-delete-test", tier);
  const { record } = createApiKey(c.id);
  recordUsage(c.id, record.id, "stock-thesis", 200, 900, "fp", false);
  createWatchlist(c.id, "list", ["AAPL"]);
  if (credits > 0) {
    db.prepare("UPDATE clients SET credit_balance_micros = ? WHERE id = ?").run(credits, c.id);
  }
  return getClientById(c.id)!;
}

beforeAll(async () => {
  app.use(express.json());
  app.use("/admin", (req, res, next) => {
    if (req.headers["authorization"] !== `Bearer ${ADMIN_SECRET}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });

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
      res.status(409).json({ error: "protected_client" });
      return;
    }
    if (confirm !== client.email) {
      res.status(400).json({ error: "confirmation_required", expected: client.email, received: confirm || null });
      return;
    }
    const paidTier = client.tier !== "free";
    const hasCredits = (client.credit_balance_micros ?? 0) > 0;
    if ((paidTier || hasCredits) && !force) {
      res.status(409).json({ error: "paying_client", tier: client.tier });
      return;
    }
    const deleted = deleteClientCascade(clientId, dryRun);
    res.json({ ...(dryRun ? { dryRun: true } : { deleted: true }), clientId, email: client.email, rows: deleted });
  });

  // Surface a thrown handler error as JSON. Without this Express returns its HTML
  // error page and a genuine failure shows up only as "Unexpected token '<'",
  // which is how a real "no such table: watchlists" bug nearly went unread.
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: "route_threw", message: err?.message });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function del(path: string, auth = true) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: auth ? { Authorization: `Bearer ${ADMIN_SECRET}` } : {},
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("DELETE /admin/clients/:id — guards", () => {
  it("requires the admin secret", async () => {
    const c = seedClient();
    const { status } = await del(`/admin/clients/${c.id}?confirm=${encodeURIComponent(c.email)}`, false);
    expect(status).toBe(401);
    expect(getClientById(c.id)).toBeDefined();
  });

  it("404s an unknown client", async () => {
    const { status } = await del("/admin/clients/cli_nope?confirm=x@y.com");
    expect(status).toBe(404);
  });

  it("refuses without ?confirm and says what it expected", async () => {
    const c = seedClient();
    const { status, body } = await del(`/admin/clients/${c.id}`);
    expect(status).toBe(400);
    expect(body.error).toBe("confirmation_required");
    expect(body.expected).toBe(c.email);
    expect(getClientById(c.id)).toBeDefined();
  });

  it("refuses when ?confirm names a different client's email", async () => {
    const target = seedClient();
    const other = seedClient();
    // The realistic accident: right email, wrong id (stale from a scrollback).
    const { status } = await del(`/admin/clients/${target.id}?confirm=${encodeURIComponent(other.email)}`);
    expect(status).toBe(400);
    expect(getClientById(target.id)).toBeDefined();
    expect(getClientById(other.id)).toBeDefined();
  });

  it("refuses to delete the RapidAPI gateway client", async () => {
    const gw = createClient(RAPIDAPI_GATEWAY_EMAIL, "RapidAPI Gateway", "enterprise");
    const { status, body } = await del(`/admin/clients/${gw.id}?confirm=${encodeURIComponent(RAPIDAPI_GATEWAY_EMAIL)}`);
    expect(status).toBe(409);
    expect(body.error).toBe("protected_client");
    expect(getClientById(gw.id)).toBeDefined();
  });

  it("refuses a paid-tier client without force", async () => {
    const c = seedClient("pro");
    const { status, body } = await del(`/admin/clients/${c.id}?confirm=${encodeURIComponent(c.email)}`);
    expect(status).toBe(409);
    expect(body.error).toBe("paying_client");
    expect(getClientById(c.id)).toBeDefined();
  });

  it("refuses a client holding credits without force", async () => {
    const c = seedClient("free", 5_000_000);
    const { status, body } = await del(`/admin/clients/${c.id}?confirm=${encodeURIComponent(c.email)}`);
    expect(status).toBe(409);
    expect(body.error).toBe("paying_client");
    expect(getClientById(c.id)).toBeDefined();
  });

  it("allows a paid-tier client through with force=true", async () => {
    const c = seedClient("pro");
    const { status } = await del(`/admin/clients/${c.id}?confirm=${encodeURIComponent(c.email)}&force=true`);
    expect(status).toBe(200);
    expect(getClientById(c.id)).toBeUndefined();
  });
});

describe("DELETE /admin/clients/:id — behaviour", () => {
  it("deletes a confirmed free client and reports the rows", async () => {
    const c = seedClient();
    const { status, body } = await del(`/admin/clients/${c.id}?confirm=${encodeURIComponent(c.email)}`);
    expect(status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(body.rows.clients).toBe(1);
    expect(body.rows.usage_records).toBe(1);
    expect(body.rows.watchlists).toBe(1);
    expect(getClientById(c.id)).toBeUndefined();
  });

  it("dryRun previews without deleting", async () => {
    const c = seedClient();
    const { status, body } = await del(`/admin/clients/${c.id}?confirm=${encodeURIComponent(c.email)}&dryRun=true`);
    expect(status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.rows.clients).toBe(1);
    expect(getClientById(c.id)).toBeDefined();
  });

  it("leaves the database intact afterwards", async () => {
    const c = seedClient();
    await del(`/admin/clients/${c.id}?confirm=${encodeURIComponent(c.email)}`);
    expect(db.pragma("foreign_key_check")).toHaveLength(0);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  });
});
