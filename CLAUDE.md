# Agent Toolbelt

API microservices for AI agents and developers. Each tool is focused, fast, and billed per call.

## Project structure

```
src/                    # Main API server (Express)
  tools/                # Tool implementations (auto-register via side effect import)
  middleware/           # auth, usage tracking, billing
  db/                   # SQLite via better-sqlite3
  config.ts             # All env vars in one place
  index.ts              # App entry point — routes, middleware, server startup
sdk/                    # npm package: typed client + LangChain wrappers
  src/
    client.ts           # AgentToolbelt class
    langchain.ts        # createLangChainTools()
    index.ts            # public exports
mcp-server/             # MCP server for Claude Desktop / Claude Code
openapi/                # OpenAPI spec served at /openapi/openapi-gpt-actions.json
public/                 # Static landing page
```

## Commands

```bash
npm run dev          # Start dev server with hot reload (tsx watch)
npm run build        # TypeScript compile to dist/
npm run test         # Run tests (vitest)
npm run test:ci      # Run tests once (no watch)
```

## Adding a new tool

1. Create `src/tools/<tool-name>.ts` — implement and call `registerTool()` at the bottom
2. Import it in `src/index.ts` (side-effect import): `import "./tools/<tool-name>";`
3. Add the endpoint to `openapi/openapi-gpt-actions.json`
4. Add typed method to `sdk/src/client.ts`
5. Add `DynamicStructuredTool` to `sdk/src/langchain.ts`
6. Rebuild SDK: `cd sdk && npm run build`

Tool pattern:
```ts
import { z } from "zod";
import { ToolDefinition, registerTool } from "./registry";

const inputSchema = z.object({ ... });
type Input = z.infer<typeof inputSchema>;

async function handler(input: Input) {
  // tool logic
  return { ... };
}

const myTool: ToolDefinition<Input> = {
  name: "my-tool",           // slug used in URL: /api/tools/my-tool
  description: "...",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: [...],
    pricing: "$0.001 per call",
    exampleInput: { ... },
  },
};

registerTool(myTool);
export default myTool;
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `API_KEY_SECRET` | Yes | Secret for hashing API keys |
| `DATABASE_PATH` | No | SQLite path (default `./data/toolbelt.db`) |
| `ADMIN_SECRET` | Yes (prod) | Bearer token for `/admin/*` routes |
| `STRIPE_SECRET_KEY` | Yes (billing) | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Yes (billing) | Stripe webhook signing secret |
| `ANTHROPIC_API_KEY` | Yes (LLM tools) | Powers meeting-action-items and prompt-optimizer |
| `RAPIDAPI_PROXY_SECRET` | No | RapidAPI proxy validation |
| `PORT` | No | Server port (default 3000) |

## Architecture

- **Auth**: Bearer token (`atb_...` prefix). Middleware in `src/middleware/auth.ts`
- **Admin routes**: Protected by `Authorization: Bearer <ADMIN_SECRET>`. Skip if unset (dev mode)
- **Usage tracking**: Every tool call is logged to SQLite. View at `GET /admin/usage`
- **Billing**: Stripe metered billing. Webhooks at `POST /stripe/webhook`
- **Rate limiting**: Global via `express-rate-limit`. Per-tier limits enforced in auth middleware
- **Database**: SQLite (better-sqlite3). Schema auto-creates on startup. Data in `./data/`

## Deployment

Hosted on Railway. Auto-deploys on push to `master` via GitHub integration.

- Production URL: `https://agent-toolbelt-production.up.railway.app`
- Railway project ID: `d345a508-2557-453d-953c-3acd1ae26568`

CI runs on every push/PR: type check → unit tests → build → smoke test → Docker image push (GHSA).

## npm SDK

Package: `agent-toolbelt` on npm. Source in `sdk/`.

```bash
cd sdk
npm run build    # build CJS + ESM + types
npm publish      # publish to npm (requires npm login)
```

## Key files

- `src/index.ts` — all route registrations and middleware
- `src/config.ts` — all env vars
- `src/tools/registry.ts` — tool registration and Express router builder
- `sdk/src/client.ts` — typed API client
- `sdk/src/langchain.ts` — LangChain DynamicStructuredTool wrappers
- `openapi/openapi-gpt-actions.json` — OpenAPI spec (keep in sync with tools)
