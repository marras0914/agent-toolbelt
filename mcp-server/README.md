# agent-toolbelt-mcp

MCP server for [Agent Toolbelt](https://agent-toolbelt-production.up.railway.app) — exposes 11 focused API tools to Claude Desktop, Claude Code, VS Code, and any MCP-compatible client.

## Install

No global install needed. Just add it to your MCP config.

### Claude Desktop

Add to `claude_desktop_config.json`:

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

### Claude Code

```bash
claude mcp add agent-toolbelt -e AGENT_TOOLBELT_KEY=atb_your_key -- npx -y agent-toolbelt-mcp
```

## Get an API key

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

Free tier: 1,000 calls/month, no credit card required.

---

## Tools

| Tool | What it does |
|---|---|
| `generate_schema` | JSON Schema / TypeScript / Zod from a description |
| `extract_from_text` | Extract emails, phones, URLs, dates, currencies from text |
| `convert_markdown` | HTML ↔ Markdown conversion |
| `fetch_url_metadata` | Title, OG tags, author, favicon from any URL |
| `count_tokens` | Token counts + cost estimates across 15 LLM models |
| `csv_to_json` | CSV to typed JSON with auto delimiter and type casting |
| `normalize_address` | US address → USPS format with component parsing |
| `generate_color_palette` | Color palettes with WCAG scores and CSS variables |
| `build_cron` | Natural language → cron expression with next-run preview |
| `build_regex` | Natural language → regex with JS/Python/TS snippets |
| `generate_brand_kit` | Full brand kit — colors, typography, CSS/Tailwind tokens |

---

## Example usage in Claude

Once configured, Claude can use the tools directly:

> "Extract all email addresses and phone numbers from this contract text..."

> "Count the tokens in this document for GPT-4o and Claude 3.5 Sonnet..."

> "Generate a color palette for a calm fintech app with WCAG scores..."

> "Convert this HTML page to clean Markdown..."

---

## License

MIT
