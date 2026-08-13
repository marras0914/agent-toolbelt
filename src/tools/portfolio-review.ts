import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";
import {
  fetchFMPProfile,
  fetchFMPKeyMetrics,
  fetchFMPRatiosTTM,
  fetchFinnhubMetrics,
} from "./_stock-fetchers";
import {
  sane,
  fhPct,
  fmt,
  fmtPct,
  round1,
  usTickerSchema,
  UnsupportedTickerError,
  mapWithConcurrency,
  TICKER_CONCURRENCY,
} from "./_stock-helpers";
import { parseLLMJson } from "./_llm-utils";

// Review a portfolio you ALREADY OWN, rather than screening candidates to buy.
// Every other stock tool answers "should I buy X?" one ticker at a time;
// compare-stocks and watchlist-scan widen that to a shortlist but still rank
// candidates. Nothing answered "what should I do with what I hold?" — which is
// the question with a recurring cadence behind it (people re-run it monthly),
// and the one where position SIZE, not just quality, drives the answer.
//
// Division of labour: every number here is computed deterministically (weights,
// HHI, sector exposure, weighted portfolio ratios) and only the judgment is left
// to Claude — the overlapping-bet read, the weakest link, what to trim. Handing
// arithmetic to an LLM would make the same input produce drifting numbers.

const holdingSchema = z
  .object({
    ticker: usTickerSchema,
    weight: z
      .number()
      .positive()
      .optional()
      .describe(
        "Relative size of the position. Any consistent unit works (percent, dollar value, or fraction) — weights are normalized internally."
      ),
    shares: z
      .number()
      .positive()
      .optional()
      .describe("Alternative to weight: share count, valued at the last close."),
  })
  .refine((h) => !(h.weight != null && h.shares != null), {
    message: "Provide either weight or shares for a holding, not both.",
  });

const inputSchema = z
  .object({
    holdings: z
      .array(holdingSchema)
      .min(2)
      .max(20)
      .describe(
        '2–20 positions, e.g. [{"ticker":"NVDA","weight":30},{"ticker":"MSFT","weight":25}]. ' +
          "Omit weight/shares on every holding to assume an equal-weighted portfolio."
      ),
  })
  .superRefine((val, ctx) => {
    const weighted = val.holdings.filter((h) => h.weight != null).length;
    const shared = val.holdings.filter((h) => h.shares != null).length;
    if (weighted > 0 && shared > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["holdings"],
        message: "Use one sizing method for the whole portfolio: weight on every holding, or shares on every holding.",
      });
      return;
    }
    if (weighted > 0 && weighted !== val.holdings.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["holdings"],
        message: "Some holdings have a weight and some do not. Set weight on all of them, or on none (equal-weighted).",
      });
    }
    if (shared > 0 && shared !== val.holdings.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["holdings"],
        message: "Some holdings have shares and some do not. Set shares on all of them, or on none (equal-weighted).",
      });
    }
  })
  // Sort by ticker so the same portfolio submitted in a different order produces
  // the same response-cache key (see responseCacheKey in registry.ts).
  .transform((val) => ({
    holdings: [...val.holdings].sort((a, b) => a.ticker.localeCompare(b.ticker)),
  }));

type Input = z.infer<typeof inputSchema>;

type WeightingMode = "weight" | "shares" | "equal";

interface PositionData {
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  price: number | null;
  marketCapB: number | null;
  pe: number | null;
  ps: number | null;
  fcfYield: number | null;
  roe: number | null;
  netMargin: number | null;
  divYield: number | null;
  revGrowth3Y: number | null;
  debtToEquity: number | null;
  beta: number | null;
}

export interface Position extends PositionData {
  weightPct: number;
}

