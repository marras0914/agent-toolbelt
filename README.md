# Agent Toolbelt

**Stock research tools for AI agents.** Live financial data + Claude-synthesized analysis, served as 7 focused tools — not raw OHLCV. Plus 20 utility tools for the rest of an agent's work.

**Production API:** https://www.agenttoolbelt.live

---

## Quickstart

```bash
# Get a free API key (1,000 calls/month, no credit card)
curl -X POST 'https://www.agenttoolbelt.live/api/clients/register' \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'

# Generate a Motley Fool-style investment thesis for any ticker
curl -X POST https://www.agenttoolbelt.live/api/tools/stock-thesis \
  -H "Authorization: Bearer atb_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ticker": "NVDA", "timeHorizon": "3-5 years"}'
```

Returns: bullish/neutral/bearish verdict, thesis paragraphs, key strengths, key risks, valuation read, insider read, analyst consensus read, and what to watch in the next earnings report.

---

## Stock research tools (7)

LLM-synthesized analysis on top of live financial data from Polygon.io, Finnhub, and Financial Modeling Prep.

| Tool | What it does | Price |
|---|---|---|
| `stock-thesis` | Full Motley Fool-style investment thesis: verdict + thesis paragraphs + strengths + risks + valuation read | $0.05/call |
| `earnings-analysis` | EPS beat/miss history, revenue trend, long-term earnings consistency read, upcoming earnings date | $0.05/call |
| `insider-signal` | Form 4 interpretation — distinguishes meaningful open-market purchases from routine sales/awards. Signal strength + confidence | $0.05/call |
| `valuation-snapshot` | P/E, P/S, EV/EBITDA, FCF yield, ROE, margins → cheap/fair/expensive verdict + specific buy zone | $0.05/call |
| `bear-vs-bull` | Steelmanned 3-bull / 3-bear case with specific data, net verdict, key debate question | $0.05/call |
| `compare-stocks` | Head-to-head comparison of 2-3 tickers. Winner + per-ticker strengths/concerns + ifYouValue map (growth / value / quality) | $0.05/call |
| `moat-analysis` | Buffett-style competitive moat assessment (brand / switching costs / network / scale / IP / cost). Wide/narrow/none + durability | $0.05/call |

Every stock tool returns a `dataSources` block with `fetchedAt` + per-source success flags so you know exactly what data backed the analysis.

---

## Utility tools (20)

Common agent infrastructure. Rule-based tools billed at $0.0001–$0.001/call; LLM-powered tools at $0.005–$0.10/call.

| Tool | What it does | Price |
|---|---|---|
| `text-extractor` | Extract emails, URLs, phones, dates, currencies, addresses, names from text | $0.0005/call |
| `token-counter` | Count tokens across 15 LLM models with cost estimates | $0.0001/call |
| `schema-generator` | JSON Schema / TypeScript / Zod validator from plain English | $0.001/call |
| `csv-to-json` | CSV to typed JSON with auto delimiter and type casting | $0.0005/call |
| `markdown-converter` | HTML ↔ Markdown conversion | $0.0005/call |
| `url-metadata` | Title, OG tags, favicon, author from any URL | $0.001/call |
| `web-summarizer` | Fetch + summarize a URL with key points | $0.02/call |
| `regex-builder` | Natural language → regex with JS/Python/TS snippets | $0.0005/call |
| `cron-builder` | Schedule description → cron expression with next-run preview | $0.0005/call |
| `address-normalizer` | US address → USPS format with component parsing | $0.0005/call |
| `color-palette` | Color palettes with WCAG scores and CSS vars | $0.0005/call |
| `brand-kit` | Full brand kit — colors, typography, CSS/Tailwind tokens | $0.001/call |
| `image-metadata-stripper` | Strip EXIF/GPS/IPTC/XMP metadata for privacy | $0.001/call |
| `meeting-action-items` | Action items, decisions, summary from meeting notes | $0.05/call |
| `prompt-optimizer` | Score and rewrite LLM prompts | $0.05/call |
| `document-comparator` | Semantic diff between two document versions | $0.05/call |
| `contract-clause-extractor` | Key clauses + risk flags from contracts | $0.10/call |
| `api-response-mocker` | Realistic mock data from a JSON Schema | $0.0005/call |
| `dependency-auditor` | CVE scan for npm/PyPI packages via OSV database | $0.005/call |
| `context-window-packer` | Pack content into a token budget for LLM context | $0.001/call |

