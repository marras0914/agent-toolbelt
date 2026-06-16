# RapidAPI distribution — API-discovery lists

*Goal: drive API-buying devs to the RapidAPI listing. RapidAPI's own marketplace search ranks by popularity, so a new listing gets ~no organic traffic — these external "list" channels are where devs actually shop for an API to consume. Different audience from `awesome-list-prs.md` (that file targets MCP/LangChain tinkerers; this one targets people picking an API to pay for).*

**Listing URL:** `https://rapidapi.com/arrasmarco/api/agent-toolbelt1` (filled in below). Most of these lists prefer a stable docs/home URL — so the public-apis entries link to `https://www.agenttoolbelt.live` (the home/docs), and the RapidAPI link is the marketplace/billing entry referenced in the Tier-2/3 copy.

---

## Tier 1 — public-apis directories (biggest reach, devs shopping for an API)

These are the giant "list of APIs" repos devs grep when they need an API. We qualify: there's a free tier (RapidAPI Basic, 25 calls/mo), HTTPS, and apiKey auth. Keep descriptions **neutral and concise** — these lists reject marketing fluff.

### 1. public-apis/public-apis (~330k stars) — PRIORITY

**URL:** https://github.com/public-apis/public-apis
**Section:** Finance
**Format:** `| API | Description | Auth | HTTPS | CORS |`

**Entry:**
```markdown
| [Agent Toolbelt](https://www.agenttoolbelt.live) | AI-generated stock analysis (investment thesis, valuation, insider signal, earnings) from live fundamentals, as structured JSON | `apiKey` | Yes | Unknown |
```

Notes: their bot/maintainers are strict on format and dedupe — one entry, alphabetical within Finance, no trailing period in the description, table columns must line up. PRs are slow to merge but durable.

### 2. marcelscruz/public-apis (active, well-maintained fork)

**URL:** https://github.com/marcelscruz/public-apis
**Section:** Finance — same table format and entry as above.

### 3. public-api-lists/public-api-lists

**URL:** https://github.com/public-api-lists/public-api-lists
**Section:** Finance — same table format and entry as above.

---

## Tier 2 — finance / quant developer lists (high-intent niche)

### 4. wilsonfreitas/awesome-quant (~20k stars)

**URL:** https://github.com/wilsonfreitas/awesome-quant
**Section:** Data Sources (APIs)
**Entry:**
```markdown
- [Agent Toolbelt](https://www.agenttoolbelt.live) - AI-generated stock analysis API: investment thesis, valuation verdict, insider-signal read, earnings track record, and watchlist ranking from live fundamentals (Polygon/Finnhub/FMP), returned as structured JSON. Free tier + paid plans on RapidAPI.
```

### 5. Awesome fintech / financial-data lists

Search GitHub for `awesome fintech`, `awesome financial data`, `awesome stock market` and submit the Tier-2 entry above to any with an active "APIs / Data Sources" section. Candidates to check: `7kfpun/awesome-fintech`, `josephmisiti/awesome-machine-learning` (Finance section), `EthicalML/awesome-production-machine-learning` (data section, only if it fits).

---

## Tier 3 — on-RapidAPI discovery (free, controllable, do in the dashboard)

RapidAPI surfaces APIs through **Collections** and category browsing as well as search. These are levers inside the provider/consumer dashboard:

1. **Add the API to relevant public Collections.** From the Hub, find Collections like "Finance APIs", "AI/ML APIs", "Data APIs" and submit the listing where allowed. Collections get their own discovery surface.
2. **Category + tags audit** (provider dashboard → listing settings): Primary category **Finance**; tags `finance`, `stocks`, `investing`, `ai`, `data`, `machine-learning`. These are the keywords RapidAPI search matches against — make sure the listing title/short tagline also contain "stock" and "analysis" verbatim.
3. **Cross-link from the other listings/SDK** — the npm README, the landing page, and the docs site can each carry an "Also on RapidAPI" link to seed referral traffic (RapidAPI counts external referrals toward listing reputation).

---

## Submission tracker

| Channel | Entry ready | Submitted | Merged/Live |
|---|---|---|---|
| public-apis/public-apis | ✓ | ☐ | ☐ |
| marcelscruz/public-apis | ✓ | ☐ | ☐ |
| public-api-lists/public-api-lists | ✓ | ☐ | ☐ |
| wilsonfreitas/awesome-quant | ✓ | ☐ | ☐ |
| awesome-fintech (TBD) | ✓ | ☐ | ☐ |
| RapidAPI Collections | n/a | ☐ | ☐ |
| Category/tags audit | n/a | ☐ | ☐ |
