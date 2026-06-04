import { Router, Request, Response, RequestHandler } from "express";
import { ZodType, ZodTypeDef } from "zod";
import { authenticate } from "../middleware/auth";
import { stockRateLimit } from "../middleware/stock-rate-limit";
import { trackUsage } from "../middleware/usage";
import { deductCredits } from "../db";
import { getCached, setCached } from "../db/stock-cache";

// Stock-tool RESPONSE cache: the underlying market data is already cached for
// 6h in _stock-fetchers, but every repeat call still re-ran the LLM analysis
// on identical data. Screening agents call the same tickers over and over
// (measured: 717 calls / 40 distinct inputs for one client), so caching the
// final JSON slashes Anthropic spend without serving staler data than the
// inputs already are.
//
// TTL is 24h: the underlying signals are daily-grained (prev close, quarterly
// statements, Form 4 filings), so a 24h window caps each (tool, ticker) at one
// LLM call/day. That's the knob that bounds COGS on the $10 Hobby tier — a
// once-daily watchlist sweep stays a single LLM call per pair per day instead
// of re-billing every burst.
const RESPONSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Deterministic cache key from validated input (sorted keys, stock inputs are flat)
export function responseCacheKey(toolName: string, input: any): string {
  const sorted = Object.keys(input ?? {})
    .sort()
    .map((k) => `${k}=${JSON.stringify(input[k])}`)
    .join("&");
  return `resp:v1:${toolName}:${sorted}`;
}

// ----- Tool Definition Interface -----
export interface ToolDefinition<TInput = any, TOutput = any> {
  /** Unique slug, used in URL: /api/tools/{name} */
  name: string;
  /** Human-readable description (shown in tool catalog) */
  description: string;
  /** Version string */
  version: string;
  /** Zod schema for input validation */
  inputSchema: ZodType<TInput, ZodTypeDef, any>;
  /** The actual tool logic */
  handler: (input: TInput) => Promise<TOutput>;
  /** OpenAPI-compatible metadata for agent discovery */
  metadata?: {
    tags?: string[];
    exampleInput?: TInput;
    exampleOutput?: TOutput;
    pricing?: string; // e.g. "$0.001 per call"
    pricingMicros?: number; // pricing in microdollars (1 USD = 1,000,000)
  };
}

// ----- Tool Registry -----
const registeredTools: Map<string, ToolDefinition> = new Map();

export function registerTool(tool: ToolDefinition): void {
  registeredTools.set(tool.name, tool);
  console.log(`🔧 Registered tool: ${tool.name} v${tool.version}`);
}

export function getRegisteredTools(): ToolDefinition[] {
  return Array.from(registeredTools.values());
}

// Parse pricing string like "$0.005 per call" → microdollars
function parsePricingMicros(pricing?: string): number {
  if (!pricing) return 1_000; // default $0.001
  const match = pricing.match(/\$([\d.]+)/);
  if (!match) return 1_000;
  return Math.round(parseFloat(match[1]) * 1_000_000);
}

// Translate upstream SDK errors (Anthropic billing/rate-limit, generic 4xx/5xx
// with JSON bodies) into clean user-facing messages. Tool-thrown errors like
// "No data found for X" pass through unchanged.
export function sanitizeErrorMessage(raw: string): string {
  if (/credit balance/i.test(raw) || /insufficient.*quota/i.test(raw)) {
    return "Service temporarily unavailable. Please try again shortly.";
  }
  if (/rate.?limit/i.test(raw) || /^429/.test(raw)) {
    return "Rate limit reached. Please retry in a moment.";
  }
  if (/^\d{3}\s+[{[]/.test(raw)) {
    return "An upstream service is temporarily unavailable.";
  }
  return raw || "An unexpected error occurred";
}

// ----- Build Express Router from registered tools -----
export function buildToolRouter(): Router {
  const router = Router();

  // Tool catalog endpoint (public — agents use this for discovery)
  router.get("/catalog", (_req: Request, res: Response) => {
    const catalog = getRegisteredTools().map((t) => {
      const { pricing, pricingMicros, ...publicMetadata } = t.metadata || {};
      return {
        name: t.name,
        description: t.description,
        version: t.version,
        endpoint: `/api/tools/${t.name}`,
        metadata: publicMetadata,
      };
    });
    res.json({ tools: catalog, count: catalog.length });
  });

  // Register each tool as a POST endpoint
  for (const tool of registeredTools.values()) {
    // Stock tools fan out to multiple upstream API calls each — apply a stricter
    // per-client rate limit so a single watchlist run can't burn an upstream
    // daily cap (especially FMP at 250/day on free).
    const isStockTool = tool.metadata?.tags?.includes("stocks") ?? false;
    const middlewares: RequestHandler[] = [authenticate];
    if (isStockTool) middlewares.push(stockRateLimit);
    middlewares.push(trackUsage(tool.name));

    router.post(
      `/${tool.name}`,
      ...middlewares,
      async (req: Request, res: Response) => {
        try {
          // Validate input
          const parsed = tool.inputSchema.safeParse(req.body);
          if (!parsed.success) {
            res.status(400).json({
              error: "validation_error",
              message: "Invalid input",
              details: parsed.error.flatten(),
            });
            return;
          }

          // Execute tool (stock tools: serve from the 6h response cache when warm)
          const startTime = Date.now();
          let result: any;
          let cached = false;
          const cacheKey = isStockTool ? responseCacheKey(tool.name, parsed.data) : null;
          if (cacheKey) {
            const hit = getCached<any>(cacheKey);
            if (hit !== undefined) {
              result = hit;
              cached = true;
            }
          }
          if (!cached) {
            result = await tool.handler(parsed.data);
            if (cacheKey) setCached(cacheKey, result, RESPONSE_CACHE_TTL_MS);
          }
          res.locals.cached = cached; // surfaced in usage stats by trackUsage
          const durationMs = Date.now() - startTime;

          // Deduct credits for PAYG clients (cache hits still bill — caching is
          // a cost optimization on our side, not a different product)
          if (req.client?.tier === "payg") {
            const micros = tool.metadata?.pricingMicros ?? parsePricingMicros(tool.metadata?.pricing);
            deductCredits(req.client.clientId, micros);
          }

          res.json({
            success: true,
            tool: tool.name,
            version: tool.version,
            durationMs,
            cached,
            result,
          });
        } catch (err: any) {
          console.error(`Tool error [${tool.name}]:`, err);
          res.status(500).json({
            error: "tool_error",
            message: sanitizeErrorMessage(err?.message || ""),
          });
        }
      }
    );
  }

  return router;
}
