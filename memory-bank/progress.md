# Progress

## Phase 1 — COMPLETE
Core API, auth, billing, tool registry, SQLite persistence

## Phase 2 — COMPLETE
SDK (npm), MCP server, OpenAPI spec, LangChain wrappers

## Phase 3 — IN PROGRESS
Distribution, first users, monetization

### Done (pre-pivot)
- 20 generic tools live (utilities + LLM wrappers)
- PAYG tier + Stripe billing
- Guest try endpoint (/api/try/:toolName)
- Pricing hidden from public catalog
- Landing pages (elephanttortoise.com) — 5 sites
- 4 blog posts (dev.to / Medium)
- HN Show HN posted 2026-03-09
- MCP directories: PulseMCP, Glama, official registry, Smithery
- RapidAPI listed
- 5 awesome list PRs submitted
- Postinstall registration prompts (SDK + MCP)
- /register web page
- schema-generator rewritten to LLM-powered
- Onboarding email security fix (no key in email)
- DB volume persistence fixed and verified (2026-03-18)
- CI green
- Cordon cross-promo live — onboarding email + /register success page

### Done (post-pivot, 2026-03-18 → 2026-03-22)
- **stock-thesis** — flagship tool, Motley Fool-style investment thesis
- **earnings-analysis** — EPS beat/miss + revenue trend + long-term read
- **insider-signal** — Form 4 interpretation, signal strength + confidence
- **valuation-snapshot** — multiples → cheap/fair/expensive + buy zone
- **bear-vs-bull** — steelmanned 3+3 arguments, net verdict
- pricingMicros: 50_000 on all 5 stock tools (PAYG billing correct)
- Landing page pivoted to stock research (headline, terminal demo, pricing)
- Docs page created — public/docs.html with real request/response examples for all 5 tools
- SDK v0.3.0 published — all 5 stock methods + LangChain wrappers
- MCP v1.0.5 published — all 5 stock tools
- MCP v1.0.6 published — README rewritten for stock pivot
- Blog post 5 published on Medium ✓ + dev.to ✓
- Reddit posts written (4 subreddits + 3 HN templates + r/SideProject)
- r/LocalLLaMA posted ✓ (2026-03-20)
- r/SideProject posted ✓ (2026-03-20) — 2 comments received
- Toolhouse.ai email sent ✓ (2026-03-20)
- **Provenance trail** — all 5 stock tools return dataSources with fetchedAt + per-API success flags
- **Stock tool tests** — 20 tests added (schema validation always runs; live integration tests skip in CI)

### Done (2026-03-23)
- r/ValueInvesting posted ✓ (rewrite cleared automod)
- r/ClaudeAI posted ✓
- Glama.ai listing claimed
- 5 organic registrations received
- 2 first real API calls

### Done (2026-03-29 – 2026-03-30)
- **Glama fixed + live** — _isMain bug (path check failed on npm global bin symlinks); fixed to `!!import.meta.url`
- **MCP v1.0.8 / v1.0.9** — _isMain fix + LICENSE + README link update
- **Smithery updated** — rebuilt shttp bundle; now shows 5 stock tools

### Done (2026-04-02 — Product Hunt launch)
- Product Hunt launched 12:01 AM PDT
- **Result: 0 upvotes, flopped** — big launch platforms don't work for niche dev tools; organic + MCP directories are the real channel

### Done (2026-04-10 — onboarding fix)
- Onboarding email rewritten to lead with stock-thesis curl example, all 5 stock tools listed, SDK example uses stockThesis. Subject: "Your API key — try analyzing AAPL first"
- Registration success page rewritten — click-to-copy curl pre-filled with user's API key, copy buttons for all 5 stock tools
- 7 new signups on Apr 10 alone (best day ever) — source unattributable

### Done (2026-04-30 — new tools + refactor + cache)
- **source= attribution param** (commit c53a32d) — POST /api/clients/register accepts `?source=` query/body. Tagged curls in npm README (`?source=npm`), MCP banner (`?source=mcp_banner`), postinstall (`?source=postinstall`).
- **compare-stocks + moat-analysis tools** (commit 84ee447) — two new $0.05/call stock tools. Wired through API + SDK + LangChain + MCP. Bumped mcp-server to v1.0.12.
- **Code-review fixes** (commit 31e1994) — eliminated duplicate metric computation in compare-stocks, added {...} parser fallback to moat-analysis, bumped compare max_tokens 1500→2048.
- **Refactor: shared stock modules** (commit 702e43e) — extracted `_stock-fetchers.ts`, `_stock-helpers.ts`, `_llm-utils.ts`. All 7 stock tools now import from these. -598/+475 lines net (-123 net) across the 7 tool files. Removed `as any` casts in favor of typed fetcher returns.
- **Peacock workspace color** (commit e0b71c9) — `.vscode/settings.json` with medium-gray.
- **5-min upstream API cache** (commit 8b74c56) — Map-based TTL cache wraps all 10 fetchers. 500-entry cap with FIFO eviction. Empty results not cached. Same-tool warm hit: ~1.1s saved.
- **MCP v1.0.11 published to npm** — source attribution tags now reach users. v1.0.12 (with new tools) bumped in source but not yet published.
- **dev.to comment posted** on "7 Best MCP Servers for Stock Market Data 2026". Author Kevin replied positively next day.

