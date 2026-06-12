import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";
import {
  fetchPolygonOverview,
  fetchPolygonPrevClose,
  fetchFMPKeyMetrics,
  fetchFMPRatiosTTM,
  fetchFinnhubMetrics,
} from "./_stock-fetchers";
import { sane, fhPct, fmt, fmtPct, usTickerSchema, US_ONLY_HINT } from "./_stock-helpers";
import { parseLLMJson } from "./_llm-utils";

// Scan a watchlist (2–15 tickers) and rank it by a chosen lens. Built for the
// dominant observed usage pattern: heavy users re-run valuation + insider on a
// fixed ~watchlist in a loop. This collapses that into one call. Cost stays low
// because the per-ticker data fetches reuse the 6h fetch cache, and we make a
// SINGLE Claude call to rank the whole group (not one per ticker). Repeat scans
// of the same list+focus hit the 24h response cache and cost nothing.
const inputSchema = z.object({
  tickers: z
    .array(usTickerSchema)
    .min(2)
    .max(15)
    .describe('2–15 US tickers to scan, e.g. ["NVDA","AMD","AVGO"]'),
  focus: z
    .enum(["value", "quality", "growth", "income"])
    .default("value")
    .describe(
      "Ranking lens: value (cheapest vs fundamentals), quality (best returns/margins/balance sheet), growth (fastest durable growth), income (best sustainable dividend)."
    ),
});

type Input = z.infer<typeof inputSchema>;

interface TickerMetrics {
  ticker: string;
  name: string;
  price: number | null;
  marketCapB: number | null;
  pe: number | null;
  ps: number | null;
  fcfYield: number | null;
  roe: number | null;
  revGrowth3Y: number | null;
  netMargin: number | null;
  divYield: number | null;
}

async function fetchTickerMetrics(ticker: string): Promise<TickerMetrics | null> {
  const [km, rt, fh, ov, pc] = await Promise.all([
    fetchFMPKeyMetrics(ticker).catch(() => ({} as any)),
    fetchFMPRatiosTTM(ticker).catch(() => ({} as any)),
    fetchFinnhubMetrics(ticker).catch(() => ({} as any)),
    fetchPolygonOverview(ticker).catch(() => ({} as any)),
    fetchPolygonPrevClose(ticker).catch(() => ({} as any)),
  ]);

  const hasData = Object.keys(km).length > 0 || Object.keys(fh).length > 0 || Object.keys(ov).length > 0;
  if (!hasData) return null;

  const pfcf = Number(fh.pfcfShareTTM);
  const fcfFromFh = pfcf > 0 && isFinite(pfcf) ? 1 / pfcf : undefined;
  const mktCap = sane(ov.market_cap, 0, 1e14);

  return {
    ticker,
    name: ov.name || ticker,
    price: sane(pc.c, 0, 1e7),
    marketCapB: mktCap != null ? round1ToB(mktCap) : null,
    pe: sane(rt.priceToEarningsRatioTTM, 0, 2000),
    ps: sane(rt.priceToSalesRatioTTM ?? fh.psTTM, 0, 1000),
    fcfYield: sane(km.freeCashFlowYieldTTM ?? fcfFromFh, -1, 1),
    roe: sane(km.returnOnEquityTTM ?? rt.returnOnEquityTTM ?? fhPct(fh.roeTTM), -5, 10),
    revGrowth3Y: sane(fhPct(fh.revenueGrowth3Y), -1, 10),
    netMargin: sane(rt.netProfitMarginTTM ?? fhPct(fh.netProfitMarginTTM), -1, 1),
    divYield: sane(rt.dividendYieldTTM ?? fh.dividendYieldIndicatedAnnual, 0, 0.3),
  };
}

function round1ToB(marketCap: number): number {
  return parseFloat((marketCap / 1e9).toFixed(1));
}

async function handler(input: Input) {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");
  if (!config.polygonApiKey) throw new Error("POLYGON_API_KEY is not configured");

  // Dedupe (input is already uppercased/validated by the schema).
  const tickers = [...new Set(input.tickers)];
  const fetchedAt = new Date().toISOString();

  const results = await Promise.all(tickers.map(fetchTickerMetrics));
  const found = results.filter((r): r is TickerMetrics => r !== null);
  const noDataFor = tickers.filter((_, i) => results[i] === null);

  if (found.length < 2) {
    throw new Error(`Need at least 2 tickers with data to scan (got ${found.length}). ${US_ONLY_HINT}`);
  }

  const rows = found.map(
    (m) =>
      `${m.ticker} (${m.name}): mktCap ${fmt(m.marketCapB, "B")} | P/E ${fmt(m.pe, "x")} | P/S ${fmt(m.ps, "x")} | ` +
      `FCF yield ${fmtPct(m.fcfYield)} | ROE ${fmtPct(m.roe)} | 3Y rev growth ${fmtPct(m.revGrowth3Y)} | ` +
      `net margin ${fmtPct(m.netMargin)} | div yield ${fmtPct(m.divYield)}`
  );

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const systemPrompt =
    "You are a sharp buy-side analyst in the style of The Motley Fool. Rank a watchlist by the requested lens, " +
    "using only the data provided. Be decisive and specific with numbers. Always respond with valid JSON. " +
    "Every text field must be exactly 1 sentence.";

  const userPrompt =
    `Rank these ${found.length} stocks by the "${input.focus}" lens ` +
    `(value=cheapest relative to fundamentals, quality=best returns/margins/balance sheet, ` +
    `growth=fastest durable growth, income=best sustainable dividend).\n\n` +
    rows.join("\n") +
    `\n\nReturn a JSON object with this exact structure:\n` +
    `{\n` +
    `  "focus": "${input.focus}",\n` +
    `  "ranked": [ { "ticker": "X", "rank": 1, "read": "1 sentence on why it ranks here" } ],  // every ticker, best first\n` +
    `  "topPick": { "ticker": "X", "why": "1 sentence" },\n` +
    `  "avoid": { "ticker": "X", "why": "1 sentence on the weakest for this lens" },\n` +
    `  "watchlistTakeaway": "1 sentence overall read across the group"\n` +
    `}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawText = message.content[0].type === "text" ? message.content[0].text : "";
  const parsed = parseLLMJson(rawText);

  return {
    focus: input.focus,
    scanned: found.map((m) => m.ticker),
    ...(noDataFor.length ? { noDataFor } : {}),
    ...parsed,
    metrics: found,
    dataSources: { fetchedAt, tickerCount: found.length },
    generatedAt: new Date().toISOString(),
  };
}

const watchlistScanTool: ToolDefinition<Input> = {
  name: "watchlist-scan",
  description:
    "Scan a watchlist of 2–15 stocks and rank them by a chosen lens (value, quality, growth, or income). " +
    "Returns a ranked list with a one-line read per ticker, a top pick, the one to avoid, and an overall takeaway — " +
    "plus the raw metrics behind it. One call instead of analyzing each ticker individually. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["stocks", "investing", "finance", "screener", "watchlist", "llm"],
    pricing: "$0.05 per call",
    pricingMicros: 50_000,
    exampleInput: { tickers: ["NVDA", "AMD", "AVGO"], focus: "value" },
  },
};

registerTool(watchlistScanTool);
export default watchlistScanTool;
