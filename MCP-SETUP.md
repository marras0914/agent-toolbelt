# 🔌 Claude MCP Server Setup Guide

This guide walks you through packaging Agent Toolbelt as an **MCP (Model Context Protocol) server** so Claude Desktop, Claude Code, VS Code Copilot, and any other MCP client can use your tools natively.

---

## What Is MCP?

MCP is an open protocol created by Anthropic that lets AI applications connect to external tools and data sources in a standardized way. Instead of the AI calling a REST API directly, an MCP server runs locally (or remotely) and exposes **tools**, **resources**, and **prompts** that the AI can discover and call.

**Why this matters for you:** Every tool call from Claude Desktop / Code / VS Code flows through your Agent Toolbelt API — and generates billable usage.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│        Claude Desktop / Code / VS Code           │
│                                                   │
│  User: "Generate a schema for a user profile"     │
│        ↓                                          │
│  Claude discovers generate_schema tool via MCP    │
│        ↓                                          │
│  Sends MCP tool call over stdio                   │
└──────────────────┬────────────────────────────────┘
                   │ stdio (JSON-RPC)
                   ▼
┌─────────────────────────────────────────────────┐
│         Agent Toolbelt MCP Server                │
│         (runs locally as a subprocess)           │
│                                                   │
│  Receives MCP call → Forwards to HTTP API →      │
│  Returns formatted result back via MCP            │
└──────────────────┬────────────────────────────────┘
                   │ HTTPS
                   ▼
┌─────────────────────────────────────────────────┐
│         Agent Toolbelt API (your server)         │
│                                                   │
│  Auth → Rate Limit → Usage Track → Execute Tool  │
│  Every call is metered and billed ✅              │
└─────────────────────────────────────────────────┘
```

---

## What the MCP Server Exposes

### Tools
| Tool | Description |
|------|-------------|
| `generate_schema` | Generate JSON Schema / TypeScript / Zod from natural language |
| `extract_from_text` | Extract emails, URLs, phones, dates, etc. from raw text |
| `list_tools` | List all available Agent Toolbelt tools and pricing |

### Resources
| Resource | Description |
|----------|-------------|
| `toolbelt://docs` | Full API documentation |

### Prompts
| Prompt | Description |
|--------|-------------|
| `generate-data-model` | Guided workflow for creating a complete data model (JSON Schema + TypeScript + Zod) |
| `extract-and-analyze` | Extract all structured data from text and provide analysis |

---

## Step 1: Build the MCP Server

```bash
cd mcp-server

# Install dependencies
npm install

# Build
npm run build
```

This creates `build/index.js` — the entry point that MCP clients will run.

---

## Step 2: Get Your API Key

If you don't already have one:
```bash
curl -X POST https://yourdomain.com/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "mcp@yourdomain.com", "name": "MCP Server"}'
```

Copy the returned `atb_...` key.

---

## Step 3: Connect to Claude Desktop

### 3a. Find your config file

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

### 3b. Add the MCP server config

Open the config file and add (or merge into existing `mcpServers`):

```json
{
  "mcpServers": {
    "agent-toolbelt": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/agent-toolbelt/mcp-server/build/index.js"],
      "env": {
        "AGENT_TOOLBELT_URL": "https://yourdomain.com",
        "AGENT_TOOLBELT_KEY": "atb_your_key_here"
      }
    }
  }
}
```

**Important:** Replace `/ABSOLUTE/PATH/TO/` with the actual absolute path to the `mcp-server` directory on your machine.

### 3c. Restart Claude Desktop

Close and reopen Claude Desktop. You should see a hammer icon (🔨) in the chat input area with a number showing how many tools are available. Click it to verify `generate_schema`, `extract_from_text`, and `list_tools` appear.

### 3d. Test it

Try these prompts in Claude Desktop:

> "Generate a JSON schema for a blog post with title, author, content, tags, and publish date"

> "Extract all emails and phone numbers from this text: Contact alice@acme.com or bob@startup.io, call (415) 555-0100 or +1 212-555-0199"

> "What tools are available in the Agent Toolbelt?"

Claude will ask for your permission before calling each tool — this is the "human in the loop" safety feature.

---

## Step 4: Connect to Claude Code

Claude Code reads MCP config from a `.mcp.json` file in your project root.

### 4a. Create `.mcp.json` in any project

