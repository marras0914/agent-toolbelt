import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { z } from "zod";
import { registerTool, buildToolRouter } from "../tools/registry";
import { UnsupportedTickerError } from "../tools/_stock-helpers";
import { createClient, createApiKey } from "../db";

/**
 * Router-level, not unit-level, on purpose.
 *
 * The lesson from the X-Upgrade-Nudge outage: a typed error and a green unit test
 * prove nothing if the layer that maps errors to HTTP status codes doesn't branch on
 * the type. So drive a real Express server over a real socket and assert on the
 * status code the client actually receives.
 */

const app = express();
let server: Server;
let baseUrl = "";
let apiKey = "";

// Two tools that fail in different ways, to prove the router distinguishes them.
registerTool({
  name: "test-unsupported-ticker",
  description: "throws UnsupportedTickerError",
  version: "1.0.0",
  inputSchema: z.object({ ticker: z.string() }),
  handler: async (input: { ticker: string }) => {
    throw new UnsupportedTickerError(input.ticker);
  },
  metadata: { tags: ["test"], pricing: "$0.001 per call" },
} as any);

registerTool({
  name: "test-genuine-fault",
  description: "throws a generic error",
  version: "1.0.0",
  inputSchema: z.object({ ticker: z.string() }),
  handler: async () => {
    throw new Error("upstream exploded");
  },
  metadata: { tags: ["test"], pricing: "$0.001 per call" },
} as any);

beforeAll(async () => {
  const client = createClient(`router-status-${process.pid}@example.com`, "test");
  apiKey = createApiKey(client.id).key;

  app.use(express.json());
  app.use("/api/tools", buildToolRouter());

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function callTool(name: string, body: unknown) {
  const res = await fetch(`${baseUrl}/api/tools/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

describe("router maps an unusable ticker to a terminal 422", () => {
  it("returns 422, not 500", async () => {
    const { status } = await callTool("test-unsupported-ticker", { ticker: "WIN" });
    // 500 is what shipped, and it is what kept a client retrying for six weeks.
    expect(status).toBe(422);
  });

  it("tells the caller it is terminal, in machine-readable form", async () => {
    const { body } = await callTool("test-unsupported-ticker", { ticker: "WIN" });
    expect(body.error).toBe("unsupported_ticker");
    expect(body.retryable).toBe(false);
    expect(body.tickers).toEqual(["WIN"]);
    expect(body.message).toContain("WIN");
  });

  it("still 500s on a genuine fault, so real incidents stay visible", async () => {
    const { status, body } = await callTool("test-genuine-fault", { ticker: "AAPL" });
    expect(status).toBe(500);
    expect(body.error).toBe("tool_error");
  });

  it("keeps schema failures on 400, a separate fix for the caller", async () => {
    const { status, body } = await callTool("test-unsupported-ticker", { notATicker: 1 });
    expect(status).toBe(400);
    expect(body.error).toBe("validation_error");
  });

  it("rejects an unauthenticated call before any of this", async () => {
    const res = await fetch(`${baseUrl}/api/tools/test-unsupported-ticker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: "WIN" }),
    });
    expect(res.status).toBe(401);
  });
});
