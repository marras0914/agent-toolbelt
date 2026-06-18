# Product Context

## What it is
Agent Toolbelt — AI-powered stock research tools for agents and investors. Per-call billing. **28 tools total: 8 stock analysis + 20 utility.**
Positioning (as of 2026-06-16): **"The stock-research API you don't have to build — analysis, not raw data."** Returns Motley-Fool-style verdicts/theses, not raw market data.

## Production
- Canonical URL: **https://www.agenttoolbelt.live** (rebranded 2026-05-19; Railway URL still resolves)
- Railway project ID: d345a508-2557-453d-953c-3acd1ae26568
- GitHub: https://github.com/marras0914/agent-toolbelt
- Auto-deploys on push to master via GitHub integration
- Persistent SQLite volume (auto-detected; do NOT set DATABASE_PATH on Railway)
- Stripe Checkout LIVE since 2026-05-19 (PAYG packs + subscriptions)
- Terms & Privacy at /terms (operator: Elephant Tortoise LLC)
- Analytics: Plausible (agenttoolbelt.live + elephanttortoise.com)
- Email: **Resend** (migrated from SendGrid 2026-06-09 after trial died). From `hello@agenttoolbelt.live`, Reply-To `hello@elephanttortoise.com`

## Stock analysis tools (8 — primary focus, $0.02/call except watchlist-scan $0.05)
pricingMicros 20_000 (repriced from $0.05 on 2026-06-03), watchlist-scan 50_000.
- **stock-thesis** — full investment thesis: verdict, thesis, strengths, risks, valuation, insider/analyst read, watchFor
- **earnings-analysis** — EPS beat/miss history, revenue trend, upcoming earnings date
- **insider-signal** — Form 4 interpretation: open-market buys vs noise, signal + confidence
- **valuation-snapshot** — P/E, P/S, EV/EBITDA, FCF yield, ROE → verdict + buy zone. Returns a `metricSources` map (fmp_ttm/finnhub_ttm/finnhub_annual/unavailable)
- **bear-vs-bull** — steelmanned bull + bear args, net verdict, key debate (max_tokens fixed at 2048 — truncates below)
- **compare-stocks** — head-to-head 2-3 ticker comparison: winner, per-ticker strengths/concerns, ifYouValue map
- **moat-analysis** — Buffett-style competitive moat: rating (wide/narrow/none), sources, durability, threats
- **watchlist-scan** (added 2026-06-11, $0.05) — rank 2-15 tickers by value/quality/growth/income in ONE Claude call: ranked list, topPick, avoid, takeaway

All stock tools share three internal modules: `_stock-fetchers.ts` (typed Polygon/Finnhub/FMP fetchers + **6-hour SQLite-backed cache** via `src/db/stock-cache.ts` + 5-min in-memory negative cache circuit breaker), `_stock-helpers.ts`, `_llm-utils.ts` (parseLLMJson).

**Methodology guardrail:** don't silently fall back across methodologies (e.g. FMP TTM → Finnhub) — produced the MU P/E 99.7x bug. P/E and P/B from FMP TTM only; mark `unavailable` otherwise. `metricSources` tags each value.

## Watchlists (stateful — NOT on RapidAPI)
- Saved watchlists: `/api/watchlists` CRUD, client-scoped, tier-capped
- **Watchlist Monitor** (the paid "watchdog", shipped 2026-06-14/15): daily 23:00 UTC job runs 3 rule-based detectors (new insider buy / earnings ≤7d / ≥10% daily move) on cached data, writes alerts, emails a Resend digest. **Gated to pro/starter/enterprise** via `TIERS[t].watchlistMonitoring` — the concrete recurring reason to pay $10. Not yet validated against a real Pro watchlist.

## Utility + LLM tools (20)
schema-generator ($0.005), text-extractor, cron-builder, regex-builder, brand-kit, markdown-converter, url-metadata, token-counter, csv-to-json, address-normalizer, color-palette, image-metadata-stripper, meeting-action-items ($0.05), prompt-optimizer ($0.05), contract-extractor, document-comparator, api-response-mocker ($0.0005), context-window-packer ($0.001), dependency-auditor ($0.005), web-summarizer ($0.02)

