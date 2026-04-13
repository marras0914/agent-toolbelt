# Product Hunt Launch — Agent Toolbelt

_Target: Tuesday or Wednesday, 12:01 AM Pacific_

---

## Core fields

**Name:** Agent Toolbelt

**Tagline:** AI-powered stock research tools for agents and investors

**Topics:** Artificial Intelligence · Finance · Developer Tools · Investing · APIs

---

## Short description (shown on listing card, ~260 chars)

Five API tools that give Claude real-time stock analysis: investment thesis, earnings history, insider signal, valuation snapshot, and bear-vs-bull case. Pulls live data from Polygon, Finnhub, and FMP. Structured JSON. $0.05/call, 1,000 free/month.

---

## Full description (shown on product page, ≤500 chars)

Claude is a brilliant analyst — but it has no live market data. Agent Toolbelt fixes that.

Five tools: investment thesis (bullish/neutral/bearish verdict + analysis), earnings beat-rate history, insider signal interpretation, valuation snapshot with buy zone, and a steelmanned bear-vs-bull case.

Live data from Polygon, Finnhub, and FMP. Structured JSON. REST API · TypeScript SDK · MCP.

$0.05/call · 1,000 free/month · no credit card

---

## Maker comment (post this yourself within the first hour)

Hey Product Hunt! 👋

I'm Marco, the builder behind Agent Toolbelt.

The problem I kept running into: Claude is great at analyzing stocks — but it has no live data. Every time I asked it about a company's current valuation, recent earnings, or what insiders were doing, it either hallucinated or gave me stale training data.

So I built the tools I wanted to use myself. Five API endpoints that each pull from Polygon, Finnhub, and Financial Modeling Prep in parallel, feed the data to Claude Haiku, and return structured JSON analysis. Not raw data — actual synthesis.

A call to `stock-thesis` for NVDA returns a verdict (bullish/neutral/bearish), two paragraphs of analysis, specific strengths and risks grounded in the actual numbers, a valuation read, an insider interpretation, and what to watch next earnings. In about 4 seconds.

The tools work via REST, TypeScript SDK, or MCP server — so you can drop them into an existing Claude agent, a LangChain pipeline, or call them directly.

Free tier: 1,000 calls/month, no credit card. PAYG credits start at $5.

Happy to answer anything — what you'd want to see, what tools are missing, how the prompting works. This is early and I'm very much building in public.

Try it at: https://agent-toolbelt-production.up.railway.app

---

## Gallery images to prepare (in order)

1. **Hero** — Terminal/code showing a `stock-thesis` call + the JSON output (NVDA example from blog post). Clean dark background.
2. **5 tools overview** — Simple grid card showing each tool name, one-line description, and the signal it returns (verdict / signal / trend / etc.)
3. **MCP demo** — Screenshot of Claude Desktop or Claude Code using the MCP server to answer a stock question.
4. **Pricing** — Clean table: Free (1,000/mo) · PAYG ($5 credits) · Starter ($29/mo). Simple, no fluff.
5. **Data sources** — "Polygon + Finnhub + FMP → Claude → Structured JSON" flow diagram.

---

## Pre-launch checklist

- [ ] Gallery images created (5 above)
- [ ] Landing page updated (agent-toolbelt-production.up.railway.app) — make sure the demo works
- [ ] Notify the 6 current registrants — ask them to upvote + leave a comment
- [ ] Line up 3-5 friends/colleagues to upvote in the first hour (critical for algo)
- [ ] Schedule for Tuesday or Wednesday 12:01 AM Pacific
- [ ] Have maker comment ready to paste within first 10 minutes of launch

---

## Post-launch responses (have these ready)

**If asked "how is this different from just calling the APIs yourself?"**
> The value is the synthesis layer. Raw API data from Finnhub gives you a table of numbers. Agent Toolbelt gives you "insiders are sending a bullish signal — two executives made meaningful open-market purchases in Q1, which historically correlates with management confidence ahead of earnings." The data is the same; the structured interpretation is what saves time.

**If asked about accuracy / hallucination:**
> The tools are grounded in live data — Claude only synthesizes what the APIs return. If Finnhub shows 12 quarters of EPS beats, the earnings-analysis tool says "consistent beat history." It won't invent beats that didn't happen. The qualitative framing (what it means for investors) is where Claude adds the synthesis, and that's clearly labeled as analysis, not fact.

**If asked about more tools / roadmap:**
> Next up: portfolio analyzer (analyze a basket of tickers), sector comparison (head-to-head for 3-5 stocks), and earnings transcript summarizer. Building based on what users actually ask for — happy to hear what you'd want.
