import sgMail from "@sendgrid/mail";
import { config } from "./config";

export async function sendOnboardingEmail(params: {
  email: string;
  name?: string | null;
  apiKey: string;
  clientId: string;
}): Promise<void> {
  if (!config.sendgridApiKey) {
    console.log(`[email] SENDGRID_API_KEY not set — skipping onboarding email for ${params.email}`);
    return;
  }

  sgMail.setApiKey(config.sendgridApiKey);

  const { email, name, apiKey, clientId } = params;
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
      <p>Your account is set up and your API key is ready. Save it somewhere safe — <strong>it won't be shown again.</strong></p>

      <div class="key-box">
        <div class="label">Your API Key</div>
        <code>${apiKey}</code>
        <div class="warning">Store this securely. It won't be shown again.</div>
      </div>

      <h2>Quick start</h2>
      <pre>curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/schema-generator \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"description": "a SaaS user with name, email, and plan"}'</pre>

      <p>Or with the TypeScript SDK:</p>
      <pre>npm install agent-toolbelt</pre>
      <pre>import { AgentToolbelt } from "agent-toolbelt";
const toolbelt = new AgentToolbelt({ apiKey: "${apiKey}" });

const { schema } = await toolbelt.schemaGenerator({
  description: "a SaaS user with name, email, and plan",
  format: "zod",
});</pre>

      <h2>What's included</h2>
      <p>You have <strong>1,000 free calls/month</strong> across all 20 tools — schema generator, token counter, regex builder, prompt optimizer, web summarizer, context window packer, and more.</p>

      <p>
        <a class="btn" href="${catalogUrl}">Browse all tools</a>
        <a class="btn" href="${docsUrl}">API docs</a>
      </p>

      <p style="margin-top: 24px; font-size: 13px; color: #666;">Need more calls? Reply to this email or visit the docs to upgrade.</p>
    </div>
    <div class="footer" style="padding: 20px 40px; border-top: 1px solid #f0f0f0; font-size: 12px; color: #aaa;">
      You're receiving this because you registered at agent-toolbelt-production.up.railway.app.
      Client ID: ${clientId}
    </div>
  </div>
</body>
</html>`;

  const text = `${greeting}, welcome to Agent Toolbelt.

Your API key (save this — it won't be shown again):
${apiKey}

Quick start:
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/schema-generator \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"description": "a SaaS user with name, email, and plan"}'

You have 1,000 free calls/month across all 20 tools.

Browse tools: ${catalogUrl}
API docs: ${docsUrl}

Need more calls? Reply to this email to upgrade.
`;

  await sgMail.send({
    to: email,
    from: { email: config.emailFrom, name: "Agent Toolbelt" },
    subject: "Your Agent Toolbelt API key",
    text,
    html,
  });

  console.log(`[email] Onboarding email sent to ${email}`);
}