## LLM-powered tools
All stock tools + schema-generator, meeting-action-items, prompt-optimizer, web-summarizer → Claude Haiku (claude-haiku-4-5-20251001) via @anthropic-ai/sdk

## Stock data APIs
- Polygon.io — company overview, prev close (POLYGON_API_KEY)
- Finnhub — metrics, recommendations, insider transactions, earnings calendar (FINNHUB_API_KEY)
- Financial Modeling Prep — income statements, key metrics TTM, ratios TTM, earnings (FMP_API_KEY)
  - **Plan: Starter ($14/mo, 750 calls/day) since 2026-05-22** (free→Starter after the MU P/E bug exposed the cap). **Use /stable/ endpoints only** (v3 died 2025-08-31). Limit param capped at 5. FMP returns 402 (not 429) over-plan.
  - **Daily cache warmer at 00:30 UTC** (`src/jobs/warm-cache.ts`) — 50 popular tickers × 3 endpoints = ~150 calls/run. Admin: `GET/POST /admin/warm-cache`.

## Billing tiers (single source of truth: `src/tiers.ts` — TIERS map)
- **free: 250 calls/month** (lowered from 1,000 on 2026-06-12), 10 req/min, rolling 30-day window
- **payg:** prepaid credits ($5/$10/$25/$50), 60 req/min, **$0.02/stock call** (cut from $0.05 on 2026-06-03)
- **pro: $10/mo, 1,000 calls, 30 req/min** (renamed from "hobby" 2026-06-08; old $99 pro DELETED). Stripe price env `STRIPE_PRICE_HOBBY`.
- **starter: $29/mo, 4,000 calls. enterprise: $499/mo, 75,000 calls.** (quotas repriced down 2026-06-16 to stay above COGS)
- Landing pricing cards (`public/index.html`) + `terms.html` + checkout-modal subtitles + auth nudge copy are hand-maintained — NOT driven by TIERS; a price/quota change needs manual edits there too.

## npm packages
- **agent-toolbelt v0.6.0** — typed SDK + LangChain wrappers (all 8 stock tools + watchlist CRUD methods). Published 2026-06-15.
- **agent-toolbelt-mcp v1.0.15** — MCP server (all 8 stock tools + watchlist tools). Published 2026-06-15.
- npm publish gotcha: E404 "do not have permission" while logged in = expired/single-use OTP, not a real perm issue. Retry with a FRESH --otp, no rebuild.

## Registration & self-serve
- POST /api/clients/register ({email, name?, source?}) — attribution logged `[register]`. Web page /register. Guest try POST /api/try/:toolName (10/IP/day).
- Onboarding email: no key in email (prefix only), leads with stock-thesis curl
- **Self-serve key reissue (shipped 2026-06-11):** `/reissue` page + magic-link revoke-and-replace flow. Point lost-key replies here.

## Distribution (as of 2026-06-18)
- **RapidAPI: ✓ Live** under "Agent Toolbelt" org — `https://rapidapi.com/agent-toolbelt-agent-toolbelt-default/api/agent-toolbelt1`. 8 stateless stock tools only. Auth via `x-rapidapi-proxy-secret` → seeded enterprise `rapidapi-gateway` client (no atb_ key). RapidAPI pricing (separate from Stripe): free 25 / Pro $19·1k / Ultra $59·5k / Mega $199·25k.
- **RapidAPI = stateless tools only** — watchlist CRUD + utility tools stay OFF (shared gateway client has no per-buyer identity)
- npm (SDK + MCP), MCP directories (PulseMCP, official registry, Smithery, Glama ✓), landing pages (elephanttortoise.com), blog posts 1-5 + post-7
- post-7 published: marcoarras.com (canonical) + dev.to + Medium (all canonicals correct)
- Awesome lists: 5 PRs open (public-apis #6340, awesome-quant #425, marcelscruz #950, public-api-lists #513, moov-io/awesome-fintech #92)
- Reddit: r/LocalLLaMA ✓, r/SideProject ✓, r/ValueInvesting ✓; r/mcp ✓
- Product Hunt (2026-04-02) + HN (2026-03-09): both flopped, not growth channels
- Cordon cross-promo: live in onboarding email + /register page
- **131 registrations, ~3,540 calls/30d, 24 unique clients. MRR: $0.**
