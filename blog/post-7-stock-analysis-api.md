# The stock-analysis API you don't have to build

*Target: devs who are shopping for a stock API and land here via search ("stock analysis API", "investment thesis API", "stock fundamental data API"). Funnels to the RapidAPI listing. Publish on dev.to + Medium + marcoarras.com/writing. Buyer framing — no MCP/Claude-tinkerer angle. Distinct from post-5 (that one was "I gave Claude stock analysis"); this is "I needed analysis in my app and bought it instead of building it."*

*Listing link used below: `https://rapidapi.com/arrasmarco/api/agent-toolbelt1`.*

---

I was building a feature that needed to say something *useful* about a stock — not just print its P/E, but actually read the situation: is this cheap or expensive, what's the bull case, is the insider buying real or routine. I went looking for an API.

Every finance API I found sold me **raw data**. Alpha Vantage, Twelve Data, Yahoo Finance, FMP — they'll hand you fundamentals, prices, filings, all of it. Great. Now I get to write the part that turns 40 metrics into "this looks expensive but the moat is widening." That's the part that's actually hard, and the part I didn't want to own forever.

So I'd be wiring three data providers, normalizing their conflicting field names, writing and tuning the LLM prompts, handling the rate limits and the caching, and then *maintaining* all of it as the upstreams change. For a feature, not a product.

## What I wanted instead

A single endpoint. Ticker in, **analysis** out — already synthesized, already structured.

That's what I ended up building for myself and then put on RapidAPI: **[Agent Toolbelt — AI Stock Research API](https://rapidapi.com/arrasmarco/api/agent-toolbelt1)**. It pulls live fundamentals from Polygon, Finnhub, and Financial Modeling Prep, then returns a Motley-Fool-style read as typed JSON. The numbers are in there too, but the point is the verdict and the reasoning.

Here's a real `stock-thesis` response:

```json
{
  "verdict": "bullish",
  "oneLiner": "Nvidia owns the essential infrastructure for the AI revolution with a defensible software moat.",
  "keyStrengths": [
    "~80%+ data center GPU market share",
    "CUDA moat creates switching costs",
    "42 buy / 5 hold / 1 sell analyst consensus"
  ],
  "keyRisks": [
    "36.9x P/E leaves no margin for error",
    "Competition from AMD and custom silicon"
  ],
  "insiderRead": "Two executives bought ~47k shares each — meaningful open-market purchases, not routine grants.",
  "dataSnapshot": { "currentPrice": 180.4, "peRatio": 36.9, "marketCapBillions": 4452.2 }
}
```

That's one HTTP call. No data-provider accounts, no prompt engineering, no normalization layer.

## The endpoints

All `POST`, ticker (or list) in, structured JSON out:

| Endpoint | What you get |
|---|---|
| **stock-thesis** | Verdict + thesis, strengths, risks, valuation, what to watch |
| **valuation-snapshot** | very_cheap → very_expensive verdict, P/E, P/S, EV/EBITDA, FCF yield, ROE, buy-zone price |
| **insider-signal** | Form 4 read: real open-market buying vs. routine noise, strong_buy → strong_sell |
| **earnings-analysis** | EPS beat/miss history, revenue trend, next earnings date |
| **bear-vs-bull** | Steelmanned bull + bear cases, net verdict, the key debate |
| **compare-stocks** | Head-to-head on 2–3 tickers, winner + per-ticker breakdown |
| **moat-analysis** | Buffett-style moat rating (wide/narrow/none), sources, durability |
| **watchlist-scan** | Rank 2–15 tickers by value/quality/growth/income in one call |

US-listed equities. Every metric is tagged with its source, so you can see whether a figure is TTM from FMP or normalized from Finnhub.

## Calling it

On RapidAPI, auth is handled for you — subscribe, copy the snippet, the `X-RapidAPI-Key` and host get filled in. The body is the only thing you write:

```bash
curl -X POST 'https://<rapidapi-host>/api/tools/stock-thesis' \
  -H 'X-RapidAPI-Key: YOUR_KEY' \
  -H 'X-RapidAPI-Host: <rapidapi-host>' \
  -H 'Content-Type: application/json' \
  -d '{"ticker": "NVDA"}'
```

There's a free tier to test against before you wire it into anything. Paid plans scale by monthly call volume.

## When this is the wrong tool

If you need tick-level price feeds, options chains, or to run your own models on raw fundamentals — buy raw data; this isn't that. This is for when you want the *judgment layer* (a verdict, a thesis, a ranked watchlist) without building and maintaining it yourself. Output is AI-generated and informational, not investment advice — do your own due diligence.

If that's the layer you were about to build: **[it's on RapidAPI here](https://rapidapi.com/arrasmarco/api/agent-toolbelt1)**. I'd rather you spend the afternoon on your actual product.

---

*Built by [Marco Arras](https://www.marcoarras.com). Questions → hello@elephanttortoise.com.*
