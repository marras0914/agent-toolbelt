# r/vibecodersnest

*Cross-posted on suggestion from r/ClaudeAI comment*

---

**Flair:** Show and Tell

**Title:**
I vibe-coded a stock research MCP server — Claude now pulls live data and writes Motley Fool-style analysis

**Post:**
I kept asking Claude about stocks and getting the same answer: "I don't have access to real-time data." So I built an MCP server that fixes it.

One command to install:

```bash
claude mcp add agent-toolbelt \
  -e AGENT_TOOLBELT_KEY=atb_... \
  -- npx -y agent-toolbelt-mcp
```

Then just ask Claude normally:

> "Analyze NVDA — is it worth buying at this price?"

Claude calls the tools behind the scenes and comes back with a full research note using real numbers. Here's what it returned for NVDA:

**Verdict:** Bullish
**One-liner:** "Nvidia owns the essential infrastructure for the AI revolution with a defensible software moat, but the valuation demands flawless execution."

- 10,005% three-year revenue CAGR
- 42 buy / 5 hold / 1 sell analyst consensus
- Two executives bought ~47k shares each in March (positive signal), routine selling from others
- 36.9x P/E — premium but justified by AI tailwinds
- **Watch for:** Data center revenue growth rate next earnings. Below 30% YoY = boom is maturing.

Five tools total: `stock_thesis`, `earnings_analysis`, `insider_signal`, `valuation_snapshot`, `bear_vs_bull`. Each one pulls live data from Polygon, Finnhub, and Financial Modeling Prep in parallel and synthesizes it with Claude Haiku.

**The vibe coding part:** the whole thing was built with Claude Code — the stock tools, the MCP server, the SDK, even the landing page. The prompt engineering was the interesting challenge: getting Claude to commit to a verdict (bullish/neutral/bearish) instead of producing wishy-washy "it depends" output. The trick was writing the system prompt in a Motley Fool analyst voice rather than generic "financial analyst."

Free tier: 1,000 calls/month, no credit card. Try the valuation snapshot live at elephanttortoise.com — no signup needed.

**[link in comments]**

Anyone else building MCP tools for domains they're personally into? Curious what people are wiring up.
