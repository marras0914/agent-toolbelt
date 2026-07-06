import { describe, it, expect } from "vitest";
import { TIERS, SUBSCRIPTION_TIERS, isSubscriptionTier, type Tier } from "../tiers";
import { checkTierLimit } from "../db";

/**
 * Golden tier table — the INTENDED plan config, encoded independently of
 * src/tiers.ts. If you change a quota, price, or rate limit, update BOTH this
 * table and src/tiers.ts; the mismatch is the point (an accidental edit to
 * either side fails here).
 *
 * This file is the canonical home for tier assertions. It exists because the
 * pro-tier quota was repriced 10k→1k on 2026-06-16 but a stale hard-coded 10k
 * assertion in another test file was missed, leaving CI red for ~3 weeks. Keep
 * per-tier assertions HERE, not scattered across other test files.
 */
const EXPECTED: Record<Tier, {
  monthlyRequests: number;
  requestsPerMinute: number;
  stockRequestsPerMinute: number;
  monthlyUsd: number | null;
  stripePriceEnv: string | null;
  watchlistMonitoring: boolean;
  maxWatchlists: number;
  maxWatchlistTickers: number;
}> = {
  free:       { monthlyRequests: 250,      requestsPerMinute: 10,    stockRequestsPerMinute: 5,        monthlyUsd: null, stripePriceEnv: null,                      watchlistMonitoring: false, maxWatchlists: 1,   maxWatchlistTickers: 10 },
  payg:       { monthlyRequests: Infinity, requestsPerMinute: 60,    stockRequestsPerMinute: 20,       monthlyUsd: null, stripePriceEnv: null,                      watchlistMonitoring: false, maxWatchlists: 3,   maxWatchlistTickers: 25 },
  pro:        { monthlyRequests: 1_000,    requestsPerMinute: 30,    stockRequestsPerMinute: 20,       monthlyUsd: 10,   stripePriceEnv: "STRIPE_PRICE_HOBBY",      watchlistMonitoring: true,  maxWatchlists: 3,   maxWatchlistTickers: 25 },
  starter:    { monthlyRequests: 4_000,    requestsPerMinute: 60,    stockRequestsPerMinute: 30,       monthlyUsd: 29,   stripePriceEnv: "STRIPE_PRICE_STARTER",    watchlistMonitoring: true,  maxWatchlists: 10,  maxWatchlistTickers: 50 },
  enterprise: { monthlyRequests: 75_000,   requestsPerMinute: 1_000, stockRequestsPerMinute: Infinity, monthlyUsd: 499,  stripePriceEnv: "STRIPE_PRICE_ENTERPRISE", watchlistMonitoring: true,  maxWatchlists: 100, maxWatchlistTickers: 100 },
};

const ALL_TIERS = Object.keys(EXPECTED) as Tier[];

describe("TIERS config table", () => {
  it("has exactly the expected tiers, no more no less", () => {
    expect(Object.keys(TIERS).sort()).toEqual(ALL_TIERS.slice().sort());
  });

  for (const tier of ALL_TIERS) {
    it(`${tier} matches the golden config`, () => {
      const actual = TIERS[tier];
      const exp = EXPECTED[tier];
      expect(actual.monthlyRequests).toBe(exp.monthlyRequests);
      expect(actual.requestsPerMinute).toBe(exp.requestsPerMinute);
      expect(actual.stockRequestsPerMinute).toBe(exp.stockRequestsPerMinute);
      expect(actual.monthlyUsd).toBe(exp.monthlyUsd);
      expect(actual.stripePriceEnv).toBe(exp.stripePriceEnv);
      expect(actual.watchlistMonitoring).toBe(exp.watchlistMonitoring);
      expect(actual.maxWatchlists).toBe(exp.maxWatchlists);
      expect(actual.maxWatchlistTickers).toBe(exp.maxWatchlistTickers);
    });
  }
});

describe("tier invariants", () => {
  it("subscription quotas strictly increase: free < pro < starter < enterprise", () => {
    expect(TIERS.free.monthlyRequests).toBeLessThan(TIERS.pro.monthlyRequests);
    expect(TIERS.pro.monthlyRequests).toBeLessThan(TIERS.starter.monthlyRequests);
    expect(TIERS.starter.monthlyRequests).toBeLessThan(TIERS.enterprise.monthlyRequests);
  });

  it("subscription prices order pro < starter < enterprise (Marco-accepted $10<$29 ladder)", () => {
    expect(TIERS.pro.monthlyUsd!).toBeLessThan(TIERS.starter.monthlyUsd!);
    expect(TIERS.starter.monthlyUsd!).toBeLessThan(TIERS.enterprise.monthlyUsd!);
  });

  it("only paid subscription tiers get watchlist monitoring (the recurring value)", () => {
    expect(TIERS.free.watchlistMonitoring).toBe(false);
    expect(TIERS.payg.watchlistMonitoring).toBe(false);
    for (const t of ["pro", "starter", "enterprise"] as Tier[]) {
      expect(TIERS[t].watchlistMonitoring).toBe(true);
    }
  });
});

describe("SUBSCRIPTION_TIERS derivation", () => {
  it("is exactly the tiers with a price and a Stripe env, in map order", () => {
    expect(SUBSCRIPTION_TIERS).toEqual(["pro", "starter", "enterprise"]);
  });

  it("excludes free and payg (no Stripe price)", () => {
    expect(SUBSCRIPTION_TIERS).not.toContain("free");
    expect(SUBSCRIPTION_TIERS).not.toContain("payg");
  });

  it("isSubscriptionTier agrees with SUBSCRIPTION_TIERS", () => {
    for (const t of ALL_TIERS) {
      expect(isSubscriptionTier(t)).toBe(SUBSCRIPTION_TIERS.includes(t));
    }
    expect(isSubscriptionTier("nonsense")).toBe(false);
  });
});

describe("checkTierLimit agrees with TIERS (regression: enforced map drifted from config)", () => {
  for (const tier of ALL_TIERS) {
    it(`${tier} enforced limit === TIERS[${tier}].monthlyRequests`, () => {
      // Nonexistent client => 0 used, so .limit reflects the tier cap.
      const { limit } = checkTierLimit(`nonexistent-${tier}`, tier);
      expect(limit).toBe(TIERS[tier].monthlyRequests);
    });
  }
});
