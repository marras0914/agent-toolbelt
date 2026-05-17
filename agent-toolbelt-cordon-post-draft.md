# Agent Toolbelt x Cordon — dev.to + marcoarras.com post

**Status: SCAFFOLD — 2026-05-14.** Old AI-drafted prose preserved at bottom (under "SUPERSEDED draft"); do not post the bottom version. The scaffold below is the working structure for the rewrite.

**Angle:** Technical walkthrough anchored by self-dogfooding voice. I built Agent Toolbelt. I built Cordon. Here is how I run one through the other, with a real audit log entry as proof.

**Venue:** marcoarras.com canonical + dev.to cross-post with `canonical_url` frontmatter pointing back to the blog. Both published simultaneously.

**Voice rules (hard):** Marco-voice only. No prose written by Claude. AI-tell scrub list at bottom of scaffold. Per `cordon-deux` `feedback_ai_content.md`, dev.to is the gray-zone venue where engineering audiences still smell AI prose — the less Claude's style shows through, the more credible.

---

## Title direction

Under 70 chars, descriptive, not clickbait. Working candidates (pick one when drafting):

- *Putting my own MCP server behind my own MCP gateway*
- *Wiring Agent Toolbelt through Cordon (and why I built both)*
- *Running an MCP server in front of an MCP server*

## Opener — earn the click in 3 sentences

Two viable hooks. Pick one; drop the other.

- **The audit-log hook.** Open with a single real line from the Cordon dashboard. `stock-thesis ticker=NVDA duration=1.2s $0.05` then one sentence that says "this is what my agent did at 11:42pm last night, and I only know because I wired my own gateway in front of my own MCP server." Specific. Concrete. No setup needed.
- **The dogfood admission.** "I built Agent Toolbelt to give agents stock-research tools. A few weeks later I built Cordon because I didn't trust what my agents were doing with them." Honest. Personal. Skips the abstract "production agents need observability" preamble that reads as content marketing.

## Section flow

1. **The gap.** Two short paragraphs. Agent Toolbelt's expensive LLM-powered tools (`stock-thesis` at $0.05/call, etc.) are exactly what you don't want an unsupervised agent looping on. No abstract security framing. Use pricing as the concrete hook — a runaway agent hitting `stock-thesis` 50 times costs $2.50, and you only notice when the bill lands.
2. **What we're wiring up.** ASCII diagram. `Claude Desktop -> Cordon (localhost:7777) -> Agent Toolbelt MCP server`. One diagram does more work here than a paragraph.
3. **Step 1: Agent Toolbelt MCP server running locally.** Point to `MCP-SETUP.md` in the repo. Show the config block users actually paste.
4. **Step 2: Cordon in front of it.** Real commands. `npx @getcordon/cli@0.3.0 init` then `cordon start --http`. No hand-waving.
5. **Step 3: Point the MCP client at Cordon.** `http://localhost:7777/mcp` with Bearer token. Show the Claude Desktop config delta.
6. **Step 4: Run a real query, watch the dashboard.** Screenshot lives here. This is the proof move.
7. **Step 5: Gate the expensive calls.** Show the actual policy snippet that ran on Marco's machine. The cost angle is unique to this post — Marco owns both sides, so he can credibly say "I gate my own $0.05 tool."
8. **Why I built both.** One short paragraph. Honest, no marketing. Closes the dogfood loop.
9. **Try it / links.** Agent Toolbelt on npm. getcordon.com. No CTA flourish.

## Things to verify before writing

- `MCP-SETUP.md` in agent-toolbelt actually works against `@getcordon/cli@0.3.0` end-to-end on Marco's machine
- The audit log captures Agent Toolbelt calls in a way that is screenshot-worthy (clear tool name, args readable, no API key leakage in captured args)
- The policy snippet pasted into the post **is the exact one Marco ran.** Readers can sniff a fabricated config from 200 yards
- Agent Toolbelt pricing in the post matches what is billed today
- Both repos are in a state Marco is happy linking from a public post (no in-flight breakage)
- All-free pricing claims for Cordon (no Pro tier, no event caps, no retention windows) — old draft below got this wrong

## Voice / register notes

- First person throughout. "I run this. Here is my config." Not "you can configure."
- Period breaks instead of em-dashes. No colons or semicolons in body prose (per `feedback_punctuation.md`).
- No tricolons. The "three things it gives you" pattern is one of the old draft's tells.
- Casual-specific over polished. "The stock-thesis tool costs me five cents every time" beats "this tool incurs a per-invocation cost."

## AI-tell scrub list (final pass before publish)

- Em-dashes
- "Happy to..." closers
- "Curious how/whether..."
- Symmetric tricolons
- "That said," "the thing is," "the real question is"
- "Fair point, but..." acknowledging-pivots
- "We" when meaning "I" (this is a solo project)
- Filler "really"s

## Dev.to + blog logistics

- Write canonical version on marcoarras.com first (or in parallel)
- Dev.to frontmatter: `canonical_url: https://marcoarras.com/<slug>` so Google indexes the blog
- Dev.to tags (4 max): candidates are `mcp`, `ai`, `webdev`, `tutorial` — confirm against dev.to's current top-tag list before publish
- Cover image: the dashboard screenshot from Step 4
- Dev.to feed shows the first 2-3 lines as preview. Make them count.

## Cross-promotion guardrail

The cost-gating angle (`gate the $0.05 calls`) is only available because Marco owns both sides. **Do not reuse this angle in n8n-post v2.** It is unique to this post and dilutes if recycled.

---

---

## SUPERSEDED draft (pre-2026-05-14) — DO NOT POST

