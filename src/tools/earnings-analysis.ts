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

async function fetchEarningsSurprises(ticker: string): Promise<unknown[]> {
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/earnings-surprises/${ticker}?apikey=${config.fmpApiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json() as unknown[];
    return Array.isArray(data) ? data.slice(0, 12) : [];
  } catch { return []; }
}

async function fetchQuarterlyIncome(ticker: string): Promise<unknown[]> {
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/income-statement/${ticker}?period=quarter&limit=8&apikey=${config.fmpApiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json() as unknown[];
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function fetchUpcomingEarnings(ticker: string): Promise<Record<string, unknown>> {
  try {
    const from = new Date().toISOString().split("T")[0];
    const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?symbol=${ticker}&from=${from}&to=${to}&token=${config.finnhubApiKey}`
    );
    if (!res.ok) return {};
    const data = await res.json() as any;
    const entries = data.earningsCalendar || [];
    return entries.length > 0 ? entries[0] : {};
  } catch { return {}; }
}

async function handler(input: Input) {
  const { ticker } = input;

  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");

  const [surprises, quarterlyIncome, upcomingEarnings] = await Promise.all([
    fetchEarningsSurprises(ticker),
    fetchQuarterlyIncome(ticker),
    fetchUpcomingEarnings(ticker),
  ]);

  if ((surprises as any[]).length === 0 && (quarterlyIncome as any[]).length === 0) {
    throw new Error(`No earnings data found for "${ticker}". Please verify the symbol.`);
  }

  // Build EPS beat/miss history
  const epsRows = (surprises as any[]).map((s: any) => {
    const actual = s.actualEarningResult;
    const estimate = s.estimatedEarning;
    const beat = actual != null && estimate != null ? actual >= estimate : null;
    const pct = actual != null && estimate != null && estimate !== 0
      ? (((actual - estimate) / Math.abs(estimate)) * 100).toFixed(1)
      : null;
    return `  ${s.date}: EPS actual $${actual?.toFixed(2) ?? "N/A"} vs estimate $${estimate?.toFixed(2) ?? "N/A"}${pct != null ? ` (${pct > "0" ? "+" : ""}${pct}% ${beat ? "BEAT" : "MISS"})` : ""}`;
  });

  const beatsTotal = (surprises as any[]).filter((s: any) =>
    s.actualEarningResult != null && s.estimatedEarning != null && s.actualEarningResult >= s.estimatedEarning
  ).length;
  const beatRate = (surprises as any[]).length > 0
    ? `${beatsTotal}/${(surprises as any[]).length} quarters beat (${Math.round((beatsTotal / (surprises as any[]).length) * 100)}%)`
    : "N/A";

  // Revenue trend from quarterly income
  const revenueRows = (quarterlyIncome as any[]).slice(0, 8).map((q: any) => {
    const rev = q.revenue ? `$${(q.revenue / 1e9).toFixed(2)}B` : "N/A";
    const margin = q.netIncomeRatio != null ? `${(q.netIncomeRatio * 100).toFixed(1)}% net margin` : "";
    return `  ${q.period ?? ""} ${q.calendarYear ?? q.date?.substring(0, 7) ?? ""}: Revenue ${rev}${margin ? ` | ${margin}` : ""}`;
  });

  // Upcoming earnings
  const upcomingLine = (upcomingEarnings as any).date
    ? `Next earnings: ${(upcomingEarnings as any).date}${(upcomingEarnings as any).epsEstimate ? ` | EPS estimate: $${(upcomingEarnings as any).epsEstimate}` : ""}`
    : "No upcoming earnings date found in next 90 days";

  const dataContext = [
    `Ticker: ${ticker}`,
    `Beat Rate (last ${(surprises as any[]).length} quarters): ${beatRate}`,
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
  const jsonText = rawText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Failed to parse structured response from LLM");
  }

  return {
    ticker,
    ...parsed,
    rawData: {
      quartersAnalyzed: (surprises as any[]).length,
      beatsTotal,
      upcomingEarnings: Object.keys(upcomingEarnings).length > 0 ? upcomingEarnings : null,
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
    pricing: "$0.05 per call",
    pricingMicros: 50_000,
    exampleInput: { ticker: "NVDA" },
  },
};

registerTool(earningsAnalysisTool);
export default earningsAnalysisTool;
