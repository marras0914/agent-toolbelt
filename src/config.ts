import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  apiKeySecret: process.env.API_KEY_SECRET || "dev-secret-change-me",

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  },

  usageTracking: process.env.USAGE_TRACKING_ENABLED !== "false",

  // Database
  databasePath: process.env.DATABASE_PATH || "./data/toolbelt.db",

  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",

  // RapidAPI
  rapidApiProxySecret: process.env.RAPIDAPI_PROXY_SECRET || "",

  // Admin
  adminSecret: process.env.ADMIN_SECRET || "",

  // LLM
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",

  // Stock data APIs
  polygonApiKey: process.env.POLYGON_API_KEY || "",
  finnhubApiKey: process.env.FINNHUB_API_KEY || "",
  fmpApiKey: process.env.FMP_API_KEY || "",

  // Email (SendGrid)
  sendgridApiKey: process.env.SENDGRID_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "hello@elephanttortoise.com",
};
