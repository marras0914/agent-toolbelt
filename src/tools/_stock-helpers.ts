import { z } from "zod";

/** Hint string appended to ticker-related errors so users know our coverage scope. */
export const US_ONLY_HINT =
  "Agent Toolbelt supports US-listed equities only (NYSE, NASDAQ, AMEX). Try AAPL, MSFT, or NVDA.";

// First char must be a letter (rejects all-numeric Chinese A-shares like "002714"
// and digit-prefixed codes like "2DG"). Rest may be letters, digits, dot, hyphen
// to allow class shares like "BRK.B", "BF.B".
const TICKER_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export const isValidUSTicker = (ticker: string): boolean =>
  TICKER_PATTERN.test(ticker);

/** Shared zod schema for a single US ticker — uppercases, trims, validates shape. */
export const usTickerSchema = z
  .string()
  .min(1)
  .max(10)
  .transform((v) => v.toUpperCase().trim())
  .refine(isValidUSTicker, (val) => ({
    message: `"${val}" is not a valid US ticker. ${US_ONLY_HINT}`,
  }))
  .describe("Stock ticker symbol (e.g. NVDA, AAPL, MSFT). US-listed equities only.");

/**
 * A ticker that passed shape validation but has no data at any upstream — delisted,
 * OTC, or a non-US listing. This is the CALLER's problem, not ours, and retrying will
 * never help.
 *
 * It needs its own type because the tool router turns every thrown error into a 500,
 * and a 500 tells a client "transient, try again". One client hammered `WIN`
 * (Windstream, delisted) 250 times over six weeks against a 500 that would never
 * clear, burning their whole free-tier quota on a request that could never succeed
 * and drowning the global error rate so genuine incidents were invisible.
 *
 * Mapped to HTTP 422 in `buildToolRouter`: the request was well-formed, but the
 * entity it names can't be processed. Not 400 (that's schema failure, a different
 * fix for the caller) and not 404 (the router already uses that for "tool not found",
 * which would be ambiguous on the same endpoint).
 */
export class UnsupportedTickerError extends Error {
  readonly tickers: string[];

  constructor(tickers: string | string[]) {
    const list = Array.isArray(tickers) ? tickers : [tickers];
    const subject = list.length === 1 ? `ticker "${list[0]}"` : `tickers: ${list.join(", ")}`;
    super(`No data found for ${subject}. ${US_ONLY_HINT}`);
    this.name = "UnsupportedTickerError";
    this.tickers = list;
  }
}

/** Sanity-check a numeric value against a plausibility range; null on out-of-range or non-finite. */
export const sane = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return v != null && isFinite(n) && n >= min && n <= max ? n : null;
};

/** Finnhub returns most quality/growth metrics as percentages (e.g. 33.6 = 33.6%). Convert to decimal. */
export const fhPct = (v: unknown): number | undefined =>
  v != null && isFinite(Number(v)) ? Number(v) / 100 : undefined;

/** Format a numeric value with a suffix and decimal precision; "N/A" when null. */
export const fmt = (v: number | null | undefined, suffix = "", decimals = 1): string =>
  v != null ? `${Number(v).toFixed(decimals)}${suffix}` : "N/A";

/** Format a decimal as a percentage (0.156 → "15.6%"); "N/A" when null. */
export const fmtPct = (v: number | null | undefined): string =>
  v != null ? `${(Number(v) * 100).toFixed(1)}%` : "N/A";

/** Round to 1 decimal, preserving null. */
export const round1 = (v: number | null | undefined): number | null =>
  v != null ? parseFloat(Number(v).toFixed(1)) : null;

/**
 * Map over tickers a few at a time instead of all at once, preserving input order.
 *
 * Multi-ticker tools fan out several upstream calls per ticker, so a bare
 * Promise.all over a 15-20 ticker list opens 60-80 connections and rate-limits
 * itself. Observed on 2026-08-13: a 12-ticker run 429'd 7 of them, and because
 * the negative cache pins a failed URL for 5 minutes, retrying inside the window
 * returned the same holes.
 *
 * The damage is quiet — a fetcher that fails returns `{}` rather than throwing,
 * so the ticker keeps whatever fields its other upstreams supplied and the tool
 * reports a confident result built on a partial row. Bound the fan-out; 4 tickers
 * in flight keeps latency close to the unbounded version because the batches
 * pipeline against the 6h fetch cache.
 */
export const TICKER_CONCURRENCY = 4;

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
