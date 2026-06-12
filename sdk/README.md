# agent-toolbelt

Official SDK for [Agent Toolbelt](https://www.agenttoolbelt.live) — a suite of focused API tools for AI agents and developers.

**Typed client + LangChain tool wrappers** for stock research (investment thesis, earnings analysis, insider signals, valuation, bear/bull, head-to-head comparison, moat analysis, watchlist scan), schema generation, text extraction, token counting, CSV conversion, Markdown conversion, URL metadata, regex building, cron expressions, address normalization, color palette generation, brand kit creation, meeting action item extraction, prompt optimization, web summarization, and more — 28 tools total (8 stock + 20 utility).

## Install

```bash
npm install agent-toolbelt
```

## Get an API key

```bash
curl -X POST https://www.agenttoolbelt.live/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

---

## Typed Client

```ts
import { AgentToolbelt } from "agent-toolbelt";

const client = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY! });
```

---

## Stock Research Tools

Seven tools that pull live data from Polygon.io, Finnhub, and Financial Modeling Prep, then synthesize Motley Fool-style analysis. Each call returns structured JSON with verdict, key drivers, and what to watch. **US-listed equities only** (NYSE, NASDAQ, AMEX).

### Investment Thesis

```ts
const result = await client.stockThesis({
  ticker: "NVDA",
  timeHorizon: "3-5 years",
});
// result.verdict        → "bullish" | "neutral" | "bearish"
// result.oneLiner       → "Nvidia owns the essential infrastructure for the AI revolution..."
// result.keyStrengths   → ["Dominant ~80%+ data center GPU share", "CUDA software moat", ...]
// result.keyRisks       → ["Customer concentration", "Cyclical demand exposure", ...]
// result.watchFor       → "Data center revenue growth rate. Deceleration below 30% YoY..."
```

### Earnings Analysis

```ts
const result = await client.earningsAnalysis({ ticker: "MSFT" });
// result.verdict        → "strong_compounder" | "consistent" | "mixed" | "volatile" | "deteriorating"
// result.beatRate       → "4/5 quarters beat (80%)"
// result.revenueTrend   → "accelerating" | "stable" | "decelerating" | "declining"
// result.lastQuarterSummary → "..."
```

### Insider Signal

```ts
const result = await client.insiderSignal({ ticker: "AAPL" });
// result.signal         → "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell"
// result.confidence     → "high" | "medium" | "low"
// result.interpretation → "Two C-suite executives bought ~47k shares in March (positive alignment)..."
```

### Valuation Snapshot

```ts
const result = await client.valuationSnapshot({ ticker: "GOOGL" });
// result.verdict        → "very_cheap" | "cheap" | "fair" | "expensive" | "very_expensive"
// result.metrics.peRatio, result.metrics.evEbitda, result.metrics.fcfYield, result.metrics.roe
// result.buyZone        → "Below $135. Current $172 is fair but not a bargain."
```

### Bear vs. Bull

```ts
const result = await client.bearVsBull({ ticker: "TSLA" });
// result.verdict        → "bull_wins" | "slight_bull" | "too_close" | "slight_bear" | "bear_wins"
// result.bullCase       → [{ argument: "...", detail: "..." }, ...]   // 3 items
// result.bearCase       → [{ argument: "...", detail: "..." }, ...]   // 3 items
// result.keyDebate      → "Will autonomous driving become a real revenue line by 2027?"
```

### Compare Stocks

Head-to-head comparison of 2–3 tickers with a recommendation by investor goal.

```ts
const result = await client.compareStocks({ tickers: ["NVDA", "AMD"] });
// result.winner         → "NVDA" | "AMD" | "tied"
// result.oneLiner       → "NVDA wins on margins and software moat; AMD better value."
// result.byTicker       → { NVDA: { strengths: [...], concerns: [...] }, AMD: {...} }
// result.ifYouValue     → { growth: "NVDA", value: "AMD", quality: "NVDA" }
```

### Moat Analysis

Buffett-style competitive moat assessment.

```ts
const result = await client.moatAnalysis({ ticker: "KO" });
// result.moatRating     → "wide" | "narrow" | "none"
// result.moatSources    → [{ type: "brand", strength: "strong", evidence: "..." }, ...]
// result.durabilityRead → "Coca-Cola's brand moat is among the most durable in consumer staples..."
// result.threats        → ["Health-conscious consumer shift", "Private label competition", ...]
```

---

### Text Extractor

Pull structured data out of raw text — no regex required.

```ts
const result = await client.textExtractor({
  text: "Contact Sarah at sarah@acme.com or (555) 867-5309. Budget: $12,500.",
  extractors: ["emails", "phone_numbers", "currencies"],
});
// result.extracted.emails       → ["sarah@acme.com"]
// result.extracted.phone_numbers → ["+15558675309"]
// result.extracted.currencies   → ["$12,500"]
```

### Token Counter

Never get surprised by context window costs again.

```ts
const result = await client.tokenCounter({
  text: longDocument,
  models: ["gpt-4o", "claude-3-5-sonnet", "gpt-3.5-turbo"],
});
// result.results["gpt-4o"].tokens            → 1842
// result.results["gpt-4o"].estimatedCost.input → 0.0000092 (USD)
```

### Schema Generator

Describe your data in English, get back a schema.

```ts
const result = await client.schemaGenerator({
  description: "a SaaS user with name, email, plan tier, and usage limits",
  format: "typescript",
});
// result.schema → full TypeScript interface
```

### CSV to JSON

Drop in CSV, get back typed JSON.

```ts
const result = await client.csvToJson({
  csv: rawCsvString,
  typeCast: true,   // "true" → true, "42" → 42, "" → null
});
// result.rows → [{ name: "Alice", age: 30, active: true }, ...]
// result.columnTypes → { name: "string", age: "number", active: "boolean" }
```

### Markdown Converter

Clean up HTML for LLM consumption.

```ts
const result = await client.markdownConverter({
  content: scrapedHtml,
  from: "html",
  to: "markdown",
});
// result.output → clean Markdown without tags
```

### URL Metadata

Enrich any link with context.

```ts
const result = await client.urlMetadata({ url: "https://example.com/article" });
// result.metadata.title       → "Article Title"
// result.metadata.description → "Meta description..."
// result.metadata.og          → { image: "...", type: "article" }
```

### Other tools

```ts
// Natural language → cron expression
await client.cronBuilder({ description: "every weekday at 9am", timezone: "America/New_York" });

