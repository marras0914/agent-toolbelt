# 🔧 Agent Toolbelt

**Licensable API microservices for AI agents — build IP that other agents pay to use.**

## Overview

Agent Toolbelt is a plug-and-play framework for building, hosting, and monetizing small, focused API tools that AI agents can discover and call. Think of it as "Stripe for agent tools" — you build useful microservices, agents find them via a catalog endpoint, and you earn per-call revenue.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Agent Toolbelt                     │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  Auth     │  │  Rate    │  │  Usage Tracking   │  │
│  │  (JWT)    │  │  Limiter │  │  (per-call billing)│  │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
│       │              │                 │              │
│  ┌────▼──────────────▼─────────────────▼──────────┐  │
│  │              Tool Registry                      │  │
│  │  ┌─────────────┐  ┌─────────────────────────┐  │  │
│  │  │  Schema Gen  │  │  Text Extractor         │  │  │
│  │  └─────────────┘  └─────────────────────────┘  │  │
│  │  ┌─────────────┐  ┌─────────────────────────┐  │  │
│  │  │  Your Tool   │  │  Your Next Tool         │  │  │
│  │  └─────────────┘  └─────────────────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  GET /api/tools/catalog  ← Agents discover tools     │
│  POST /api/tools/{name}  ← Agents call tools         │
└─────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your secret key

# 3. Run in development
npm run dev

# 4. Generate an API key
curl -X POST http://localhost:3000/admin/generate-key \
  -H "Content-Type: application/json" \
  -d '{"clientId": "my-first-agent", "tier": "free"}'

# 5. Call a tool
curl -X POST http://localhost:3000/api/tools/schema-generator \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer atb_YOUR_KEY_HERE" \
  -d '{"description": "A user profile with name and email", "format": "json_schema"}'
```

## Included Tools

### 1. Schema Generator (`/api/tools/schema-generator`)
Generates JSON Schema, TypeScript interfaces, or Zod schemas from natural language descriptions. Agents use this to validate data on the fly.

### 2. Text Extractor (`/api/tools/text-extractor`)
Extracts structured data (emails, URLs, phone numbers, dates, currencies, addresses) from raw text. Essential for agents processing unstructured content.

## Adding Your Own Tools

Create a new file in `src/tools/` following this pattern:

```typescript
import { z } from "zod";
import { ToolDefinition, registerTool } from "./registry";

const inputSchema = z.object({
  // Define your input with Zod
  myField: z.string().describe("What this field does"),
});

type Input = z.infer<typeof inputSchema>;

async function handler(input: Input) {
  // Your tool logic here
  return { result: "your output" };
}

const myTool: ToolDefinition<Input> = {
  name: "my-tool",
  description: "What my tool does",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["category"],
    pricing: "$0.001 per call",
  },
};

registerTool(myTool);
export default myTool;
```

Then import it in `src/index.ts`:
```typescript
import "./tools/my-tool";
```

That's it — it's automatically available in the catalog and as a POST endpoint.

## Pricing Tiers

| Tier       | Requests/min | Monthly Limit | Price     |
|------------|-------------|---------------|-----------|
| Free       | 10          | 1,000         | $0/mo     |
| Starter    | 60          | 50,000        | $29/mo    |
| Pro        | 300         | 500,000       | $99/mo    |
| Enterprise | 1,000       | 5,000,000     | Custom    |

## Monetization Channels

1. **Direct API subscriptions** — Stripe Billing with usage-based metering
2. **RapidAPI Marketplace** — List tools on rapidapi.com for organic discovery
3. **Toolhouse.ai** — Purpose-built marketplace for agent tools
4. **OpenAI GPT Actions** — Package tools as GPT Actions for ChatGPT users
5. **Claude MCP Servers** — Expose tools as MCP servers for Claude integrations
6. **LangChain/LangGraph Hub** — Publish as community tools

## Deployment

Recommended platforms (cheapest to most scalable):

- **Railway / Render** — $5/mo, zero-config Node hosting, great for starting
- **Fly.io** — Edge deployment, scales globally
- **AWS Lambda + API Gateway** — Pay-per-invocation, ideal at scale
- **Cloudflare Workers** — Edge compute, very low latency

## Production Checklist

- [ ] Replace in-memory usage store with Redis or PostgreSQL
- [ ] Add Stripe integration for billing (see `src/middleware/usage.ts`)
- [ ] Add proper API key storage (database, not just JWT)
- [ ] Set up monitoring (Sentry, Datadog, or PostHog)
- [ ] Add request logging and alerting
- [ ] Write integration tests for each tool
- [ ] Set up CI/CD pipeline
- [ ] Add OpenAPI spec generation for each tool
- [ ] Register on agent tool marketplaces
- [ ] Create landing page for developer signups

## Project Structure

```
agent-toolbelt/
├── src/
│   ├── config.ts              # Environment config
│   ├── index.ts               # Express app + server
│   ├── middleware/
│   │   ├── auth.ts            # JWT-based API key auth
│   │   └── usage.ts           # Per-call usage tracking
│   └── tools/
│       ├── registry.ts        # Plug-and-play tool system
│       ├── schema-generator.ts # Tool: JSON/TS/Zod schema gen
│       └── text-extractor.ts  # Tool: structured data extraction
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## License

Proprietary — this is your IP. Protect it.
