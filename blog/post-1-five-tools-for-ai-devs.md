---
title: "5 API Tools That Save AI Developers Hours of Boilerplate"
description: "When you're building AI agents, you end up writing the same utility code over and over. Here are five focused APIs that handle the tedious parts so you can focus on what matters."
tags: ["ai", "devtools", "productivity", "llm"]
cover_image: https://agent-toolbelt-production.up.railway.app/og.png
published: true
---

When I started building AI agents seriously, I noticed a pattern: 80% of my time wasn't going into the agent logic — it was going into the *infrastructure around the agent logic*. Counting tokens before making API calls. Writing JSON schemas by hand. Debugging regex patterns. Cleaning up GPT output so it was actually useful.

None of this is interesting work. It's the tax you pay to build something interesting.

I built Agent Toolbelt to eliminate that tax. Each tool is a focused, pay-per-call API endpoint that does one thing well. Here are the five I reach for constantly.

---

## 1. [Token Counter](https://tokens.elephanttortoise.com) — Know Your Context Limits Before You Hit Them

If you've ever gotten a `context_length_exceeded` error mid-agent-run, you know the pain. Token counting feels like it should be trivial, but every model counts differently, and the `tiktoken` library has non-obvious behavior for different models.

**The API:**
```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/token-counter \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Analyze the following document and extract key action items...",
    "model": "gpt-4o"
  }'
```

**Response:**
```json
{
  "tokens": 14,
  "model": "gpt-4o",
  "limit": 128000,
  "remaining": 127986,
  "percentUsed": 0.01
}
```

I use this before every LLM call in my agents to decide whether to summarize context, chunk documents, or proceed as-is. It's replaced about 200 lines of token management code across my projects.

---

## 2. [Schema Generator](https://schema.elephanttortoise.com) — Stop Writing JSON Schemas by Hand

JSON Schema is powerful and absolutely miserable to write. TypeScript interfaces are better, but converting between them is a chore. This tool takes a sample JSON object and generates both.

**The API:**
```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/schema-generator \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "userId": "usr_123",
      "email": "user@example.com",
      "plan": "pro",
      "createdAt": "2024-01-15T10:30:00Z"
    },
    "format": "typescript"
  }'
```

**Response:**
```json
{
  "schema": "interface Output {\n  userId: string;\n  email: string;\n  plan: string;\n  createdAt: string;\n}",
  "format": "typescript"
}
```

This is especially useful when you're working with undocumented APIs or extracting structured data from LLM output. Paste the example, get the schema, move on.

---

## 3. [Regex Builder](https://regex.elephanttortoise.com) — Describe It in English, Get the Pattern

Regex is one of those things where the write-once-debug-forever rule really applies. `^[\w.]+@[\w]+\.[\w.]+$` is not readable. The regex builder lets you describe what you want in plain English and get a working pattern with an explanation.

**The API:**
```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/regex-builder \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Match US phone numbers in formats like (555) 123-4567, 555-123-4567, or 5551234567",
    "testString": "Call us at (555) 123-4567 or 555.987.6543"
  }'
```

**Response:**
```json
{
  "pattern": "\\(?\\d{3}\\)?[\\s.\\-]?\\d{3}[\\s.\\-]?\\d{4}",
  "flags": "g",
  "explanation": "Matches US phone numbers with optional parentheses around area code, separated by spaces, dots, or hyphens",
  "matches": ["(555) 123-4567", "555.987.6543"]
}
```

In agent workflows, I use this for data extraction and validation. Tell the agent what format you want, get the regex, apply it to your pipeline.

---

## 4. [Prompt Optimizer](https://prompts.elephanttortoise.com) — Make Your Prompts Actually Work

This one is powered by Claude and it has saved my agents from a lot of mediocre output. You pass it a prompt and it returns an improved version with an explanation of what changed and why.

**The API:**
```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/prompt-optimizer \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Summarize this document",
    "goal": "Extract key decisions and action items for a project manager"
  }'
```

**Response:**
```json
{
  "optimizedPrompt": "You are a project management assistant. Review the following document and produce a structured summary that includes: (1) Key decisions made, with context, (2) Action items with owner and deadline if mentioned, (3) Open questions requiring follow-up. Format your response as a bulleted list under each section.",
  "changes": [
    "Added a clear role/persona to orient the model",
    "Made the output format explicit with three specific sections",
    "Specified structured formatting to ensure consistent, parseable output"
  ],
  "estimatedImprovement": "High — original prompt was ambiguous about scope and format"
}
```

I run new prompts through this before adding them to production agents. The `changes` array is particularly useful for learning — it teaches you what prompt engineering principles are being applied.

---

## 5. [Meeting Action Items](https://meetings.elephanttortoise.com) — Turn Notes into Tasks Instantly

This is the one non-developers ask me about most. Paste raw meeting notes — however messy — and get back structured action items with owners and deadlines. Also Claude-powered.

**The API:**
```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/meeting-action-items \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Sync call with Sarah and Mike. We agreed to push the launch to March 15. Mike needs to finish the billing integration by EOD Friday. Sarah will update the docs and send them to the team by Wednesday. We still need to decide on pricing — Mike will put together a proposal next week. Action: I need to email the investors by tomorrow."
  }'
```

**Response:**
```json
{
  "actionItems": [
    { "task": "Finish billing integration", "owner": "Mike", "deadline": "Friday EOD" },
    { "task": "Update docs and send to team", "owner": "Sarah", "deadline": "Wednesday" },
    { "task": "Put together pricing proposal", "owner": "Mike", "deadline": "Next week" },
    { "task": "Email the investors", "owner": "You", "deadline": "Tomorrow" }
  ],
  "summary": "Launch pushed to March 15. Four action items assigned across three owners. Pricing decision pending Mike's proposal."
}
```

This integrates cleanly into any workflow automation — Zapier, Make, n8n, or directly in your agent.

---

## Getting Started

All five tools are available under the same API key. The pricing is per-call: most tools are a fraction of a cent, the LLM-powered ones (prompt-optimizer and meeting-action-items) are $0.05/call.

```bash
# Get an API key
curl -X POST https://agent-toolbelt-production.up.railway.app/api/keys \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

Or use the [TypeScript SDK](https://www.npmjs.com/package/agent-toolbelt):

```typescript
import { AgentToolbelt } from "agent-toolbelt";

const toolbelt = new AgentToolbelt({ apiKey: process.env.TOOLBELT_KEY });

const { tokens } = await toolbelt.tokenCounter({ text: myPrompt, model: "gpt-4o" });
const { optimizedPrompt } = await toolbelt.promptOptimizer({ prompt: myPrompt, goal: "..." });
```

The LangChain integration is also available if you're building with agents:

```typescript
import { createLangChainTools } from "agent-toolbelt/langchain";

const tools = createLangChainTools({ apiKey: process.env.TOOLBELT_KEY });
// Drop into any LangChain agent executor
```

Stop paying the boilerplate tax. These five calls handle the tedious parts so you can focus on the parts that actually matter.

---

*Agent Toolbelt is a collection of focused, pay-per-call API tools for AI developers. [See all 14 tools →](https://agent-toolbelt-production.up.railway.app)*
