# RapidAPI "Documentation" field — paste-ready

*Paste this whole block into the RapidAPI listing's Documentation / About markdown field (the one flagged "not set"). Self-contained: overview, quickstart with RapidAPI auth, endpoint reference, example response, and notes. Buyer-facing — stock API first, no Claude/MCP mention.*

---

# Agent Toolbelt — AI Stock Research API

**Structured stock analysis, not raw data.** Most finance APIs hand you numbers and leave the hard part to you. This one returns the *analysis*: investment theses, valuation verdicts, insider-signal reads, earnings summaries, head-to-head comparisons, moat ratings, and watchlist rankings — decision-ready JSON, for US-listed equities.

Under the hood each call pulls live fundamentals from Polygon, Finnhub, and Financial Modeling Prep and synthesizes them into a structured read. **Build-vs-buy:** doing this yourself means wiring three data providers, normalizing their conflicting fields, and maintaining a synthesis layer. Or one call here.

## Quick start

All requests are `POST` with a JSON body. RapidAPI handles auth — your `X-RapidAPI-Key` is added automatically when you subscribe; just copy a code snippet from any endpoint. Example:

```bash
curl -X POST 'https://<your-rapidapi-host>/api/tools/stock-thesis' \
  -H 'X-RapidAPI-Key: YOUR_RAPIDAPI_KEY' \
  -H 'X-RapidAPI-Host: <your-rapidapi-host>' \
  -H 'Content-Type: application/json' \
  -d '{"ticker": "NVDA"}'
```

(The exact host is shown in the code snippets on each endpoint — RapidAPI fills it in for you.)

## Endpoints

All paths are `POST /api/tools/<name>`:

| Endpoint | Body | Returns |
|---|---|---|
| `stock-thesis` | `{"ticker":"NVDA"}` | Verdict (bullish/neutral/bearish), thesis, strengths, risks, valuation, what to watch |
| `valuation-snapshot` | `{"ticker":"AAPL"}` | Verdict (very_cheap → very_expensive), P/E, P/S, EV/EBITDA, FCF yield, ROE, buy-zone price |
| `insider-signal` | `{"ticker":"NVDA"}` | Form 4 read: signal (strong_buy → strong_sell) + confidence |
| `earnings-analysis` | `{"ticker":"NVDA"}` | EPS beat/miss history, revenue trend, next earnings date |
| `bear-vs-bull` | `{"ticker":"AMD"}` | Steelmanned bull + bear cases, net verdict, key debate |
| `compare-stocks` | `{"tickers":["NVDA","AMD"]}` | Winner + per-ticker strengths/concerns (2–3 tickers) |
| `moat-analysis` | `{"ticker":"AAPL"}` | Moat rating (wide/narrow/none), sources, durability |
| `watchlist-scan` | `{"tickers":["NVDA","AMD","AVGO"],"focus":"value"}` | Ranks 2–15 tickers by value/quality/growth/income: ranked list, top pick, one to avoid |

## Example response (`stock-thesis`)

```json
{
  "ticker": "NVDA",
  "companyName": "Nvidia Corporation",
  "verdict": "bullish",
  "oneLiner": "Near-monopoly in high-performance GPUs with a sticky CUDA software moat, but priced for premium growth.",
  "valuation": "32.3 P/E, 20.3 P/S — premium multiples; 2.3% FCF yield. Priced for excellence.",
  "watchFor": "Gross-margin trend and 2027+ revenue guidance."
}
```

## Notes

- **Coverage:** US-listed equities (NYSE, NASDAQ, AMEX).
- **Data + method:** live fundamentals from Polygon, Finnhub, and Financial Modeling Prep, synthesized into structured analysis. Every metric is sourced; figures are TTM where applicable.
- **Not investment advice:** output is informational only, generated in part by AI, and may contain errors. Do your own due diligence. See Terms of Use.
- **Limits:** each plan has a monthly quota + a per-minute rate limit (see Pricing). Stock analysis is the focus; responses are typed JSON.
