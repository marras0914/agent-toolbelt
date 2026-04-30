import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";
import {
  fetchPolygonOverview,
  fetchFMPKeyMetrics,
  fetchFMPRatiosTTM,
  fetchFinnhubMetrics,
} from "./_stock-fetchers";
import { sane, fhPct, fmt, fmtPct, round1 } from "./_stock-helpers";
import { parseLLMJson } from "./_llm-utils";

const inputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(10)
    .transform((v) => v.toUpperCase().trim())
    .describe("Stock ticker symbol (e.g. NVDA, AAPL, MSFT)"),
});

type Input = z.infer<typeof inputSchema>;

async function handler(input: Input) {
  const { ticker } = input;

  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");
  if (!config.polygonApiKey) throw new Error("POLYGON_API_KEY is not configured");

  const fetchedAt = new Date().toISOString();
  const [keyMetrics, ratiosTTM, finnhubMetrics, overview] = await Promise.all([
    fetchFMPKeyMetrics(ticker),
    fetchFMPRatiosTTM(ticker),
    fetchFinnhubMetrics(ticker),
    fetchPolygonOverview(ticker),
  ]);

  const hasData = Object.keys(keyMetrics).length > 0 || Object.keys(finnhubMetrics).length > 0;
  if (!hasData) {
    throw new Error(`No valuation data found for "${ticker}". Please verify the symbol.`);
  }

  const km = keyMetrics;
  const rt = ratiosTTM;
  const fh = finnhubMetrics;
  const ov = overview;

  const pe = sane(rt.priceToEarningsRatioTTM ?? fh.peNormalizedAnnual, 0, 2000);
  const ps = sane(rt.priceToSalesRatioTTM ?? fh.psTTM, 0, 1000);
  const pb = sane(rt.priceToBookRatioTTM ?? fh.pbAnnual, 0, 500);
  const evEbitda = sane(km.evToEBITDATTM ?? rt.enterpriseValueMultipleTTM ?? fh.evEbitdaTTM, 0, 500);
  const pfcfTTM = Number(fh.pfcfShareTTM);
  const fcfYieldFromFh = pfcfTTM > 0 && isFinite(pfcfTTM) ? 1 / pfcfTTM : undefined;
  const fcfYield = sane(km.freeCashFlowYieldTTM ?? fcfYieldFromFh, -1, 1);

  // FMP ratios-ttm dividend yield is decimal; Finnhub is decimal — cap at 30% to reject bad data
  const rawDividendYield = rt.dividendYieldTTM ?? fh.dividendYieldIndicatedAnnual;
  const dividendYield = sane(rawDividendYield, 0, 0.30);

  const roe = sane(km.returnOnEquityTTM ?? rt.returnOnEquityTTM ?? fhPct(fh.roeTTM), -5, 10);
  const roic = sane(km.returnOnInvestedCapitalTTM ?? km.returnOnCapitalEmployedTTM ?? fhPct(fh.roicTTM), -5, 10);
  const debtToEquity = sane(rt.debtToEquityRatioTTM ?? fh["totalDebt/totalEquityAnnual"], 0, 100);
  const currentRatio = sane(km.currentRatioTTM ?? rt.currentRatioTTM ?? fh.currentRatioAnnual, 0, 50);
  const grossMargin = sane(rt.grossProfitMarginTTM ?? fhPct(fh.grossMarginTTM), -1, 1);
  const netMargin = sane(rt.netProfitMarginTTM ?? fhPct(fh.netProfitMarginTTM), -1, 1);

  const revenueGrowth3Y = sane(fhPct(fh.revenueGrowth3Y), -1, 10);
  const epsGrowth3Y = sane(fhPct(fh.epsGrowth3Y), -5, 50);

  const peHigh5Y = (fh as Record<string, unknown>)["pe5Y"] as number | undefined;

  const companyName = ov.name || ticker;
  const sector = ov.sic_description || "";
  const marketCap = ov.market_cap;

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
  const parsed = parseLLMJson(rawText);

  return {
    ticker,
    companyName,
    ...parsed,
    metrics: {
      peRatio: round1(pe),
      psRatio: round1(ps),
      pbRatio: round1(pb),
      evEbitda: round1(evEbitda),
      fcfYield: fcfYield != null ? parseFloat((Number(fcfYield) * 100).toFixed(1)) : null,
      roe: roe != null ? parseFloat((Number(roe) * 100).toFixed(1)) : null,
      netMargin: netMargin != null ? parseFloat((Number(netMargin) * 100).toFixed(1)) : null,
      debtToEquity: debtToEquity != null ? parseFloat(Number(debtToEquity).toFixed(2)) : null,
    },
    dataSources: {
      fetchedAt,
      fmp: { success: Object.keys(keyMetrics).length > 0 || Object.keys(ratiosTTM).length > 0 },
      finnhub: { success: Object.keys(finnhubMetrics).length > 0 },
      polygon: { success: Object.keys(overview).length > 0 },
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
