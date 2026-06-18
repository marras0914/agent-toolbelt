# System Patterns

## Adding a new tool
1. Create src/tools/<name>.ts — call registerTool() at bottom
2. Import in src/index.ts as side-effect: import "./tools/<name>"
3. Add to openapi/openapi-gpt-actions.json
4. Add typed method to sdk/src/client.ts
5. Add DynamicStructuredTool to sdk/src/langchain.ts
6. Add tool to mcp-server/src/index.ts
7. Rebuild SDK: cd sdk && npm run build

## Tool pattern
```ts
const tool: ToolDefinition<Input> = {
  name: "tool-name",          // slug used in URL: /api/tools/tool-name
  description: "...",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: [...],
    pricing: "$0.001 per call",
    pricingMicros: 1_000,     // used for PAYG billing deduction
    exampleInput: { ... },
  },
};
```

## LLM tool pattern (Claude Haiku)
- Import Anthropic from "@anthropic-ai/sdk"
- Check config.anthropicApiKey at start of handler, throw if missing
- Use claude-haiku-4-5-20251001 model
- Strip markdown code fences from response before JSON.parse
- Unit tests: use it.skipIf(!process.env.ANTHROPIC_API_KEY) to skip in CI

## Stock analysis tool pattern
- Check API keys at start of handler (anthropicApiKey + whichever upstream sources you use)
- Import fetchers from `./_stock-fetchers` — DO NOT inline upstream fetch logic. The shared fetchers are typed, graceful (return {} or [] on any failure), and cached (**6-hour SQLite-backed cache** via `src/db/stock-cache.ts`, survives redeploys + a 5-min in-memory negative cache that circuit-breaks on 429/network failures).
- **Methodology guardrail:** do NOT silently fall back across methodologies (FMP TTM → Finnhub) — caused the MU P/E 99.7x bug. P/E/P/B from FMP TTM only; mark `unavailable` otherwise. Return a `metricSources` map so consumers see which methodology backs each value.
- Import `sane`, `fhPct`, `fmt`, `fmtPct`, `round1` from `./_stock-helpers`. Don't redefine.
- Import `parseLLMJson` from `./_llm-utils` for the Anthropic response — it strips markdown fences and falls back to extracting the first {...} block when Claude prepends preamble text.
- Capture `fetchedAt = new Date().toISOString()` before Promise.all
- Fetch all data sources in parallel via Promise.all
- Check hasData after fetches — throw if nothing came back (invalid ticker). Standard error message: `No data found for "${ticker}". Please verify the symbol.`
- Build a plain-text dataContext string for the Claude prompt (not JSON — more token-efficient)
- Claude prompt: Motley Fool style, respond with strict JSON schema. Use claude-haiku-4-5-20251001.
- max_tokens: 1024 for simple schemas (insider-signal, earnings-analysis), 1500 for moderate (moat-analysis, valuation-snapshot), 2048 for multi-ticker or many-output (stock-thesis, compare-stocks, bear-vs-bull) — bear-vs-bull and compare-stocks specifically need 2048 because they generate ~3+3 arguments / per-ticker breakdowns and 1500 occasionally truncated.
- Return structured result + dataSnapshot/metrics + dataSources
- dataSources shape: `{ fetchedAt, polygon: {success}, finnhub: {success}, fmp: {success} }` (compare-stocks: same shape per-ticker under `dataSources.perTicker`)
- See src/tools/moat-analysis.ts for a minimal reference implementation post-refactor.

## Shared stock modules (added 2026-04-30)
Three internal-only modules (underscore prefix) that all 7 stock tools import from:

- **`src/tools/_stock-fetchers.ts`** — typed fetchers for Polygon (overview, prevClose), FMP (key-metrics-ttm, ratios-ttm, income-statement, earnings), Finnhub (metric, recommendation, insider-transactions, insider-sentiment, calendar/earnings). Each is graceful and cached: **6-hour SQLite-backed cache** (`src/db/stock-cache.ts`, survives redeploys) + a 5-min in-memory negative cache (circuit breaker on 429/network). `safeJson` records non-2xx upstreams into `src/upstream-health.ts` (`GET /admin/upstream-health`, `upstreamCapExceeded` = 402+429). Defines minimal response interfaces for type safety.
- **`src/tools/_stock-helpers.ts`** — sane(v, min, max), fhPct(v) (Finnhub-percentage to decimal), fmt(v, suffix, decimals), fmtPct(v), round1(v).
- **`src/tools/_llm-utils.ts`** — parseLLMJson(rawText). Strips markdown fences first; falls back to first {...} block if JSON.parse fails (handles Claude preamble text).

When the next FMP/Polygon/Finnhub API change happens, the fix is one file, not 5+. The recent FMP v3→/stable/ migration is the load-bearing example of why this matters.

## FMP /stable/ endpoint conventions (post-2025-08-31 migration)
**FMP shut down all v3 legacy endpoints on 2025-08-31.** Tools that haven't migrated will silently 403. Use `/stable/` paths only.

URL shape change: `/api/v3/<endpoint>/<TICKER>?...` → `/stable/<endpoint>?symbol=<TICKER>&...`