async function fetchPosition(ticker: string): Promise<PositionData | null> {
  const [pr, km, rt, fh] = await Promise.all([
    fetchFMPProfile(ticker).catch(() => ({} as any)),
    fetchFMPKeyMetrics(ticker).catch(() => ({} as any)),
    fetchFMPRatiosTTM(ticker).catch(() => ({} as any)),
    fetchFinnhubMetrics(ticker).catch(() => ({} as any)),
  ]);

  const hasData = Object.keys(pr).length > 0 || Object.keys(km).length > 0 || Object.keys(fh).length > 0;
  if (!hasData) return null;

  const pfcf = Number(fh.pfcfShareTTM);
  const fcfFromFh = pfcf > 0 && isFinite(pfcf) ? 1 / pfcf : undefined;
  const mktCap = sane(pr.marketCap ?? km.marketCap, 0, 1e14);

  return {
    ticker,
    name: pr.companyName || ticker,
    sector: pr.sector ? String(pr.sector) : null,
    industry: pr.industry ? String(pr.industry) : null,
    price: sane(pr.price, 0, 1e7),
    marketCapB: mktCap != null ? parseFloat((mktCap / 1e9).toFixed(1)) : null,
    // FMP TTM only, never Finnhub's normalized-annual as a fallback: mixing the two
    // methodologies is what produced the MU 99.7x P/E bug. It would be worse here —
    // the portfolio multiple is aggregated across holdings, so one mis-sourced P/E
    // silently drags a number the caller reads as the whole book's valuation.
    pe: sane(rt.priceToEarningsRatioTTM, 0, 2000),
    ps: sane(rt.priceToSalesRatioTTM ?? fh.psTTM, 0, 1000),
    fcfYield: sane(km.freeCashFlowYieldTTM ?? fcfFromFh, -1, 1),
    roe: sane(km.returnOnEquityTTM ?? rt.returnOnEquityTTM ?? fhPct(fh.roeTTM), -5, 10),
    netMargin: sane(rt.netProfitMarginTTM ?? fhPct(fh.netProfitMarginTTM), -1, 1),
    divYield: sane(rt.dividendYieldTTM ?? fh.dividendYieldIndicatedAnnual, 0, 0.3),
    revGrowth3Y: sane(fhPct(fh.revenueGrowth3Y), -1, 10),
    debtToEquity: sane(rt.debtToEquityRatioTTM ?? fh["totalDebt/totalEquityAnnual"], 0, 50),
    beta: sane(pr.beta ?? fh.beta, -5, 5),
  };
}

/** Weighted arithmetic mean over the positions that actually have the metric. */
export function weightedAvg(positions: Position[], pick: (p: Position) => number | null): number | null {
  const rows = positions.filter((p) => pick(p) != null);
  const total = rows.reduce((sum, p) => sum + p.weightPct, 0);
  if (!rows.length || total <= 0) return null;
  return rows.reduce((sum, p) => sum + (pick(p) as number) * (p.weightPct / total), 0);
}

/**
 * Weighted harmonic mean — the correct aggregation for a price multiple.
 * A portfolio's P/E is price over EARNINGS, so it is the inverse of the weighted
 * average earnings yield. Averaging the P/Es arithmetically lets one 200x holding
 * drag the whole portfolio number somewhere it has no business being.
 */
export function weightedHarmonic(positions: Position[], pick: (p: Position) => number | null): number | null {
  const rows = positions.filter((p) => {
    const v = pick(p);
    return v != null && v > 0;
  });
  const total = rows.reduce((sum, p) => sum + p.weightPct, 0);
  if (!rows.length || total <= 0) return null;
  const inverse = rows.reduce((sum, p) => sum + (p.weightPct / total) / (pick(p) as number), 0);
  return inverse > 0 ? 1 / inverse : null;
}

export function concentrationLabel(top3Pct: number, effectivePositions: number): string {
  if (top3Pct >= 60 || effectivePositions < 3) return "highly_concentrated";
  if (top3Pct >= 40 || effectivePositions < 5) return "concentrated";
  return "diversified";
}

