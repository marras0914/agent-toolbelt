# agent-toolbelt-mcp

MCP server for [Agent Toolbelt](https://agent-toolbelt-production.up.railway.app) — gives Claude real-time stock research capabilities. Five AI-powered analysis tools that pull live data from Polygon.io, Finnhub, and Financial Modeling Prep, then synthesize it into structured investment analysis.

Try the valuation snapshot live (no signup): [agent-toolbelt-production.up.railway.app](https://agent-toolbelt-production.up.railway.app)

## Install

### Claude Code

```bash
claude mcp add agent-toolbelt \
  -e AGENT_TOOLBELT_KEY=atb_your_key_here \
  -- npx -y agent-toolbelt-mcp
```

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

## Get an API key

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

Free tier: 1,000 calls/month, no credit card required.

---

## Stock Research Tools

Five tools that give Claude live market data and AI-synthesized analysis. Each call pulls from multiple financial APIs in parallel and returns structured JSON. ~4–5 seconds per call.

| Tool | What it does |
|---|---|
| `stock_thesis` | Full investment thesis: bullish/neutral/bearish verdict, 2–3 paragraph analysis, key strengths, risks, valuation read, insider interpretation, what to watch next earnings |
| `earnings_analysis` | EPS beat/miss history across 12 quarters, revenue trend classification, long-term consistency read, upcoming earnings date |
| `insider_signal` | Form 4 interpretation: distinguishes meaningful open-market purchases from routine option exercises → strong_buy to strong_sell signal + confidence rating |
| `valuation_snapshot` | P/E, P/S, EV/EBITDA, FCF yield, ROE → cheap/fair/expensive verdict + specific buy zone |
| `bear_vs_bull` | 3 bull + 3 bear arguments steelmanned with real data, net verdict, key debate question, who the stock suits |

### Example

Once installed, ask Claude:

> *"Give me a full analysis of NVDA — thesis, earnings quality, insider activity, and whether it's cheap right now."*

Claude calls the tools in parallel and synthesizes a complete research note. Here's what `stock_thesis` returns for NVDA:

**Verdict:** Bullish
**One-liner:** "Nvidia owns the essential infrastructure for the AI revolution with a defensible software moat, but the valuation demands flawless execution."

**Key Strengths:**
- Dominant ~80%+ data center GPU market share
- CUDA moat creates switching costs and customer lock-in
- 42 buy / 5 hold / 1 sell analyst consensus

**Insider Read:** Mixed — two executives bought ~47k shares each in March (positive), offset by routine selling from others.

**Watch For Next Earnings:** Data center revenue growth rate. Deceleration below 30% YoY would signal the boom is maturing.

---

## Utility Tools

20 additional tools for common agent tasks.

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
| `optimize_prompt` | Score and rewrite LLM prompts for clarity and specificity |
| `extract_meeting_action_items` | Action items, decisions, and summary from meeting notes |
| `summarize_url` | Fetch and summarize any URL |
| `compare_documents` | Semantic diff between two document versions |
| `extract_contract_clauses` | Key clauses + risk flags from contracts |
| `mock_api_response` | Realistic mock data from a JSON Schema |
| `audit_dependencies` | CVE scan for npm/PyPI packages via OSV database |
| `pack_context_window` | Pack content into a token budget |
| `strip_image_metadata` | Remove EXIF/GPS metadata from images |

---

## Pricing

- **Free tier:** 1,000 calls/month, no credit card
- **Stock analysis tools:** $0.05/call (PAYG)
- **Most utility tools:** $0.001–$0.005/call

---

## License

MIT
