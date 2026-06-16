import { describe, it, expect } from "vitest";
import { getRapidApiGatewayClient } from "../rapidapi-gateway";
import { getClientById } from "../db";

describe("RapidAPI gateway client", () => {
  it("seeds an enterprise-tier client + key and is idempotent (cached)", () => {
    const a = getRapidApiGatewayClient();
    expect(a.clientId).toMatch(/^cli_/);
    expect(a.keyId).toMatch(/^key_/);

    // Second call returns the same identity (cached, not a new client/key).
    const b = getRapidApiGatewayClient();
    expect(b).toEqual(a);

    // The gateway client is uncapped (enterprise), so RapidAPI's shared channel
    // isn't throttled by the per-client free/origin limits.
    expect(getClientById(a.clientId)?.tier).toBe("enterprise");
  });
});
