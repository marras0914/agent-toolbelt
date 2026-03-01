# Hacker News Post

**Title:**
Show HN: Agent Toolbelt – 16 focused API tools for LLM agents (contract review, prompt optimizer, meeting notes, and more)

---

**Body:**

I kept rebuilding the same small utilities across agent projects. Eventually packaged them as a focused API — each tool does one thing, billed per call.

Started with the obvious stuff (token counting, text extraction, CSV conversion). Recently added four LLM-powered tools that are more interesting:

- **Contract clause extractor** — paste in a contract, get back structured parties/payment terms/termination/IP/liability clauses plus risk flags with severity ratings and plain-English explanations ($0.10/call)
- **Document comparator** — semantic diff of any two text versions. Identifies additions, deletions, modifications with significance ratings. Works on contracts, READMEs, policies, anything ($0.05/call)
- **Meeting notes → action items** — extracts owners, deadlines, priorities, decisions, and a summary from raw transcripts or bullet notes ($0.05/call)
- **Prompt optimizer** — scores LLM prompts on clarity, specificity, structure, and completeness, then rewrites them with a changelog ($0.05/call)

Plus 12 rule-based tools: token counter (exact via tiktoken + cost estimates), text extractor, CSV→JSON, HTML↔Markdown, URL metadata, schema generator, regex builder, cron builder, address normalizer, color palette, brand kit, image EXIF stripper.

Ships three ways:
- npm: `npm install agent-toolbelt` — typed client + 16 LangChain DynamicStructuredTools
- Claude MCP: `npx -y agent-toolbelt-mcp` — works in Claude Desktop and Claude Code
- OpenAI GPT Actions — OpenAPI spec at /openapi/openapi-gpt-actions.json

Free tier: 1,000 calls/month, no credit card.

https://agent-toolbelt-production.up.railway.app
