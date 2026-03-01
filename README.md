# Agent Toolbelt

**Focused API tools for AI agents and developers.** 16 tools covering data transformation, text extraction, LLM utilities, document analysis, and contract review — each one a focused microservice, billed per call.

**Production API:** https://agent-toolbelt-production.up.railway.app

---

## Quickstart

```bash
# Get a free API key
curl -X POST https://agent-toolbelt-production.up.railway.app/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'

# Call a tool
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/token-counter \
  -H "Authorization: Bearer atb_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "models": ["gpt-4o", "claude-3-5-sonnet"]}'
```

---

## npm SDK + LangChain

```bash
npm install agent-toolbelt
```

### Typed client

```ts
import { AgentToolbelt } from "agent-toolbelt";

const client = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY! });

// Count tokens across models with cost estimates
const tokens = await client.tokenCounter({
  text: myDocument,
  models: ["gpt-4o", "claude-3-5-sonnet"],
});

// Extract structured data from raw text
const contacts = await client.textExtractor({
  text: emailBody,
  extractors: ["emails", "phone_numbers", "addresses"],
});

// Convert HTML to clean Markdown for LLM consumption
const markdown = await client.markdownConverter({
  content: scrapedHtml,
  from: "html",
  to: "markdown",
});
```

### LangChain integration

```ts
import { AgentToolbelt } from "agent-toolbelt";
import { createLangChainTools } from "agent-toolbelt/langchain";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const client = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY! });
const tools = createLangChainTools(client); // 16 ready-to-use DynamicStructuredTools

const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o" }),
  tools,
});
```

---

## Tools

| Tool | What it does | Price |
|---|---|---|
| `text-extractor` | Extract emails, URLs, phones, dates, currencies, addresses, names from any text | $0.0005/call |
| `token-counter` | Count tokens across 15 LLM models (GPT-4o, Claude 3.5, etc.) with cost estimates | $0.0001/call |
| `schema-generator` | Generate JSON Schema, TypeScript interfaces, or Zod validators from plain English | $0.001/call |
| `csv-to-json` | Convert CSV to typed JSON — auto-detects delimiters, casts types, infers column types | $0.0005/call |
| `markdown-converter` | Convert HTML ↔ Markdown. Clean up web content for LLM consumption | $0.0005/call |
| `url-metadata` | Fetch a URL and extract title, description, OG tags, favicon, author, publish date | $0.001/call |
| `regex-builder` | Build and test regex patterns from natural language. Returns JS/Python/TS code snippets | $0.0005/call |
| `cron-builder` | Convert schedule descriptions to cron expressions with next-run preview | $0.0005/call |
| `address-normalizer` | Normalize US addresses to USPS format with component parsing and confidence score | $0.0005/call |
| `color-palette` | Generate color palettes from descriptions or hex seeds with WCAG scores and CSS vars | $0.0005/call |
| `brand-kit` | Full brand kit — color palette, typography pairings, CSS/Tailwind design tokens | $0.001/call |
| `image-metadata-stripper` | Strip EXIF/GPS/IPTC/XMP metadata from images for privacy | $0.001/call |
| `meeting-action-items` | Extract action items, decisions, and summary from meeting notes | $0.05/call |
| `prompt-optimizer` | Analyze and improve LLM prompts — scores + rewrite + change summary | $0.05/call |
| `document-comparator` | Semantic diff of two document versions with significance ratings | $0.05/call |
| `contract-clause-extractor` | Extract and risk-flag key clauses from contracts and legal docs | $0.10/call |

---

## Discover tools programmatically

Agents can auto-discover all tools at runtime:

```bash
curl https://agent-toolbelt-production.up.railway.app/api/tools/catalog
```

```json
{
  "tools": [
    {
      "name": "text-extractor",
      "description": "Extract structured data...",
      "endpoint": "/api/tools/text-extractor",
      "metadata": { "pricing": "$0.0005 per call" }
    }
  ],
  "count": 16
}
```

---

## Pricing

| Tier | Price | Monthly calls | Rate limit |
|---|---|---|---|
| Free | $0/mo | 1,000 | 10/min |
| Starter | $29/mo | 50,000 | 60/min |
| Pro | $99/mo | 500,000 | 300/min |
| Enterprise | Custom | 5,000,000 | 1,000/min |

---

## Integrations

- **npm** — `npm install agent-toolbelt` — typed client + LangChain tools
- **LangChain/LangGraph** — `createLangChainTools(client)` — 16 `DynamicStructuredTool` instances
- **Claude MCP** — `npx -y agent-toolbelt-mcp` — works with Claude Desktop and Claude Code
- **OpenAI GPT Actions** — OpenAPI spec at `/openapi/openapi-gpt-actions.json`
- **RapidAPI** — listed on the RapidAPI marketplace

### Claude MCP

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

---

## License

MIT
