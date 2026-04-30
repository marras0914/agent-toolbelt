import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";

const inputSchema = z.object({
  tickers: z
    .array(z.string().min(1).max(10).transform((v) => v.toUpperCase().trim()))
    .min(2)
    .max(3)
    .describe("2-3 stock tickers to compare head-to-head (e.g. ['NVDA','AMD'])"),
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

interface TickerData {
  ticker: string;
  overview: Record<string, unknown>;
  km: Record<string, unknown>;
  rt: Record<string, unknown>;
  fh: Record<string, unknown>;
  derived: DerivedMetrics;
}

interface DerivedMetrics {
  pe: number | null;
  ps: number | null;
  evEbitda: number | null;
  fcfYield: number | null;
  roe: number | null;
  roic: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  revGrowth3Y: number | null;
  debtToEquity: number | null;
}

const sane = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return v != null && isFinite(n) && n >= min && n <= max ? n : null;
};
const fhPct = (v: unknown) => (v != null && isFinite(Number(v)) ? Number(v) / 100 : undefined);
const fmt = (v: number | null | undefined, suffix = "", decimals = 1) =>
  v != null ? `${Number(v).toFixed(decimals)}${suffix}` : "N/A";
const fmtPct = (v: number | null | undefined) =>
  v != null ? `${(Number(v) * 100).toFixed(1)}%` : "N/A";
const round1 = (v: number | null) => (v != null ? parseFloat(Number(v).toFixed(1)) : null);

function deriveMetrics(km: any, rt: any, fh: any): DerivedMetrics {
  return {
    pe: sane(rt.priceToEarningsRatioTTM ?? fh.peNormalizedAnnual, 0, 2000),
    ps: sane(rt.priceToSalesRatioTTM ?? fh.psTTM, 0, 1000),
    evEbitda: sane(km.evToEBITDATTM ?? rt.enterpriseValueMultipleTTM ?? fh.evEbitdaTTM, 0, 500),
    fcfYield: sane(km.freeCashFlowYieldTTM, -1, 1),
    roe: sane(km.returnOnEquityTTM ?? rt.returnOnEquityTTM ?? fhPct(fh.roeTTM), -5, 10),
    roic: sane(km.returnOnInvestedCapitalTTM ?? km.returnOnCapitalEmployedTTM ?? fhPct(fh.roicTTM), -5, 10),
    grossMargin: sane(rt.grossProfitMarginTTM ?? fhPct(fh.grossMarginTTM), -1, 1),
    netMargin: sane(rt.netProfitMarginTTM ?? fhPct(fh.netProfitMarginTTM), -1, 1),
    revGrowth3Y: sane(fhPct(fh.revenueGrowth3Y), -1, 10),
    debtToEquity: sane(rt.debtToEquityRatioTTM ?? fh["totalDebt/totalEquityAnnual"], 0, 100),
  };
}

async function fetchAll(ticker: string): Promise<TickerData> {
  const [overview, km, rt, fh] = await Promise.all([
    fetchPolygonOverview(ticker),
    fetchFMPKeyMetrics(ticker),
    fetchFMPRatiosTTM(ticker),
    fetchFinnhubMetrics(ticker),
  ]);
  return { ticker, overview, km, rt, fh, derived: deriveMetrics(km, rt, fh) };
}

function summarizeTicker(t: TickerData): string {
  const ov = t.overview as any;
  const d = t.derived;
  const lines = [
    `${t.ticker} — ${ov.name || t.ticker}`,
    ov.sic_description ? `  Sector: ${ov.sic_description}` : "",
    ov.market_cap ? `  Market Cap: $${(ov.market_cap / 1e9).toFixed(1)}B` : "",
    `  P/E: ${fmt(d.pe, "x")} | P/S: ${fmt(d.ps, "x")} | EV/EBITDA: ${fmt(d.evEbitda, "x")} | FCF Yield: ${fmtPct(d.fcfYield)}`,
    `  ROE: ${fmtPct(d.roe)} | ROIC: ${fmtPct(d.roic)} | Gross Margin: ${fmtPct(d.grossMargin)} | Net Margin: ${fmtPct(d.netMargin)}`,
    `  3Y Revenue CAGR: ${fmtPct(d.revGrowth3Y)} | Debt/Equity: ${fmt(d.debtToEquity)}`,
  ].filter(Boolean);
  return lines.join("\n");
}

function metricsObject(t: TickerData) {
  const d = t.derived;
  return {
    peRatio: round1(d.pe),
    psRatio: round1(d.ps),
    evEbitda: round1(d.evEbitda),
    fcfYield: d.fcfYield != null ? parseFloat((Number(d.fcfYield) * 100).toFixed(1)) : null,
    roe: d.roe != null ? parseFloat((Number(d.roe) * 100).toFixed(1)) : null,
    netMargin: d.netMargin != null ? parseFloat((Number(d.netMargin) * 100).toFixed(1)) : null,
  };
}

async function handler(input: Input) {
  const { tickers } = input;

  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.polygonApiKey) throw new Error("POLYGON_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  const fetchedAt = new Date().toISOString();
  const allData = await Promise.all(tickers.map(fetchAll));

  const empties = allData.filter(
    (d) => Object.keys(d.overview).length === 0 && Object.keys(d.km).length === 0 && Object.keys(d.fh).length === 0
  );
  if (empties.length > 0) {
    throw new Error(`No data found for: ${empties.map((d) => d.ticker).join(", ")}. Please verify the symbols.`);
  }

  const dataContext = [
    `Comparing ${tickers.join(" vs ")}:`,
    "",
    ...allData.map((d) => summarizeTicker(d)),
  ].join("\n\n");

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const systemPrompt =
    "You are a professional stock analyst comparing companies head-to-head in the style of The Motley Fool. " +
    "Be direct about which company is the more compelling long-term hold and why, but acknowledge that the answer " +
    "depends on what the investor values (growth, value, quality, income). " +
    "Always respond with valid JSON matching the exact schema requested. " +
    "Base analysis strictly on the data provided. Do not fabricate numbers.";

  const tickerEnumString = tickers.map((t) => `"${t}"`).join(" | ");
  const perTickerSchema = tickers
    .map((t) => `    "${t}": { "strengths": ["..."], "concerns": ["..."], "summary": "1-2 sentences" }`)
    .join(",\n");

  const userPrompt =
    `Compare these stocks for a long-term investor. Pick a winner and explain when the loser might still be the right call.\n\n` +
    dataContext +
    `\n\nReturn a JSON object with this exact structure:
{
  "winner": ${tickerEnumString} | "tied",
  "oneLiner": "one sentence summary of the head-to-head",
  "perTicker": {
${perTickerSchema}
  },
  "rationale": "2-3 sentences on why the winner is the winner",
  "ifYouValue": {
    "growth": ${tickerEnumString},
    "value": ${tickerEnumString},
    "quality": ${tickerEnumString}
  },
  "keyDifference": "the single most important way these companies differ"
}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const rawText = message.content[0].type === "text" ? message.content[0].text : "";
  const stripped = rawText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // Fallback: extract the first balanced {...} block (handles preamble text from Claude)
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Failed to parse structured response from LLM");
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new Error("Failed to parse structured response from LLM");
    }
  }

  return {
    tickers,
    ...parsed,
    metrics: Object.fromEntries(allData.map((d) => [d.ticker, metricsObject(d)])),
    dataSources: {
      fetchedAt,
      perTicker: Object.fromEntries(
        allData.map((d) => [
          d.ticker,
          {
            polygon: { success: Object.keys(d.overview).length > 0 },
            finnhub: { success: Object.keys(d.fh).length > 0 },
            fmp: { success: Object.keys(d.km).length > 0 || Object.keys(d.rt).length > 0 },
          },
        ])
      ),
    },
    generatedAt: new Date().toISOString(),
  };
}

const compareStocksTool: ToolDefinition<Input> = {
  name: "compare-stocks",
  description:
    "Head-to-head comparison of 2-3 stocks for a long-term investor. Pulls live valuation, quality, and growth metrics " +
    "for each ticker, then synthesizes a winner verdict, per-ticker strengths and concerns, and recommendations for what " +
    "type of investor each fits. Useful for choosing between competitors (e.g., NVDA vs AMD, V vs MA, AAPL vs MSFT). Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["stocks", "investing", "finance", "comparison", "llm"],
    pricing: "$0.05 per call",
    pricingMicros: 50_000,
    exampleInput: { tickers: ["NVDA", "AMD"] },
  },
};

registerTool(compareStocksTool);
export default compareStocksTool;
