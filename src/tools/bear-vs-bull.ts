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
    return Array.isArray(data) ? data.slice(0, 2) : [];
  } catch { return []; }
}

async function fetchFinnhubInsiders(ticker: string): Promise<unknown[]> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${config.finnhubApiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    return Array.isArray(data.data) ? data.data.slice(0, 8) : [];
  } catch { return []; }
}

async function handler(input: Input) {
  const { ticker } = input;

  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.polygonApiKey) throw new Error("POLYGON_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  const fetchedAt = new Date().toISOString();
  const [overview, prevClose, incomeStatements, keyMetrics, finnhubMetrics, recommendations, insiders] =
    await Promise.all([
      fetchPolygonOverview(ticker),
      fetchPolygonPrevClose(ticker),
      fetchFMPIncomeStatement(ticker),
      fetchFMPKeyMetrics(ticker),
      fetchFinnhubMetrics(ticker),
      fetchFinnhubRecommendations(ticker),
      fetchFinnhubInsiders(ticker),
    ]);

  const hasData = Object.keys(overview).length > 0 || (incomeStatements as any[]).length > 0;
  if (!hasData) {
    throw new Error(`No data found for "${ticker}". Please verify the symbol.`);
  }

  const ov = overview as any;
  const pc = prevClose as any;
  const km = keyMetrics as any;
  const fh = finnhubMetrics as any;
  const rec = (recommendations as any[])[0];

  const incomeRows = (incomeStatements as any[]).map((s: any) => {
    const rev = s.revenue ? `$${(s.revenue / 1e9).toFixed(2)}B` : "N/A";
    const margin = s.netIncomeRatio != null ? `${(s.netIncomeRatio * 100).toFixed(1)}% net margin` : "N/A";
    const eps = s.eps != null ? `EPS $${s.eps.toFixed(2)}` : "";
    return `  ${s.calendarYear ?? s.date?.substring(0, 4)}: Revenue ${rev} | ${margin}${eps ? ` | ${eps}` : ""}`;
  });

  const insiderPurchases = (insiders as any[]).filter((t: any) => t.transactionCode === "P").length;
  const insiderSales = (insiders as any[]).filter((t: any) => t.transactionCode === "S").length;

  const dataContext = [
    `Company: ${ov.name || ticker} (${ticker})`,
    ov.sic_description ? `Sector: ${ov.sic_description}` : "",
    ov.market_cap ? `Market Cap: $${(ov.market_cap / 1e9).toFixed(1)}B` : "",
    pc.c ? `Current Price: $${pc.c}` : "",
    ov.description ? `\nBusiness: ${ov.description.substring(0, 400)}` : "",
    incomeRows.length > 0 ? `\nFinancials:\n${incomeRows.join("\n")}` : "",
    fh.revenueGrowth3Y != null ? `3Y Revenue CAGR: ${Number(fh.revenueGrowth3Y).toFixed(1)}%` : "",
    `\nValuation:`,
    (km.peRatioTTM ?? fh.peNormalizedAnnual) != null ? `  P/E (TTM): ${Number(km.peRatioTTM ?? fh.peNormalizedAnnual).toFixed(1)}x` : "",
    (km.priceToSalesRatioTTM ?? fh.psTTM) != null ? `  P/S: ${Number(km.priceToSalesRatioTTM ?? fh.psTTM).toFixed(1)}x` : "",
    km.freeCashFlowYieldTTM != null ? `  FCF Yield: ${(Number(km.freeCashFlowYieldTTM) * 100).toFixed(1)}%` : (fh.pfcfShareTTM > 0 ? `  FCF Yield: ${(100 / Number(fh.pfcfShareTTM)).toFixed(1)}%` : ""),
    (km.debtToEquityTTM ?? fh["totalDebt/totalEquityAnnual"]) != null ? `  Debt/Equity: ${Number(km.debtToEquityTTM ?? fh["totalDebt/totalEquityAnnual"]).toFixed(2)}` : "",
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
    max_tokens: 1500,
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
    dataSources: {
      fetchedAt,
      polygon: { success: Object.keys(overview).length > 0 },
      fmp: { success: (incomeStatements as any[]).length > 0 || Object.keys(keyMetrics).length > 0 },
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
