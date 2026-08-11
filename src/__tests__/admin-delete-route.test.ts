import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import {
  createClient,
  createApiKey,
  recordUsage,
  getClientById,
  db,
} from "../db";
import { createWatchlist } from "../db/watchlists";
import { RAPIDAPI_GATEWAY_EMAIL } from "../rapidapi-gateway";

/**
 * Drives the REAL route from src/app.ts, not a copy of it.
 *
 * This used to mirror the handler here, because importing the app started a server.
 * A mirrored guard is a guard that drifts: the copy could keep passing while the
 * shipped route lost a check. Now that app.ts no longer listens on import, the
 * guards standing between a cleanup sweep and a paying customer are tested as
 * deployed.
 */

// Hoisted so ADMIN_SECRET is set before src/app.ts (and src/config.ts) are imported;
// config reads process.env once at module load. Without this, config.adminSecret is
// "" and the admin middleware skips auth entirely (its dev-mode behaviour).
const ADMIN_SECRET = "test-admin-secret-delete-route";
vi.hoisted(() => {
  process.env.ADMIN_SECRET = "test-admin-secret-delete-route";
});

import app from "../app";

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
    const existing = db.prepare("SELECT id FROM clients WHERE email = ?").get(RAPIDAPI_GATEWAY_EMAIL) as { id: string } | undefined;
    const gw = existing ?? createClient(RAPIDAPI_GATEWAY_EMAIL, "RapidAPI Gateway", "enterprise");
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
