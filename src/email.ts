import sgMail from "@sendgrid/mail";
import { config } from "./config";

export async function sendOnboardingEmail(params: {
  email: string;
  name?: string | null;
  apiKey: string;
  keyPrefix: string;
  clientId: string;
}): Promise<void> {
  if (!config.sendgridApiKey) {
    console.log(`[email] SENDGRID_API_KEY not set — skipping onboarding email for ${params.email}`);
    return;
  }

  sgMail.setApiKey(config.sendgridApiKey);

  const { email, name, keyPrefix, clientId } = params;
  const greeting = name ? `Hi ${name}` : "Hi there";
  const docsUrl = "https://agent-toolbelt-production.up.railway.app/api/docs";
  const catalogUrl = "https://agent-toolbelt-production.up.railway.app/api/tools/catalog";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .header { background: #1a1a1a; padding: 32px 40px; }
    .header h1 { color: #fff; margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.3px; }
    .header p { color: #888; margin: 4px 0 0; font-size: 13px; }
    .body { padding: 32px 40px; color: #333; font-size: 15px; line-height: 1.6; }
    .key-box { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
    .key-box .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 6px; }
    .key-box code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 14px; color: #1a1a1a; word-break: break-all; }
    .warning { font-size: 12px; color: #e55; margin-top: 8px; }
    pre { background: #1a1a1a; color: #e8e8e8; border-radius: 6px; padding: 16px 20px; font-size: 13px; overflow-x: auto; margin: 20px 0; }
    .btn { display: inline-block; background: #1a1a1a; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500; margin: 4px 4px 4px 0; }
    h2 { font-size: 16px; font-weight: 600; margin: 24px 0 8px; color: #1a1a1a; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Agent Toolbelt</h1>
      <p>API tools for AI agents and developers</p>
    </div>
    <div class="body">
      <p>${greeting}, welcome to Agent Toolbelt.</p>
      <p>Your account is set up. Your API key was shown once at registration — if you saved it, you're ready to analyze your first stock.</p>

      <div class="key-box">
        <div class="label">Key prefix (for reference)</div>
        <code>${keyPrefix}...</code>
        <div class="warning">The full key is not included in this email. If you lost it, reply here and we'll issue a new one.</div>
      </div>

      <h2>Run your first analysis</h2>
      <p>Paste this into your terminal (replace <code>&lt;your-key&gt;</code> with your API key):</p>
      <pre>curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/stock-thesis \\
  -H "Authorization: Bearer &lt;your-key&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{"ticker": "AAPL"}'</pre>

      <p>You'll get a full Motley Fool-style investment thesis: verdict, strengths, risks, valuation read, and what to watch for.</p>

      <h2>5 stock research tools</h2>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr style="border-bottom: 1px solid #e0e0e0;"><td style="padding: 8px 0; font-weight: 600;">stock-thesis</td><td style="padding: 8px 0; color: #555;">Full investment thesis with verdict</td></tr>
        <tr style="border-bottom: 1px solid #e0e0e0;"><td style="padding: 8px 0; font-weight: 600;">earnings-analysis</td><td style="padding: 8px 0; color: #555;">12-quarter EPS track record + revenue trend</td></tr>
        <tr style="border-bottom: 1px solid #e0e0e0;"><td style="padding: 8px 0; font-weight: 600;">insider-signal</td><td style="padding: 8px 0; color: #555;">Form 4 insider trades interpreted</td></tr>
        <tr style="border-bottom: 1px solid #e0e0e0;"><td style="padding: 8px 0; font-weight: 600;">valuation-snapshot</td><td style="padding: 8px 0; color: #555;">P/E, P/S, EV/EBITDA, FCF yield + buy zone</td></tr>
        <tr><td style="padding: 8px 0; font-weight: 600;">bear-vs-bull</td><td style="padding: 8px 0; color: #555;">3 bull + 3 bear arguments, steelmanned</td></tr>
      </table>

      <p>All tools work the same way — just change the tool name in the URL and pass <code>{"ticker": "..."}</code>.</p>

      <p>Or with the TypeScript SDK:</p>
      <pre>npm install agent-toolbelt</pre>
      <pre>import { AgentToolbelt } from "agent-toolbelt";
const atb = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY });

const thesis = await atb.stockThesis({ ticker: "AAPL" });
console.log(thesis.verdict, thesis.oneLiner);</pre>

      <h2>What's included</h2>
      <p>Your free tier includes <strong>1,000 calls/month</strong> across all 25 tools — 5 stock research tools plus 20 utility tools (schema generator, token counter, regex builder, and more).</p>

      <p>
        <a class="btn" href="${docsUrl}">API docs</a>
        <a class="btn" href="${catalogUrl}">All 25 tools</a>
      </p>

      <p style="margin-top: 24px; font-size: 13px; color: #666;">Need more calls or want PAYG pricing? Reply to this email.</p>

      <div style="margin-top: 28px; padding: 20px; background: #f8f8f8; border-radius: 6px; border-left: 3px solid #1a1a1a;">
        <p style="margin: 0 0 6px; font-size: 14px; font-weight: 600; color: #1a1a1a;">Deploying agents to production?</p>
        <p style="margin: 0; font-size: 13px; color: #555;">Check out <a href="https://getcordon.com" style="color: #1a1a1a; font-weight: 500;">Cordon</a> — secrets management and access control built for AI agents.</p>
      </div>
    </div>
    <div class="footer" style="padding: 20px 40px; border-top: 1px solid #f0f0f0; font-size: 12px; color: #aaa;">
      You're receiving this because you registered at agent-toolbelt-production.up.railway.app.
      Client ID: ${clientId}
    </div>
  </div>
</body>
</html>`;

  const text = `${greeting}, welcome to Agent Toolbelt.

Your API key was shown once at registration. Key prefix for reference: ${keyPrefix}...

If you lost your key, reply to this email and we'll issue a new one.

Run your first analysis — paste this into your terminal:

curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/stock-thesis \\
  -H "Authorization: Bearer <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"ticker": "AAPL"}'

5 stock research tools:
- stock-thesis — full investment thesis with verdict
- earnings-analysis — 12-quarter EPS track record + revenue trend
- insider-signal — Form 4 insider trades interpreted
- valuation-snapshot — P/E, P/S, EV/EBITDA, FCF yield + buy zone
- bear-vs-bull — 3 bull + 3 bear arguments, steelmanned

All tools take {"ticker": "..."} — just change the tool name in the URL.

1,000 free calls/month across all 25 tools.

API docs: ${docsUrl}
All tools: ${catalogUrl}

Need more calls? Reply to this email.

---
Deploying agents to production? Check out Cordon — secrets management and access control built for AI agents: https://getcordon.com
`;

  await sgMail.send({
    to: email,
    from: { email: config.emailFrom, name: "Agent Toolbelt" },
    subject: "Your API key — try analyzing AAPL first",
    text,
    html,
  });

  console.log(`[email] Onboarding email sent to ${email}`);
}
