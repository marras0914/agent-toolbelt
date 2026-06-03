import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";
import {
  fetchFMPEarnings,
  fetchFMPIncomeStatement,
  fetchFinnhubUpcomingEarnings,
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
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");

  const fetchedAt = new Date().toISOString();
  const [surprises, quarterlyIncome, upcomingEarnings] = await Promise.all([
    fetchFMPEarnings(ticker),
    fetchFMPIncomeStatement(ticker, "quarter"),
    fetchFinnhubUpcomingEarnings(ticker),
  ]);

  if (surprises.length === 0 && quarterlyIncome.length === 0) {
    throw new Error(`No earnings data found for "${ticker}". ${US_ONLY_HINT}`);
  }

  // Stable /earnings includes upcoming reports with epsActual:null — filter to reported quarters only
  const reportedSurprises = surprises.filter((s) => s.epsActual != null);
  const epsRows = reportedSurprises.map((s) => {
    const actual = s.epsActual;
    const estimate = s.epsEstimated;
    const beat = actual != null && estimate != null ? actual >= estimate : null;
    const pct = actual != null && estimate != null && estimate !== 0
      ? (((actual - estimate) / Math.abs(estimate)) * 100).toFixed(1)
      : null;
    return `  ${s.date}: EPS actual $${actual?.toFixed(2) ?? "N/A"} vs estimate $${estimate?.toFixed(2) ?? "N/A"}${pct != null ? ` (${pct > "0" ? "+" : ""}${pct}% ${beat ? "BEAT" : "MISS"})` : ""}`;
  });

  const beatsTotal = reportedSurprises.filter((s) =>
    s.epsEstimated != null && s.epsActual! >= s.epsEstimated
  ).length;
  const beatRate = reportedSurprises.length > 0
    ? `${beatsTotal}/${reportedSurprises.length} quarters beat (${Math.round((beatsTotal / reportedSurprises.length) * 100)}%)`
    : "N/A";

  const revenueRows = quarterlyIncome.slice(0, 8).map((q) => {
    const rev = q.revenue ? `$${(q.revenue / 1e9).toFixed(2)}B` : "N/A";
    const ratio = q.netIncome != null && q.revenue ? q.netIncome / q.revenue : null;
    const margin = ratio != null ? `${(ratio * 100).toFixed(1)}% net margin` : "";
    return `  ${q.period ?? ""} ${q.fiscalYear ?? q.date?.substring(0, 7) ?? ""}: Revenue ${rev}${margin ? ` | ${margin}` : ""}`;
  });

  const upcomingLine = upcomingEarnings.date
    ? `Next earnings: ${upcomingEarnings.date}${upcomingEarnings.epsEstimate ? ` | EPS estimate: $${upcomingEarnings.epsEstimate}` : ""}`
    : "No upcoming earnings date found in next 90 days";

  const dataContext = [
    `Ticker: ${ticker}`,
    `Beat Rate (last ${reportedSurprises.length} quarters): ${beatRate}`,
    "",
    "EPS Surprises (most recent first):",
    ...epsRows,
    "",
    "Quarterly Revenue Trend (most recent first):",
    ...revenueRows,
    "",
    upcomingLine,
  ].join("\n");

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const systemPrompt =
    "You are a professional stock analyst writing in the style of The Motley Fool — clear, conversational, " +
    "focused on what earnings results mean for long-term investors. Avoid jargon. " +
    "Always respond with valid JSON matching the exact schema requested. " +
    "Base your analysis strictly on the data provided. Do not fabricate numbers.";

  const userPrompt =
    `Analyze the earnings track record for ${ticker} and explain what it means for a long-term investor.\n\n` +
    dataContext +
    `\n\nReturn a JSON object with this exact structure:
{
  "verdict": "strong_compounder" | "consistent" | "mixed" | "volatile" | "deteriorating",
  "oneLiner": "one sentence capturing the key takeaway from this earnings history",
  "beatRate": "X/Y quarters beat (Z%)",
  "revenueTrend": "accelerating" | "stable" | "decelerating" | "declining",
  "revenueRead": "1-2 sentences on the revenue trajectory and what it signals",
  "epsRead": "1-2 sentences on EPS consistency and what it signals for reliability",
  "lastQuarterSummary": "2-3 sentences on the most recent quarter — what happened, was it meaningful?",
  "longTermRead": "2 sentences on what this earnings history means for a 3-5 year investor",
  "watchForNext": "the single most important thing to watch in the next earnings report",
  "upcomingDate": "next earnings date if known, or null"
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
    ...parsed,
    rawData: {
      quartersAnalyzed: reportedSurprises.length,
      beatsTotal,
      upcomingEarnings: Object.keys(upcomingEarnings).length > 0 ? upcomingEarnings : null,
    },
    dataSources: {
      fetchedAt,
      fmp: { success: surprises.length > 0 || quarterlyIncome.length > 0 },
      finnhub: { success: Object.keys(upcomingEarnings).length > 0 },
    },
    generatedAt: new Date().toISOString(),
  };
}

const earningsAnalysisTool: ToolDefinition<Input> = {
  name: "earnings-analysis",
  description:
    "Analyze a stock's earnings track record — EPS beat/miss history, revenue trend, and what it means " +
    "for long-term investors. Returns a Motley Fool-style read on earnings consistency, the last quarter, " +
    "and what to watch next. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["stocks", "investing", "finance", "earnings", "llm"],
    pricing: "$0.02 per call",
    pricingMicros: 20_000,
    exampleInput: { ticker: "NVDA" },
  },
};

registerTool(earningsAnalysisTool);
export default earningsAnalysisTool;
