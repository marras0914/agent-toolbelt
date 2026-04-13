# Reddit Posts

---

## ⚠️ Strategy note
Build karma before posting self-promotion. Comment genuinely on threads in each subreddit first.
For investing subreddits: lead with value and output quality — don't mention "API" in the title.
For dev subreddits: lead with the technical story.

---

## r/ValueInvesting

**Title:**
I built a tool that gives Claude real-time stock analysis — here's what it returned for NVDA

**Post:**
I invest using Motley Fool-style fundamental analysis — revenue growth, insider activity, whether a stock is cheap relative to quality. The problem is Claude can't see any live data. Its training cutoff means it can't tell you NVDA's current P/E, whether insiders are buying, or what last quarter's earnings meant.

So I built something that fixes that. It pulls live data from Polygon, Finnhub, and Financial Modeling Prep simultaneously, passes it to Claude for synthesis, and returns structured analysis. Here's what it actually produced for NVDA last week:

> *"Nvidia is in a rare position: it supplies the picks and shovels for an industry-wide megatrend. The company has grown revenue at a staggering 10,005% CAGR over three years... CUDA, its software platform, locks customers into its ecosystem. This network effect is Nvidia's moat."*

> **Insider read:** "Mixed signals: two executives bought ~47k shares each on March 9 (positive alignment), offset by routine selling from others — likely tax diversification rather than conviction-based."

> **Watch for:** "Data center revenue growth rate and gross margin in the next earnings report. If deceleration goes below 30% YoY, the boom is maturing faster than expected."

Five tools total: investment thesis, earnings beat/miss history across 12 quarters, insider signal interpretation, valuation snapshot, and a steelmanned bear-vs-bull case.

The insider signal one is the most interesting to me — it classifies Form 4 transactions and distinguishes open-market purchases (meaningful) from option exercises and tax-withholding sales (routine noise). Most tools just show you the raw filings.

Curious if others are building AI-assisted research workflows — what does your process look like?

**[link in comments]**

---

## r/ClaudeAI

**Title:**
I added real-time stock analysis to Claude Desktop via MCP — one command, works immediately

**Post:**
Claude is a brilliant analyst but has a major blind spot for investing: no live data. Ask it about a stock's current P/E, whether insiders are buying, or what last quarter's earnings meant — and it has to guess from training data.

I built an MCP server that fixes this. One command:

```bash
claude mcp add agent-toolbelt \
  -e AGENT_TOOLBELT_KEY=atb_... \
  -- npx -y agent-toolbelt-mcp
```

Then in Claude Desktop or Claude Code:

> *"Give me a full analysis of AAPL — investment thesis, earnings quality, insider activity, and whether it's cheap or expensive."*

Claude calls the tools in parallel and synthesizes a complete research note. Real numbers, real analysis. Here's what it produces for NVDA:

**Verdict:** Bullish
**One-liner:** "Nvidia owns the essential infrastructure for the AI revolution with a defensible software moat, but the valuation demands flawless execution."

**Key Strengths:**
- Dominant ~80%+ data center GPU market share
- CUDA moat creates switching costs and customer lock-in
- 42 buy / 5 hold / 1 sell analyst consensus

**Valuation:** 36.9x P/E — premium but justified by AI tailwinds. Fair value hinges entirely on sustained data center spending through 2029.

**Insider Read:** Mixed — two executives bought ~47k shares each (positive), offset by routine selling from others.

**Watch For Next Earnings:** Data center revenue growth rate. Deceleration below 30% YoY would signal the boom is maturing.

The five tools: `stock_thesis`, `earnings_analysis`, `insider_signal`, `valuation_snapshot`, `bear_vs_bull`. Free tier included (1,000 calls/month, no credit card). Try the valuation snapshot live at elephanttortoise.com — no signup needed.

**[link in comments]**

Happy to answer questions — works with Claude Code too if anyone uses that for research.

---

## r/algotrading

**Title:**
REST API for AI-powered fundamental analysis — investment thesis, insider signals, valuation in one call

**Post:**
If you're building any kind of systematic research pipeline, I built something that might be useful.

Five endpoints that pull live data from Polygon, Finnhub, and FMP simultaneously and synthesize it with Claude:

**`POST /api/tools/stock-thesis`** `{"ticker": "NVDA", "timeHorizon": "3-5 years"}`
Returns: bullish/neutral/bearish verdict, thesis paragraphs, key strengths/risks, valuation read, insider interpretation, analyst consensus read.

**`POST /api/tools/insider-signal`** `{"ticker": "NVDA"}`
Returns: strong_buy/buy/neutral/sell/strong_sell signal with confidence rating. Distinguishes open-market purchases (meaningful) from option exercises and tax-withholding sales (routine noise).

