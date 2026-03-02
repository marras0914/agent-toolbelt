---
title: "Three API Calls That Make Your LLM Workflow Dramatically Better"
description: "Token overflows, weak prompts, and manual meeting cleanup are three problems you shouldn't be solving by hand. Here's how I automated them."
tags: ["llm", "ai", "productivity", "agents"]
cover_image: https://agent-toolbelt-production.up.railway.app/og.png
published: true
---

Building on top of LLMs is mostly a problem of plumbing. The model itself is capable. The hard part is everything around it: managing context, crafting prompts that reliably produce good output, and dealing with all the unstructured text that needs to become structured data.

Three tools in my stack handle the most common versions of these problems. Here's how I use them.

---

## Problem 1: Context Overflows (Token Counter)

If you're building any agent that processes documents, maintains conversation history, or chains multiple LLM calls, you've hit this error:

```
openai.BadRequestError: This model's maximum context length is 128000 tokens.
However, your messages resulted in 134521 tokens.
```

The naive fix is to truncate blindly. The real fix is to count tokens before you make the call and make a decision.

The problem is token counting is model-specific, non-obvious, and the libraries that do it (`tiktoken`, `@dqbd/tiktoken`) have quirks around special tokens, system prompts, and multi-turn conversations that make "just add it to your project" more involved than it sounds.

### The API approach

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/token-counter \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "{{ full conversation history + document here }}",
    "model": "gpt-4o"
  }'
```

```json
{
  "tokens": 89432,
  "model": "gpt-4o",
  "limit": 128000,
  "remaining": 38568,
  "percentUsed": 69.87
}
```

The `percentUsed` and `remaining` fields let you make branching decisions without calculating anything:

```typescript
import { AgentToolbelt } from "agent-toolbelt";

const toolbelt = new AgentToolbelt({ apiKey: process.env.TOOLBELT_KEY });

async function prepareContext(history: Message[], document: string) {
  const fullContext = buildContextString(history, document);

  const { percentUsed, remaining } = await toolbelt.tokenCounter({
    text: fullContext,
    model: "gpt-4o",
  });

  if (percentUsed > 80) {
    // Summarize old history before proceeding
    return await summarizeHistory(history, remaining);
  }

  if (percentUsed > 95) {
    // Chunk the document instead of including the full thing
    return await chunkAndProcess(document);
  }

  return fullContext;
}
```

This pattern — count first, decide, then call — prevents runtime failures and makes context management explicit rather than a guessing game.

I check token counts at three points in any agent that handles variable-length input:
1. Before appending to conversation history
2. Before adding a retrieved document to the context
3. Before the final LLM call, as a sanity check

---

## Problem 2: Weak Prompts (Prompt Optimizer)

Here's an uncomfortable truth: most prompts in production agents are not good. Not because the developer is bad at writing prompts, but because:

1. Prompt engineering is a craft that takes iteration to get right
2. The first draft usually works "well enough" and never gets revisited
3. What "well enough" means becomes clear only when edge cases fail

The prompt optimizer is powered by Claude and takes your prompt plus a description of your goal and returns a better version with an explanation of what changed.

### What this looks like in practice

Original prompt:
```
Analyze this customer feedback and tell me what's wrong.
```

Goal: "Categorize issues by type and severity so a product manager can prioritize fixes"

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/prompt-optimizer \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analyze this customer feedback and tell me what what'\''s wrong.",
    "goal": "Categorize issues by type and severity so a product manager can prioritize fixes"
  }'
```

Optimized prompt:
```
You are a product analyst reviewing customer feedback. Analyze the following feedback and categorize every issue you find.

For each issue, provide:
- **Category**: Bug / UX Problem / Missing Feature / Performance / Other
- **Severity**: Critical (blocks usage) / High (significant friction) / Medium (noticeable but workaround exists) / Low (minor inconvenience)
- **Description**: One sentence describing the specific issue
- **Quote**: The exact phrase from the feedback that indicates this issue

Format your response as a structured list. If no issues are present, say so explicitly.
```

Changes explained:
- Added a clear analyst persona to orient the model's reasoning
- Defined explicit categories and severity levels to remove ambiguity
- Required a direct quote to keep the analysis grounded in the actual feedback
- Specified format explicitly so the output is consistent and parseable

