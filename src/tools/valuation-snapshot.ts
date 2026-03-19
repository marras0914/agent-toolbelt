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

async function fetchKeyMetrics(ticker: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/key-metrics-ttm/${ticker}?apikey=${config.fmpApiKey}`
    );
    if (!res.ok) return {};
    const data = await res.json() as any;
    return Array.isArray(data) && data.length > 0 ? data[0] : {};
  } catch { return {}; }
}

async function fetchRatiosTTM(ticker: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/ratios-ttm/${ticker}?apikey=${config.fmpApiKey}`
    );
    if (!res.ok) return {};
    const data = await res.json() as any;
    return Array.isArray(data) && data.length > 0 ? data[0] : {};
  } catch { return {}; }
}

async function fetchFinnhubMetrics(ticker: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${config.finnhubApiKey}`
    );
    if (!res.ok) return {};
    const data = await res.json() as any;
    return data.metric || {};
  } catch { return {}; }
}

async function fetchPolygonOverview(ticker: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(
      `https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${config.polygonApiKey}`
    );
    if (!res.ok) return {};
    const data = await res.json() as any;
    return data.results || {};
  } catch { return {}; }
}

async function handler(input: Input) {
  const { ticker } = input;

  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");
  if (!config.polygonApiKey) throw new Error("POLYGON_API_KEY is not configured");

  const [keyMetrics, ratiosTTM, finnhubMetrics, overview] = await Promise.all([
    fetchKeyMetrics(ticker),
    fetchRatiosTTM(ticker),
    fetchFinnhubMetrics(ticker),
    fetchPolygonOverview(ticker),
  ]);

  const hasData = Object.keys(keyMetrics).length > 0 || Object.keys(finnhubMetrics).length > 0;
  if (!hasData) {
    throw new Error(`No valuation data found for "${ticker}". Please verify the symbol.`);
  }

  const km = keyMetrics as any;
  const rt = ratiosTTM as any;
  const fh = finnhubMetrics as any;
  const ov = overview as any;

  // Collect metrics with fallbacks
  const pe = km.peRatioTTM ?? fh.peNormalizedAnnual;
  const ps = km.priceToSalesRatioTTM ?? rt.priceToSalesRatioTTM;
  const pb = km.pbRatioTTM ?? rt.pbRatioTTM;
  const evEbitda = km.evToEbitdaTTM ?? rt.enterpriseValueMultipleTTM;
  const fcfYield = km.freeCashFlowYieldTTM;
  const dividendYield = rt.dividendYieldTTM ?? fh.dividendYieldIndicatedAnnual;
  const roe = km.roeTTM ?? rt.returnOnEquityTTM;
  const roic = km.roicTTM ?? rt.returnOnCapitalEmployedTTM;
  const debtToEquity = km.debtToEquityTTM ?? rt.debtEquityRatioTTM;
  const currentRatio = km.currentRatioTTM ?? rt.currentRatioTTM;
  const grossMargin = rt.grossProfitMarginTTM;
  const netMargin = rt.netProfitMarginTTM;
  const revenueGrowth3Y = fh.revenueGrowth3Y;
  const epsGrowth3Y = fh.epsGrowth3Y;

  // Historical P/E range from Finnhub
  const peHigh5Y = fh["pe5Y"];
  const peLow5Y = fh["peLow5Y"] ?? fh["peTTM"];
  const peHistoricalAvg = fh["peNormalizedAnnual"];

  const companyName = ov.name || ticker;
  const sector = ov.sic_description || "";
  const marketCap = ov.market_cap;

  const fmt = (v: number | null | undefined, suffix = "", decimals = 1) =>
    v != null ? `${Number(v).toFixed(decimals)}${suffix}` : "N/A";
  const fmtPct = (v: number | null | undefined) =>
    v != null ? `${(Number(v) * 100).toFixed(1)}%` : "N/A";

  const dataContext = [
    `Company: ${companyName} (${ticker})`,
    sector ? `Sector: ${sector}` : "",
    marketCap ? `Market Cap: $${(marketCap / 1e9).toFixed(1)}B` : "",
    "",
    "Valuation Multiples (TTM):",
    `  P/E Ratio: ${fmt(pe, "x")}`,
    `  P/S Ratio: ${fmt(ps, "x")}`,
    `  P/B Ratio: ${fmt(pb, "x")}`,
    `  EV/EBITDA: ${fmt(evEbitda, "x")}`,
    `  FCF Yield: ${fmtPct(fcfYield)}`,
    dividendYield != null ? `  Dividend Yield: ${fmtPct(dividendYield)}` : "",
    "",
    "Quality Metrics:",
    `  ROE: ${fmtPct(roe)}`,
    `  ROIC: ${fmtPct(roic)}`,
    `  Gross Margin: ${fmtPct(grossMargin)}`,
    `  Net Margin: ${fmtPct(netMargin)}`,
    `  Debt/Equity: ${fmt(debtToEquity)}`,
    `  Current Ratio: ${fmt(currentRatio)}`,
    "",
    "Growth:",
    `  3-Year Revenue CAGR: ${fmtPct(revenueGrowth3Y)}`,
    `  3-Year EPS CAGR: ${fmtPct(epsGrowth3Y)}`,
    peHigh5Y != null ? `\nHistorical P/E context:\n  5-Year high P/E: ${fmt(peHigh5Y, "x")}\n  Current P/E: ${fmt(pe, "x")}` : "",
  ].filter(Boolean).join("\n");

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const systemPrompt =
    "You are a professional stock analyst writing in the style of The Motley Fool — clear, direct, " +
    "focused on what the valuation means for a long-term investor. Avoid jargon. " +
    "Interpret multiples in context: a high P/E can be justified by high growth; a low P/E can signal problems. " +
    "Always respond with valid JSON matching the exact schema. Base analysis strictly on provided data.";

  const userPrompt =
    `Assess the valuation of ${ticker} for a long-term investor.\n\n` +
    dataContext +
    `\n\nReturn a JSON object with this exact structure:
{
  "verdict": "very_cheap" | "cheap" | "fair" | "expensive" | "very_expensive",
  "oneLiner": "one sentence capturing the valuation story",
  "peRead": "1-2 sentences interpreting the P/E ratio in context of the company's growth and sector",
  "multiplesSummary": "2-3 sentences synthesizing the valuation multiples together — is the premium (or discount) justified?",
  "qualityRead": "1-2 sentences on ROE/ROIC/margins — is this a high-quality business at this price?",
  "growthContext": "1-2 sentences on whether growth rates justify the current multiple (PEG-style thinking)",
  "buyZone": "at what P/E or price level would this become clearly attractive? Be specific.",
  "bottomLine": "2 sentences — net verdict for a long-term investor: is this a good entry point, a hold, or a wait?"
}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const rawText = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonText = rawText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Failed to parse structured response from LLM");
  }

  return {
    ticker,
    companyName,
    ...parsed,
    metrics: {
      peRatio: pe != null ? parseFloat(Number(pe).toFixed(1)) : null,
      psRatio: ps != null ? parseFloat(Number(ps).toFixed(1)) : null,
      pbRatio: pb != null ? parseFloat(Number(pb).toFixed(1)) : null,
      evEbitda: evEbitda != null ? parseFloat(Number(evEbitda).toFixed(1)) : null,
      fcfYield: fcfYield != null ? parseFloat((Number(fcfYield) * 100).toFixed(1)) : null,
      roe: roe != null ? parseFloat((Number(roe) * 100).toFixed(1)) : null,
      netMargin: netMargin != null ? parseFloat((Number(netMargin) * 100).toFixed(1)) : null,
      debtToEquity: debtToEquity != null ? parseFloat(Number(debtToEquity).toFixed(2)) : null,
    },
    generatedAt: new Date().toISOString(),
  };
}

const valuationSnapshotTool: ToolDefinition<Input> = {
  name: "valuation-snapshot",
  description:
    "Assess whether a stock is cheap, fair, or expensive. Returns P/E, P/S, EV/EBITDA, FCF yield, ROE, and margins, " +
    "then synthesizes them into a Motley Fool-style verdict on whether the price is justified by the business quality " +
    "and growth. Includes a specific buy zone price level. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["stocks", "investing", "finance", "valuation", "llm"],
    pricing: "$0.05 per call",
    pricingMicros: 50_000,
    exampleInput: { ticker: "NVDA" },
  },
};

registerTool(valuationSnapshotTool);
export default valuationSnapshotTool;
