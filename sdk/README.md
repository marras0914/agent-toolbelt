# agent-toolbelt

Official SDK for [Agent Toolbelt](https://agent-toolbelt-production.up.railway.app) — a suite of focused API tools for AI agents and developers.

**Typed client + LangChain tool wrappers** for schema generation, text extraction, token counting, CSV conversion, Markdown conversion, URL metadata, regex building, cron expressions, address normalization, color palette generation, brand kit creation, meeting action item extraction, and prompt optimization.

## Install

```bash
npm install agent-toolbelt
```

## Get an API key

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

---

## Typed Client

```ts
import { AgentToolbelt } from "agent-toolbelt";

const client = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY! });
```

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

---

## All tools

19 tools available. Free tier included — paid tiers available for higher volume. See [pricing](https://agent-toolbelt-production.up.railway.app/#pricing).

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

## License

MIT
