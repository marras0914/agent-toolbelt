# Agent Toolbelt — Roadmap & Revenue Strategy

_Last updated: 2026-03-19_

---

## Phase 1: Foundation ✓ COMPLETE
- 20 utility tools built and live
- Railway deployment with persistent SQLite volume
- Stripe billing (free, PAYG, starter/pro/enterprise tiers)
- Auth middleware, usage tracking, admin routes
- Guest try endpoint (10 calls/IP/day, no key required)

## Phase 2: Distribution ✓ COMPLETE
- npm: `agent-toolbelt` SDK + `agent-toolbelt-mcp` MCP server (~810 + 292 downloads/mo)
- RapidAPI listed
- MCP registries: registry.modelcontextprotocol.io, PulseMCP, Glama, Smithery ✓
- 5 per-tool landing pages on elephanttortoise.com ✓
- 5 blog posts published (dev.to + Medium) ✓
- HN Show HN posted 2026-03-09 ✓
- 5 awesome list PRs open ✓
- OpenAPI/GPT Actions spec served at `/openapi/openapi-gpt-actions.json`

---

## Pivot: Stock Research Tools (2026-03-18)

**Why we pivoted:**
- 0 organic registrations after HN, 4 blog posts, 5 awesome list PRs, npm packages with 1,100+ downloads/mo
- Generic utility tools have no pull — devs build them or find free alternatives
- Raw financial data MCP space is crowded (Alpha Vantage, Alpaca, FMP, EODHD all have MCP servers)
- **Gap**: LLM-powered stock analysis as a standalone API — Motley Fool-style output, not raw data
- Builder (Matt) enjoys stock picking and fundamental analysis → dogfood signal

**New positioning:** "Stock research tools for AI agents"
**Target user:** Retail investors building AI research agents

**5 stock analysis tools added ($0.05/call):**
| Tool | What it does |
|---|---|
| stock-thesis | Full investment thesis: verdict, strengths, risks, valuation, insider/analyst read |
| earnings-analysis | EPS beat/miss history (12Q), revenue trend, upcoming earnings date |
| insider-signal | Form 4 interpretation: signal (strong_buy → strong_sell) + confidence |
| valuation-snapshot | P/E, P/S, EV/EBITDA, FCF yield, ROE → verdict + buy zone |
| bear-vs-bull | 3 bull + 3 bear arguments (steelmanned with data), net verdict |

**Data sources:** Polygon.io + Finnhub + Financial Modeling Prep (all fetched in parallel)

---

## Phase 3: First Revenue — IN PROGRESS
**Goal: First paying users, $500/mo MRR**

### Status (as of 2026-03-19)
| Item | Status |
|---|---|
| 25 tools live (5 stock + 20 utility) | ✓ |
| Guest try endpoint | ✓ |
| Stock pivot blog post (post 5) | ✓ Published Medium + dev.to |
| MCP server v1.0.5 (all 5 stock tools) | ✓ Published |
| SDK v0.3.0 (all 5 stock tools) | ✓ Published |
| Onboarding email + Cordon cross-promo | ✓ Live |
| HN Show HN | ✓ Posted 2026-03-09 |
| Awesome list PRs (5 open) | ✓ Open — descriptions need stock pivot update |
| MCP registry listings (Smithery, PulseMCP, Glama) | ✓ Live — descriptions need stock pivot update |
| Reddit posts written (stock pivot framing) | ✓ Written — blocked by low karma |
| HN comment templates (3) | ✓ Written |
| Toolhouse.ai adapter | TODO — email hello@toolhouse.ai |
| Product Hunt launch | TODO — after first organic registrations |
| Update MCP directory descriptions | TODO |
| Update awesome list PR descriptions | TODO |

### Immediate TODO
1. **MCP listings** — update Smithery / PulseMCP / Glama / official registry descriptions for stock pivot
2. **Awesome list PRs** — update descriptions in open PRs for stock pivot
3. **Reddit** — build karma via comments, then post to r/ValueInvesting, r/algotrading, r/ClaudeAI, r/LocalLLaMA
4. **HN comments** — drop templates into active MCP/investing threads
5. **Toolhouse.ai** — email hello@toolhouse.ai, build thin adapter
6. **Product Hunt** — after first organic registrations

### Revenue Target: $500/mo MRR

---

## Phase 4: Scale
**Goal: $5,000-15,000/mo MRR**

### Growth levers
- Product Hunt launch (after first 5-10 registrations for social proof)
- Target Reddit communities: r/ValueInvesting, r/algotrading, r/SecurityAnalysis, r/stocks
- Reach out to finance/AI newsletter writers (newsletter placement)
- Enterprise outreach — AI teams at hedge funds, fintechs, trading desks
- Custom tool development for enterprise clients (bespoke analysis tools)
- Private/dedicated hosting option
- SLA + priority support tier

### New stock tools to consider
- **Portfolio analyzer** — analyze a list of tickers as a portfolio, correlation, sector concentration
- **Sector comparison** — compare 3-5 stocks in the same sector head-to-head
- **Earnings transcript summarizer** — ingest earnings call transcript, extract key guidance
- **News sentiment** — recent news headlines → sentiment signal + summary
- **DCF estimator** — rough discounted cash flow model from fundamentals
- **Short interest signal** — short % of float, days to cover, trend
- **Dividend analyzer** — yield, payout ratio, growth history, safety score

### Revenue Target: $5,000-15,000/mo

---

## Phase 5: Platform
**Goal: Third-party tool marketplace, $20,000+/mo**

- Allow other developers to publish tools on the platform
- 20-30% commission on third-party tool revenue
- Tool analytics dashboard for publishers
- Reputation/rating system
- White-label option for enterprises

---

## Revenue Model

### Subscription Tiers
| Tier | Monthly Fee | Included Calls | Overage |
|---|---|---|---|
| Free | $0 | 1,000 | Blocked |
| PAYG | $0 | Prepaid credits ($5/$10/$25/$50) | Pay as you go |
| Starter | $29 | 50,000 | $0.001/call |
| Pro | $99 | 500,000 | $0.0005/call |
| Enterprise | Custom | Unlimited | Volume pricing |

**Stock analysis tools: $0.05/call** (applies to PAYG; included in subscription call quotas)

### Revenue History
| Date | MRR | Registrations | Notes |
|---|---|---|---|
| 2026-03-10 | $0 | 0 | Distribution underway, utility tool framing |
| 2026-03-18 | $0 | 1 | Pivoted to stock research tools. 1 registration = test account only |
| 2026-03-19 | $0 | 1 | Post-pivot. Stock tools live + published. Awaiting organic traction |

### Conservative Projection (post-pivot)
| Month | Free Users | Paid Users | MRR |
|---|---|---|---|
| Mar '26 | 2 | 0 | $0 |
| Apr '26 | 10 | 1 | $29 |
| May '26 | 30 | 4 | $200 |
| Aug '26 | 100 | 20 | $1,500 |
| Mar '27 | 400 | 80 | $7,000 |
