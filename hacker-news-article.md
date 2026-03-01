I kept rebuilding the same small utilities across agent projects — counting tokens before LLM calls, extracting structured data from raw text, converting HTML to Markdown for context windows, normalizing addresses. Packaged them as a focused API with per-call pricing.

11 tools live:

- Token counter (exact via tiktoken for OpenAI, approximated for Claude) + cost estimates
- Text extractor (emails, URLs, phones, dates, currencies, addresses, names)
- CSV → typed JSON with auto delimiter detection and type casting
- HTML ↔ Markdown converter
- URL metadata (title, OG tags, favicon, author, publish date)
- Schema generator (JSON Schema / TypeScript / Zod from plain English)
- Regex builder, cron builder, address normalizer, color palette generator

Ships as an npm package (agent-toolbelt) with a typed client and LangChain DynamicStructuredTool wrappers. Also works as a Claude MCP server and OpenAI GPT Action.

Free tier: 1,000 calls/month, no credit card.

https://agent-toolbelt-roduction.up.railway.app
