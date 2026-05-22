/**
 * Daily FMP cache warmer. Calls the FMP fetchers (which already cache via
 * `withCache` in _stock-fetchers.ts) for a curated list of popular US tickers,
 * so user-facing requests during the day hit the cache instead of FMP.
 *
 * Sized to fit inside FMP's free-tier 250 calls/day cap: 50 tickers × 3
 * endpoints = 150 calls/run, leaving ~100 calls/day for organic traffic on
 * tickers not in the warm list.
 *
 * Runs once per day at 00:30 UTC, 30 minutes after FMP's daily cap reset.
 */

import { config } from "../config";
import {
  fetchFMPKeyMetrics,
  fetchFMPRatiosTTM,
  fetchFMPIncomeStatement,
} from "../tools/_stock-fetchers";

// Megacaps + AI/semis + banks + consumer + healthcare + industrials. Covers what
// the active users (Filip, Reddit reports) actually query. Update as patterns shift.
const WARM_TICKERS = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "BRK.B", "JPM",
  "V", "MA", "JNJ", "WMT", "PG", "XOM", "UNH", "HD", "CVX", "LLY",
  "ABBV", "MRK", "PEP", "KO", "COST", "AVGO", "ADBE", "CSCO", "ORCL", "CRM",
  "NFLX", "INTC", "AMD", "MU", "QCOM", "TXN", "INTU", "IBM", "NOW", "AMAT",
  "BAC", "WFC", "MS", "GS", "AXP", "SCHW", "BLK", "BA", "CAT", "GE",
];

interface WarmupResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  tickersAttempted: number;
  tickersSucceeded: number;
  tickersFailed: number;
  failedTickers: string[];
}

let lastResult: WarmupResult | null = null;

export function getLastWarmupResult(): WarmupResult | null {
  return lastResult;
}

export function getWarmTickers(): readonly string[] {
  return WARM_TICKERS;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runCacheWarmup(): Promise<WarmupResult> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const failedTickers: string[] = [];
  let succeeded = 0;

  console.log(`[warm-cache] starting warmup for ${WARM_TICKERS.length} tickers`);

  // Serialize across tickers (parallel within ticker is fine) to avoid bursting
  // against FMP's per-minute throttling on top of the daily cap.
  for (const ticker of WARM_TICKERS) {
    try {
      const [km, rt, inc] = await Promise.all([
        fetchFMPKeyMetrics(ticker),
        fetchFMPRatiosTTM(ticker),
        fetchFMPIncomeStatement(ticker, "annual", 5),
      ]);
      const hasData = Object.keys(km).length > 0 || Object.keys(rt).length > 0 || inc.length > 0;
      if (hasData) succeeded++;
      else failedTickers.push(ticker);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      console.warn(`[warm-cache] ${ticker} threw: ${msg}`);
      failedTickers.push(ticker);
    }
    await sleep(200);
  }

  const result: WarmupResult = {
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    tickersAttempted: WARM_TICKERS.length,
    tickersSucceeded: succeeded,
    tickersFailed: failedTickers.length,
    failedTickers,
  };
  lastResult = result;
  console.log(`[warm-cache] done: ${succeeded}/${WARM_TICKERS.length} succeeded in ${result.durationMs}ms`);
  return result;
}

// ----- Scheduler -----
// Re-arming setTimeout (cron-style daily at 00:30 UTC) instead of a node-cron
// dependency since this is the only scheduled job in the service.
function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 30, 0, 0,
  ));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function startCacheWarmupScheduler(): void {
  if (config.nodeEnv !== "production") {
    console.log("[warm-cache] scheduler skipped (NODE_ENV != production)");
    return;
  }
  if (!config.fmpApiKey) {
    console.log("[warm-cache] scheduler skipped (FMP_API_KEY not set)");
    return;
  }
  const arm = (): void => {
    const delay = msUntilNextRun();
    console.log(`[warm-cache] next run in ${(delay / 1000 / 60).toFixed(1)}min`);
    setTimeout(async () => {
      try {
        await runCacheWarmup();
      } catch (err) {
        console.warn(`[warm-cache] run threw: ${(err as Error)?.message ?? err}`);
      } finally {
        arm();
      }
    }, delay).unref();
  };
  arm();
}
