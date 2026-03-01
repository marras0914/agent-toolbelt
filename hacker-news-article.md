I kept rebuilding the same small utilities across agent projects — counting tokens before LLM calls, extracting structured data from raw text, converting HTML to Markdown for context windows, normalizing addresses. Packaged them as a focused API with per-call pricing.

16 tools live:

**Data & transformation (rule-based, fast, cheap)**
- Token counter — exact via tiktoken for OpenAI models, approximated for Claude — with cost estimates
- Text extractor — emails, URLs, phones, dates, currencies, addresses, names from raw text
- CSV → typed JSON with auto delimiter detection and type casting
- HTML ↔ Markdown converter
- URL metadata — title, OG tags, favicon, author, publish date
- Schema generator — JSON Schema / TypeScript / Zod from plain English
- Regex builder, cron builder, address normalizer, color palette, brand kit, image EXIF stripper

**LLM-powered tools (Claude Haiku, $0.05–$0.10/call)**
- Meeting notes → action items — extracts owners, deadlines, priorities, decisions, and summary
- Prompt optimizer — scores and rewrites LLM prompts (clarity, specificity, structure, completeness)
- Document comparator — semantic diff of any two text versions with significance ratings
- Contract clause extractor — pulls parties, payment terms, termination, IP, liability, risks from legal docs

Ships as:
- npm package (`agent-toolbelt`) — typed client + LangChain DynamicStructuredTool wrappers
- Claude MCP server (`agent-toolbelt-mcp`) — works in Claude Desktop and Claude Code
- OpenAI GPT Actions — OpenAPI spec at /openapi/openapi-gpt-actions.json

Free tier: 1,000 calls/month, no credit card.

https://agent-toolbelt-production.up.railway.app
