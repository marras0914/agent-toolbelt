import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";
import {
  fetchPolygonOverview,
  fetchPolygonPrevClose,
  fetchFMPIncomeStatement,
  fetchFMPKeyMetrics,
  fetchFMPRatiosTTM,
  fetchFinnhubMetrics,
  fetchFinnhubRecommendations,
  fetchFinnhubInsiders,
} from "./_stock-fetchers";
import { usTickerSchema, US_ONLY_HINT } from "./_stock-helpers";
import { parseLLMJson } from "./_llm-utils";

const inputSchema = z.object({
  ticker: usTickerSchema,
});

type Input = z.infer<typeof inputSchema>;

async function handler(input: Input) {
  const { ticker } = input;

  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.polygonApiKey) throw new Error("POLYGON_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  const fetchedAt = new Date().toISOString();
  const [overview, prevClose, incomeStatements, keyMetrics, ratiosTTM, finnhubMetrics, recommendations, insiders] =
    await Promise.all([
      fetchPolygonOverview(ticker),
      fetchPolygonPrevClose(ticker),
      fetchFMPIncomeStatement(ticker, "annual", 3),
      fetchFMPKeyMetrics(ticker),
      fetchFMPRatiosTTM(ticker),
      fetchFinnhubMetrics(ticker),
      fetchFinnhubRecommendations(ticker),
      fetchFinnhubInsiders(ticker),
    ]);

  const hasData = Object.keys(overview).length > 0 || incomeStatements.length > 0;
  if (!hasData) {
    throw new Error(`No data found for "${ticker}". ${US_ONLY_HINT}`);
  }

  const ov = overview;
  const pc = prevClose;
  const km = keyMetrics;
  const rt = ratiosTTM;
  const fh = finnhubMetrics;
  const rec = recommendations[0];

  const incomeRows = incomeStatements.slice(0, 3).map((s) => {
    const rev = s.revenue ? `$${(s.revenue / 1e9).toFixed(2)}B` : "N/A";
    const ratio = s.netIncome != null && s.revenue ? s.netIncome / s.revenue : null;
    const margin = ratio != null ? `${(ratio * 100).toFixed(1)}% net margin` : "N/A";
    const eps = s.eps != null ? `EPS $${s.eps.toFixed(2)}` : "";
    return `  ${s.fiscalYear ?? s.date?.substring(0, 4)}: Revenue ${rev} | ${margin}${eps ? ` | ${eps}` : ""}`;
  });

  const insiderPurchases = insiders.filter((t) => t.transactionCode === "P").length;
  const insiderSales = insiders.filter((t) => t.transactionCode === "S").length;

  const dataContext = [
    `Company: ${ov.name || ticker} (${ticker})`,
    ov.sic_description ? `Sector: ${ov.sic_description}` : "",
    ov.market_cap ? `Market Cap: $${(ov.market_cap / 1e9).toFixed(1)}B` : "",
    pc.c ? `Current Price: $${pc.c}` : "",
    ov.description ? `\nBusiness: ${ov.description.substring(0, 400)}` : "",
    incomeRows.length > 0 ? `\nFinancials:\n${incomeRows.join("\n")}` : "",
    fh.revenueGrowth3Y != null ? `3Y Revenue CAGR: ${Number(fh.revenueGrowth3Y).toFixed(1)}%` : "",
    `\nValuation:`,
    (rt.priceToEarningsRatioTTM ?? fh.peNormalizedAnnual) != null ? `  P/E (TTM): ${Number(rt.priceToEarningsRatioTTM ?? fh.peNormalizedAnnual).toFixed(1)}x` : "",
    (rt.priceToSalesRatioTTM ?? fh.psTTM) != null ? `  P/S: ${Number(rt.priceToSalesRatioTTM ?? fh.psTTM).toFixed(1)}x` : "",
    km.freeCashFlowYieldTTM != null ? `  FCF Yield: ${(Number(km.freeCashFlowYieldTTM) * 100).toFixed(1)}%` : (Number(fh.pfcfShareTTM) > 0 ? `  FCF Yield: ${(100 / Number(fh.pfcfShareTTM)).toFixed(1)}%` : ""),
    (rt.debtToEquityRatioTTM ?? fh["totalDebt/totalEquityAnnual"]) != null ? `  Debt/Equity: ${Number(rt.debtToEquityRatioTTM ?? fh["totalDebt/totalEquityAnnual"]).toFixed(2)}` : "",
    rec ? `\nAnalysts: ${rec.buy} buy / ${rec.hold} hold / ${rec.sell} sell` : "",
    `\nInsider activity (recent): ${insiderPurchases} open-market purchases, ${insiderSales} open-market sales`,
  ].filter(Boolean).join("\n");

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const systemPrompt =
    "You are a balanced, rigorous stock analyst in the style of The Motley Fool. " +
    "Your job is to steelman BOTH the bull and bear cases with equal intellectual honesty. " +
    "The bull case should be genuinely optimistic with specific data. " +
    "The bear case should be genuinely challenging — not strawman risks. " +
    "The net verdict should be your honest synthesis of both sides. " +
    "Write clearly for a retail investor. Always respond with valid JSON.";

  const userPrompt =
    `Build a rigorous bull vs. bear case for ${ticker}.\n\n` +
    dataContext +
    `\n\nReturn a JSON object with this exact structure:
{
  "companyName": "full company name",
  "bullCase": [
    { "argument": "title of the bull point", "detail": "2-3 sentences explaining it with specific data" },
    { "argument": "title", "detail": "..." },
    { "argument": "title", "detail": "..." }
  ],
  "bearCase": [
    { "argument": "title of the bear point", "detail": "2-3 sentences explaining the genuine risk" },
    { "argument": "title", "detail": "..." },
    { "argument": "title", "detail": "..." }
  ],
  "verdict": "bull_wins" | "slight_bull" | "too_close" | "slight_bear" | "bear_wins",
  "verdictRationale": "2-3 sentences explaining which side is more compelling and why. Be direct.",
  "keyDebate": "the single most important question investors need to answer about this stock",
  "forInvestorsWho": "1 sentence describing what type of investor this stock suits (or doesn't suit)"
}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const rawText = message.content[0].type === "text" ? message.content[0].text : "";
  const parsed = parseLLMJson(rawText);

  return {
    ticker,
    ...parsed,
    dataSources: {
      fetchedAt,
      polygon: { success: Object.keys(overview).length > 0 },
      fmp: { success: incomeStatements.length > 0 || Object.keys(keyMetrics).length > 0 || Object.keys(ratiosTTM).length > 0 },
      finnhub: { success: Object.keys(finnhubMetrics).length > 0 },
    },
    generatedAt: new Date().toISOString(),
  };
}

const bearVsBullTool: ToolDefinition<Input> = {
  name: "bear-vs-bull",
  description:
    "Generate a structured bull vs. bear case for any stock. Steelmans both sides equally — 3 bull arguments " +
    "and 3 bear arguments with specific data, then delivers a net verdict and the key question investors need " +
    "to answer. Great for stress-testing a thesis or getting a balanced view before investing. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["stocks", "investing", "finance", "analysis", "llm"],
    pricing: "$0.05 per call",
    pricingMicros: 50_000,
    exampleInput: { ticker: "NVDA" },
  },
};

registerTool(bearVsBullTool);
export default bearVsBullTool;