```json
{
  "mcpServers": {
    "agent-toolbelt": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/agent-toolbelt/mcp-server/build/index.js"],
      "env": {
        "AGENT_TOOLBELT_URL": "https://yourdomain.com",
        "AGENT_TOOLBELT_KEY": "atb_your_key_here"
      }
    }
  }
}
```

### 4b. Verify in Claude Code

Run `/mcp` in Claude Code to see connected servers and their status.

---

## Step 5: Connect to VS Code (Copilot MCP)

VS Code supports MCP servers via its Copilot integration.

### 5a. Open MCP config

Press `Ctrl+Shift+P` → type "MCP: Open User Configuration"

### 5b. Add Agent Toolbelt

```json
{
  "agent-toolbelt": {
    "command": "node",
    "args": ["/ABSOLUTE/PATH/TO/agent-toolbelt/mcp-server/build/index.js"],
    "type": "stdio",
    "env": {
      "AGENT_TOOLBELT_URL": "https://yourdomain.com",
      "AGENT_TOOLBELT_KEY": "atb_your_key_here"
    }
  }
}
```

---

## Step 6: Test with MCP Inspector

The MCP Inspector is a visual debugging tool:

```bash
cd mcp-server

# Set env vars
export AGENT_TOOLBELT_URL=https://yourdomain.com
export AGENT_TOOLBELT_KEY=atb_your_key_here

# Launch inspector
npm run inspector
```

This opens a browser UI where you can:
- See all registered tools, resources, and prompts
- Call tools interactively and inspect requests/responses
- Debug issues before connecting to Claude

---

## Adding New Tools

When you add a new tool to the Agent Toolbelt API, add a matching `server.registerTool()` call in `mcp-server/src/index.ts`:

```typescript
server.registerTool(
  "my_new_tool",
  {
    title: "My New Tool",
    description: "What this tool does — be descriptive, Claude uses this to decide when to call it",
    inputSchema: {
      myParam: z.string().describe("Description of this parameter"),
    },
  },
  async ({ myParam }) => {
    const result = await callToolApi("my-new-tool", { myParam });
    const data = result as any;

    return {
      content: [
        {
          type: "text" as const,
          text: `Result: ${JSON.stringify(data.result, null, 2)}`,
        },
      ],
    };
  }
);
```

Then rebuild: `npm run build`

Claude Desktop / Code will pick up the new tool after a restart.

---

## Publishing to npm (Optional)

If you want users to install your MCP server with `npx`:

```bash
cd mcp-server

# Update package.json name to something unique
# e.g., "name": "@yourorg/agent-toolbelt-mcp"

npm login
npm publish --access public
```

Then users can configure Claude Desktop with:

```json
{
  "mcpServers": {
    "agent-toolbelt": {
      "command": "npx",
      "args": ["-y", "@yourorg/agent-toolbelt-mcp"],
      "env": {
        "AGENT_TOOLBELT_URL": "https://yourdomain.com",
        "AGENT_TOOLBELT_KEY": "atb_their_key_here"
      }
    }
  }
}
```

This is a great distribution channel — anyone can install your tools with one config change.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Hammer icon missing in Claude Desktop | Check config path, ensure `node` is in your PATH, restart Claude |
| "Connection failed" | Run `node build/index.js` manually to see errors; check the env vars |
| Tool calls return errors | Verify `AGENT_TOOLBELT_URL` and `AGENT_TOOLBELT_KEY` are correct |
| "Module not found" | Run `npm run build` again; make sure you're pointing to `build/index.js` |
| No response from tools | Never use `console.log()` in MCP servers — it corrupts the stdio transport. Use `console.error()` instead |
| VS Code doesn't show tools | Check `Ctrl+Shift+P` → "MCP: List Servers" to see connection status |

---

## Files Reference

| File | Purpose |
|------|---------|
| `mcp-server/src/index.ts` | MCP server source — tools, resources, prompts |
| `mcp-server/package.json` | Dependencies and build scripts |
| `mcp-server/tsconfig.json` | TypeScript config (ESM, Node16 modules) |
| `mcp-server/build/index.js` | Built entry point (what Claude runs) |

---

## Revenue Impact

Every tool call from Claude Desktop / Code / VS Code hits your Agent Toolbelt API the same as any other client:

- **Claude Desktop users** → casual exploration, schema generation, text extraction
- **Claude Code users** → developer workflows, automated schema creation during coding
- **VS Code Copilot users** → inline tool usage during development

All of these are authenticated, rate-limited, usage-tracked, and billable. The more MCP clients connect, the more API calls you earn from.
