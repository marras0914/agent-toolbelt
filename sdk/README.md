# agent-toolbelt

Official SDK for [Agent Toolbelt](https://agent-toolbelt-production.up.railway.app) — a suite of focused API tools for AI agents and developers.

**Typed client + LangChain tool wrappers** for schema generation, text extraction, token counting, CSV conversion, Markdown conversion, URL metadata, regex building, cron expressions, address normalization, color palette generation, and brand kit creation.

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

---

## All tools

| Tool | Pricing |
|---|---|
| `schema-generator` | $0.001 / call |
| `text-extractor` | $0.0005 / call |
| `token-counter` | $0.0001 / call |
| `csv-to-json` | $0.0005 / call |
| `markdown-converter` | $0.0005 / call |
| `url-metadata` | $0.001 / call |
| `regex-builder` | $0.0005 / call |
| `cron-builder` | $0.0005 / call |
| `address-normalizer` | $0.0005 / call |
| `color-palette` | $0.0005 / call |
| `brand-kit` | $0.001 / call |

## License

MIT