### Done (2026-04-29 — FMP migration + attribution + CTA fix)
- **FMP /stable/ endpoint migration** (commit 5e5a8a1) — all 4 FMP-using tools (earnings-analysis, valuation-snapshot, stock-thesis, bear-vs-bull) migrated from v3 (403 since Aug 2025) to /stable/. URLs changed from path-based ticker to `?symbol=` query param; field renames: `peRatioTTM` moved to ratios-ttm as `priceToEarningsRatioTTM`, `pbRatioTTM` → `priceToBookRatioTTM`, `evToEbitdaTTM` → `evToEBITDATTM`, `roeTTM` → `returnOnEquityTTM`, `debtEquityRatioTTM` → `debtToEquityRatioTTM`, `actualEarningResult` → `epsActual`, `estimatedEarning` → `epsEstimated`. `s.netIncomeRatio` no longer exists — derive from `s.netIncome / s.revenue`. `s.calendarYear` → `s.fiscalYear`. limit param capped at 5 on /stable/ (was 12 on v3). Verified end-to-end via remote agent against prod.
- **Registration attribution logging** (commit 287d722) — `console.log("[register] <email> | referer=<r> | ua=<ua> | ip=<ip>")` added to POST /api/clients/register
- **MCP v1.0.10 published** (commit bca19eb) — three CTA-visibility fixes: stderr banner when AGENT_TOOLBELT_KEY unset, friendly registration hint on key-missing tool calls (401/403), README hoisted "Step 1: Get a free API key" above install commands
- **Auto-memory updated** with project_install_signup_leak.md learning

### Done — outreach
- openclaw.ai outreach — emailed in a prior session, got a polite reply but no conversion. Lesson: max-engagement signal (used all 5 tools) didn't predict paid conversion. Don't re-ping.

### Done (2026-05-19 → 2026-06-18 — monetization, infra, buyer pivot)
- **Stripe Checkout LIVE** (2026-05-19) — PAYG packs + subscriptions; first $5 self-test verified. Terms/Privacy at /terms. Plausible analytics wired.
- **FMP rate-limit mitigations** — SQLite-backed **6h fetch cache** + 5-min 429/circuit-breaker negative cache + per-client stock rate limit; `upstreamCapExceeded` counter (402+429). Upgraded FMP free → **Starter ($14/mo, 750/day)** after the MU P/E bug. Added **methodology guardrail + `metricSources`** tagging and a **daily 00:30 UTC cache warmer**.
- **$10 Pro tier shipped** (2026-06-03) + stock calls cut $0.05→$0.02 + 24h LLM response cache + tier-aware upgrade nudges. Renamed hobby→pro, deleted unused $99 pro, **consolidated all tier config into `src/tiers.ts`** (2026-06-08). Subscription quotas repriced down to be margin-positive (pro 10k→1k, starter 50k→4k, ent 5M→75k, 2026-06-16).
- **Email saga** (2026-06-09) — SendGrid had silently failed ~30 days; migrated to **Resend**, added `/admin/email-health` + `/admin/cap-watch`. **Self-serve key reissue** (`/reissue`, magic link).
- **watchlist-scan** (8th stock tool, 2026-06-11) across API + SDK + MCP + OpenAPI (now complete, all 28 tools). **Lowered free tier 1,000→250.**
- **Watchlist Monitor** (paid watchdog, 2026-06-14/15) — saved watchlists CRUD + daily 23:00 UTC detector job + Resend digest, gated to pro/starter/enterprise. NOT yet validated against a real Pro watchlist.
- **npm: SDK v0.6.0 + MCP v1.0.15 published** (2026-06-15) — watchlist methods/tools.
- **Buyer-channel pivot (2026-06-16):** diagnosed conversion (not product) as the bottleneck → repositioned "analysis not raw data", reframed landing hero, **RapidAPI proxy-secret gateway bypass** (channel finally collectable), relaunched RapidAPI listing.
- **2026-06-18 (this session):** RapidAPI org conversion → "Agent Toolbelt" provider (new URL `.../agent-toolbelt-agent-toolbelt-default/api/agent-toolbelt1`); gateway re-verified; URL swept across repo + marcoarras.com; post-7 crossposted to dev.to + Medium (canonicals correct); editorial-collection email sent; **5 awesome-list PRs open** (added marcelscruz #950, public-api-lists #513, moov-io/awesome-fintech #92).

### TODO — Distribution / what's left
- **Watch the 5 awesome-list PRs** for merge (public-apis #6340, awesome-quant #425, marcelscruz #950, public-api-lists #513, moov-io #92) — mechanical, no action
- **The signal that matters: a paying RapidAPI buyer** — distribution is otherwise exhausted
- Validate Watchlist Monitor against a real Pro-client watchlist (none exist yet)
- r/algotrading — blocked by karma, deferred

## Key metrics (as of 2026-06-18)
- Registrations: **~131** total (~129 real), steady ~1/day organic
- API calls (last 30 days): **~3,540**, 24 unique clients (rolling window)
  - stock-thesis ~1,800 | valuation-snapshot ~1,120 | insider-signal ~645 | bear-vs-bull ~236 | earnings-analysis ~64 | moat-analysis ~32
  - **80% of calls = 2 whales:** Filip (~1,751, over cap, non-responsive to $10 pitch) + Paulo (~1,380, stuck retry loop)
  - Cache hit rate ~14% global
- npm: ~810/mo (SDK) + 200-280/day MCP installs
- Tools: **28 total** (20 utility + 8 stock analysis)
- SDK: **v0.6.0** | MCP: **v1.0.15** | OpenAPI: complete (28 tools)
- Out-of-pocket: ~$30-40/mo (Anthropic + FMP $14 + Railway; email $0 on Resend)
- **MRR: $0** (only Marco's own $5 payg self-test; no Pro conversions yet)
