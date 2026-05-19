#!/usr/bin/env node
console.log(`
  +-----------------------------------------+
  |          agent-toolbelt installed        |
  +-----------------------------------------+

  Get your free API key (1,000 calls/month):

    curl -X POST https://www.agenttoolbelt.live/api/clients/register \\
      -H "Content-Type: application/json" \\
      -d '{"email": "you@example.com"}'

  Your key is returned immediately. No credit card required.

  Docs: https://www.agenttoolbelt.live

`);
