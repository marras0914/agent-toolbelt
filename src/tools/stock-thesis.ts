import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";
import {
  fetchPolygonOverview,
  fetchPolygonPrevClose,
  fetchFinnhubMetrics,
  fetchFinnhubRecommendations,
  fetchFinnhubInsiders,
  fetchFMPIncomeStatement,
  fetchFMPKeyMetrics,
  fetchFMPRatiosTTM,
} from "./_stock-fetchers";
import { sane, fhPct, round1, usTickerSchema, US_ONLY_HINT } from "./_stock-helpers";
import { parseLLMJson } from "./_llm-utils";

const inputSchema = z.object({
  ticker: usTickerSchema,
  timeHorizon: z
    .enum(["1-2 years", "3-5 years", "5+ years"])
    .default("3-5 years")
    .describe("Investment time horizon for the thesis"),
});

type Input = z.infer<typeof inputSchema>;

async function handler(input: Input) {
  const { ticker, timeHorizon } = input;

  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.polygonApiKey) throw new Error("POLYGON_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  const fetchedAt = new Date().toISOString();
  const [overview, prevClose, metrics, recommendations, insiders, incomeStatements, keyMetrics, ratiosTTM] =
    await Promise.all([
      fetchPolygonOverview(ticker),
      fetchPolygonPrevClose(ticker),
      fetchFinnhubMetrics(ticker),
      fetchFinnhubRecommendations(ticker),
      fetchFinnhubInsiders(ticker),
      fetchFMPIncomeStatement(ticker, "annual", 3),
      fetchFMPKeyMetrics(ticker),
      fetchFMPRatiosTTM(ticker),
    ]);

  const hasData =
    Object.keys(overview).length > 0 ||
    incomeStatements.length > 0 ||
    Object.keys(metrics).length > 0;

  if (!hasData) {
    throw new Error(`No data found for ticker "${ticker}". ${US_ONLY_HINT}`);
  }

  const companyName = overview.name || ticker;
  const description = (overview.description || "").substring(0, 600);
  const sector = overview.sic_description || "";
  const employees = overview.total_employees;
  const marketCap = overview.market_cap;
  const currentPrice = prevClose.c;

  const incomeRows = incomeStatements.slice(0, 3).map((s) => {
    const rev = s.revenue ? `$${(s.revenue / 1e9).toFixed(2)}B` : "N/A";
    const ratio = s.netIncome != null && s.revenue ? s.netIncome / s.revenue : null;
    const margin = ratio != null ? `${(ratio * 100).toFixed(1)}%` : "N/A";
    const eps = s.eps != null ? `$${s.eps.toFixed(2)}` : "N/A";
    const year = s.fiscalYear || (s.date || "").substring(0, 4);
    return `  ${year}: Revenue ${rev} | Net Margin ${margin} | EPS ${eps}`;
  });

  const latestRec = recommendations[0];
  const analystLine = latestRec
    ? `${latestRec.buy} buy / ${latestRec.hold} hold / ${latestRec.sell} sell (${latestRec.period})`
    : "Not available";

  const insiderLines = insiders.slice(0, 5).map((t) => {
    const direction = t.transactionCode === "P" ? "purchase" : t.transactionCode === "S" ? "sale" : t.transactionCode;
    return `  ${t.transactionDate}: ${t.name} — ${direction} (${(t.change ?? 0) > 0 ? "+" : ""}${t.change?.toLocaleString()} shares)`;
  });

  const km = keyMetrics;
  const rt = ratiosTTM;
  const fh = metrics;

  const pe = sane(rt.priceToEarningsRatioTTM ?? fh.peNormalizedAnnual, 0, 2000);
  const ps = sane(rt.priceToSalesRatioTTM ?? fh.psTTM, 0, 1000);
  const pb = sane(rt.priceToBookRatioTTM ?? fh.pbAnnual, 0, 500);
  const roe = sane(km.returnOnEquityTTM ?? rt.returnOnEquityTTM ?? fhPct(fh.roeTTM), -5, 10);
  const debtToEquity = sane(rt.debtToEquityRatioTTM ?? fh["totalDebt/totalEquityAnnual"], 0, 100);
  const pfcfTTM = Number(fh.pfcfShareTTM);
  const fcfYield = sane(km.freeCashFlowYieldTTM ?? (pfcfTTM > 0 && isFinite(pfcfTTM) ? 1 / pfcfTTM : undefined), -1, 1);
  // Finnhub revenueGrowth3Y is already a percentage — pass through, don't divide by 100
  const revenueGrowth3Y = sane(fh.revenueGrowth3Y, -100, 1000);

  const lines: string[] = [
    `Company: ${companyName} (${ticker})`,
    sector ? `Sector: ${sector}` : "",
    employees ? `Employees: ${employees.toLocaleString()}` : "",
    marketCap ? `Market Cap: $${(marketCap / 1e9).toFixed(1)}B` : "",
    currentPrice ? `Current Price: $${currentPrice}` : "",
    description ? `\nBusiness:\n${description}` : "",
    incomeRows.length > 0 ? `\nFinancial Performance (Annual):\n${incomeRows.join("\n")}` : "",
    revenueGrowth3Y != null ? `3-Year Revenue CAGR: ${revenueGrowth3Y.toFixed(1)}%` : "",
    `\nValuation:`,
    pe != null ? `  P/E (TTM): ${Number(pe).toFixed(1)}` : "",
    ps != null ? `  P/S (TTM): ${Number(ps).toFixed(1)}` : "",
    pb != null ? `  P/B: ${Number(pb).toFixed(1)}` : "",
    fcfYield != null ? `  FCF Yield: ${(Number(fcfYield) * 100).toFixed(1)}%` : "",
    roe != null ? `  ROE: ${(Number(roe) * 100).toFixed(1)}%` : "",
    debtToEquity != null ? `  Debt/Equity: ${Number(debtToEquity).toFixed(2)}` : "",
    `\nAnalyst Consensus: ${analystLine}`,
    insiderLines.length > 0
      ? `\nRecent Insider Activity:\n${insiderLines.join("\n")}`
      : "\nRecent Insider Activity: None reported",
  ];

  const dataContext = lines.filter(Boolean).join("\n");

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const systemPrompt =
    "You are a professional stock analyst writing in the style of The Motley Fool — clear, conversational, " +
    "grounded in fundamentals, focused on long-term investing. Avoid jargon. Write for a smart retail investor. " +
    "Always respond with valid JSON matching the exact schema requested. " +
    "Base your analysis strictly on the data provided. Do not fabricate numbers. " +
    "If data is limited, work with what's available and be transparent about it.";

  const userPrompt =
    `Analyze the following data for ${ticker} and write a ${timeHorizon} investment thesis.\n\n` +
    dataContext +
    `\n\nReturn a JSON object with this exact structure:
{
  "companyName": "full company name",
  "sector": "sector or industry",
  "verdict": "bullish" | "neutral" | "bearish",
  "oneLiner": "one compelling sentence that captures the core investment case",
  "thesis": "2-3 paragraphs. Write like a human analyst — reference specific numbers, explain what they mean for long-term investors. Be direct about the opportunity or lack thereof.",
  "keyStrengths": ["strength with specific data point", "strength 2", "strength 3"],
  "keyRisks": ["risk 1", "risk 2"],
  "valuation": "1-2 sentences — does the stock look cheap, fair, or expensive at the current price? Reference the P/E, P/S, or other relevant metric.",
  "insiderRead": "1 sentence interpreting the insider activity — meaningful buying/selling or routine noise?",
  "analystRead": "1 sentence interpreting the analyst consensus — is the street bullish, divided, or cautious?",
  "watchFor": "the single most important metric or event to watch in the next earnings report",
  "timeHorizon": "${timeHorizon}"
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
    dataSnapshot: {
      marketCapBillions: marketCap != null ? parseFloat((marketCap / 1e9).toFixed(1)) : null,
      currentPrice: currentPrice ?? null,
      peRatio: round1(pe),
      analystConsensus: latestRec
        ? { buy: latestRec.buy, hold: latestRec.hold, sell: latestRec.sell }
        : null,
    },
    dataSources: {
      fetchedAt,
      polygon: { success: Object.keys(overview).length > 0 },
      finnhub: { success: Object.keys(metrics).length > 0 },
      fmp: { success: incomeStatements.length > 0 || Object.keys(keyMetrics).length > 0 || Object.keys(ratiosTTM).length > 0 },
    },
    generatedAt: new Date().toISOString(),
  };
}

const stockThesisTool: ToolDefinition<Input> = {
  name: "stock-thesis",
  description:
    "Generate a long-term investment thesis for any stock. Pulls live financials, valuation metrics, " +
    "insider trades, and analyst ratings, then synthesizes them into a Motley Fool-style research note. " +
    "Returns verdict (bullish/neutral/bearish), thesis, key strengths, risks, and valuation read. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["stocks", "investing", "finance", "analysis", "llm"],
    pricing: "$0.05 per call",
    pricingMicros: 50_000,
    exampleInput: {
      ticker: "NVDA",
      timeHorizon: "3-5 years",
    },
  },
};

registerTool(stockThesisTool);
export default stockThesisTool;
