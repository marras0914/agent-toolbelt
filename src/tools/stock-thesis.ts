import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(10)
    .transform((v) => v.toUpperCase().trim())
    .describe("Stock ticker symbol (e.g. NVDA, AAPL, MSFT)"),
  timeHorizon: z
    .enum(["1-2 years", "3-5 years", "5+ years"])
    .default("3-5 years")
    .describe("Investment time horizon for the thesis"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Data fetchers (graceful — return {} on any error) -----

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

async function fetchPolygonPrevClose(ticker: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${config.polygonApiKey}`
    );
    if (!res.ok) return {};
    const data = await res.json() as any;
    return data.results?.[0] || {};
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

async function fetchFinnhubRecommendations(ticker: string): Promise<unknown[]> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${config.finnhubApiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json() as unknown[];
    return Array.isArray(data) ? data.slice(0, 3) : [];
  } catch { return []; }
}

async function fetchFinnhubInsiders(ticker: string): Promise<unknown[]> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${config.finnhubApiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    return Array.isArray(data.data) ? data.data.slice(0, 10) : [];
  } catch { return []; }
}

async function fetchFMPIncomeStatement(ticker: string): Promise<unknown[]> {
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/income-statement/${ticker}?period=annual&limit=3&apikey=${config.fmpApiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json() as unknown[];
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function fetchFMPKeyMetrics(ticker: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/key-metrics-ttm/${ticker}?apikey=${config.fmpApiKey}`
    );
    if (!res.ok) return {};
    const data = await res.json() as any;
    return Array.isArray(data) && data.length > 0 ? data[0] : {};
  } catch { return {}; }
}

// ----- Handler -----
async function handler(input: Input) {
  const { ticker, timeHorizon } = input;

  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.polygonApiKey) throw new Error("POLYGON_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  // Fetch all data sources in parallel
  const fetchedAt = new Date().toISOString();
  const [overview, prevClose, metrics, recommendations, insiders, incomeStatements, keyMetrics] =
    await Promise.all([
      fetchPolygonOverview(ticker),
      fetchPolygonPrevClose(ticker),
      fetchFinnhubMetrics(ticker),
      fetchFinnhubRecommendations(ticker),
      fetchFinnhubInsiders(ticker),
      fetchFMPIncomeStatement(ticker),
      fetchFMPKeyMetrics(ticker),
    ]);

  const hasData =
    Object.keys(overview).length > 0 ||
    (incomeStatements as any[]).length > 0 ||
    Object.keys(metrics).length > 0;

  if (!hasData) {
    throw new Error(`No data found for ticker "${ticker}". Please verify the symbol is correct.`);
  }

  // ----- Build data context for the prompt -----
  const companyName = (overview as any).name || ticker;
  const description = ((overview as any).description || "").substring(0, 600);
  const sector = (overview as any).sic_description || "";
  const employees = (overview as any).total_employees as number | undefined;
  const marketCap = (overview as any).market_cap as number | undefined;
  const currentPrice = (prevClose as any).c as number | undefined;

  const incomeRows = (incomeStatements as any[]).map((s: any) => {
    const rev = s.revenue ? `$${(s.revenue / 1e9).toFixed(2)}B` : "N/A";
    const margin = s.netIncomeRatio != null ? `${(s.netIncomeRatio * 100).toFixed(1)}%` : "N/A";
    const eps = s.eps != null ? `$${s.eps.toFixed(2)}` : "N/A";
    const year = s.calendarYear || (s.date || "").substring(0, 4);
    return `  ${year}: Revenue ${rev} | Net Margin ${margin} | EPS ${eps}`;
  });

  const latestRec = (recommendations as any[])[0];
  const analystLine = latestRec
    ? `${latestRec.buy} buy / ${latestRec.hold} hold / ${latestRec.sell} sell (${latestRec.period})`
    : "Not available";

  const insiderLines = (insiders as any[]).slice(0, 5).map((t: any) => {
    const direction = t.transactionCode === "P" ? "purchase" : t.transactionCode === "S" ? "sale" : t.transactionCode;
    return `  ${t.transactionDate}: ${t.name} — ${direction} (${t.change > 0 ? "+" : ""}${t.change?.toLocaleString()} shares)`;
  });

  const km = keyMetrics as any;
  const fh = metrics as any;
  // Finnhub returns quality/growth metrics as percentages (e.g. 33.6 = 33.6%) — divide to get decimal
  const fhPct = (v: unknown) => (v != null && isFinite(Number(v)) ? Number(v) / 100 : undefined);
  // Reject implausible values
  const sane = (v: unknown, min: number, max: number): number | null => {
    const n = Number(v); return v != null && isFinite(n) && n >= min && n <= max ? n : null;
  };

  const pe = sane(km.peRatioTTM ?? fh.peNormalizedAnnual, 0, 2000);
  const ps = sane(km.priceToSalesRatioTTM ?? fh.psTTM, 0, 1000);
  const pb = sane(km.pbRatioTTM ?? fh.pbAnnual, 0, 500);
  const roe = sane(km.roeTTM ?? fhPct(fh.roeTTM), -5, 10);
  const debtToEquity = sane(km.debtToEquityTTM ?? fh["totalDebt/totalEquityAnnual"], 0, 100);
  const pfcfTTM = Number(fh.pfcfShareTTM);
  const fcfYield = sane(km.freeCashFlowYieldTTM ?? (pfcfTTM > 0 && isFinite(pfcfTTM) ? 1 / pfcfTTM : undefined), -1, 1);
  // Finnhub revenueGrowth3Y is already a percentage (e.g. 12.5 = 12.5%) — use directly
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

  // ----- Claude analysis -----
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
    dataSnapshot: {
      marketCapBillions: marketCap != null ? parseFloat((marketCap / 1e9).toFixed(1)) : null,
      currentPrice: currentPrice ?? null,
      peRatio: pe != null ? parseFloat(Number(pe).toFixed(1)) : null,
      analystConsensus: latestRec
        ? { buy: latestRec.buy, hold: latestRec.hold, sell: latestRec.sell }
        : null,
    },
    dataSources: {
      fetchedAt,
      polygon: { success: Object.keys(overview).length > 0 },
      finnhub: { success: Object.keys(metrics).length > 0 },
      fmp: { success: (incomeStatements as any[]).length > 0 || Object.keys(keyMetrics).length > 0 },
    },
    generatedAt: new Date().toISOString(),
  };
}

// ----- Register -----
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
