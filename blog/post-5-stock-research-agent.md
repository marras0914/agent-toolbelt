---
title: "I gave Claude real-time stock analysis. Here's how it works."
description: "Claude is a brilliant analyst — but it has no live market data. I built 5 API tools that fix that."
tags: ["ai", "investing", "claude", "agents"]
published: true
---

Claude can reason about stocks brilliantly. But ask it about NVDA's current P/E ratio, whether insiders are buying, or what last quarter's earnings meant — and it has to guess. Its training data has a cutoff. It has no live market data.

I fixed that by building five tools that give Claude everything a fundamental analyst would reach for: live financials, earnings history, insider transactions, valuation metrics, and analyst consensus. Claude synthesizes the data. You get structured research.

Here's what it produces and how to use it.

---

## What the tools return

A single call to `stock-thesis` with `{"ticker": "NVDA"}` pulls data from three sources in parallel — Polygon.io (company overview + price), Finnhub (metrics, analyst ratings, insider trades), and Financial Modeling Prep (income statements, key ratios) — and returns this:

```json
{
  "verdict": "bullish",
  "oneLiner": "Nvidia owns the essential infrastructure for the AI revolution with a defensible software moat, but the valuation demands flawless execution.",
  "thesis": "Nvidia is in a rare position: it supplies the picks and shovels for an industry-wide megatrend. The company has grown revenue at a staggering 10,005% CAGR over three years...",
  "keyStrengths": [
    "Dominant market position in AI chips with ~80%+ data center GPU market share",
    "CUDA software moat creates switching costs and customer lock-in",
    "42 buy / 5 hold / 1 sell analyst consensus shows street confidence"
  ],
  "keyRisks": [
    "36.9x P/E leaves no margin for error",
    "Intensifying competition from AMD, Intel, and hyperscaler custom silicon"
  ],
  "valuation": "Nvidia trades at 36.9x trailing earnings — premium to sector but justified by AI tailwinds. Fair value hinges entirely on sustained data center spending.",
  "insiderRead": "Mixed signals: two executives bought ~47k shares each in March (positive), offset by routine selling from others.",
  "watchFor": "Data center revenue growth rate and gross margin trends — deceleration below 30% YoY would signal the boom is maturing.",
  "dataSnapshot": {
    "marketCapBillions": 4452.2,
    "currentPrice": 180.4,
    "peRatio": 36.9,
    "analystConsensus": { "buy": 42, "hold": 5, "sell": 1 }
  }
}
```

That's not a data dump. That's analysis — the kind you'd get from a well-researched article, delivered as structured JSON in about 4 seconds.

---

## The five tools

**`stock-thesis`** — Full investment thesis. Verdict (bullish/neutral/bearish), 2-3 paragraph analysis, strengths, risks, valuation read, insider interpretation, and the one thing to watch next earnings.

**`earnings-analysis`** — EPS beat/miss track record across the last 12 quarters. Revenue trend (accelerating/stable/decelerating). What the pattern means for a long-term holder.

**`insider-signal`** — Interprets Form 4 filings. Distinguishes meaningful open-market purchases from routine option exercises and tax-withholding sales. Returns signal strength: `strong_buy` → `strong_sell`.

**`valuation-snapshot`** — P/E, P/S, EV/EBITDA, FCF yield, ROE, net margin. Verdict (very_cheap/cheap/fair/expensive/very_expensive) plus a specific buy zone: "at what P/E would this become clearly attractive?"

**`bear-vs-bull`** — Steelmans both sides equally. Three bull arguments with specific data, three bear arguments with specific data, net verdict, and the single key question investors need to answer before buying.

---

## Use it in Claude Desktop or Claude Code

One command:

```bash
claude mcp add agent-toolbelt \
  -e AGENT_TOOLBELT_KEY=atb_... \
  -- npx -y agent-toolbelt-mcp
```

Then in Claude:

> *"Give me a full analysis of AAPL — thesis, earnings quality, insider activity, and whether it's cheap or expensive right now."*

Claude calls all four tools in parallel and synthesizes a complete research note. No switching between financial sites. No copy-pasting data into prompts.

---

## Use it in a LangChain agent

```typescript
import { AgentToolbelt } from "agent-toolbelt";
import { createLangChainTools } from "agent-toolbelt/langchain";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";

const client = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY! });
const tools = createLangChainTools(client);

// tools includes: stock_thesis, earnings_analysis, insider_signal,
//                 valuation_snapshot, bear_vs_bull (+ 20 utility tools)

const agent = createReactAgent({
  llm: new ChatAnthropic({ model: "claude-opus-4-6" }),
  tools,
});

const result = await agent.invoke({
  messages: [{
    role: "user",
    content: "Compare NVDA and AMD. Which has the stronger investment case right now?",
  }],
});
```

The agent will call `stock-thesis` and `bear-vs-bull` for both tickers, then synthesize a comparison. Real data, real analysis, in a few lines of code.

---

## Or call the API directly

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/bear-vs-bull \
  -H "Authorization: Bearer atb_..." \
  -H "Content-Type: application/json" \
  -d '{"ticker": "TSLA"}'
```

```json
{
  "verdict": "too_close",
  "bullCase": [
    { "argument": "Energy business inflection", "detail": "..." },
    { "argument": "Full Self-Driving optionality", "detail": "..." },
    { "argument": "Brand and pricing power", "detail": "..." }
  ],
  "bearCase": [
    { "argument": "Auto margin compression", "detail": "..." },
    { "argument": "CEO distraction risk", "detail": "..." },
    { "argument": "Competition catching up", "detail": "..." }
  ],
  "keyDebate": "Is Tesla an auto company or an AI/energy company? The answer determines whether the multiple is justified.",
  "forInvestorsWho": "Suits investors who believe in long-duration optionality and can stomach high volatility."
}
```

---

## Pricing

1,000 free calls/month. No credit card required.

Stock analysis tools are $0.05/call on the pay-as-you-go tier — prepaid credits, no subscription. A $10 pack covers 200 analyses.

**Get your key:** [agent-toolbelt-production.up.railway.app](https://agent-toolbelt-production.up.railway.app)

---

The raw data APIs (Polygon, Finnhub, FMP) are all freely available. What takes time is knowing which endpoints to call, normalizing the response formats, writing prompts that produce consistent structured output, and handling graceful degradation when a source is down. These tools handle all of that so you don't have to.

If you're building a stock research agent, portfolio monitor, or anything that needs live fundamental analysis — this is the fastest way to get there.
