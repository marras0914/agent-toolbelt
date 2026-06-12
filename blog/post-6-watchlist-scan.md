---
title: "I watched everyone loop my stock API one ticker at a time, so I built a watchlist scanner"
description: "Usage data told me what tool to build next: rank a whole watchlist in one call instead of N. Here's the design decision and why one LLM call beats many."
tags: ["ai", "investing", "claude", "agents"]
published: true
canonical_url: "https://marcoarras.com/watchlist-scan"
---

I build a set of stock-research tools for AI agents. Each one takes a ticker and returns structured analysis: an investment thesis, a valuation read, insider activity, and so on. Single ticker in, structured research out.

Then I looked at how people were actually using them.

The heaviest user had made over 700 valuation calls across about 40 distinct tickers. That is roughly eighteen runs per ticker. They were not doing deep research on 700 companies. They were running the same watchlist over and over, one ticker at a time, in a loop.

That pattern was everywhere once I saw it. People do not have one stock they care about. They have a list, and they want to know which one to look at first. My single-ticker tools made them do the triage by hand: call, call, call, then eyeball 40 JSON blobs and rank them in their head.

So the next tool built itself: take the whole list, rank it, hand back the answer.

## Why one call, not a loop

The naive version is a batch endpoint that just loops the existing valuation tool internally. It works, but it is the wrong shape for two reasons.

First, cost and latency. N tickers means N model calls, and for an AI agent that is N round trips plus N chances to hit a rate limit.

Second, and more important: looping gives you N independent verdicts, not a ranking. "NVDA is fairly valued" and "AMD is expensive" are two separate opinions. They are not the same as "of these three, here is the order and here is why." Comparative judgment is better when the model sees the whole group at once.

So `watchlist-scan` fetches the metrics for every ticker (those fetches are cached, so repeats are nearly free), builds one compact table, and makes a single model call that ranks the entire group against the lens you pick: value, quality, growth, or income.

One call. The whole list ranked. Regardless of whether you pass 3 tickers or 15.

## What it returns

Ask it to rank the big AI semis by value:

```json
{ "tickers": ["NVDA", "AMD", "AVGO"], "focus": "value" }
```

And you get back a ranking with a one-line read per ticker, a top pick, the one to avoid, and an overall takeaway:

```
#1 NVDA — 31x P/E (cheapest here), 63% net margin, 112% ROE
#2 AVGO — 62x P/E, 39% net margin (middle ground)
#3 AMD  — 159x P/E on a 13% margin, hard to justify on trailing numbers
top pick: NVDA   avoid: AMD
```

The counterintuitive result is NVDA screening as the cheapest of the three on trailing earnings. That is the margin and ROE doing the work: a 31x multiple on a 63% net margin business is a very different thing from 159x on a 13% margin. The raw metrics come back in the response too, so you can check the model's reasoning instead of trusting it.

(These are all TTM figures from FMP, Finnhub, and Polygon. The obvious counter is forward earnings, which is exactly the kind of debate the ranking is meant to start, not end.)

## The lesson I keep relearning

I did not build this because I thought it would be cool. I built it because the usage data pointed straight at it: a real workflow people were hand-rolling because the tool for it did not exist yet.

Every time I have guessed at what to build next, I have been wrong. Every time I have read what people actually do with the thing and built the missing piece, it has landed. The watchlist loop was hiding in the call logs the whole time.

## Try it

`watchlist-scan` is live across the API, the npm SDK, and the MCP server (so Claude can call it directly). The free tier covers 1,000 calls a month.

```bash
# via the MCP server, then just ask Claude to "rank my watchlist by quality"
claude mcp add agent-toolbelt -e AGENT_TOOLBELT_KEY=atb_... -- npx -y agent-toolbelt-mcp
```

```ts
// or via the SDK
import { AgentToolbelt } from "agent-toolbelt";
const atb = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY });
const scan = await atb.watchlistScan({ tickers: ["NVDA", "AMD", "AVGO"], focus: "value" });
console.log(scan.topPick, scan.ranked);
```

Get a free key at [agenttoolbelt.live](https://www.agenttoolbelt.live). If you try it on a watchlist that surprises you, I would genuinely like to hear what it said.
