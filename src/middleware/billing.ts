import Stripe from "stripe";
import { Request, Response, Router } from "express";
import { config } from "../config";
import {
  createClient,
  createApiKey,
  getClientByEmail,
  getClientByStripeId,
  updateClientStripe,
  updateClientTier,
  addCredits,
  getClientBalance,
  Client,
} from "../db";
import { sendOnboardingEmail } from "../email";

// ----- Stripe Client -----
const stripe = config.stripeSecretKey
  ? new Stripe(config.stripeSecretKey, { apiVersion: "2024-12-18.acacia" as any })
  : null;

// ----- PAYG Credit Packs -----
// Amount in cents → label
export const CREDIT_PACKS: Record<number, string> = {
  500:  "$5 — 5,000,000 credits (~250 stock analyses / ~50,000 cheap calls)",
  1000: "$10 — 10,000,000 credits",
  2500: "$25 — 25,000,000 credits",
  5000: "$50 — 50,000,000 credits",
};

// 1 USD = 1,000,000 microdollars. $1 spent → 1,000,000 microdollars.
function centsToMicros(cents: number): number {
  return cents * 10_000; // $0.01 = 10,000 microdollars
}

// ----- Pricing Configuration -----
// Set these in your .env after creating products in Stripe Dashboard
export const STRIPE_PRICES: Record<string, { priceId: string; monthlyUsd: number }> = {
  hobby: { priceId: process.env.STRIPE_PRICE_HOBBY || "", monthlyUsd: 10 },
  starter: { priceId: process.env.STRIPE_PRICE_STARTER || "", monthlyUsd: 29 },
  pro: { priceId: process.env.STRIPE_PRICE_PRO || "", monthlyUsd: 99 },
  enterprise: { priceId: process.env.STRIPE_PRICE_ENTERPRISE || "", monthlyUsd: 499 },
};

// ----- Usage Metering -----
export async function reportUsageToStripe(
  subscriptionItemId: string,
  quantity: number = 1
): Promise<void> {
  if (!stripe) return;
  try {
    await stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
      quantity,
      timestamp: Math.floor(Date.now() / 1000),
      action: "increment",
    });
  } catch (err) {
    console.error("Stripe usage reporting failed:", err);
  }
}