> Preserved for reference only. Hard blockers: uses Architecture B URL pattern (`gateway.getcordon.com/sse/<id>`) which does not exist; references killed `$49/month Pro` tier + 1,000 events/month cap + 30-day retention; reads as AI-drafted (em-dashes, tricolons, "Happy to help"). Predates SSE/HTTP Architecture A actually shipping on 2026-05-13.

---

# From Prototype to Production: Adding Policy Enforcement to Agent Toolbelt

*Dev.to / cross-post to HN, npm blog, MCP directories*

---

Agent Toolbelt is a collection of ~20 MCP tools built for developers who want to skip the boilerplate and start wiring tools into AI agents fast. Web search, file ops, data transforms, HTTP calls — the common stuff you'd otherwise build yourself for the third time.

It's great for prototyping. But at some point you ship the agent to production, and a new set of questions shows up:

- Which tools is my agent actually calling?
- What arguments is it passing — and are they what I expected?
- What happens when it calls something destructive?
- Who approved that?

Agent Toolbelt doesn't answer those questions. Cordon does.

---

## The Gap Between "It Works" and "It's Safe to Run"

When you're developing, you want fast iteration. You run the agent, it calls tools, you check the output. If something goes wrong you can see it in your terminal and fix it.

In production, that feedback loop disappears. The agent runs on a schedule, or in response to a webhook, or inside a larger pipeline. Nobody is watching the terminal. Nobody sees the tool calls in real time.

This is when the blast radius of a misconfigured agent becomes real.

---

## What Cordon Adds

[Cordon](https://getcordon.com) is an MCP gateway proxy. You point your agent at Cordon instead of directly at the Agent Toolbelt server. Cordon forwards every call through, and gives you three things:

**1. A real-time audit log**

Every tool invocation — name, arguments, response, latency, timestamp — captured and queryable. You can export to CSV or JSON. You can see, after the fact, exactly what your agent did and why.

**2. Policy enforcement**

RBAC-mapped rules that let you define which tools are allowed, for which API keys, under what conditions. You can block categories of tools entirely, or scope specific tools to specific callers.

**3. Human-in-the-loop approvals**

For tool calls you've flagged as high-risk, Cordon pauses before the call fires and sends you a Slack DM with the full context — tool name, arguments, agent reasoning. Approve and it continues. Reject and the agent gets a clean error.

---

## Wiring It Up

**Step 1: Install Agent Toolbelt**

If you haven't already:

```bash
npx @elephant-tortoise/agent-toolbelt
```

Or in your MCP config:

```json
{
  "mcpServers": {
    "agent-toolbelt": {
      "command": "npx",
      "args": ["-y", "@elephant-tortoise/agent-toolbelt"]
    }
  }
}
```

This starts the Agent Toolbelt MCP server locally.

**Step 2: Create a Cordon gateway**

Log into [getcordon.com](https://getcordon.com), create a new gateway, and point it at your Agent Toolbelt server endpoint. Cordon gives you a new SSE (or HTTP Streamable) URL to use instead.

**Step 3: Update your MCP client config**

Swap the Agent Toolbelt server URL for the Cordon gateway URL. In Claude Desktop, Cursor, or any SSE-capable MCP client:

```json
{
  "mcpServers": {
    "agent-toolbelt-via-cordon": {
      "url": "https://gateway.getcordon.com/sse/<your-gateway-id>",
      "headers": {
        "Authorization": "Bearer <your-cordon-api-key>"
      }
    }
  }
}
```

From your agent's perspective, nothing changes. The same tools, the same schemas. The calls just flow through Cordon first.

**Step 4: Tag the calls you want to gate**

In the Cordon dashboard, set up a policy for the tools you want human approval on — anything that writes, deletes, or calls an external API with side effects. Leave read-only tools to run freely.

---

## What the Dashboard Shows You

Once Cordon is in the path, open the dashboard while running your agent. You'll see:

- A live event stream: each tool call as it happens
- Tool call analytics: volume, error rate, latency per tool — useful for spotting when an agent is looping or calling something unexpectedly often
- Full request/response payloads: click into any event and see exactly what the agent sent and what came back

The free tier covers 1,000 events/month. Pro ($49/month) adds Slack-based approvals, 30-day log retention, and CSV/JSON export.

---

## When This Actually Matters

A few scenarios where having this in place pays off fast:

**Customer-facing agents**: If your agent has tools that touch customer data or trigger real-world actions, you want a log. You want to be able to answer "what did the agent do?" after the fact.

**Multi-step pipelines**: When an agent is one node in a larger workflow (n8n, LangGraph, a custom orchestrator), it's easy to lose track of what it's actually calling. The event stream makes this visible again.

**Shared team environments**: Multiple developers pointing agents at the same MCP server. Cordon's API key management lets you scope what each key can do, and audit who called what.

**Anything that writes or deletes**: If the tool has a side effect, you probably want it gated until you've seen it behave correctly a few times. HITL approvals let you run the agent in "supervised" mode before you fully trust it.

---

## Try It

Agent Toolbelt is free and open. Cordon has a free tier with no credit card required.

→ [Agent Toolbelt on npm](https://www.npmjs.com/package/@elephant-tortoise/agent-toolbelt)
→ [Cordon](https://getcordon.com)

If you're already using Agent Toolbelt, adding Cordon is a one-line config change. Happy to help in the comments if you hit anything unexpected.

---

*Both are built by Marco / Elephant Tortoise LLC. Agent Toolbelt has ~1,600 weekly npm downloads. Cordon is the security and observability layer built to sit in front of it.*