// Natural language → regex with code snippets
await client.regexBuilder({ description: "US phone numbers", testStrings: ["555-867-5309"] });

// Normalize messy US addresses to USPS format
await client.addressNormalizer({ address: "123 main st apt 4b, springfield, il 62701" });

// Generate color palettes from descriptions or hex colors
await client.colorPalette({ description: "calm fintech blue", count: 5 });

// Generate a full brand kit — colors, typography, CSS/Tailwind tokens
await client.brandKit({ name: "Solaris Health", industry: "healthcare", vibe: ["modern", "trustworthy"], format: "full" });

// Extract action items, decisions, and summary from meeting notes
await client.meetingActionItems({ notes: transcript, format: "full", participants: ["Sarah", "John"] });

// Analyze and improve an LLM prompt
await client.promptOptimizer({ prompt: "Summarize this and tell me the main points.", model: "gpt-4o", mode: "both" });

// Fetch a URL, strip boilerplate, return clean Markdown + AI summary
await client.webSummarizer({ url: "https://example.com/article", mode: "both", focus: "key arguments" });
// result.content           → clean Markdown
// result.summary.summary   → "2-4 sentence summary..."
// result.summary.keyPoints → ["point 1", "point 2", ...]
```

---

## LangChain Integration

Use Agent Toolbelt tools directly in LangChain agents and chains.

```ts
import { AgentToolbelt } from "agent-toolbelt";
import { createLangChainTools } from "agent-toolbelt/langchain";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const client = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY! });
const tools = createLangChainTools(client);

