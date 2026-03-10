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
public/                 # Static landing page (main site)
sites/                  # Per-tool static landing pages (deployed to Railway)
  token-counter/        # → tokens.elephanttortoise.com
  schema-generator/     # → schema.elephanttortoise.com
  regex-builder/        # → regex.elephanttortoise.com
  prompt-optimizer/     # → prompts.elephanttortoise.com
  meeting-action-items/ # → meetings.elephanttortoise.com
blog/                   # Blog posts (dev.to / Medium)
  post-1-five-tools-for-ai-devs.md
  post-2-schema-and-regex.md
  post-3-llm-workflow.md
  post-4-research-agent.md  # written, ready to publish
  hn-show-hn.md             # Show HN submission (posted 2026-03-09)
  reddit-posts.md           # r/LocalLLaMA + r/ChatGPTCoding posts
  awesome-list-prs.md       # PR content for awesome lists
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
| `DATABASE_PATH` | No | SQLite path override. Auto-detects `/data` (Railway volume) → falls back to `./data/toolbelt.db` |
| `ADMIN_SECRET` | Yes (prod) | Bearer token for `/admin/*` routes |
| `STRIPE_SECRET_KEY` | Yes (billing) | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Yes (billing) | Stripe webhook signing secret |
| `ANTHROPIC_API_KEY` | Yes (LLM tools) | Powers meeting-action-items, prompt-optimizer, and web-summarizer |
| `RAPIDAPI_PROXY_SECRET` | No | RapidAPI proxy validation |
| `PORT` | No | Server port (default 3000) |

## Architecture

- **Auth**: Bearer token (`atb_...` prefix). Middleware in `src/middleware/auth.ts`
- **Guest try endpoint**: `POST /api/try/:toolName` — no auth, 10 calls/IP/day. Lets users test tools before registering.
- **Admin routes**: Protected by `Authorization: Bearer <ADMIN_SECRET>`. Skip if unset (dev mode)
- **Usage tracking**: Every tool call is logged to SQLite. View at `GET /admin/usage`
- **Billing**: Stripe metered billing. Webhooks at `POST /stripe/webhook`
- **Rate limiting**: Global via `express-rate-limit`. Per-tier limits enforced in auth middleware
- **Database**: SQLite (better-sqlite3). Schema auto-creates on startup. Auto-detects Railway persistent volume at `/data`; falls back to `./data/` locally. Do NOT set `DATABASE_PATH` env var on Railway — volume auto-detection handles it.
- **Pricing visibility**: `pricing` and `pricingMicros` are stripped from public catalog and docs responses. Still used internally for PAYG billing.

## Deployment

Hosted on Railway. Auto-deploys on push to `master` via GitHub integration.

- Production URL: `https://agent-toolbelt-production.up.railway.app`
- Railway project ID: `d345a508-2557-453d-953c-3acd1ae26568`
- Persistent volume mounted at `/data` — SQLite DB survives deploys

CI runs on every push/PR: type check → unit tests → build → smoke test → Docker image push (GHSA).

### Landing pages (elephanttortoise.com)

Five per-tool static sites deployed as Railway static services:

| Domain | Site dir |
|---|---|
| tokens.elephanttortoise.com | `sites/token-counter/` |
| schema.elephanttortoise.com | `sites/schema-generator/` |
| regex.elephanttortoise.com | `sites/regex-builder/` |
| prompts.elephanttortoise.com | `sites/prompt-optimizer/` |
| meetings.elephanttortoise.com | `sites/meeting-action-items/` |

To redeploy a landing page: `cd sites/<name> && MSYS_NO_PATHCONV=1 railway up --service <service-id>`

## npm SDK

Package: `agent-toolbelt` on npm. Source in `sdk/`.

```bash
cd sdk
npm run build    # build CJS + ESM + types
npm publish      # publish to npm (requires npm login)
```

## MCP server

Package: `agent-toolbelt-mcp` on npm (v1.0.2). Source in `mcp-server/`.

```bash
cd mcp-server
npm run build    # compile TypeScript
npm publish      # publish to npm
```

Default API URL is the production Railway URL — no `AGENT_TOOLBELT_URL` env var needed for normal use.

## Admin routes

| Method | Path | Description |
|---|---|---|
| GET | `/admin/usage` | Global stats (calls, clients, avg duration) |
| GET | `/admin/clients` | List all registered clients |
| GET | `/admin/clients/:id/usage` | Per-client usage breakdown |
| GET | `/admin/clients/:id/keys` | List client's API keys |
| POST | `/admin/clients/:id/keys` | Create API key for client |
| DELETE | `/admin/clients/:id/keys/:keyId` | Revoke API key |

```bash
# Get full ADMIN_SECRET (use --json to avoid truncation)
railway variables --json | python3 -c "import sys,json; print(json.load(sys.stdin)['ADMIN_SECRET'])"

# Check usage / clients (use python subprocess on Windows MINGW to pass secret safely)
railway variables --json | python3 -c "
import sys, json, subprocess
secret = json.load(sys.stdin)['ADMIN_SECRET']
r = subprocess.run(['curl', '-s', 'https://agent-toolbelt-production.up.railway.app/admin/clients',
  '-H', f'Authorization: Bearer {secret}'], capture_output=True, text=True)
print(r.stdout)
"
```

## Key files

- `src/index.ts` — all route registrations and middleware
- `src/config.ts` — all env vars
- `src/tools/registry.ts` — tool registration and Express router builder
- `src/db/index.ts` — SQLite setup with volume auto-detection
- `sdk/src/client.ts` — typed API client
- `sdk/src/langchain.ts` — LangChain DynamicStructuredTool wrappers
- `mcp-server/src/index.ts` — MCP tool definitions and server
- `openapi/openapi-gpt-actions.json` — OpenAPI spec (keep in sync with tools)
- `blog/` — blog posts (published to dev.to / Medium ✓)
- `sites/` — per-tool static landing pages (elephanttortoise.com)

## Distribution status

| Channel | Status |
|---|---|
| npm (`agent-toolbelt` + `agent-toolbelt-mcp`) | ✓ Live — 810 + 292 downloads/mo |
| RapidAPI | ✓ Listed |
| MCP registry (registry.modelcontextprotocol.io) | ✓ Submitted |
| PulseMCP + Glama | ✓ Submitted |
| Landing pages (elephanttortoise.com) | ✓ Live |
| Blog posts (dev.to / Medium) | ✓ Published |
| HN article | ✓ Posted 2026-03-09 |
| Smithery | ✓ Submitted URL-based via smithery.ai/new (production /mcp endpoint) |
| Awesome lists | ✓ PRs open — punkpeye/awesome-mcp-servers #2947, kyrolabs/awesome-langchain #207, appcypher/awesome-mcp-servers #532, tensorchord/Awesome-LLMOps #284, mcpservers.org submitted |
| Reddit | Pending — posts written in blog/reddit-posts.md (r/LocalLLaMA + r/ChatGPTCoding) |
| Medium post #4 | Pending — blog/post-4-research-agent.md written, needs publishing |
| Toolhouse.ai | TODO — email hello@toolhouse.ai, needs thin adapter using their SDK |
| Product Hunt | TODO — do after first registrations land |
