import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { z } from "zod";
import { registerTool } from "../tools/registry";
import { UnsupportedTickerError } from "../tools/_stock-helpers";

/**
 * The test that could not exist before src/app.ts stopped listening on import.
 *
 * PR #8 mapped an unusable ticker to 422 in buildToolRouter. The guest
 * POST /api/try/:toolName endpoint runs tool handlers itself and had its own copy of
 * the catch block, so it kept returning 500 — on the one path a prospective user hits
 * before they ever register. That gap reached production and was caught by a manual
 * probe, because importing the app to test it would have started a server.
 *
 * Both paths now share sendToolError(); this pins the guest side of that contract.
 */

// NOTE ON ORDERING: `buildToolRouter()` runs once when src/app.ts is imported and
// iterates whatever is registered at that instant, whereas the guest endpoint looks
// the tool up per request. A static `import app from "../app"` is hoisted above these
// registerTool() calls, so the authed router would miss them while the guest path
// still worked — the exact asymmetry this file exists to pin down. Hence the dynamic
// import in beforeAll: it is the only way to guarantee registration happens first.
registerTool({
  name: "guest-test-unsupported-ticker",
  description: "throws UnsupportedTickerError",
  version: "1.0.0",
  inputSchema: z.object({ ticker: z.string() }),
  handler: async (input: { ticker: string }) => {
    throw new UnsupportedTickerError(input.ticker);
  },
  metadata: { tags: ["test"], pricing: "$0.001 per call" },
} as any);

registerTool({
  name: "guest-test-genuine-fault",
  description: "throws a generic error",
  version: "1.0.0",
  inputSchema: z.object({ ticker: z.string() }),
  handler: async () => {
    throw new Error("upstream exploded");
  },
  metadata: { tags: ["test"], pricing: "$0.001 per call" },
} as any);

registerTool({
  name: "guest-test-ok",
  description: "succeeds",
  version: "1.0.0",
  inputSchema: z.object({ ticker: z.string() }),
  handler: async (input: { ticker: string }) => ({ ticker: input.ticker, ok: true }),
  metadata: { tags: ["test"], pricing: "$0.001 per call" },
} as any);

let app: import("express").Express;
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  app = (await import("../app")).default;
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

async function tryTool(name: string, body: unknown) {
  const res = await fetch(`${baseUrl}/api/try/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("POST /api/try/:tool — no auth, the pre-registration path", () => {
  it("returns a terminal 422 for an unusable ticker, not 500", async () => {
    const { status, body } = await tryTool("guest-test-unsupported-ticker", { ticker: "WIN" });
    expect(status).toBe(422);
    expect(body.error).toBe("unsupported_ticker");
    expect(body.retryable).toBe(false);
    expect(body.tickers).toEqual(["WIN"]);
  });

  it("still returns 500 for a genuine fault", async () => {
    const { status, body } = await tryTool("guest-test-genuine-fault", { ticker: "AAPL" });
    expect(status).toBe(500);
    expect(body.error).toBe("tool_error");
  });

  it("keeps schema failures on 400", async () => {
    const { status, body } = await tryTool("guest-test-unsupported-ticker", { nope: 1 });
    expect(status).toBe(400);
    expect(body.error).toBe("validation_error");
  });

  it("404s an unknown tool", async () => {
    const { status } = await tryTool("guest-test-does-not-exist", { ticker: "AAPL" });
    expect(status).toBe(404);
  });

  it("succeeds without any API key and advertises the trial allowance", async () => {
    const { status, body } = await tryTool("guest-test-ok", { ticker: "AAPL" });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.guest).toBe(true);
    expect(typeof body.trialCallsRemaining).toBe("number");
  });

  it("agrees with the authenticated router on the status for the same failure", async () => {
    // The whole point of sharing sendToolError: these two must not diverge again.
    const guest = await tryTool("guest-test-unsupported-ticker", { ticker: "WIN" });
    const res = await fetch(`${baseUrl}/api/tools/guest-test-unsupported-ticker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: "WIN" }),
    });
    // Unauthenticated on the authed route, so it 401s before reaching the handler —
    // but it must never be a 500, and the guest path must be the terminal 422.
    expect(guest.status).toBe(422);
    expect(res.status).toBe(401);
  });
});