const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o" }),
  tools,
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Extract all emails and phone numbers from this text: ..." }],
});
```

### Available LangChain tools

| Tool name | Description |
|---|---|
| `stock_thesis` | Motley Fool-style investment thesis with live data |
| `earnings_analysis` | EPS beat/miss history + revenue trend read |
| `insider_signal` | Form 4 interpretation: meaningful signal or routine noise? |
| `valuation_snapshot` | P/E, P/S, EV/EBITDA, FCF yield → cheap/fair/expensive |
| `bear_vs_bull` | Steelmanned bull and bear cases with net verdict |
| `compare_stocks` | Head-to-head 2–3 ticker comparison with recommendation map |
| `moat_analysis` | Buffett-style competitive moat assessment with durability outlook |
| `extract_from_text` | Extract emails, URLs, phones, dates, currencies, addresses, names from text |
| `count_tokens` | Count tokens and estimate cost across LLM models |
| `generate_schema` | Generate JSON Schema / TypeScript / Zod from a description |
| `csv_to_json` | Convert CSV to typed JSON with auto type casting |
| `convert_markdown` | Convert HTML ↔ Markdown |
| `fetch_url_metadata` | Get title, description, OG tags, favicon from a URL |
| `build_regex` | Build and test regex patterns from natural language |
| `build_cron` | Convert schedule descriptions to cron expressions |
| `normalize_address` | Normalize US addresses to USPS format |
| `generate_color_palette` | Generate color palettes with WCAG scores and CSS variables |
| `generate_brand_kit` | Generate full brand kit — colors, typography, CSS/Tailwind tokens |
| `strip_image_metadata` | Strip EXIF/GPS/IPTC/XMP metadata from images for privacy |
| `extract_meeting_action_items` | Extract action items, decisions, and summary from meeting notes |
| `optimize_prompt` | Analyze and improve LLM prompts with scores and rewrite |
| `compare_documents` | Semantic diff between two document versions |
| `extract_contract_clauses` | Extract key clauses and flag risks from contracts |
| `mock_api_response` | Generate realistic mock data from a JSON Schema |
| `pack_context_window` | Select the best content subset that fits a token budget |
| `audit_dependencies` | Check npm/PyPI packages for known CVEs |
| `summarize_web_page` | Fetch a URL, extract clean Markdown, generate AI summary with key points |

---

## All tools

28 tools available (8 stock + 20 utility). Free tier included — paid tiers available for higher volume. See [pricing](https://www.agenttoolbelt.live/#pricing).

### Stock research ($0.05 per call)

| Tool | Description |
|---|---|
| `stock-thesis` | Motley Fool-style investment thesis with verdict, strengths, risks |
| `earnings-analysis` | EPS beat/miss history + revenue trend over 5 quarters |
| `insider-signal` | Form 4 interpretation distinguishing real signal from routine |
| `valuation-snapshot` | P/E, P/S, EV/EBITDA, FCF yield → cheap/fair/expensive verdict |
| `bear-vs-bull` | Steelmanned bull and bear cases with net verdict |
| `compare-stocks` | Head-to-head 2–3 ticker comparison with winner |
| `moat-analysis` | Buffett-style competitive moat with durability rating |

### Utility tools

| Tool | Description |
|---|---|
| `schema-generator` | JSON Schema / TypeScript / Zod from natural language |
| `text-extractor` | Extract emails, URLs, phones, dates, currencies from text |
| `token-counter` | Token counts and cost estimates across LLM models |
| `csv-to-json` | CSV to typed JSON with auto type detection |
| `markdown-converter` | HTML ↔ Markdown conversion |
| `url-metadata` | Title, description, OG tags, favicon from a URL |
| `regex-builder` | Natural language → tested regex with code snippets |
| `cron-builder` | Natural language → cron expression with next run times |
| `address-normalizer` | Normalize US addresses to USPS format |
| `color-palette` | Color palettes with WCAG scores and CSS variables |
| `brand-kit` | Full brand kit — colors, typography, CSS/Tailwind tokens |
| `image-metadata-stripper` | Strip EXIF/GPS/IPTC/XMP metadata from images |
| `meeting-action-items` | Extract action items and decisions from meeting notes |
| `prompt-optimizer` | Analyze and improve LLM prompts |
| `document-comparator` | Semantic diff between two document versions |
| `contract-clause-extractor` | Extract clauses and flag risks from contracts |
| `api-response-mocker` | Generate realistic mock data from a JSON Schema |
| `context-window-packer` | Pack content into a token budget optimally |
| `dependency-auditor` | Audit npm/PyPI packages for CVEs |
| `web-summarizer` | Fetch a URL, extract clean Markdown, generate AI summary with key points |

---

## Going to production

When the agent moves out of dev, a new set of questions shows up. What did it call last night? What arguments did it pass? Who approved the destructive one?

[Cordon](https://getcordon.com) is an MCP gateway that sits in front of servers like this one. Point your client at Cordon instead of directly at Agent Toolbelt; Cordon forwards every call through and adds:

- A real-time audit log of every tool invocation (name, arguments, response, latency)
- Per-API-key policy: which tools each caller can use, under what conditions
- Slack-based human approvals for tool calls you've flagged as high-risk

From the agent's perspective nothing changes — same tools, same schemas. Free tier covers 250 events/month.

## License

MIT
