/**
 * In-memory recorder for upstream API failures (HTTP non-2xx + fetch errors).
 *
 * Populated by `safeJson` in src/tools/_stock-fetchers.ts. Surfaced via the
 * /admin/upstream-health route so ops can see whether the stock tools are
 * silently degrading (e.g., FMP free-tier daily cap blowing through).
 *
 * Counters and the recent-events buffer reset whenever the Railway process
 * restarts. That's intentional — we deploy multiple times a day, and the
 * counter is meant as a "since last deploy" health view, not as a persistent
 * analytics store. If you need longer-window data, grep Railway logs for
 * `[stock-fetcher]`.
 */

interface UpstreamFailure {
  ts: number;
  host: string;
  endpoint: string;
  status: number; // HTTP status; 0 for network/parse errors
  message?: string;
}

const MAX_RECENT = 200;
const startedAt = Date.now();
const recent: UpstreamFailure[] = [];
const counts = new Map<string, number>(); // key: `${host}|${status}` → count
const negCacheHits = new Map<string, number>(); // key: `${host}` → count

export function recordUpstreamFailure(args: {
  host: string;
  endpoint: string;
  status: number;
  message?: string;
}): void {
  recent.push({ ts: Date.now(), ...args });
  if (recent.length > MAX_RECENT) recent.shift();
  const key = `${args.host}|${args.status}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * Increment when the in-memory negative cache short-circuits an upstream call
 * (i.e., we skipped a fetch because the same URL recently 429'd). High values
 * here mean the circuit breaker is actively protecting against a sustained
 * upstream outage. Counted per host since endpoint-level breakdown is captured
 * indirectly via the failure that opened the breaker.
 */
export function recordNegativeCacheHit(args: { host: string; endpoint: string }): void {
  negCacheHits.set(args.host, (negCacheHits.get(args.host) ?? 0) + 1);
}

export function getUpstreamHealth(): {
  windowStartedAt: string;
  totalFailures: number;
  totalNegativeCacheHits: number;
  byHost: Array<{ host: string; total: number; rateLimits429: number; otherErrors: number; negCacheHits: number }>;
  byHostStatus: Array<{ host: string; status: number; count: number }>;
  recent: Array<{ ts: string; host: string; endpoint: string; status: number; message?: string }>;
} {
  const byHostStatus: Array<{ host: string; status: number; count: number }> = [];
  const byHostMap = new Map<string, { total: number; rateLimits429: number; otherErrors: number; negCacheHits: number }>();

  for (const [key, count] of counts) {
    const [host, statusStr] = key.split("|");
    const status = parseInt(statusStr, 10);
    byHostStatus.push({ host, status, count });

    const h = byHostMap.get(host) ?? { total: 0, rateLimits429: 0, otherErrors: 0, negCacheHits: 0 };
    h.total += count;
    if (status === 429) h.rateLimits429 += count;
    else h.otherErrors += count;
    byHostMap.set(host, h);
  }

  for (const [host, hits] of negCacheHits) {
    const h = byHostMap.get(host) ?? { total: 0, rateLimits429: 0, otherErrors: 0, negCacheHits: 0 };
    h.negCacheHits = hits;
    byHostMap.set(host, h);
  }

  return {
    windowStartedAt: new Date(startedAt).toISOString(),
    totalFailures: Array.from(counts.values()).reduce((a, b) => a + b, 0),
    totalNegativeCacheHits: Array.from(negCacheHits.values()).reduce((a, b) => a + b, 0),
    byHost: Array.from(byHostMap.entries())
      .map(([host, v]) => ({ host, ...v }))
      .sort((a, b) => b.total - a.total),
    byHostStatus: byHostStatus.sort((a, b) => b.count - a.count),
    recent: recent
      .slice()
      .reverse()
      .slice(0, 50)
      .map((f) => ({
        ts: new Date(f.ts).toISOString(),
        host: f.host,
        endpoint: f.endpoint,
        status: f.status,
        ...(f.message ? { message: f.message } : {}),
      })),
  };
}