The `changes` array is the part I find most valuable long-term. It's effectively prompt engineering education inline with the work — you can see which principles are being applied and why, which improves your own prompts over time.

### My workflow

Every new prompt I write for a production agent goes through the optimizer once before it ships. I treat the optimized version as a starting point, not a final answer — sometimes I override specific changes, sometimes I take it wholesale.

For A/B testing:
```typescript
const { optimizedPrompt, changes } = await toolbelt.promptOptimizer({
  prompt: currentPrompt,
  goal: "Extract structured contact information from business card text",
});

// Run both in shadow mode, compare output quality
const [originalResult, optimizedResult] = await Promise.all([
  callLLM(currentPrompt, testInput),
  callLLM(optimizedPrompt, testInput),
]);
```

At $0.05/call, running every significant prompt through this once is the cheapest prompt engineering review you can get.

---

## Problem 3: Meeting Notes to Action Items (Meeting Action Items)

This one isn't strictly an LLM-workflow problem — it's a general productivity problem. But it shows up constantly in agent builds because meeting notes are one of the most common forms of unstructured text that needs to become structured data.

The gap between "notes from a meeting" and "tasks in a project management tool" is always a human doing manual extraction. It shouldn't be.

### The API

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/meeting-action-items \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Sprint planning with the team. Decided to delay the billing feature to next sprint — the payment gateway integration is taking longer than expected. Alex is going to refactor the auth module by Thursday. Need Jamie to write up the new onboarding flow specs before our next sync on Friday. I should review the Q4 metrics and send a report to leadership by EOW. Still undecided on whether to use Stripe or Braintree — Alex will evaluate both and report back."
  }'
```

```json
{
  "actionItems": [
    {
      "task": "Refactor the auth module",
      "owner": "Alex",
      "deadline": "Thursday"
    },
    {
      "task": "Write up new onboarding flow specs",
      "owner": "Jamie",
      "deadline": "Before Friday sync"
    },
    {
      "task": "Review Q4 metrics and send report to leadership",
      "owner": "You",
      "deadline": "End of week"
    },
    {
      "task": "Evaluate Stripe vs Braintree and report back",
      "owner": "Alex",
      "deadline": null
    }
  ],
  "summary": "Billing feature delayed to next sprint. Four action items across three owners. Payment gateway decision pending Alex's evaluation."
}
```

The model correctly:
- Identified the deferred billing feature as a decision, not an action item
- Extracted the "I should" as belonging to "You"
- Left `deadline` null when none was specified (rather than hallucinating one)

### Where this gets interesting

The structured output is the point. With this response, you can:

```typescript
// Auto-create Jira tickets
for (const item of actionItems) {
  await jira.createIssue({
    summary: item.task,
    assignee: resolveUser(item.owner),
    dueDate: parseDeadline(item.deadline),
  });
}

// Post to Slack
await slack.postMessage({
  channel: "#project-updates",
  text: summary,
  blocks: formatActionItemsAsBlocks(actionItems),
});

// Add to your project tracker
await notion.createTasks(actionItems);
```

One API call turns messy meeting notes into structured data that plugs into whatever system you're already using.

---

## Putting It Together

These three tools address three different points in an LLM-based workflow:

- **Token Counter** → Before the LLM call: is my context safe?
- **Prompt Optimizer** → At deploy time: is my prompt good?
- **Meeting Action Items** → After human collaboration: what needs to happen next?

None of them are complex to integrate. Each one is a POST request with a JSON body. But together they remove a significant amount of the manual work that surrounds LLM-based applications.

All three run on the same API key:

```typescript
import { AgentToolbelt } from "agent-toolbelt";

const toolbelt = new AgentToolbelt({ apiKey: process.env.TOOLBELT_KEY });

// Everything from one client
await toolbelt.tokenCounter({ text, model: "gpt-4o" });
await toolbelt.promptOptimizer({ prompt, goal });
await toolbelt.meetingActionItems({ notes });
```

**Get started:** [agent-toolbelt-production.up.railway.app](https://agent-toolbelt-production.up.railway.app)

---

*Agent Toolbelt is a collection of focused API tools for developers building on top of LLMs. Pricing is per-call. [See all 14 tools →](https://agent-toolbelt-production.up.railway.app)*
