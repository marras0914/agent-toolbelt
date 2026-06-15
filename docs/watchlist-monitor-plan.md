# Watchlist Monitor — build plan

**Goal:** turn the manual watchlist-polling behavior (the dominant observed usage) into a paid "watchdog" — the product checks a saved watchlist on a schedule and reports what changed. Monitoring is the recurring value, gated to Pro. This is the conversion mechanism for the $10 tier.

## Locked decisions (2026-06-14)
1. **Gating:** scheduled monitoring + alerts require a subscription tier (pro/starter/enterprise). Free/PAYG can save a watchlist and run `watchlist-scan` on demand, but not monitoring. Encoded in `src/tiers.ts` (`watchlistMonitoring` flag).
2. **Delivery:** email digest via Resend (push) + stored alerts (pull endpoint). Email only sends when there are changes.
3. **v1 alert types:** (a) new insider open-market buy, (b) earnings within 7 days, (c) valuation entered buy zone.
4. **Cadence:** daily, ~23:00 UTC (post US close). Re-arming setTimeout, prod-gated — same pattern as `src/jobs/warm-cache.ts`.

## Data model (src/db/watchlists.ts, same migration style as stock-cache.ts)
- **watchlists** — id, client_id (FK), name, tickers (JSON), email_alerts, created_at, updated_at
- **watchlist_state** — watchlist_id, ticker, last_insider_buy_date, last_earnings_date, last_valuation_verdict, last_price, checked_at (the "what we last saw" memory for change detection)
- **watchlist_alerts** — id, watchlist_id, ticker, type, message, created_at, delivered

## Phase 1a — stateful watchlists (foundation, no monetization risk)
- `watchlists` table + CRUD functions.
- Tier fields in `src/tiers.ts`: `watchlistMonitoring: boolean`, `maxWatchlists: number`, `maxWatchlistTickers: number`.
- Authed CRUD endpoints: POST/GET(list)/GET(one)/PATCH/DELETE `/api/watchlists`, scoped to the client, with ticker validation (usTickerSchema) + tier caps.
- Tests: CRUD scoping, caps, ticker validation.

## Phase 1b — monitoring (the paid value)
- `watchlist_state` + `watchlist_alerts` tables + functions.
- `src/jobs/watchlist-monitor.ts` — daily job (prod-gated). Dedupe tickers across all *monitored* watchlists, fetch each unique ticker once (cache-friendly), run the 3 rule-based detectors on cached data, write alerts, update state.
- Gating: only watchlists owned by `watchlistMonitoring: true` tiers are monitored.
- Resend digest email (sendWatchlistDigest) — one LLM call per user-with-changes to narrate, not per ticker.
- `GET /api/watchlists/:id/alerts` (pull). Admin `GET/POST /admin/watchlist-monitor`.
- Tests: detector logic (state in → alerts out), gating.

## Phase 2 — distribution + depth
- MCP tools (create_watchlist, watchlist_alerts) + SDK methods + OpenAPI entries.
- More alert types (price move, analyst change), per-watchlist config (cadence/thresholds/email toggle).

## Phase 3 — moat
- Verdict track record tie-in; richer digests.

## COGS guardrails
- Dedupe tickers across watchlists → cost scales with unique tickers, not watchlist count.
- Detection is rule-based on the 6h-cached fetchers (≈ free). LLM only for the digest, once per user-with-changes.
- Tier caps bound the universe (maxWatchlists × maxWatchlistTickers). Overlaps with the warm-cache'd 50 popular tickers keep most fetches warm.
