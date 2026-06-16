/**
 * Single source of truth for plan tiers.
 *
 * Every per-tier value — monthly quota, per-minute rate limit, stock-tool rate
 * limit, subscription price, display name — lives in this one map. auth.ts,
 * billing.ts, stock-rate-limit.ts, and the db quota check all read from here.
 *
 * Historically these limits were duplicated across files (a TIER_LIMITS map in
 * auth.ts AND a separate LIMITS map inside checkTierLimit in db/index.ts), and
 * they drifted: a new tier was added to one but not the other, so subscribers
 * were silently capped at the free limit. Adding or renaming a tier now means
 * editing exactly one place.
 */

export type Tier = "free" | "payg" | "pro" | "starter" | "enterprise";

export interface TierConfig {
  displayName: string;
  /** Monthly call cap. Infinity = no monthly cap (payg is gated by credits instead). */
  monthlyRequests: number;
  /** Global per-minute request rate limit. */
  requestsPerMinute: number;
  /** Stricter per-minute limit applied only to stock tools (they fan out to upstream APIs). Infinity = unlimited. */
  stockRequestsPerMinute: number;
  /** Monthly price in USD for subscription tiers; null for free/payg. */
  monthlyUsd: number | null;
  /** Name of the env var holding the Stripe price id (subscription tiers only); null otherwise. */
  stripePriceEnv: string | null;
  /** Whether this tier gets scheduled watchlist monitoring + alerts (the paid recurring value). */
  watchlistMonitoring: boolean;
  /** Max saved watchlists this tier can create. */
  maxWatchlists: number;
  /** Max tickers per watchlist. */
  maxWatchlistTickers: number;
}

export const TIERS: Record<Tier, TierConfig> = {
  free:       { displayName: "Free",          monthlyRequests: 250,       requestsPerMinute: 10,    stockRequestsPerMinute: 5,        monthlyUsd: null, stripePriceEnv: null,                       watchlistMonitoring: false, maxWatchlists: 1,   maxWatchlistTickers: 10 },
  payg:       { displayName: "Pay As You Go", monthlyRequests: Infinity,  requestsPerMinute: 60,    stockRequestsPerMinute: 20,       monthlyUsd: null, stripePriceEnv: null,                       watchlistMonitoring: false, maxWatchlists: 3,   maxWatchlistTickers: 25 },
  // Stripe price for the $10 Pro tier is read from STRIPE_PRICE_HOBBY — kept
  // under the original env var name so no Railway change was needed for the
  // hobby→pro rename. (STRIPE_PRICE_PRO previously held the retired $99 tier.)
  pro:        { displayName: "Pro",           monthlyRequests: 1_000,     requestsPerMinute: 30,    stockRequestsPerMinute: 20,       monthlyUsd: 10,   stripePriceEnv: "STRIPE_PRICE_HOBBY",       watchlistMonitoring: true,  maxWatchlists: 3,   maxWatchlistTickers: 25 },
  starter:    { displayName: "Starter",       monthlyRequests: 4_000,     requestsPerMinute: 60,    stockRequestsPerMinute: 30,       monthlyUsd: 29,   stripePriceEnv: "STRIPE_PRICE_STARTER",     watchlistMonitoring: true,  maxWatchlists: 10,  maxWatchlistTickers: 50 },
  enterprise: { displayName: "Enterprise",    monthlyRequests: 75_000,    requestsPerMinute: 1_000, stockRequestsPerMinute: Infinity, monthlyUsd: 499,  stripePriceEnv: "STRIPE_PRICE_ENTERPRISE", watchlistMonitoring: true,  maxWatchlists: 100, maxWatchlistTickers: 100 },
};

/** Tiers a customer can subscribe to via Stripe checkout (excludes free/payg). */
export const SUBSCRIPTION_TIERS = (Object.keys(TIERS) as Tier[]).filter(
  (t) => TIERS[t].monthlyUsd !== null && TIERS[t].stripePriceEnv !== null
);

/** Type guard for runtime-validating an arbitrary string as a subscription tier. */
export function isSubscriptionTier(tier: string): tier is Tier {
  return (SUBSCRIPTION_TIERS as string[]).includes(tier);
}
