# Reddit Posts

---

## r/LocalLLaMA

**Title:**
I built 20 API tools for LLM developers — token counting, schema gen, prompt optimizer, web summarizer, and more. Free tier, open to feedback.

**Post:**
Been building agents on top of local and hosted LLMs for a while and kept running into the same friction: all the infrastructure around the model takes longer than the model itself.

Token counting is the big one. Every model counts differently, tiktoken has quirks with system prompts and multi-turn conversations, and adding it properly to a project is more involved than it looks. Same with generating JSON schemas, writing regex patterns, cleaning up HTML before ingestion, parsing meeting notes into structured data.

I packaged all of it into Agent Toolbelt — 20 focused API endpoints, one shared key:

- **token-counter** — counts across GPT-4o, Claude 3.5, Gemini, Llama 3, Mistral, etc. Returns tokens, context window size, and estimated cost per model so you can compare before committing
- **web-summarizer** — fetches a URL, strips nav/ads/boilerplate, returns clean Markdown + an AI summary with key points. Useful for feeding web content to local models without the noise
- **context-window-packer** — given a list of documents and a token budget, selects the best subset that fits. Solves the "I have 10 docs but only room for 3" problem
- **schema-generator** — describe your data in English, get back JSON Schema / TypeScript / Zod
- **prompt-optimizer** — Claude analyzes your prompt and returns a scored, improved version with a diff of what changed
- **regex-builder**, **cron-builder**, **text-extractor**, **document-comparator**, **dependency-auditor**, and 10 more

TypeScript SDK (`npm install agent-toolbelt`), LangChain tool wrappers, and an MCP server (`npx agent-toolbelt-mcp`) if you want to use the tools directly from Claude Desktop or Claude Code.

Free tier: 1,000 calls/month, no credit card.

https://agent-toolbelt-production.up.railway.app

Happy to answer questions or take feature requests. What tools would actually be useful for your local model workflows?

---

## r/ChatGPTCoding

**Title:**
I got tired of writing the same boilerplate for every AI project — so I turned it into 20 API tools. Schema gen, regex builder, prompt optimizer, web scraper, token counter, and more.

**Post:**
Every AI coding project I start ends up with the same 500 lines of infrastructure code before I write a single line of actual logic: token counting, JSON schema generation, HTML cleanup, regex patterns for data extraction, prompt iteration.

None of it is interesting. It's the tax you pay to build something interesting.

I built Agent Toolbelt to eliminate that tax. 20 focused endpoints that each do one thing:

**For coding workflows:**
- **schema-generator** — describe your data structure in plain English, get back JSON Schema, TypeScript interface, or Zod schema. I use this constantly when building tools that need to validate LLM output.
- **regex-builder** — describe the pattern you want in English, get back a tested regex with an explanation and code snippets. No more regex101 sessions.
- **dependency-auditor** — check npm or PyPI packages for known CVEs. Useful before adding a new dep to an AI project.
- **api-response-mocker** — give it a JSON schema, get back realistic mock data. Good for testing without hitting real APIs.

**For agent/LLM workflows:**
- **token-counter** — count tokens across models before making API calls. Multi-model: pass `["gpt-4o", "claude-3-5-sonnet"]` and compare.
- **prompt-optimizer** — paste your prompt, get back a scored rewrite with a diff of what changed and why. I run every production prompt through this once before shipping.
- **web-summarizer** — fetch any URL, get clean Markdown + AI summary with key points. Great for agents that need to read web content.
- **context-window-packer** — fits the most relevant content into a token budget. Solves context overflow before it happens.
- **text-extractor** — pull emails, phones, dates, currencies, addresses from messy text. No regex required.

TypeScript SDK: `npm install agent-toolbelt`

```typescript
import { AgentToolbelt } from "agent-toolbelt";
const toolbelt = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY });

const schema = await toolbelt.schemaGenerator({ description: "a SaaS user with name, email, plan, and usage", format: "zod" });
const { pattern } = await toolbelt.regexBuilder({ description: "US phone numbers in any format" });
const { optimizedPrompt } = await toolbelt.promptOptimizer({ prompt: myPrompt, mode: "rewrite" });
```

Also has LangChain tool wrappers and an MCP server if you use Claude Desktop/Code.

Free tier: 1,000 calls/month, no credit card.

https://agent-toolbelt-production.up.railway.app

What other tools would be useful? Always looking for what's actually painful to build by hand.