// ----- Checkout Session Creation -----
export async function createCheckoutSession(
  clientEmail: string,
  clientId: string,
  tier: "hobby" | "starter" | "pro" | "enterprise",
  successUrl: string,
  cancelUrl: string
): Promise<string | null> {
  if (!stripe) {
    console.warn("Stripe not configured — skipping checkout");
    return null;
  }

  const priceConfig = STRIPE_PRICES[tier];
  if (!priceConfig?.priceId) {
    throw new Error(`No Stripe price configured for tier: ${tier}. Set STRIPE_PRICE_${tier.toUpperCase()} in .env`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: clientEmail,
    line_items: [{ price: priceConfig.priceId, quantity: 1 }],
    metadata: { clientId, tier },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return session.url;
}

// ----- Customer Portal -----
export async function createPortalSession(customerId: string, returnUrl: string): Promise<string | null> {
  if (!stripe) return null;
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

// ----- Webhook Handler -----
export function buildStripeWebhookRouter(): Router {
  const router = Router();

  router.post("/webhook", async (req: Request, res: Response) => {
    if (!stripe || !config.stripeWebhookSecret) {
      res.status(400).json({ error: "Stripe not configured" });
      return;
    }

    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const { clientId, tier, type, creditsMicros } = session.metadata || {};

        if (type === "topup" && clientId && creditsMicros) {
          // PAYG credit top-up
          addCredits(clientId, parseInt(creditsMicros, 10));
          // Upgrade tier to payg if still on free
          updateClientTier(clientId, "payg");
          console.log(`💳 Credits added: ${clientId} +${creditsMicros} micros`);
        } else if (clientId && tier && session.subscription && session.customer) {
          // Subscription checkout
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          const subscriptionItemId = subscription.items.data[0]?.id || "";

          updateClientStripe(
            clientId,
            session.customer as string,
            session.subscription as string,
            subscriptionItemId,
            tier as Client["tier"]
          );
          console.log(`✅ New subscription: ${clientId} → ${tier}`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        if (subscription.status === "active") {
          const client = getClientByStripeId(subscription.customer as string);
          if (client) {
            // Could detect plan changes here based on price ID
            console.log(`🔄 Subscription updated: ${client.id} → ${subscription.status}`);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const client = getClientByStripeId(subscription.customer as string);
        if (client) {
          updateClientTier(client.id, "free");
          console.log(`❌ Subscription cancelled — downgraded: ${client.id} → free`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const client = getClientByStripeId(invoice.customer as string);
        if (client) {
          console.warn(`⚠️ Payment failed for ${client.id} (${client.email})`);
          // Optionally: send an email, temporarily downgrade, etc.
        }
        break;
      }

      default:
        break;
    }

    res.json({ received: true });
  });

  return router;
}

// ----- Billing Routes -----
export function buildBillingRouter(): Router {
  const router = Router();

  // Create checkout session
  router.post("/checkout", async (req: Request, res: Response) => {
    const { clientId, email, tier, successUrl, cancelUrl } = req.body;

    if (!clientId || !tier || !email) {
      res.status(400).json({ error: "clientId, email, and tier are required" });
      return;
    }

    if (!["hobby", "starter", "pro", "enterprise"].includes(tier)) {
      res.status(400).json({ error: "tier must be: hobby, starter, pro, or enterprise" });
      return;
    }

    try {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const url = await createCheckoutSession(
        email,
        clientId,
        tier,
        successUrl || `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl || `${baseUrl}/billing/cancel`
      );

      if (!url) {
        res.status(503).json({ error: "Billing not configured. Set STRIPE_SECRET_KEY in .env" });
        return;
      }

      res.json({ checkoutUrl: url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Customer portal (manage subscription)
  router.post("/portal", async (req: Request, res: Response) => {
    const { stripeCustomerId, returnUrl } = req.body;

    if (!stripeCustomerId) {
      res.status(400).json({ error: "stripeCustomerId is required" });
      return;
    }

    try {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const url = await createPortalSession(stripeCustomerId, returnUrl || baseUrl);

      if (!url) {
        res.status(503).json({ error: "Billing not configured" });
        return;
      }

      res.json({ portalUrl: url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PAYG credit top-up
  router.post("/topup", async (req: Request, res: Response) => {
    const { clientId, email, amountCents } = req.body;

    if (!clientId || !email || !amountCents) {
      res.status(400).json({ error: "clientId, email, and amountCents are required" });
      return;
    }

    const cents = parseInt(amountCents, 10);
    if (![500, 1000, 2500, 5000].includes(cents)) {
      res.status(400).json({ error: "amountCents must be one of: 500, 1000, 2500, 5000 ($5, $10, $25, $50)" });
      return;
    }

    if (!stripe) {
      res.status(503).json({ error: "Billing not configured" });
      return;
    }

    try {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const micros = centsToMicros(cents);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: email,
        line_items: [{
          price_data: {
            currency: "usd",
            unit_amount: cents,
            product_data: {
              name: "Agent Toolbelt Credits",
              description: CREDIT_PACKS[cents] || `${micros.toLocaleString()} credits`,
            },
          },
          quantity: 1,
        }],
        metadata: { clientId, type: "topup", creditsMicros: String(micros) },
        success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/billing/cancel`,
      });

      res.json({
        checkoutUrl: session.url,
        creditsMicros: micros,
        amountUsd: cents / 100,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Credit balance check
  router.get("/balance/:clientId", (req: Request, res: Response) => {
    const balance = getClientBalance(req.params.clientId);
    res.json({
      clientId: req.params.clientId,
      creditsMicros: balance,
      creditsUsd: (balance / 1_000_000).toFixed(6),
      approximateCalls: {
        cheapTools: Math.floor(balance / 100),    // $0.0001 tools
        midTools: Math.floor(balance / 1_000),    // $0.001 tools
        stockTools: Math.floor(balance / 20_000), // $0.02 stock analysis tools
        llmTools: Math.floor(balance / 50_000),   // $0.05 LLM tools
        contractExtractor: Math.floor(balance / 100_000), // $0.10
      },
    });
  });

  // Unified register-or-find + checkout flow
  // Lets visitors pay directly from the marketing page without a separate signup step.
  router.post("/start", async (req: Request, res: Response) => {
    const { email, name, type, amountCents, tier } = req.body;

    if (!email || !type) {
      res.status(400).json({ error: "email and type are required" });
      return;
    }
    if (type !== "topup" && type !== "subscription") {
      res.status(400).json({ error: "type must be 'topup' or 'subscription'" });
      return;
    }
    if (!stripe) {
      res.status(503).json({ error: "Billing not configured" });
      return;
    }

    // Find or create the client
    let client = getClientByEmail(email);
    let apiKey: string | undefined;
    let isNew = false;

    if (!client) {
      client = createClient(email, name);
      isNew = true;
      const { key } = createApiKey(client.id, "default");
      apiKey = key;

      const source = (req.query.source as string) || (req.body?.source as string) || "billing_start";
      const referer = req.headers.referer || req.headers.referrer || "none";
      const userAgent = req.headers["user-agent"] || "none";
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip || "unknown";
      console.log(`[register] ${email} | source=${source} | referer=${referer} | ua=${userAgent} | ip=${ip}`);

      sendOnboardingEmail({
        email: client.email,
        name: client.name,
        apiKey: key,
        keyPrefix: key.slice(0, 12),
        clientId: client.id,
      }).catch((err) => console.error("Onboarding email failed:", err));
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    try {
      let checkoutUrl: string | null = null;

      if (type === "subscription") {
        const validTier = (tier as Client["tier"]) || "starter";
        if (!["hobby", "starter", "pro", "enterprise"].includes(validTier)) {
          res.status(400).json({ error: "tier must be: hobby, starter, pro, or enterprise" });
          return;
        }
        checkoutUrl = await createCheckoutSession(
          client.email,
          client.id,
          validTier as "hobby" | "starter" | "pro" | "enterprise",
          `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          `${baseUrl}/billing/cancel`
        );
      } else {
        const cents = parseInt(String(amountCents), 10);
        if (![500, 1000, 2500, 5000].includes(cents)) {
          res.status(400).json({ error: "amountCents must be one of: 500, 1000, 2500, 5000" });
          return;
        }
        const micros = centsToMicros(cents);
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          customer_email: client.email,
          line_items: [{
            price_data: {
              currency: "usd",
              unit_amount: cents,
              product_data: {
                name: "Agent Toolbelt Credits",
                description: CREDIT_PACKS[cents] || `${micros.toLocaleString()} credits`,
              },
            },
            quantity: 1,
          }],
          metadata: { clientId: client.id, type: "topup", creditsMicros: String(micros) },
          success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/billing/cancel`,
        });
        checkoutUrl = session.url;
      }

      if (!checkoutUrl) {
        res.status(503).json({ error: "Failed to create checkout session" });
        return;
      }

      res.json({ checkoutUrl, clientId: client.id, isNew, apiKey });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // HTML success page — browser redirect target after Stripe completes.
  // Reads apiKey from sessionStorage (set by the modal during /billing/start) so
  // first-time payers can see their new key.
  router.get("/success", (req, res) => {
    const sessionId = (req.query.session_id as string) || "";
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payment successful — Agent Toolbelt</title>
  <style>
    :root { --bg: #0f0f10; --surface: #1a1a1c; --border: #2a2a2d; --text: #e8e8e8; --text-dim: #888; --accent: #7dd3a0; --orange: #f5a572; --mono: 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { max-width: 560px; width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 32px; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    .check { color: var(--accent); font-size: 32px; line-height: 1; margin-bottom: 12px; }
    p { color: var(--text-dim); margin: 8px 0; }
    .key-block { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin: 16px 0; }
    .key-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-dim); margin-bottom: 6px; }
    code { font-family: var(--mono); font-size: 13px; color: var(--orange); word-break: break-all; }
    .warning { font-size: 12px; color: var(--orange); margin-top: 8px; }
    .btn { display: inline-block; background: var(--accent); color: #0a0a0a; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px; font-size: 14px; }
    .btn-ghost { background: transparent; color: var(--text-dim); border: 1px solid var(--border); }
    pre { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 14px; font-size: 12px; font-family: var(--mono); overflow-x: auto; color: var(--text); }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1 id="title">Payment received</h1>
    <p id="subtitle">Your account is active.</p>

    <div id="new-user-block" style="display:none">
      <div class="key-block">
        <div class="key-label">Your API key (save this — shown once)</div>
        <code id="api-key"></code>
        <div class="warning">We've also emailed a confirmation to <span id="email-display"></span>, but the full key is not in the email for security.</div>
      </div>

      <p style="color: var(--text); font-size: 14px; margin-top: 16px;">Try your first call:</p>
      <pre id="curl-example"></pre>
    </div>

    <div id="returning-user-block" style="display:none">
      <p>Credits have been added to your account. Use your existing API key as before.</p>
    </div>

    <a class="btn" href="/docs">Read the docs</a>
    <a class="btn btn-ghost" href="/">Back to home</a>
  </div>

  <script>
    const sessionId = ${JSON.stringify(sessionId)};
    const apiKey = sessionStorage.getItem('atb_pending_key');
    const email = sessionStorage.getItem('atb_pending_email') || '';

    if (apiKey) {
      document.getElementById('new-user-block').style.display = 'block';
      document.getElementById('api-key').textContent = apiKey;
      document.getElementById('email-display').textContent = email;
      document.getElementById('curl-example').textContent =
        'curl -X POST https://www.agenttoolbelt.live/api/tools/stock-thesis \\\\\\n' +
        '  -H "Authorization: Bearer ' + apiKey + '" \\\\\\n' +
        '  -H "Content-Type: application/json" \\\\\\n' +
        "  -d '{\\"ticker\\": \\"AAPL\\"}'";
      sessionStorage.removeItem('atb_pending_key');
      sessionStorage.removeItem('atb_pending_email');
    } else {
      document.getElementById('returning-user-block').style.display = 'block';
    }
  </script>
</body>
</html>`);
  });

  router.get("/cancel", (_req, res) => {
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Checkout cancelled — Agent Toolbelt</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f10; color: #e8e8e8; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { max-width: 480px; width: 100%; background: #1a1a1c; border: 1px solid #2a2a2d; border-radius: 12px; padding: 32px; text-align: center; }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { color: #888; margin: 8px 0 20px; }
    .btn { display: inline-block; background: #7dd3a0; color: #0a0a0a; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 0 4px; }
    .btn-ghost { background: transparent; color: #888; border: 1px solid #2a2a2d; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Checkout cancelled</h1>
    <p>No charges were made. Your account is unchanged.</p>
    <a class="btn" href="/#pricing">Back to pricing</a>
    <a class="btn btn-ghost" href="/">Home</a>
  </div>
</body>
</html>`);
  });

  return router;
}
