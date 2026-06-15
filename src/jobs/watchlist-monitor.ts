/**
 * Daily watchlist monitor — the paid "watchdog" value (see
 * docs/watchlist-monitor-plan.md). Walks every watchlist owned by a tier with
 * `watchlistMonitoring`, runs rule-based change detectors on the (cached)
 * upstream data, writes alerts, and emails a digest when a watchlist changed.
 *
 * Cheap by construction: detection is pure rules on data the fetchers already
 * cache for 6h (so a ticker shared across watchlists is fetched once), and the
 * digest is a plain template (no LLM). Runs ~23:00 UTC (after US close).
 *
 * v1 detectors: new insider open-market buy, earnings within 7 days, and a
 * significant daily price move (>=10%). (Buy-zone detection needs an LLM pass
 * and is deferred to Phase 2 per the plan.)
 */

import { config } from "../config";
import { getClientById } from "../db";
import {
  listAllWatchlistsWithTier,
  getWatchlistState,
  upsertWatchlistState,
  insertWatchlistAlert,
  type WatchlistWithTier,
} from "../db/watchlists";
import { TIERS, type Tier } from "../tiers";
import {
  fetchFinnhubInsiders,
  fetchFinnhubUpcomingEarnings,
  fetchPolygonPrevClose,
} from "../tools/_stock-fetchers";
import { sendWatchlistDigest } from "../email";

const PRICE_MOVE_THRESHOLD = 0.1; // 10% day-over-day
const EARNINGS_WINDOW_DAYS = 7;

interface Alert {
  ticker: string;
  type: string;
  message: string;
}

interface MonitorResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  watchlistsMonitored: number;
  tickersChecked: number;
  alertsGenerated: number;
  emailsSent: number;
  errors: number;
}

let lastResult: MonitorResult | null = null;
export function getLastMonitorResult(): MonitorResult | null {
  return lastResult;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run the three detectors for one (watchlist, ticker), update state, return any alerts. */
async function checkTicker(watchlistId: string, ticker: string): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const prev = getWatchlistState(watchlistId, ticker);
  const firstRun = prev === undefined;

  const [insiders, earnings, prevClose] = await Promise.all([
    fetchFinnhubInsiders(ticker).catch(() => []),
    fetchFinnhubUpcomingEarnings(ticker, EARNINGS_WINDOW_DAYS).catch(() => ({} as any)),
    fetchPolygonPrevClose(ticker).catch(() => ({} as any)),
  ]);

  // 1) New insider open-market buy (transactionCode 'P', positive change).
  const buys = (insiders || []).filter((t) => t.transactionCode === "P" && (t.change ?? 0) > 0 && t.transactionDate);
  const newestBuyDate = buys.map((t) => t.transactionDate as string).sort().pop() ?? null;
  if (newestBuyDate && !firstRun && (!prev!.last_insider_buy_date || newestBuyDate > prev!.last_insider_buy_date)) {
    alerts.push({
      ticker,
      type: "insider_buy",
      message: `New insider open-market purchase (filed ${newestBuyDate}).`,
    });
  }

  // 2) Earnings within the window.
  const earningsDate: string | null = (earnings && earnings.date) || null;
  if (earningsDate && (!prev || prev.last_earnings_date !== earningsDate)) {
    alerts.push({
      ticker,
      type: "earnings_soon",
      message: `Earnings expected ${earningsDate} (within ${EARNINGS_WINDOW_DAYS} days).`,
    });
  }

  // 3) Significant daily price move.
  const price: number | null = typeof prevClose?.c === "number" ? prevClose.c : null;
  if (price != null && !firstRun && prev!.last_price != null && prev!.last_price > 0) {
    const pct = (price - prev!.last_price) / prev!.last_price;
    if (Math.abs(pct) >= PRICE_MOVE_THRESHOLD) {
      const dir = pct > 0 ? "up" : "down";
      alerts.push({
        ticker,
        type: "price_move",
        message: `Moved ${dir} ${(Math.abs(pct) * 100).toFixed(1)}% since last check (now $${price}).`,
      });
    }
  }

  upsertWatchlistState(watchlistId, ticker, {
    lastInsiderBuyDate: newestBuyDate ?? prev?.last_insider_buy_date ?? null,
    lastEarningsDate: earningsDate ?? prev?.last_earnings_date ?? null,
    lastPrice: price ?? prev?.last_price ?? null,
  });

  return alerts;
}

export async function runWatchlistMonitor(): Promise<MonitorResult> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  let tickersChecked = 0;
  let alertsGenerated = 0;
  let emailsSent = 0;
  let errors = 0;

  const monitored: WatchlistWithTier[] = listAllWatchlistsWithTier().filter(
    (w) => TIERS[w.tier as Tier]?.watchlistMonitoring
  );
  console.log(`[watchlist-monitor] starting: ${monitored.length} monitored watchlist(s)`);

  for (const wl of monitored) {
    const wlAlerts: Alert[] = [];
    for (const ticker of wl.tickers) {
      try {
        const alerts = await checkTicker(wl.id, ticker);
        wlAlerts.push(...alerts);
      } catch (err) {
        errors++;
        console.warn(`[watchlist-monitor] ${wl.id}/${ticker} threw: ${(err as Error)?.message ?? err}`);
      }
      tickersChecked++;
      await sleep(150); // pace Finnhub/Polygon
    }

    if (wlAlerts.length === 0) continue;
    alertsGenerated += wlAlerts.length;

    // Email digest if enabled and we can resolve the owner's email.
    let emailed = false;
    if (wl.email_alerts) {
      const client = getClientById(wl.client_id);
      if (client?.email && config.resendApiKey) {
        try {
          await sendWatchlistDigest({
            email: client.email,
            name: client.name,
            watchlistName: wl.name,
            alerts: wlAlerts.map((a) => ({ ticker: a.ticker, message: a.message })),
          });
          emailed = true;
          emailsSent++;
        } catch (err) {
          errors++;
          console.warn(`[watchlist-monitor] digest send failed for ${wl.id}: ${(err as Error)?.message ?? err}`);
        }
      }
    }

    for (const a of wlAlerts) insertWatchlistAlert(wl.id, a.ticker, a.type, a.message, emailed);
  }

  const result: MonitorResult = {
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    watchlistsMonitored: monitored.length,
    tickersChecked,
    alertsGenerated,
    emailsSent,
    errors,
  };
  lastResult = result;
  console.log(
    `[watchlist-monitor] done: ${alertsGenerated} alerts across ${monitored.length} watchlists, ${emailsSent} emails, ${errors} errors, ${result.durationMs}ms`
  );
  return result;
}

// ----- Scheduler (re-arming setTimeout, daily ~23:00 UTC, same pattern as warm-cache) -----
function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 0, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function startWatchlistMonitorScheduler(): void {
  if (config.nodeEnv !== "production") {
    console.log("[watchlist-monitor] scheduler skipped (NODE_ENV != production)");
    return;
  }
  if (!config.finnhubApiKey) {
    console.log("[watchlist-monitor] scheduler skipped (FINNHUB_API_KEY not set)");
    return;
  }
  const arm = (): void => {
    const delay = msUntilNextRun();
    console.log(`[watchlist-monitor] next run in ${(delay / 1000 / 60).toFixed(1)}min`);
    setTimeout(async () => {
      try {
        await runWatchlistMonitor();
      } catch (err) {
        console.warn(`[watchlist-monitor] run threw: ${(err as Error)?.message ?? err}`);
      } finally {
        arm();
      }
    }, delay).unref();
  };
  arm();
}