Field renames:
- `peRatioTTM` (was in key-metrics-ttm) → `priceToEarningsRatioTTM` (now in ratios-ttm)
- `priceToSalesRatioTTM` (was in key-metrics-ttm) → also moved to ratios-ttm
- `pbRatioTTM` → `priceToBookRatioTTM` (in ratios-ttm)
- `evToEbitdaTTM` → `evToEBITDATTM` (capitalized; still in key-metrics-ttm)
- `roeTTM` → `returnOnEquityTTM` (in key-metrics-ttm or ratios-ttm)
- `roicTTM` → `returnOnInvestedCapitalTTM` (in key-metrics-ttm)
- `debtToEquityTTM` / `debtEquityRatioTTM` → `debtToEquityRatioTTM` (in ratios-ttm)
- `actualEarningResult` → `epsActual` (in /stable/earnings)
- `estimatedEarning` → `epsEstimated`
- `s.netIncomeRatio` no longer in income-statement → compute as `s.netIncome / s.revenue`
- `s.calendarYear` → `s.fiscalYear`

Practical implications:
- If a tool uses peRatioTTM/priceToSalesRatioTTM, it now needs to fetch `/stable/ratios-ttm` (those moved out of key-metrics-ttm). stock-thesis and bear-vs-bull added a `fetchFMPRatiosTTM` helper.
- **Limit param capped at 5** on current FMP plan (was 12 on v3). Hard 402 if exceeded.
- Reference: see commit 5e5a8a1 for the full migration.

## Testing stock tools
- Tests in src/__tests__/tools/stock-tools.test.ts
- Schema validation tests always run (no API keys needed)
- Live integration tests: `it.skipIf(!hasStockKeys)(...)` — skipped in CI
- hasStockKeys = all 4 env vars present (ANTHROPIC, POLYGON, FINNHUB, FMP)
- Use NVDA/AAPL/GOOG as test tickers (known good data)

## Per-tier config — single source of truth (2026-06-08)
- **Edit `src/tiers.ts` ONLY** (the `TIERS` map) for per-tier limits/prices/quotas. Auth, billing, stock-rate-limit, and the quota check all read from it. Previously-duplicated maps drifted and silently capped a tier at the free limit. A regression test asserts `checkTierLimit` agrees with `TIERS`.
- `TIERS[t].watchlistMonitoring` gates the paid Watchlist Monitor (pro/starter/enterprise).
- **NOT driven by TIERS:** landing pricing cards (`public/index.html`), `terms.html`, checkout-modal subtitles, auth-nudge copy — a price/quota change needs manual edits there too.

## Email — Resend (migrated from SendGrid 2026-06-09)
- `RESEND_API_KEY`. From `hello@agenttoolbelt.live` (domain verified in Resend), Reply-To `hello@elephanttortoise.com` (the From domain sends but has NO inbox). `EMAIL_FROM`/`EMAIL_REPLY_TO` env vars.
- Resend keys + domains are per-*team* — verify the domain in the same team the key belongs to.
- Monitor send health: `GET /admin/email-health`.

## Deployment
- Railway auto-deploys on push to master via GitHub
- If auto-deploy seems stuck: MSYS_NO_PATHCONV=1 railway up --detach
- DO NOT use railway redeploy (redeploys without rebuilding)
- DB volume: auto-detected persistent volume; survives deploys. Do NOT set DATABASE_PATH on Railway — auto-detection handles it.
- DB_PATH exported from src/db/index.ts, shown in startup banner

## RapidAPI gateway (buyer channel, 2026-06-16)
- All RapidAPI traffic runs as ONE shared enterprise client `rapidapi-gateway@agenttoolbelt.live` (`src/rapidapi-gateway.ts`). In `authenticate()`, a request whose `x-rapidapi-proxy-secret` matches `RAPIDAPI_PROXY_SECRET` is trusted and run as that client — no `atb_` key needed.
- **Stateless tools only:** only the 8 stock-analysis tools belong on RapidAPI; stateful per-user endpoints (`/api/watchlists*`) + utility tools stay OFF (shared gateway = no per-buyer identity). Don't re-add watchlist CRUD if the OpenAPI spec gets re-imported.

## CI/CD
- GitHub Actions: type check → unit tests → build → smoke test → Docker push (GHCR)
- Smoke test uses token-counter (not schema-generator — requires ANTHROPIC_API_KEY)
- Docker push only happens after CI passes
- Railway auto-deploy uses builder=dockerfile directly, does NOT wait for CI

## Railway CLI gotchas (Windows MINGW)
- Prefix path args with MSYS_NO_PATHCONV=1
- railway variables truncates — use --json flag
- railway link syntax: railway link -p <project-id> -e production
- Bash variable assignment drops values with special chars — use python subprocess
- railway logs default scope is small; use `--since 7d --json` for historical pulls

## Admin
- All admin routes: Authorization: Bearer <ADMIN_SECRET>
- Get secret: railway variables --json | python3 -c "import sys,json; print(json.load(sys.stdin)['ADMIN_SECRET'])"
- Key rotation: POST /admin/clients/:id/keys

## Registration attribution (2026-04-29)
- POST /api/clients/register logs `[register] <email> | referer=<r> | ua=<ua> | ip=<ip>` on every successful registration
- Pull attribution data: `railway logs --since 7d --filter "[register]"`
- Note: pre-2026-04-29 registrations have NO attribution data (logging didn't exist yet)

## MCP CTA visibility (lessons from v1.0.10 fix)
**npm postinstall is the wrong place for any user-facing CTA in an MCP package.**
- Default `npm install <pkg>`: postinstall stdout silently swallowed by npm 7+
- Global `npm install -g <pkg>`: same
- `npx -y <pkg>` (used by Claude Desktop / Claude Code MCP launchers): postinstall doesn't run at all
- `npm install --foreground-scripts`: visible (rare power-user flag)

Working CTA placements for MCP packages:
1. Stderr banner on server startup (visible in MCP client logs)
2. Error message thrown back through the MCP protocol on tool calls (LLM surfaces to user)
3. README — keep "Get a key" step BEFORE install commands

See mcp-server/src/index.ts for current implementation.