**`POST /api/tools/valuation-snapshot`** `{"ticker": "NVDA"}`
Returns: P/E, P/S, EV/EBITDA, FCF yield, ROE, net margin + verdict (very_cheap/cheap/fair/expensive/very_expensive) + specific buy zone.

**`POST /api/tools/earnings-analysis`** `{"ticker": "NVDA"}`
Returns: beat rate across last 12 quarters, revenue trend classification, long-term consistency read.

**`POST /api/tools/bear-vs-bull`** `{"ticker": "NVDA"}`
Returns: 3 bull arguments + 3 bear arguments (both with specific data), net verdict, key debate question.

All return structured JSON. $0.05/call on PAYG (prepaid credits, no subscription). TypeScript SDK and LangChain wrappers available. Free tier: 1,000 calls/month.

Not quant/technical analysis — strictly fundamental. Useful if you're building a screening pipeline, portfolio monitor, or research agent that needs structured qualitative output alongside your quantitative signals.

**[link in comments]**

---

## r/LocalLLaMA

**Title:**
Gave Claude live stock data via MCP — fundamental analysis pipeline using Polygon + Finnhub + FMP

**Post:**
Claude can reason about investing brilliantly but has no live market data. I built a small MCP server with 5 tools that fix this — pulls from three financial APIs and runs Claude Haiku synthesis on the combined data.

**Architecture:**
1. Tool receives ticker
2. Fetches company overview + price (Polygon), metrics + insider trades + analyst ratings (Finnhub), income statements + key metrics (FMP) — all in parallel via `Promise.all`
3. Builds a plain-text data context (more token-efficient than passing raw JSON)
4. Passes to Claude Haiku with a Motley Fool-style prompt
5. Returns structured JSON: verdict, thesis, strengths, risks, valuation, insider read

The five tools: `stock_thesis`, `earnings_analysis`, `insider_signal`, `valuation_snapshot`, `bear_vs_bull`.

MCP install:
```bash
claude mcp add agent-toolbelt \
  -e AGENT_TOOLBELT_KEY=atb_... \
  -- npx -y agent-toolbelt-mcp
```

Or call the REST API directly:
```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/bear-vs-bull \
  -H "Authorization: Bearer atb_..." \
  -d '{"ticker": "TSLA"}'
```

Returns: 3 bull points, 3 bear points (both steelmanned with real data), net verdict, and the single key question investors need to answer.

TypeScript SDK on npm: `npm install agent-toolbelt`. LangChain wrappers included.

Free tier: 1,000 calls/month. Financial data APIs (Polygon/Finnhub/FMP) all have generous free tiers so the data cost is minimal.

**[link in comments]**

Curious if anyone's done similar financial analysis MCP tools — the interesting design question was how to structure the prompt so Claude gives consistent verdicts rather than wishy-washy "it depends."

---

## r/SideProject

**Title:**
I built a stock research API after getting 0 users from 4 blog posts and an HN submission

**Post:**
Six weeks ago I launched Agent Toolbelt — a set of utility tools for AI agents (token counter, schema generator, regex builder, etc.). I posted on HN, wrote 4 blog posts, submitted to 5 awesome lists, published on npm.

Zero organic registrations.

The problem: utility tools have no pull. Developers either build them in an afternoon or find free alternatives. I was selling something nobody needed to buy.

So I pivoted. I'm a stock picker. I use Motley Fool-style fundamental analysis — revenue growth, insider activity, whether a business is cheap relative to quality. And I kept running into a wall: Claude can reason about stocks brilliantly, but it has no live data. It can't tell you a stock's current P/E, whether insiders bought last week, or what last quarter's earnings pattern means.

I rebuilt around that gap. Five tools that pull live data from Polygon.io, Finnhub, and Financial Modeling Prep in parallel, then synthesize it with Claude Haiku into structured analysis:

- **stock-thesis** — full investment thesis with a bullish/neutral/bearish verdict
- **earnings-analysis** — EPS beat/miss history across 12 quarters
- **insider-signal** — distinguishes meaningful open-market buys from routine option noise
- **valuation-snapshot** — P/E, P/S, EV/EBITDA → cheap/fair/expensive verdict + specific buy zone
- **bear-vs-bull** — steelmans both sides with real data, returns net verdict

The output reads like a Motley Fool article. Structured JSON. ~4 seconds per call.

Still at 0 organic registrations — but this time I actually use it myself, which feels like the right starting point.

Try it: elephanttortoise.com (valuation snapshot, no signup)

