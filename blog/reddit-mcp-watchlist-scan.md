# r/mcp — watchlist-scan launch (reusable for r/LocalLLaMA, r/ClaudeAI)

*Show-and-Tell post for the MCP / Claude-agent audience to drive top-of-funnel + installs for the new `watchlist_scan` MCP tool (shipped in agent-toolbelt-mcp v1.0.14). This crowd welcomes "I built/added a tool" posts, so the tool + install are front and center (unlike the r/ValueInvesting version). Still value-first and casual, no hard sell, no em dashes. Lead angle: one call ranks the whole list instead of the agent looping single-ticker calls.*

---

**Flair:** Show and Tell

**Title:**
Added a watchlist screener to my stock MCP — Claude ranks a list of tickers in one call instead of looping

**Post:**
I run a small MCP server that gives Claude live stock fundamentals (thesis, valuation, insider activity, etc). Watching how people used it, the most common pattern was the agent looping over a watchlist one ticker at a time, which is slow and burns through rate limits fast.

So I added a tool that takes the whole list and ranks it in a single call. The agent-friendly part: it's one model pass that ranks the group comparatively, not N separate calls you then have to stitch together.

Install:

```bash
claude mcp add agent-toolbelt \
  -e AGENT_TOOLBELT_KEY=atb_... \
  -- npx -y agent-toolbelt-mcp
```

Then just ask Claude normally:

> "Rank NVDA, AMD, and AVGO by value"

Claude calls `watchlist_scan` behind the scenes and comes back with:

```
#1 NVDA — 31x P/E (cheapest here), 63% net margin, 112% ROE
#2 AVGO — 62x P/E, 39% margin (middle ground)
#3 AMD  — 159x P/E on a 13% margin, hard to justify
top pick: NVDA, avoid: AMD
```

You pick the lens (value / quality / growth / income) and it ranks the list, names a top pick and one to avoid, gives an overall takeaway, and returns the raw metrics behind it. All TTM data from FMP/Finnhub/Polygon.

Free key covers 1,000 calls/month (`agent-toolbelt-mcp` on npm). Curious what watchlists people would actually throw at this, and whether the one-call-ranks-the-group approach is useful for other kinds of batch analysis too.

---

## Reply if asked "how does the ranking work / is it just the LLM guessing"

Good question. It pulls the real TTM metrics for each ticker first (P/E, P/S, FCF yield, ROE, margins, growth) from FMP/Finnhub/Polygon, then the model ranks on those numbers for the lens you pick. So the data is real, the ranking/synthesis is the model. You get the raw metrics back too so you can check its work.

## Reply if asked about cost / "doesn't N tickers get expensive"

It's one model call regardless of list size (it ranks the whole group in a single pass), and the per-ticker data fetches are cached, so a 15-ticker scan is roughly the cost of one analysis, not 15. Repeat scans of the same list are cached for the day.

---

## Posting notes
- Show-and-Tell flair where the sub has it.
- This audience is fine with the install command + npm link in the body (unlike r/ValueInvesting) — they expect it for a tool post.
- r/mcp primary. Reuse for r/LocalLLaMA (already hosted the original MCP launch) and r/ClaudeAI (if posting is approved).
- Engage on the "is it just the LLM guessing" and cost questions — the real-metrics + one-call answers are the credibility points.
- Weekday mid-morning ET; less weekend-sensitive than the finance subs but still better mid-week.
