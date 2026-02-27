import Stripe from "stripe";
import { Request, Response, Router } from "express";
import { config } from "../config";
import {
  getClientByEmail,
  getClientByStripeId,
  updateClientStripe,
  updateClientTier,
  Client,
} from "../db";

// ----- Stripe Client -----
const stripe = config.stripeSecretKey
  ? new Stripe(config.stripeSecretKey, { apiVersion: "2024-12-18.acacia" as any })
  : null;

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
        const { clientId, tier } = session.metadata || {};

        if (clientId && tier && session.subscription && session.customer) {
          // Retrieve subscription to get the subscription item ID (for usage metering)
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
