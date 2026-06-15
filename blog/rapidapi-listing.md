# RapidAPI listing — repositioned for the API buyer

*Goal: stop pitching "Claude stock tools" to tinkerers and start pitching "the stock-research API you don't have to build" to devs who already pay for APIs on RapidAPI. The wedge: nearly every finance API on RapidAPI is RAW DATA (Alpha Vantage, Yahoo Finance, Twelve Data). This one returns structured **analysis** — verdicts, theses, ranked watchlists — already synthesized. Paste these sections into the RapidAPI provider dashboard.*

---

## API name
Agent Toolbelt — AI Stock Research API

## Short tagline (card / search result)
Structured stock analysis, not raw data. Investment theses, valuation verdicts, insider signals, and watchlist ranking — one call, structured JSON.

## Category / tags
Primary: **Finance**. Tags: `finance`, `stocks`, `investing`, `ai`, `data`, `machine-learning`

---

## Overview / long description

Most stock APIs hand you numbers and leave the hard part to you. Agent Toolbelt hands you the **analysis**.

Each endpoint pulls live fundamentals from Polygon, Finnhub, and Financial Modeling Prep, then returns a structured, Motley-Fool-style read: a verdict, the reasoning, the risks, and the metrics behind it. JSON in, decision-ready JSON out.

**Build vs. buy:** doing this yourself means wiring three data providers, normalizing their conflicting fields, writing the LLM prompts, and maintaining all of it. Or one call here.

**8 stock-research endpoints:**
- **Investment thesis** — bullish/neutral/bearish verdict, thesis, strengths, risks, valuation read
- **Valuation snapshot** — P/E, P/S, EV/EBITDA, FCF yield, ROE → verdict + a specific buy-zone price
- **Insider signal** — Form 4 reads: real open-market buying vs. routine noise, strong_buy → strong_sell
- **Earnings analysis** — EPS beat/miss history, revenue trend, next earnings date
- **Bull vs. bear** — 3 steelmanned bull + 3 bear arguments, net verdict, key debate
- **Compare stocks** — head-to-head on 2–3 tickers with a winner and per-ticker breakdown
- **Moat analysis** — Buffett-style competitive-moat rating with sources and durability
- **Watchlist scan** — rank 2–15 tickers by value/quality/growth/income in one call

US-listed equities. Typed responses, every metric tagged with its source. Also includes 20 general developer utilities (schema generation, token counting, etc.) at no extra cost.

---

## Per-endpoint blurbs (for each RapidAPI endpoint page)

- **POST /api/tools/stock-thesis** — Full investment thesis for a ticker: verdict, 2–3 paragraph analysis, strengths, risks, valuation, what to watch. `{"ticker":"NVDA"}`
- **POST /api/tools/valuation-snapshot** — Valuation verdict (very_cheap → very_expensive) with P/E, P/S, EV/EBITDA, FCF yield, ROE, and a buy-zone price. `{"ticker":"AAPL"}`
- **POST /api/tools/insider-signal** — Interprets Form 4 filings into a signal + confidence, separating open-market conviction buys from option-exercise noise. `{"ticker":"TSLA"}`
- **POST /api/tools/earnings-analysis** — EPS beat/miss track record, revenue trend, and the next earnings date. `{"ticker":"MSFT"}`
- **POST /api/tools/bear-vs-bull** — Steelmanned bull and bear cases with data, a net verdict, and the key debate. `{"ticker":"AMD"}`
- **POST /api/tools/compare-stocks** — Head-to-head comparison of 2–3 tickers with a winner. `{"tickers":["NVDA","AMD"]}`
- **POST /api/tools/moat-analysis** — Competitive-moat rating (wide/narrow/none), sources, durability. `{"ticker":"V"}`
- **POST /api/tools/watchlist-scan** — Rank a list by a lens (value/quality/growth/income), one call. `{"tickers":["NVDA","AMD","AVGO"],"focus":"value"}`

*(On RapidAPI, calls route through the RapidAPI gateway with X-RapidAPI-Key — use RapidAPI's auto-generated code snippets for the auth/host; the body params above are what matters.)*

---

## Pricing (RapidAPI tiers — set in the dashboard)

Position it freemium so buyers can test, then convert. **Margin note:** stock calls cost ~$0.006–0.008 in LLM/data, RapidAPI takes ~20%, so keep effective per-call revenue ≥ ~$0.02 on paid tiers to stay healthy (the 24h response cache improves this for repeat tickers).

| Tier | Price | Quota | Notes |
|---|---|---|---|
| **Basic** | Free | 25 calls/mo, hard cap | Lets buyers evaluate. Low enough to force upgrade. |
| **Pro** | $19/mo | 1,000 calls/mo | ~$0.019/call. The default paid tier. |
| **Ultra** | $59/mo | 5,000 calls/mo | ~$0.012/call (volume discount), overage at $0.02. |
| **Mega** | $199/mo | 25,000 calls/mo | For embedding in a product. |

(These are independent of the agenttoolbelt.live Stripe tiers — RapidAPI is its own billing + funnel.)

---

## Notes for Marco
- Lead with **"analysis, not raw data"** everywhere — that's the one thing competitors on RapidAPI don't have.
- Make sure `RAPIDAPI_PROXY_SECRET` is set so gateway calls validate.
- Add 1–2 real example responses (e.g., the NVDA thesis JSON) to the endpoint pages — buyers want to see the shape before subscribing.
- After updating, the listing should read as a **finance/stock API** first and an "AI/Claude tool" second. The Claude/MCP angle is a different (non-paying) funnel; keep it off the RapidAPI page.