async function handler(input: Input) {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");
  if (!config.fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  // Collapse duplicate tickers into one position — a portfolio listing the same
  // holding twice is one bet, and summing is the only reading that keeps the
  // weights honest. (Tickers are already uppercased by the schema.)
  const merged = new Map<string, { ticker: string; weight?: number; shares?: number }>();
  for (const h of input.holdings) {
    const prev = merged.get(h.ticker);
    if (!prev) {
      merged.set(h.ticker, { ...h });
      continue;
    }
    if (h.weight != null) prev.weight = (prev.weight ?? 0) + h.weight;
    if (h.shares != null) prev.shares = (prev.shares ?? 0) + h.shares;
  }
  const holdings = [...merged.values()];

  const mode: WeightingMode = holdings.some((h) => h.weight != null)
    ? "weight"
    : holdings.some((h) => h.shares != null)
      ? "shares"
      : "equal";

  const fetchedAt = new Date().toISOString();
  const fetched = await mapWithConcurrency(holdings, TICKER_CONCURRENCY, (h) => fetchPosition(h.ticker));

  const excluded: { ticker: string; reason: string }[] = [];
  const unpriced: string[] = [];
  const sized: { data: PositionData; raw: number }[] = [];

  fetched.forEach((data, i) => {
    const h = holdings[i];
    if (!data) {
      excluded.push({ ticker: h.ticker, reason: "no_upstream_data" });
      return;
    }
    if (mode === "shares") {
      // Share counts only become a weight once they are valued, so a missing
      // price makes this position unsizable.
      if (data.price == null) {
        unpriced.push(h.ticker);
        return;
      }
      sized.push({ data, raw: (h.shares as number) * data.price });
      return;
    }
    sized.push({ data, raw: mode === "weight" ? (h.weight as number) : 1 });
  });

  // A ticker with no data anywhere is the caller's problem (delisted, OTC, non-US)
  // and dropping it is the only sane response. A ticker we HAVE data for but can't
  // price is our problem — a transient upstream miss — and dropping it silently is
  // the dangerous case: the remaining weights renormalize to 100%, so the caller
  // gets a confident review of a portfolio that isn't theirs. A 12-holding test run
  // came back as a "highly concentrated" 5-holding book for exactly this reason.
  // Fail loudly instead and let them retry.
  if (unpriced.length) {
    throw new Error(
      `Could not price ${unpriced.join(", ")} to convert share counts into weights. ` +
        `Reviewing the rest would silently misstate every other position's weight. ` +
        `Retry shortly, or supply weights directly instead of share counts.`
    );
  }

  if (sized.length < 2) {
    throw new UnsupportedTickerError(excluded.map((e) => e.ticker));
  }

  const rawTotal = sized.reduce((sum, s) => sum + s.raw, 0);
  const positions: Position[] = sized
    .map(({ data, raw }) => ({ ...data, weightPct: parseFloat(((raw / rawTotal) * 100).toFixed(2)) }))
    .sort((a, b) => b.weightPct - a.weightPct);

  // Herfindahl index over weight fractions. 1/HHI is the "effective number of
  // positions" — a 20-stock portfolio where one name is 70% behaves like ~2.
  const hhi = positions.reduce((sum, p) => sum + (p.weightPct / 100) ** 2, 0);
  const effectivePositions = hhi > 0 ? 1 / hhi : positions.length;
  const top3Pct = positions.slice(0, 3).reduce((sum, p) => sum + p.weightPct, 0);
  const concentration = {
    label: concentrationLabel(top3Pct, effectivePositions),
    largestPosition: { ticker: positions[0].ticker, weightPct: positions[0].weightPct },
    top3Pct: round1(top3Pct),
    hhi: parseFloat(hhi.toFixed(3)),
    effectivePositions: round1(effectivePositions),
    positionCount: positions.length,
  };

  const bySector = new Map<string, { weightPct: number; tickers: string[] }>();
  for (const p of positions) {
    const key = p.sector || "Unknown";
    const entry = bySector.get(key) ?? { weightPct: 0, tickers: [] };
    entry.weightPct += p.weightPct;
    entry.tickers.push(p.ticker);
    bySector.set(key, entry);
  }
  const sectorExposure = [...bySector.entries()]
    .map(([sector, v]) => ({ sector, weightPct: round1(v.weightPct), tickers: v.tickers }))
    .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0));

  const portfolioMetrics = {
    peWeighted: round1(weightedHarmonic(positions, (p) => p.pe)),
    psWeighted: round1(weightedHarmonic(positions, (p) => p.ps)),
    fcfYield: round1(mulPct(weightedAvg(positions, (p) => p.fcfYield))),
    roe: round1(mulPct(weightedAvg(positions, (p) => p.roe))),
    netMargin: round1(mulPct(weightedAvg(positions, (p) => p.netMargin))),
    divYield: round1(mulPct(weightedAvg(positions, (p) => p.divYield))),
    revGrowth3Y: round1(mulPct(weightedAvg(positions, (p) => p.revGrowth3Y))),
    beta: round1(weightedAvg(positions, (p) => p.beta)),
  };

  const rows = positions.map(
    (p) =>
      `${p.ticker} (${p.name}) — ${p.weightPct}% of portfolio | ${p.sector || "sector unknown"}` +
      `${p.industry ? ` / ${p.industry}` : ""} | ` +
      `mktCap ${fmt(p.marketCapB, "B")} | P/E ${fmt(p.pe, "x")} | P/S ${fmt(p.ps, "x")} | ` +
      `FCF yield ${fmtPct(p.fcfYield)} | ROE ${fmtPct(p.roe)} | net margin ${fmtPct(p.netMargin)} | ` +
      `3Y rev growth ${fmtPct(p.revGrowth3Y)} | div yield ${fmtPct(p.divYield)} | ` +
      `D/E ${fmt(p.debtToEquity, "x")} | beta ${fmt(p.beta, "", 2)}`
  );

  const sectorLines = sectorExposure.map(
    (s) => `  ${s.sector}: ${fmt(s.weightPct, "%")} (${s.tickers.join(", ")})`
  );

  const dataContext = [
    `Portfolio of ${positions.length} positions${mode === "equal" ? " (equal-weighted — the caller supplied no sizes)" : ""}:`,
    ...rows.map((r) => `  ${r}`),
    "",
    "Sector exposure (sector labels are coarse — holdings in different sectors can still share one driver):",
    ...sectorLines,
    "",
    "Concentration (computed, do not recalculate):",
    `  Largest position: ${concentration.largestPosition.ticker} at ${concentration.largestPosition.weightPct}%`,
    `  Top 3 positions: ${fmt(concentration.top3Pct, "%")}`,
    `  Herfindahl index: ${concentration.hhi} → effective number of positions: ${fmt(concentration.effectivePositions)}`,
    `  Classification: ${concentration.label}`,
    "",
    "Portfolio-level metrics (weight-adjusted; multiples use the weighted harmonic mean):",
    `  P/E ${fmt(portfolioMetrics.peWeighted, "x")} | P/S ${fmt(portfolioMetrics.psWeighted, "x")} | ` +
      `FCF yield ${fmt(portfolioMetrics.fcfYield, "%")} | ROE ${fmt(portfolioMetrics.roe, "%")}`,
    `  Net margin ${fmt(portfolioMetrics.netMargin, "%")} | 3Y rev growth ${fmt(portfolioMetrics.revGrowth3Y, "%")} | ` +
      `div yield ${fmt(portfolioMetrics.divYield, "%")} | beta ${fmt(portfolioMetrics.beta, "", 2)}`,
    excluded.length ? `\nExcluded (no usable data): ${excluded.map((e) => e.ticker).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const systemPrompt =
    "You are a portfolio risk analyst reviewing a retail investor's actual holdings. " +
    "You are NOT screening stocks to buy — you are judging what this specific combination of positions, at these specific " +
    "weights, adds up to. Position size matters as much as position quality: a great business at 45% of a portfolio is a " +
    "risk finding, not a compliment. " +
    "Your most valuable job is spotting CORRELATED BETS — holdings that look diversified by sector label but share one " +
    "underlying driver (e.g. NVDA + AMD + AVGO + MU are all one bet on datacenter capex; JPM + BAC + SCHW all move on the " +
    "rate cycle; COST + WMT + TGT all ride the same consumer). Name the shared driver explicitly. " +
    "All numeric aggregates have been computed for you — cite them, never recalculate them. " +
    "Be direct and specific. Never recommend a ticker the investor does not already hold except in the 'gaps' field. " +
    "Always respond with valid JSON matching the exact schema.";

  const userPrompt =
    `Review this portfolio.\n\n` +
    dataContext +
    `\n\nReturn a JSON object with this exact structure:
{
  "oneLiner": "one sentence describing what this portfolio actually is, as a bet",
  "riskRead": "2-3 sentences interpreting the concentration, sector exposure, and beta together",
  "overlappingBets": [
    {
      "tickers": ["X", "Y"],
      "combinedWeightPct": 0,
      "sharedRisk": "1-2 sentences naming the single underlying driver these positions share",
      "severity": "high" | "medium" | "low"
    }
  ],
  "weakestLink": { "ticker": "X", "why": "1-2 sentences on the holding that most weakens the portfolio, citing its numbers and its weight" },
  "trimCandidates": [ { "ticker": "X", "why": "1 sentence on why this position is too large for what it is" } ],
  "gaps": ["specific exposure this portfolio lacks, and why it matters"],
  "bottomLine": "2 sentences — what the investor should actually do next"
}

Rules: report at most 4 overlappingBets (the most material ones), at most 3 trimCandidates, and at most 3 gaps. overlappingBets may be an empty array if the holdings are genuinely independent, and trimCandidates may be empty if no position is oversized. Every ticker you name must be one of: ${positions
      .map((p) => p.ticker)
      .join(", ")} (except inside "gaps").`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    // Do NOT trim this, and note the array caps in the prompt above. Unlike the
    // single-ticker tools, this response scales with holding count: 20 positions
    // can motivate a dozen overlapping bets. bear-vs-bull 500'd repeatedly on
    // truncated JSON at 900/1200/1600 tokens (parseLLMJson throws on a partial
    // object), and this schema is larger than that one.
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawText = message.content[0].type === "text" ? message.content[0].text : "";
  const parsed = parseLLMJson(rawText);

  return {
    ...parsed,
    weightingMode: mode,
    concentration,
    sectorExposure,
    portfolioMetrics,
    holdings: positions.map((p) => ({
      ticker: p.ticker,
      name: p.name,
      sector: p.sector,
      industry: p.industry,
      weightPct: p.weightPct,
      price: p.price,
      marketCapB: p.marketCapB,
      pe: round1(p.pe),
      ps: round1(p.ps),
      fcfYield: round1(mulPct(p.fcfYield)),
      roe: round1(mulPct(p.roe)),
      netMargin: round1(mulPct(p.netMargin)),
      divYield: round1(mulPct(p.divYield)),
      revGrowth3Y: round1(mulPct(p.revGrowth3Y)),
      debtToEquity: round1(p.debtToEquity),
      beta: p.beta != null ? parseFloat(p.beta.toFixed(2)) : null,
    })),
    ...(excluded.length ? { excluded } : {}),
    dataSources: { fetchedAt, positionCount: positions.length },
    generatedAt: new Date().toISOString(),
  };
}

/** Decimal ratio (0.156) → percentage number (15.6), preserving null. */
function mulPct(v: number | null): number | null {
  return v != null ? v * 100 : null;
}

const portfolioReviewTool: ToolDefinition<Input> = {
  name: "portfolio-review",
  description:
    "Review a portfolio you already own, not a shortlist you're screening. Takes 2–20 holdings with weights (or share counts) " +
    "and returns concentration risk (Herfindahl / effective position count), sector exposure, weight-adjusted portfolio " +
    "metrics (P/E, FCF yield, ROE, beta), the correlated bets hiding behind different sector labels, the weakest holding, " +
    "trim candidates, and the exposures you're missing. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["stocks", "investing", "finance", "portfolio", "risk", "diversification", "llm"],
    pricing: "$0.05 per call",
    pricingMicros: 50_000,
    exampleInput: {
      holdings: [
        { ticker: "NVDA", weight: 30 },
        { ticker: "MSFT", weight: 25 },
        { ticker: "AMD", weight: 20 },
        { ticker: "KO", weight: 15 },
        { ticker: "JNJ", weight: 10 },
      ],
    },
  },
};

registerTool(portfolioReviewTool);
export default portfolioReviewTool;