What would you want from an AI stock research tool that doesn't exist yet?

---

## Comment Replies

### r/SideProject — agentixlabs (provenance trail request)

> Good call — provenance is important for trust, especially when an agent is reasoning over numbers. The response already includes a `dataSnapshot` with key raw metrics (P/E, market cap, analyst consensus, current price) and a `generatedAt` timestamp, but you're right that it doesn't explicitly name which endpoint each number came from.
>
> Explicit source attribution (e.g. `"peRatio": {"value": 36.9, "source": "Finnhub", "fetchedAt": "..."}`) is on the roadmap. Agree it's table stakes for agent trust. Thanks for the framing — "provenance trail" is exactly the right mental model.

### r/SideProject — Uditakhourii (docs + landing page copy)

> Both points land. The "can I integrate this in 10 minutes" bar is the right one — I'll add a single page with real request/response examples for each tool, not just the API reference.
>
> On the landing page copy: the Motley Fool-style angle is buried. Moving it up. The current hero is too generic — it should lead with what the output actually looks like.
>
> Appreciate the feedback.

### r/ValueInvesting — "Is it just redundant?" (Claude/Gemini already do this)

> Claude doesn't have real-time financial data by default — ask it NVDA's current P/E and it'll hedge with training cutoff caveats or guess. The tool passes live data from Polygon, Finnhub, and FMP (current price, trailing multiples, recent Form 4 filings, analyst consensus) so Claude is synthesizing actual numbers, not memory. Gemini's search integration gives you headlines — not structured insider signal interpretation or a specific buy zone with supporting data.

### r/ValueInvesting — "You lost me at Motley Fool"

> Fair — their individual pick track record is mixed. I use the analytical framework (revenue growth quality, moat durability, insider alignment) not the newsletter. The prompt is designed to force a verdict rather than produce "on the one hand / on the other hand" output, which is what you usually get from generic financial analyst prompting.

### r/ValueInvesting — CompoundQuietly (idea generation bottleneck)

> This is the right critique. The current tools assume you already have a name — you're doing the triage manually and handing it a ticker. The harder problem is upstream: surfacing names worth looking at before the price/value gap becomes obvious to everyone.
>
> A screener layer that filters by quality signals (revenue growth tier, insider buying pattern, valuation percentile) and queues interesting names for deeper analysis would be a more complete workflow. That's on the roadmap but not built yet.
>
> Curious what your current process looks like for that first stage — are you using anything systematic or mostly pattern recognition?

---

## HN Comment Templates

### For threads about MCP / Claude tools ("what MCP servers are you using?")

> I built one for stock research that I've found genuinely useful. Five tools: investment thesis, earnings analysis, insider signal interpretation, valuation snapshot, and bear-vs-bull case. Each pulls live data from Polygon + Finnhub + FMP in parallel and passes it to Claude Haiku for synthesis.
>
> The useful design insight: passing a plain-text data context to Claude (not raw JSON) cuts token usage by ~40% and produces more natural analysis.
>
> One command to install: `claude mcp add agent-toolbelt -e AGENT_TOOLBELT_KEY=atb_... -- npx -y agent-toolbelt-mcp`
>
> [link] — free tier included

### For threads about AI + investing / finance

> The gap I kept running into: Claude can reason about stocks well but has no live data. You can paste in a 10-K and it'll analyze it well — but it can't tell you what insiders did last week, whether the P/E has expanded, or what the earnings beat rate looks like.
>
> I built a small tool that fixes this — pulls from Polygon, Finnhub, and FMP simultaneously and synthesizes into structured analysis. The output reads like a Motley Fool article: verdict, thesis paragraphs, specific data points on insider activity, valuation read, and what to watch in the next earnings report.
>
> For NVDA it returned: 10,005% 3-year revenue CAGR, 42/5/1 analyst buy-hold-sell, two executives buying ~47k shares in March, and a specific warning about gross margin compression as the key thing to watch.
>
> [link] — free tier (1k calls/mo), works via MCP or REST API

### For Show HN / Ask HN threads about agent infrastructure

> Relevant: I shipped something similar for financial analysis. Five tools — stock thesis, earnings analysis, insider signal, valuation snapshot, bear-vs-bull — that pull from three financial data APIs and synthesize with Claude.
>
> The interesting challenge was prompt design: getting Claude to give consistent, structured verdicts (bullish/neutral/bearish, strong_buy → strong_sell, cheap/fair/expensive) rather than qualified hedging. The trick was writing the system prompt in the voice of a specific analyst type (Motley Fool style) rather than "financial analyst" generically. Narrows the output distribution significantly.
>
> [link]
