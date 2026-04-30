import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";

const inputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(10)
    .transform((v) => v.toUpperCase().trim())
    .describe("Stock ticker symbol (e.g. NVDA, AAPL, MSFT)"),
});

type Input = z.infer<typeof inputSchema>;

async function fetchPolygonOverview(ticker: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${config.polygonApiKey}`);
    if (!res.ok) return {};
    const data = await res.json() as any;
    return data.results || {};
  } catch { return {}; }
}

async function fetchFMPKeyMetrics(ticker: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${ticker}&apikey=${config.fmpApiKey}`);
    if (!res.ok) return {};
    const data = await res.json() as any;
    return Array.isArray(data) && data.length > 0 ? data[0] : {};
  } catch { return {}; }
}

async function fetchFMPRatiosTTM(ticker: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${ticker}&apikey=${config.fmpApiKey}`);
    if (!res.ok) return {};
    const data = await res.json() as any;
    return Array.isArray(data) && data.length > 0 ? data[0] : {};
  } catch { return {}; }
}

async function fetchFinnhubMetrics(ticker: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${config.finnhubApiKey}`);
    if (!res.ok) return {};
    const data = await res.json() as any;
    return data.metric || {};
  } catch { return {}; }
}

async function handler(input: Input) {
  const { ticker } = input;

  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.polygonApiKey) throw new Error("POLYGON_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  const fetchedAt = new Date().toISOString();
  const [overview, km, rt, fh] = await Promise.all([
    fetchPolygonOverview(ticker),
    fetchFMPKeyMetrics(ticker),
    fetchFMPRatiosTTM(ticker),
    fetchFinnhubMetrics(ticker),
  ]);

  if (Object.keys(overview).length === 0 && Object.keys(km).length === 0 && Object.keys(fh).length === 0) {
    throw new Error(`No data found for "${ticker}". Please verify the symbol.`);
  }

  const ov = overview as any;
  const kmAny = km as any;
  const rtAny = rt as any;
  const fhAny = fh as any;

  const sane = (v: unknown, min: number, max: number): number | null => {
    const n = Number(v);
    return v != null && isFinite(n) && n >= min && n <= max ? n : null;
  };
  const fhPct = (v: unknown) => (v != null && isFinite(Number(v)) ? Number(v) / 100 : undefined);

  const roic = sane(kmAny.returnOnInvestedCapitalTTM ?? kmAny.returnOnCapitalEmployedTTM ?? fhPct(fhAny.roicTTM), -5, 10);
  const roe = sane(kmAny.returnOnEquityTTM ?? rtAny.returnOnEquityTTM ?? fhPct(fhAny.roeTTM), -5, 10);
  const grossMargin = sane(rtAny.grossProfitMarginTTM ?? fhPct(fhAny.grossMarginTTM), -1, 1);
  const operatingMargin = sane(rtAny.operatingProfitMarginTTM ?? rtAny.ebitMarginTTM, -1, 1);
  const netMargin = sane(rtAny.netProfitMarginTTM ?? fhPct(fhAny.netProfitMarginTTM), -1, 1);
  const fcfYield = sane(kmAny.freeCashFlowYieldTTM, -1, 1);
  const intangiblesRatio = sane(kmAny.intangiblesToTotalAssetsTTM, 0, 1);
  const capexToRevenue = sane(kmAny.capexToRevenueTTM, -1, 1);
  const revenueGrowth3Y = sane(fhPct(fhAny.revenueGrowth3Y), -1, 10);

  const fmt = (v: number | null | undefined, suffix = "", decimals = 1) =>
    v != null ? `${Number(v).toFixed(decimals)}${suffix}` : "N/A";
  const fmtPct = (v: number | null | undefined) =>
    v != null ? `${(Number(v) * 100).toFixed(1)}%` : "N/A";

  const description = (ov.description || "").substring(0, 800);
  const sector = ov.sic_description || "";
  const employees = ov.total_employees as number | undefined;
  const marketCap = ov.market_cap as number | undefined;
  const companyName = ov.name || ticker;

  const dataContext = [
    `Company: ${companyName} (${ticker})`,
    sector ? `Sector: ${sector}` : "",
    marketCap ? `Market Cap: $${(marketCap / 1e9).toFixed(1)}B` : "",
    employees ? `Employees: ${employees.toLocaleString()}` : "",
    "",
    description ? `Business description:\n${description}` : "",
    "",
    "Moat-related metrics (TTM):",
    `  ROIC: ${fmtPct(roic)}  (>15% sustained = strong moat indicator)`,
    `  ROE: ${fmtPct(roe)}`,
    `  Gross margin: ${fmtPct(grossMargin)}  (high + stable = pricing power)`,
    `  Operating margin: ${fmtPct(operatingMargin)}`,
    `  Net margin: ${fmtPct(netMargin)}`,
    `  FCF yield: ${fmtPct(fcfYield)}`,
    `  Capex-to-revenue: ${fmtPct(capexToRevenue)}  (low = capital-light = often moat)`,
    `  Intangibles-to-assets: ${fmtPct(intangiblesRatio)}  (high = brand/IP-heavy)`,
    `  3-year revenue CAGR: ${fmtPct(revenueGrowth3Y)}`,
  ].filter(Boolean).join("\n");

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const systemPrompt =
    "You are a professional stock analyst evaluating competitive moats in the style of Warren Buffett and Pat Dorsey. " +
    "A moat is a durable competitive advantage that lets a business earn high returns on capital for many years. " +
    "Categorize moats into: brand (Coca-Cola, Apple), switching_costs (Microsoft, Adobe), network_effects (Visa, Meta), " +
    "scale_advantages (Costco, Walmart), intangibles_ip (pharma patents, proprietary tech), and cost_advantage (low-cost producer). " +
    "Use the financial evidence to support your read. High sustained ROIC (>15%) and durable margins are the quantitative " +
    "fingerprints of a real moat. " +
    "Always respond with valid JSON matching the exact schema. Be direct about whether the moat is wide, narrow, or non-existent.";

  const userPrompt =
    `Analyze the competitive moat of ${ticker}.\n\n` +
    dataContext +
    `\n\nReturn a JSON object with this exact structure:
{
  "ticker": "${ticker}",
  "companyName": "full company name",
  "moatRating": "wide" | "narrow" | "none",
  "oneLiner": "one sentence describing the moat (or lack thereof)",
  "moatSources": [
    {
      "type": "brand" | "switching_costs" | "network_effects" | "scale_advantages" | "intangibles_ip" | "cost_advantage",
      "strength": "strong" | "moderate" | "weak",
      "evidence": "1-2 sentences explaining how this moat type applies, citing specific business characteristics or numbers"
    }
  ],
  "quantitativeRead": "1-2 sentences interpreting the ROIC, margins, and capex profile in moat terms",
  "durabilityRead": "2-3 sentences on whether the moat is widening, stable, or eroding, and over what time horizon you'd expect it to hold",
  "threats": ["specific threat 1 to the moat", "specific threat 2"],
  "bottomLine": "2 sentences — should a long-term investor pay a premium for this moat?"
}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const rawText = message.content[0].type === "text" ? message.content[0].text : "";
  const stripped = rawText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Failed to parse structured response from LLM");
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new Error("Failed to parse structured response from LLM");
    }
  }

  return {
    ticker,
    ...parsed,
    metrics: {
      roic: roic != null ? parseFloat((Number(roic) * 100).toFixed(1)) : null,
      roe: roe != null ? parseFloat((Number(roe) * 100).toFixed(1)) : null,
      grossMargin: grossMargin != null ? parseFloat((Number(grossMargin) * 100).toFixed(1)) : null,
      operatingMargin: operatingMargin != null ? parseFloat((Number(operatingMargin) * 100).toFixed(1)) : null,
      capexToRevenue: capexToRevenue != null ? parseFloat((Number(capexToRevenue) * 100).toFixed(1)) : null,
      intangiblesRatio: intangiblesRatio != null ? parseFloat((Number(intangiblesRatio) * 100).toFixed(1)) : null,
    },
    dataSources: {
      fetchedAt,
      polygon: { success: Object.keys(overview).length > 0 },
      finnhub: { success: Object.keys(fh).length > 0 },
      fmp: { success: Object.keys(km).length > 0 || Object.keys(rt).length > 0 },
    },
    generatedAt: new Date().toISOString(),
  };
}

const moatAnalysisTool: ToolDefinition<Input> = {
  name: "moat-analysis",
  description:
    "Analyze the competitive moat of a stock, Buffett-style. Categorizes the moat (brand, switching costs, network effects, " +
    "scale, intangibles/IP, cost advantage), rates it wide/narrow/none, and assesses durability and threats. Uses ROIC, margins, " +
    "and capex intensity as the quantitative fingerprint of a real moat. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["stocks", "investing", "finance", "moat", "qualitative", "llm"],
    pricing: "$0.05 per call",
    pricingMicros: 50_000,
    exampleInput: { ticker: "AAPL" },
  },
};

registerTool(moatAnalysisTool);
export default moatAnalysisTool;
