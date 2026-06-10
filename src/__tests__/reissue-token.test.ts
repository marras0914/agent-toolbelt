import { describe, it, expect } from "vitest";
import { createReissueToken, consumeReissueToken, createClient } from "../db";

// Reissue tokens FK-reference clients(id), and FK enforcement is on, so each
// test seeds a real client with a unique email first.
function newClient() {
  const uniq = `reissue-${Date.now()}-${Math.floor(Math.random() * 1e9)}@test.local`;
  return createClient(uniq).id;
}

describe("key reissue tokens", () => {
  it("creates a token that consumes to the right client once", () => {
    const cid = newClient();
    const token = createReissueToken(cid);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(32);
    expect(consumeReissueToken(token)).toBe(cid);
  });

  it("is single-use — a second consume returns null", () => {
    const cid = newClient();
    const token = createReissueToken(cid);
    expect(consumeReissueToken(token)).toBe(cid);
    expect(consumeReissueToken(token)).toBeNull();
  });

  it("returns null for an unknown token", () => {
    expect(consumeReissueToken("deadbeef".repeat(8))).toBeNull();
  });

  it("returns null for an expired token", () => {
    const cid = newClient();
    const token = createReissueToken(cid, -1); // expired 1 min ago
    expect(consumeReissueToken(token)).toBeNull();
  });

  it("issues distinct tokens per call", () => {
    const cid = newClient();
    expect(createReissueToken(cid)).not.toBe(createReissueToken(cid));
  });
});
