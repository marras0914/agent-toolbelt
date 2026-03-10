---
title: "How to Build a Research Agent in 30 Lines of TypeScript"
description: "Most research agents are 80% plumbing. Here's how to strip that down to what actually matters."
tags: ["ai", "typescript", "agents", "llm", "productivity"]
cover_image: https://agent-toolbelt-production.up.railway.app/og.png
published: true
---

Building a research agent sounds hard. It isn't — once you stop reimplementing the plumbing.

The typical research agent has three jobs: fetch content from the web, figure out what's relevant, and produce something structured. Most tutorials spend 200 lines doing the fetch-and-parse part. The actual agent logic gets three paragraphs at the end.

Here's a version that inverts that ratio.

---

## What the agent does

Given a topic and a list of URLs, the agent:

1. Fetches each URL and extracts the main content as clean Markdown
2. Summarizes each page with a focus on the topic
3. Checks whether the combined content fits in the model's context window
4. Synthesizes a final answer from what fits

No scraping library. No HTML parser. No tokenizer setup. Four API calls.

---

## The setup

```bash
npm install agent-toolbelt openai
```

```bash
# Get a free API key (1,000 calls/month)
curl -X POST https://agent-toolbelt-production.up.railway.app/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

```typescript
import { AgentToolbelt } from "agent-toolbelt";
import OpenAI from "openai";

const toolbelt = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY! });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
```

---

## Step 1: Fetch and summarize each URL

The `web-summarizer` tool fetches a URL, strips out navigation, ads, and boilerplate, converts the content to clean Markdown, and runs it through Claude to produce a summary. You get structured output you can actually work with.

```typescript
async function researchUrl(url: string, topic: string) {
  const result = await toolbelt.webSummarizer({
    url,
    mode: "both",      // return both full content and summary
    focus: topic,      // summarize with this specific angle
  });

  if (!result.content) return null;

  return {
    url,
    summary: result.summary,   // { title, summary, keyPoints, contentType }
    content: result.content,   // clean Markdown
    characterCount: result.characterCount,
  };
}
```

The `focus` parameter is what makes this actually useful. "Pricing and API limits" gives you a different summary than "technical architecture" from the same page.

---

## Step 2: Check what fits in context

Before sending anything to your LLM, count the tokens. Running out of context mid-synthesis is a frustrating failure mode that's easy to prevent.

```typescript
async function packContext(pages: Awaited<ReturnType<typeof researchUrl>>[]) {
  const validPages = pages.filter(Boolean) as NonNullable<typeof pages[number]>[];

  // Build the full context string from all summaries
  const fullContext = validPages
    .map((p) => `## ${p.summary?.title ?? p.url}\n\n${p.content}`)
    .join("\n\n---\n\n");

  // Count tokens before committing
  const tokenResult = await toolbelt.tokenCounter({
    text: fullContext,
    models: ["gpt-4o"],
  });

  const { tokens, contextWindow } = tokenResult.results["gpt-4o"];
  const percentUsed = (tokens / contextWindow) * 100;

  console.log(`Context: ${tokens.toLocaleString()} tokens (${percentUsed.toFixed(1)}% of GPT-4o window)`);

  if (percentUsed > 75) {
    // Too much — use summaries only instead of full content
    console.log("Switching to summaries-only to fit context window");
    return validPages
      .map((p) => `## ${p.summary?.title ?? p.url}\n\n${p.summary?.summary}\n\nKey points:\n${p.summary?.keyPoints.map((k: string) => `- ${k}`).join("\n")}`)
      .join("\n\n---\n\n");
  }

  return fullContext;
}
```

This is the pattern I use in every agent that handles variable-length input: count first, make a decision, then call the LLM. It prevents runtime failures and makes the behavior explicit rather than hopeful.

---

## Step 3: Synthesize

```typescript
async function synthesize(context: string, topic: string, question: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a research assistant. You have been given content from ${topic}-related web pages. Answer the user's question based only on the provided content. Be specific and cite which source each claim comes from.`,
      },
      {
        role: "user",
        content: `Research context:\n\n${context}\n\n---\n\nQuestion: ${question}`,
      },
    ],
  });

  return response.choices[0].message.content;
}
```

---

## Putting it together

```typescript
async function researchAgent(params: {
  topic: string;
  question: string;
  urls: string[];
}) {
  const { topic, question, urls } = params;

  console.log(`Researching: ${question}`);
  console.log(`Sources: ${urls.length} URLs\n`);

  // Fetch and summarize all URLs in parallel
  const pages = await Promise.all(urls.map((url) => researchUrl(url, topic)));

  // Pack into context window
  const context = await packContext(pages);

  // Synthesize answer
  const answer = await synthesize(context, topic, question);

  return { answer, sources: urls };
}
```

---

## Running it

```typescript
const result = await researchAgent({
  topic: "TypeScript build tools",
  question: "What are the main differences between tsup, esbuild, and tsc for building TypeScript libraries?",
  urls: [
    "https://tsup.egoist.dev",
    "https://esbuild.github.io",
    "https://www.typescriptlang.org/docs/handbook/compiler-options.html",
  ],
});

console.log(result.answer);
```

Output:
```
Based on the provided content:

**tsup** is a zero-config bundler built on esbuild. It handles CJS/ESM dual output,
TypeScript declarations (.d.ts), and tree-shaking out of the box. Best for library authors
who want fast builds without configuration overhead.

**esbuild** is the underlying bundler — raw speed (10-100x faster than tsc), but requires
more manual configuration for TypeScript declarations and dual module output. Best when
you need fine-grained control or are building an application rather than a library.

**tsc** is the TypeScript compiler itself — slowest, but the authoritative source for
type checking. Many setups use esbuild/tsup for bundling and tsc --noEmit for type
checking only.

Sources: tsup.egoist.dev, esbuild.github.io, typescriptlang.org
```

---

## Why this works

The agent is 30 lines of orchestration. Everything else — HTML parsing, content extraction, token counting, summarization — is delegated to API calls that handle the mechanics.

The interesting parts are:
- **The `focus` parameter** on web-summarizer. Asking for "pricing" vs "architecture" vs "use cases" from the same URL gives completely different and useful summaries.
- **The context check** before synthesis. Without this, long pages silently cause context overflow. With it, you get a graceful fallback and a log message explaining what happened.
- **Parallel fetching** with `Promise.all`. Research agents that fetch URLs sequentially are unnecessarily slow.

---

## Extensions

A few directions worth exploring from here:

**Add a search step.** Let the agent search for URLs rather than requiring them upfront. The `web-summarizer` pairs well with a search API — search for the topic, get the top 5 URLs, summarize them, synthesize.

**Extract structured data.** If you need the research output in a specific format, run the synthesis result through `schema-generator` to get a Zod schema, then validate the output. Useful when the agent feeds into downstream systems.

**Build a monitoring loop.** Run the same research agent weekly against a set of URLs (competitor pages, documentation, news sources) and use `document-comparator` to diff the summaries against last week's run. You get a change detection system for any set of web pages.

---

## Getting started

```bash
npm install agent-toolbelt
```

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/clients/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

Free tier: 1,000 calls/month, no credit card required. The research agent above uses 3 calls per URL (web-summarizer + token-counter) plus 1 for synthesis — about 10 URLs per 30 calls.

---

*Agent Toolbelt is a collection of 20 focused API tools for developers building on top of LLMs. [See all tools →](https://agent-toolbelt-production.up.railway.app)*
