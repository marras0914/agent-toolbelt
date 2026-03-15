#!/usr/bin/env node
console.log(`
  +-------------------------------------------------+
  |        agent-toolbelt-mcp installed             |
  +-------------------------------------------------+

  Get your free API key (1,000 calls/month):

    curl -X POST https://agent-toolbelt-production.up.railway.app/api/clients/register \\
      -H "Content-Type: application/json" \\
      -d '{"email": "you@example.com"}'

  Or visit: https://agent-toolbelt-production.up.railway.app/register

  Then add to Claude Code:

    claude mcp add agent-toolbelt-mcp \\
      -e AGENT_TOOLBELT_KEY=<your-key> \\
      -- npx -y agent-toolbelt-mcp

  No credit card required.

`);
