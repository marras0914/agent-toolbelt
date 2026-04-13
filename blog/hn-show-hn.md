# Show HN: Agent Toolbelt – 20 focused API tools for AI developers

**URL to submit:** https://agent-toolbelt-production.up.railway.app

---

## HN submission text (paste this in the text box)

I kept writing the same utility code across every AI project: token counting before LLM calls, JSON schemas from example objects, regex patterns for data extraction, prompt cleanup, meeting notes parsing. None of it was the interesting part. It was the tax you pay to build something interesting.

So I packaged all of it into a single API with a shared key. 20 focused endpoints, each doing one thing:

- **token-counter** — Count tokens across GPT-4o, Claude, Gemini, etc. before you hit context limits
- **schema-generator** — Describe your data in English, get back JSON Schema / TypeScript / Zod
- **regex-builder** — Natural language → tested regex with explanation and code snippets
- **prompt-optimizer** — Claude analyzes your prompt and returns a better version with a diff
- **web-summarizer** — Fetch any URL, strip it to clean markdown, get an AI summary with key points
- **meeting-action-items** — Raw notes → structured action items with owners and deadlines
- **text-extractor** — Pull emails, phones, dates, currencies, addresses from unstructured text
- **csv-to-json** — CSV to typed JSON with auto type casting
- **markdown-converter** — HTML ↔ Markdown (useful for cleaning scraped content before LLM ingestion)
- **url-metadata** — Title, description, OG tags, favicon from any URL
- **document-comparator** — Semantic diff between two document versions
- **contract-clause-extractor** — Extract key clauses and flag risks from contracts
- **dependency-auditor** — Check npm/PyPI packages for known CVEs
- **context-window-packer** — Select the best content subset that fits a token budget
- **api-response-mocker** — Generate realistic mock data from a JSON Schema
- ...and 5 more

TypeScript SDK (`npm install agent-toolbelt`), LangChain tool wrappers, and an MCP server (`npx agent-toolbelt-mcp`) are all available.

Free tier included (no credit card). Feedback welcome.

---

## Longer writeup (optional blog post / self post)

When I started building AI agents seriously, I noticed the 80/20 problem in reverse: 80% of my time wasn't going into the agent logic — it was going into the *infrastructure around the agent logic*.

Counting tokens before making API calls. Writing JSON schemas by hand from API responses I already had. Debugging regex patterns in regex101 for the third time this week. Cleaning up HTML before feeding it to an LLM. None of this is interesting work. It's the tax you pay to build something interesting.

I built [Agent Toolbelt](https://agent-toolbelt-production.up.railway.app) to eliminate that tax. Here's what that looks like in practice.

---

### Token counting before LLM calls

The naive approach to context management is to truncate blindly when things get too long. The real approach is to count first and make a decision.

The problem is that `tiktoken` and equivalent libraries have non-obvious behavior around system prompts, special tokens, and multi-turn conversations — and they're model-specific. Adding one to a project is more involved than it sounds.

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/token-counter \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "{{ full conversation history + document }}",
    "models": ["gpt-4o", "claude-3-5-sonnet", "gpt-3.5-turbo"]
  }'
```

```json
{
  "results": {
    "gpt-4o": {
      "tokens": 89432,
      "contextWindow": 128000,
      "estimatedCost": { "input": 0.000448 }
    },
    "claude-3-5-sonnet": {
      "tokens": 91204,
      "contextWindow": 200000,
      "estimatedCost": { "input": 0.000274 }
    },
    "gpt-3.5-turbo": {
      "tokens": 89432,
      "contextWindow": 16385,
      "estimatedCost": { "input": 0.0000134 }
    }
  }
}
```

Count first, then decide whether to summarize history, chunk the document, or proceed as-is. This pattern prevents runtime failures and makes context management explicit.

---

### Schema generation from natural language

JSON Schema is powerful and miserable to write. The schema-generator takes a plain English description and returns JSON Schema, TypeScript, or Zod.

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/schema-generator \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "a SaaS user with name, email, subscription plan, monthly usage count, and a list of connected integrations",
    "format": "typescript"
  }'
```

```typescript
interface Output {
  name: string;
  email: string;
  subscriptionPlan: string;
  monthlyUsageCount: number;
  connectedIntegrations: string[];
}
```

Switch `"format"` to `"json-schema"` or `"zod"` for the other formats. Most useful when validating LLM output — describe the shape you want, use the schema with Zod or Ajv for enforcement.

---

### Prompt optimization

Most prompts in production agents are first drafts that worked well enough and never got revisited. The prompt-optimizer is Claude-powered and returns a better version of your prompt with an explanation of what changed and why.

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/prompt-optimizer \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analyze this customer feedback and tell me what is wrong.",
    "mode": "both"
  }'
```

The response includes `optimizedPrompt`, `changes` (a list of specific improvements with explanations), and `scores` (before/after ratings on clarity, specificity, and format). The `changes` array is the part I find most useful — it's prompt engineering education inline with the work.

---

### Getting started

```bash
# Register — get an API key instantly
curl -X POST https://agent-toolbelt-production.up.railway.app/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

Or via the TypeScript SDK:

```typescript
import { AgentToolbelt } from "agent-toolbelt";

const toolbelt = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY });

const tokens = await toolbelt.tokenCounter({ text: myPrompt, models: ["gpt-4o"] });
const schema = await toolbelt.schemaGenerator({ description: "...", format: "typescript" });
const { optimizedPrompt } = await toolbelt.promptOptimizer({ prompt: myPrompt, mode: "rewrite" });
```

LangChain tool wrappers are in `agent-toolbelt/langchain`. An MCP server (`agent-toolbelt-mcp` on npm) lets you use all 20 tools directly in Claude Desktop or Claude Code.

Free tier included. No credit card required to start. [Pricing](https://agent-toolbelt-production.up.railway.app/#pricing) is available for higher volume.

---

*20 tools available. [Full catalog →](https://agent-toolbelt-production.up.railway.app/api/tools/catalog)*
