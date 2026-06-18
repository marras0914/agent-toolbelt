# Active Context

## Current state (2026-06-18)
- **~131 total registrations** (~129 real), steady ~1/day organic
- **API calls: ~3,540 (last 30 days), 24 unique clients** (rolling window)
  - Tool mix: stock-thesis ~1,800, valuation-snapshot ~1,120, insider-signal ~645, bear-vs-bull ~236, earnings-analysis ~64, moat-analysis ~32
  - Cache hit rate ~14% global (24h response cache + 6h fetch cache)
- **80% of all calls = 2 whales:** Filip.Kubak@gmail.com (~1,751 calls, over free cap, pitched $10 Pro directly — went non-responsive) + paulosouzajms@gmail.com (~1,380 calls, stuck retry loop, not a lead)
- npm: SDK v0.6.0, MCP v1.0.15 — ~810/mo SDK + 200-280/day MCP installs
- Tools: **28 live** (8 stock analysis + 20 utility)
- **MRR: $0** (only Marco's own $5 payg self-test). No Pro conversions yet.
- Out-of-pocket ~$30-40/mo (Anthropic + FMP Starter $14 + Railway; email now $0 on Resend)

## Strategic position
- **Pivot 1 (2026-03-18):** generic utility tools → LLM-powered stock research analysis ("analysis, not raw data")
- **Pivot 2 / buyer-channel pivot (2026-06-16):** after diagnosing **conversion (willingness-to-pay), not product, as the bottleneck** ($0 MRR despite a genuinely-used product; Filip non-responsive to a $10 pitch), repositioned to **"the stock-research API you don't have to build"** and pushed into buyer-rich channels (RapidAPI). See [[project-buyer-channel-pivot-2026-06-16]].

## What just shipped (this session, 2026-06-18)
- **RapidAPI org conversion** — converted personal account → Organization "Agent Toolbelt" (free, ≤5 seats, no card) so the listing's provider name reads "Agent Toolbelt" not "arrasmarco". Transfer mangled the URL handle into `agent-toolbelt-agent-toolbelt-default` (org-slug + auto `-Default` team); slug is NOT cleanly editable, decided to keep it. New listing URL: `https://rapidapi.com/agent-toolbelt-agent-toolbelt-default/api/agent-toolbelt1`
- **RapidAPI gateway re-verified** — origin proxy-secret path works end-to-end (POST /api/tools/valuation-snapshot with only `x-rapidapi-proxy-secret`, no atb_ key → success + analysis as enterprise gateway client)
- **Listing URL swept** to the new org URL across CLAUDE.md, blog/post-7, blog/rapidapi-distribution.md, and the marcoarras.com post (separate `marcoarras-site` repo, pushed)
- **post-7 crossposted** to dev.to ([live](https://dev.to/marras0914/the-stock-analysis-api-you-dont-have-to-build-2jcc), canonical → marcoarras.com confirmed on-page) + Medium ([live](https://medium.com/@arras.marco/the-stock-analysis-api-you-dont-have-to-build-822044fdd5db), import-by-URL auto-canonical)
- **RapidAPI editorial-collection email SENT** (support@rapidapi.com — fire-and-forget, no SLA)
- **2 fork PRs fired:** marcelscruz/public-apis [#950](https://github.com/marcelscruz/public-apis/pull/950), public-api-lists/public-api-lists [#513](https://github.com/public-api-lists/public-api-lists/pull/513)
- **5th awesome-list PR fired:** moov-io/awesome-fintech [#92](https://github.com/moov-io/awesome-fintech/pull/92) (flagged as hosted/commercial since the section skews OSS). Scouted-and-skipped: 7kfpun/awesome-fintech (no API section), josephmisiti/awesome-machine-learning (ML libs/papers)

## Open distribution PRs (5, all awaiting merge)
- public-apis/public-apis [#6340](https://github.com/public-apis/public-apis/pull/6340) (slow backlog)
- wilsonfreitas/awesome-quant [#425](https://github.com/wilsonfreitas/awesome-quant/pull/425) (best odds)
- marcelscruz/public-apis #950, public-api-lists #513, moov-io/awesome-fintech #92

## Immediate TODOs / what to watch
1. **The signal that matters: a paying RapidAPI buyer** — the real test of the "audience won't pay" hypothesis the whole pivot was built to answer
2. **Watch the 5 awesome-list PRs** for merge (mechanical, no action)
3. **Watchlist Monitor not yet validated against a real Pro-client watchlist** — pipeline runs clean in prod but no paying client has a monitored watchlist yet
4. **Site's $10/10k Pro tier is underpriced** (~$0.001/call vs ~$0.007 COGS) — RapidAPI per-call pricing is the correct one; revisit site tier when convenient (note: subscription quotas were repriced down 2026-06-16: pro 10k→1k, starter 50k→4k, ent 5M→75k — now margin-positive)
5. **Distribution is otherwise EXHAUSTED** — listing live + repositioned + documented, editorial email sent, post-7 published 3 ways, 5 discovery PRs out. Remaining work is waiting on signal.