---

## npm SDK + LangChain

```bash
npm install agent-toolbelt
```

### Typed client

```ts
import { AgentToolbelt } from "agent-toolbelt";

const client = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY! });

// Stock research
const thesis = await client.stockThesis({ ticker: "NVDA", timeHorizon: "3-5 years" });
const moat = await client.moatAnalysis({ ticker: "AAPL" });
const compare = await client.compareStocks({ tickers: ["NVDA", "AMD"] });

// Utility
const tokens = await client.tokenCounter({ text: myDocument });
const contacts = await client.textExtractor({
  text: emailBody,
  extractors: ["emails", "phone_numbers", "addresses"],
});
```

### LangChain integration

```ts
import { AgentToolbelt } from "agent-toolbelt";
import { createLangChainTools } from "agent-toolbelt/langchain";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const client = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY! });
const tools = createLangChainTools(client); // 27 ready-to-use DynamicStructuredTools

const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o" }),
  tools,
});
```

---

## Claude MCP

Use the stock research tools (and the rest of the toolbelt) directly inside Claude Desktop or Claude Code via the [agent-toolbelt-mcp](https://www.npmjs.com/package/agent-toolbelt-mcp) package.

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-toolbelt": {
      "command": "npx",
      "args": ["-y", "agent-toolbelt-mcp"],
      "env": {
        "AGENT_TOOLBELT_KEY": "atb_your_key_here"
      }
    }
  }
}
```

**Claude Code** — one command:

```bash
claude mcp add agent-toolbelt -e AGENT_TOOLBELT_KEY=atb_your_key_here -- npx -y agent-toolbelt-mcp
```

Once installed, ask Claude things like *"Give me a full analysis of NVDA — thesis, earnings quality, insider activity, and whether it's cheap right now"* and it'll call the tools in parallel.

---

## Discover tools programmatically

Agents can auto-discover all 27 tools at runtime:

```bash
curl https://www.agenttoolbelt.live/api/tools/catalog
```

---

## Pricing

| Tier | Price | Monthly calls | Rate limit |
|---|---|---|---|
| Free | $0/mo | 1,000 | 10/min |
| PAYG | prepaid credits | unlimited | 60/min |
| Starter | $29/mo | 50,000 | 60/min |
| Pro | $99/mo | 500,000 | 300/min |
| Enterprise | Custom | 5,000,000 | 1,000/min |

---

## Integrations

- **npm SDK** — `npm install agent-toolbelt` — typed client + LangChain tools
- **MCP** — `npx -y agent-toolbelt-mcp` — works with Claude Desktop and Claude Code
- **OpenAI GPT Actions** — OpenAPI spec at `/openapi/openapi-gpt-actions.json`
- **RapidAPI** — listed on the RapidAPI marketplace
- **Smithery, Glama, PulseMCP, MCP registry** — discoverable in MCP directories

---

## Going to production

When the agent moves out of dev, a new set of questions shows up. What did it call last night? What arguments did it pass? Who approved the destructive one?

[Cordon](https://getcordon.com) is an MCP gateway that sits in front of servers like this one. Point your client at Cordon instead of directly at Agent Toolbelt; Cordon forwards every call through and adds:

- A real-time audit log of every tool invocation (name, arguments, response, latency)
- Per-API-key policy: which tools each caller can use, under what conditions
- Slack-based human approvals for tool calls you've flagged as high-risk

From the agent's perspective nothing changes — same tools, same schemas. Free tier covers 1,000 events/month.

---

## License

MIT
