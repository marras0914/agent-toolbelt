import Stripe from "stripe";
import { Request, Response, Router } from "express";
import { config } from "../config";
import {
  getClientByEmail,
  getClientByStripeId,
  updateClientStripe,
  updateClientTier,
  addCredits,
  getClientBalance,
  Client,
} from "../db";

// ----- Stripe Client -----
const stripe = config.stripeSecretKey
  ? new Stripe(config.stripeSecretKey, { apiVersion: "2024-12-18.acacia" as any })
  : null;

// ----- PAYG Credit Packs -----
// Amount in cents → label
export const CREDIT_PACKS: Record<number, string> = {
  500:  "$5 — 5,000,000 credits (~50,000 cheap calls / ~50 contract extractions)",
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
  tier: "starter" | "pro" | "enterprise",
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

    if (!["starter", "pro", "enterprise"].includes(tier)) {
      res.status(400).json({ error: "tier must be: starter, pro, or enterprise" });
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
        llmTools: Math.floor(balance / 50_000),   // $0.05 tools
        contractExtractor: Math.floor(balance / 100_000), // $0.10
      },
    });
  });

  // Success/cancel pages
  router.get("/success", (_req, res) => {
    res.json({
      message: "🎉 Subscription activated! Your API key tier has been upgraded.",
      next: "Your existing API keys now have increased limits. Check /admin/usage for your new quotas.",
    });
  });

  router.get("/cancel", (_req, res) => {
    res.json({ message: "Checkout cancelled. No changes were made." });
  });

  return router;
}
