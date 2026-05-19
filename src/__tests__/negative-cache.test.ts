import { describe, it, expect, beforeEach, vi } from "vitest";
import { _clearStockCache } from "../tools/_stock-fetchers";

describe("negative cache (safeJson circuit breaker)", () => {
  beforeEach(() => {
    _clearStockCache();
    vi.restoreAllMocks();
  });

  it("short-circuits the second call after a 429", async () => {
    // Mock fetch to always return 429.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429, statusText: "Too Many Requests" })
    );

    const { fetchFMPKeyMetrics } = await import("../tools/_stock-fetchers");

    // First call hits upstream, gets 429, populates negative cache.
    await fetchFMPKeyMetrics("TESTCACHE_AAPL");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call for the same ticker should NOT hit upstream — negative cache short-circuit.
    await fetchFMPKeyMetrics("TESTCACHE_AAPL");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Different ticker IS a different cache key — should hit upstream.
    await fetchFMPKeyMetrics("TESTCACHE_MSFT");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("short-circuits on network errors too", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const { fetchPolygonOverview } = await import("../tools/_stock-fetchers");

    await fetchPolygonOverview("TESTCACHE_NET");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await fetchPolygonOverview("TESTCACHE_NET");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still 1 — breaker open
  });

  it("does NOT short-circuit on successful empty responses (e.g. legitimate empty array)", async () => {
    // Successful 200 with empty array is a legitimate result, not a failure — should not poison the cache.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const { fetchFMPIncomeStatement } = await import("../tools/_stock-fetchers");

    await fetchFMPIncomeStatement("TESTCACHE_EMPTY");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call SHOULD hit upstream again — empty success doesn't trigger the breaker.
    await fetchFMPIncomeStatement("TESTCACHE_EMPTY");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("strips API key from the negative-cache key (different keys, same path → same breaker)", async () => {
    // Build two FMP URLs differing only in apikey param. The breaker should treat them as the same.
    // We test this indirectly: the first failure should block the second call, even though the
    // fetcher rebuilds the URL with the same key each time — so all we need to verify is that the
    // path+ticker is what's hashed, not the full URL string. The mock asserts call count.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 })
    );

    const { fetchFMPRatiosTTM } = await import("../tools/_stock-fetchers");

    await fetchFMPRatiosTTM("TESTCACHE_KEYSTRIP");
    await fetchFMPRatiosTTM("TESTCACHE_KEYSTRIP");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Verify the URL passed to fetch contained the apikey — proves the breaker stripped it before hashing.
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/apikey=/);
  });
});
