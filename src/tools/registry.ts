import { Router, Request, Response, RequestHandler } from "express";
import { ZodType, ZodTypeDef } from "zod";
import { authenticate } from "../middleware/auth";
import { stockRateLimit } from "../middleware/stock-rate-limit";
import { trackUsage } from "../middleware/usage";
import { deductCredits } from "../db";

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

          // Execute tool
          const startTime = Date.now();
          const result = await tool.handler(parsed.data);
          const durationMs = Date.now() - startTime;

          // Deduct credits for PAYG clients
          if (req.client?.tier === "payg") {
            const micros = tool.metadata?.pricingMicros ?? parsePricingMicros(tool.metadata?.pricing);
            deductCredits(req.client.clientId, micros);
          }

          res.json({
            success: true,
            tool: tool.name,
            version: tool.version,
            durationMs,
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
