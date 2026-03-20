# Distribution Copy — Stock Research Pivot

_Created 2026-03-20. Use this for MCP registry listings, directory submissions, and outreach._

---

## MCP Directory Descriptions

### Short (1 line — for registry listings, tags, etc.)
AI-powered stock research for agents and investors — investment thesis, earnings analysis, insider signal, valuation snapshot, bear-vs-bull. Live data synthesized by Claude. $0.05/call.

### Medium (2-3 sentences — for Smithery, PulseMCP, Glama)
Agent Toolbelt gives AI agents and investors live stock research — five focused tools that pull real financial data from Polygon, Finnhub, and FMP, then synthesize it with Claude into structured JSON analysis. Get a full investment thesis (bullish/neutral/bearish verdict + paragraphs), earnings beat-rate history, insider signal interpretation, a valuation snapshot with buy zone, and a steelmanned bear-vs-bull case. $0.05/call, 1,000 free/month. Works via MCP, REST API, or TypeScript SDK.

### Long (for Smithery "about" section, PulseMCP description)
Agent Toolbelt is a per-call API of AI-powered stock research tools — think Motley Fool-style analysis delivered as structured JSON, ready for any agent or research pipeline.

**Five tools:**
- **stock-thesis** — full investment thesis: bullish/neutral/bearish verdict, 2-3 paragraph analysis, key strengths, risks, valuation read, insider interpretation, what to watch next earnings
- **earnings-analysis** — EPS beat/miss history across 12 quarters, revenue trend classification, long-term consistency read
- **insider-signal** — interprets Form 4 filings: distinguishes meaningful open-market purchases from routine option exercises and tax-withholding sales → strong_buy to strong_sell signal + confidence rating
- **valuation-snapshot** — P/E, P/S, EV/EBITDA, FCF yield, ROE, net margin → cheap/fair/expensive verdict + specific buy zone
- **bear-vs-bull** — steelmans 3 bull + 3 bear arguments with real data, delivers a net verdict and the key question investors need to answer

**Data sources:** Polygon.io (company overview, price), Finnhub (metrics, insider trades, analyst ratings, earnings calendar), Financial Modeling Prep (income statements, key metrics TTM). All fetched in parallel per call.

**Pricing:** $0.05/call on PAYG (prepaid credits). Free tier: 1,000 calls/month, no credit card required.

**Try it live:** Type any US ticker at elephanttortoise.com — valuation snapshot, no signup.

---

## Smithery — How to update

Smithery reads the MCP server's tool list directly (auto-generates from the manifest). The tool descriptions shown on Smithery come from the MCP server's `description` fields in `mcp-server/src/index.ts`. To update the Smithery listing:

1. Log in at smithery.ai → find Agent Toolbelt listing
2. Update the "About" / server description manually in the Smithery dashboard
3. Or: republish the MCP server package (`npm publish` from `mcp-server/`) — Smithery re-scans on new versions

**Updated "About" text for Smithery dashboard:**
> AI-powered stock research tools for agents and investors. Five focused tools — investment thesis, earnings analysis, insider signal interpretation, valuation snapshot, and bear-vs-bull case — that pull live data from Polygon, Finnhub, and FMP and synthesize it with Claude into structured JSON analysis. $0.05/call, 1,000 free/month. Try it: elephanttortoise.com

---

## PulseMCP — How to update

1. Go to pulsemcp.com → find your listing (search "agent-toolbelt")
2. Click "Claim" or "Edit" if available
3. Update description with the Medium copy above

---

## Glama — How to update

1. Go to glama.ai/mcp/servers → find agent-toolbelt
2. Submit an update or contact via their form
3. Use the Medium copy above

---

## Official MCP Registry (registry.modelcontextprotocol.io)

The registry reads from the npm package metadata and GitHub repo description. To update:
1. Update GitHub repo description: "AI-powered stock research tools for agents and investors — investment thesis, earnings analysis, insider signal, valuation snapshot, bear-vs-bull. Claude + live financial data."
2. Update `mcp-server/package.json` description field
3. Republish to npm

---

## Toolhouse.ai Outreach Email

**To:** hello@toolhouse.ai
**Subject:** Agent Toolbelt — 5 AI-powered stock research tools, interested in Toolhouse adapter

---

Hi Toolhouse team,

I'm Matt, the builder behind Agent Toolbelt — a per-call API of AI-powered stock research tools for agents and investors.

**Five focused tools ($0.05/call):**
- **stock-thesis** — full investment thesis: bullish/neutral/bearish verdict, thesis paragraphs, key strengths, risks, valuation read, insider interpretation
- **earnings-analysis** — EPS beat/miss history across 12 quarters, revenue trend, long-term consistency read
- **insider-signal** — Form 4 interpretation: open-market purchases vs. routine noise → strong_buy to strong_sell signal + confidence rating
- **valuation-snapshot** — P/E, P/S, EV/EBITDA, FCF yield, ROE → cheap/fair/expensive verdict + specific buy zone
- **bear-vs-bull** — 3 bull + 3 bear arguments steelmanned with data, net verdict, key debate question

Each pulls live data from Polygon.io, Finnhub, and Financial Modeling Prep in parallel and synthesizes it with Claude Haiku. Structured JSON output, ~5 seconds per call.

**Links:**
- API: https://agent-toolbelt-production.up.railway.app
- npm SDK: `npm install agent-toolbelt`
- MCP server: `npm install agent-toolbelt-mcp`
- Try live: elephanttortoise.com (valuation snapshot, no signup)
- Free tier: 1,000 calls/month, no credit card

I'd like to build a Toolhouse adapter using `@th.register_local_tool()`. Is there a standard pattern or docs I should follow? Happy to submit a PR to the Toolhouse tool registry if that's the right path.

Matt
hello@elephanttortoise.com

---

## Reddit karma-building strategy

Before posting any of the 4 subreddit posts, comment genuinely in these threads first to build credibility:

**r/ValueInvesting:**
- Comment on stock analysis threads with your actual views (not product mentions)
- Share Motley Fool-style fundamental takes — this is the audience
- Goal: 50+ karma before posting

**r/algotrading:**
- Comment on fundamental analysis / data API threads
- Mention Polygon/Finnhub/FMP experience naturally
- Goal: 30+ karma before posting

**r/ClaudeAI:**
- Comment on MCP threads, tool-building threads — this is friendly territory
- Can mention the project earlier (lower bar)
- Goal: 10+ karma before posting

**r/LocalLLaMA:**
- Comment on agent/tool threads, architecture discussions
- Technical audience — the Promise.all + plain-text context design is interesting to them
- Goal: 20+ karma before posting

**HN — no karma needed for comments:**
- Drop the HN comment templates into active "what MCP servers are you using?" and investing/AI threads
- These can go immediately — no karma requirement for comments
