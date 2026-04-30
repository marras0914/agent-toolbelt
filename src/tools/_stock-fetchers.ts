import { config } from "../config";

/* ===== Response shapes (minimal, additive — extra fields preserved via index signature) ===== */

export interface PolygonOverview {
  name?: string;
  description?: string;
  sic_description?: string;
  market_cap?: number;
  total_employees?: number;
  [key: string]: unknown;
}

export interface PolygonPrevClose {
  c?: number; // close
  o?: number; h?: number; l?: number; v?: number;
  [key: string]: unknown;
}

/** FMP /stable/key-metrics-ttm. Note: peRatio / priceToSales / priceToBook moved to ratios-ttm in /stable/. */
export interface FMPKeyMetrics {
  symbol?: string;
  marketCap?: number;
  enterpriseValueTTM?: number;
  evToEBITDATTM?: number;
  evToFreeCashFlowTTM?: number;
  freeCashFlowYieldTTM?: number;
  returnOnEquityTTM?: number;
  returnOnInvestedCapitalTTM?: number;
  returnOnCapitalEmployedTTM?: number;
  currentRatioTTM?: number;
  intangiblesToTotalAssetsTTM?: number;
  capexToRevenueTTM?: number;
  [key: string]: unknown;
}

/** FMP /stable/ratios-ttm. */
export interface FMPRatiosTTM {
  priceToEarningsRatioTTM?: number;
  priceToSalesRatioTTM?: number;
  priceToBookRatioTTM?: number;
  enterpriseValueMultipleTTM?: number;
  dividendYieldTTM?: number;
  returnOnEquityTTM?: number;
  returnOnCapitalEmployedTTM?: number;
  currentRatioTTM?: number;
  debtToEquityRatioTTM?: number;
  grossProfitMarginTTM?: number;
  netProfitMarginTTM?: number;
  ebitMarginTTM?: number;
  operatingProfitMarginTTM?: number;
  [key: string]: unknown;
}

/** FMP /stable/income-statement (annual or quarterly). netIncomeRatio no longer present — derive from netIncome/revenue. */
export interface FMPIncomeStatement {
  date?: string;
  fiscalYear?: string;
  period?: string;
  revenue?: number;
  netIncome?: number;
  eps?: number;
  [key: string]: unknown;
}

/** FMP /stable/earnings — replaces v3 /earnings-surprises. epsActual is null on upcoming reports. */
export interface FMPEarnings {
  date?: string;
  symbol?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
  lastUpdated?: string;
}

/** Finnhub /stock/metric — just the `.metric` subobject. Many fields are percentages (e.g. 33.6 = 33.6%). */
export interface FinnhubMetric {
  peNormalizedAnnual?: number;
  psTTM?: number;
  pbAnnual?: number;
  evEbitdaTTM?: number;
  pfcfShareTTM?: number;
  roeTTM?: number;
  roicTTM?: number;
  grossMarginTTM?: number;
  netProfitMarginTTM?: number;
  revenueGrowth3Y?: number;
  epsGrowth3Y?: number;
  dividendYieldIndicatedAnnual?: number;
  currentRatioAnnual?: number;
  "totalDebt/totalEquityAnnual"?: number;
  [key: string]: unknown;
}

export interface FinnhubRecommendation {
  buy?: number;
  hold?: number;
  sell?: number;
  strongBuy?: number;
  strongSell?: number;
  period?: string;
  symbol?: string;
}

export interface FinnhubInsiderTransaction {
  name?: string;
  position?: string;
  transactionDate?: string;
  transactionCode?: string;
  transactionPrice?: number;
  change?: number;
  share?: number;
  symbol?: string;
}

export interface FinnhubInsiderSentiment {
  year?: number;
  month?: number;
  mspr?: number;
  change?: number;
  symbol?: string;
}

export interface FinnhubEarningsCalendarEntry {
  symbol?: string;
  date?: string;
  hour?: string;
  epsActual?: number | null;
  epsEstimate?: number;
  revenueActual?: number | null;
  revenueEstimate?: number;
  quarter?: number;
  year?: number;
}

/* ===== Internal helper ===== */

async function safeJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    return await res.json() as T;
  } catch {
    return fallback;
  }
}

/* ===== Fetchers — one per upstream endpoint, graceful on any failure ===== */

export async function fetchPolygonOverview(ticker: string): Promise<PolygonOverview> {
  const data = await safeJson<{ results?: PolygonOverview }>(
    `https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${config.polygonApiKey}`,
    {}
  );
  return data.results || {};
}

export async function fetchPolygonPrevClose(ticker: string): Promise<PolygonPrevClose> {
  const data = await safeJson<{ results?: PolygonPrevClose[] }>(
    `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${config.polygonApiKey}`,
    {}
  );
  return data.results?.[0] || {};
}

export async function fetchFMPKeyMetrics(ticker: string): Promise<FMPKeyMetrics> {
  const data = await safeJson<FMPKeyMetrics[]>(
    `https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${ticker}&apikey=${config.fmpApiKey}`,
    []
  );
  return Array.isArray(data) && data.length > 0 ? data[0] : {};
}

export async function fetchFMPRatiosTTM(ticker: string): Promise<FMPRatiosTTM> {
  const data = await safeJson<FMPRatiosTTM[]>(
    `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${ticker}&apikey=${config.fmpApiKey}`,
    []
  );
  return Array.isArray(data) && data.length > 0 ? data[0] : {};
}

/** FMP /stable/ caps `limit` at 5 on current plan. */
export async function fetchFMPIncomeStatement(
  ticker: string,
  period: "annual" | "quarter" = "annual",
  limit: number = 5
): Promise<FMPIncomeStatement[]> {
  const data = await safeJson<FMPIncomeStatement[]>(
    `https://financialmodelingprep.com/stable/income-statement?symbol=${ticker}&period=${period}&limit=${limit}&apikey=${config.fmpApiKey}`,
    []
  );
  return Array.isArray(data) ? data : [];
}

/** FMP /stable/earnings. limit capped at 5. Includes upcoming earnings (epsActual=null). */
export async function fetchFMPEarnings(ticker: string, limit: number = 5): Promise<FMPEarnings[]> {
  const data = await safeJson<FMPEarnings[]>(
    `https://financialmodelingprep.com/stable/earnings?symbol=${ticker}&limit=${limit}&apikey=${config.fmpApiKey}`,
    []
  );
  return Array.isArray(data) ? data : [];
}

export async function fetchFinnhubMetrics(ticker: string): Promise<FinnhubMetric> {
  const data = await safeJson<{ metric?: FinnhubMetric }>(
    `https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${config.finnhubApiKey}`,
    {}
  );
  return data.metric || {};
}

export async function fetchFinnhubRecommendations(ticker: string): Promise<FinnhubRecommendation[]> {
  const data = await safeJson<FinnhubRecommendation[]>(
    `https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${config.finnhubApiKey}`,
    []
  );
  return Array.isArray(data) ? data : [];
}

export async function fetchFinnhubInsiders(ticker: string): Promise<FinnhubInsiderTransaction[]> {
  const data = await safeJson<{ data?: FinnhubInsiderTransaction[] }>(
    `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${config.finnhubApiKey}`,
    {}
  );
  return Array.isArray(data.data) ? data.data : [];
}

export async function fetchFinnhubInsiderSentiment(
  ticker: string,
  from: string = "2024-01-01"
): Promise<FinnhubInsiderSentiment[]> {
  const data = await safeJson<{ data?: FinnhubInsiderSentiment[] }>(
    `https://finnhub.io/api/v1/stock/insider-sentiment?symbol=${ticker}&from=${from}&token=${config.finnhubApiKey}`,
    {}
  );
  return Array.isArray(data.data) ? data.data : [];
}

/** First upcoming earnings entry within `daysAhead` days, or {} if none. */
export async function fetchFinnhubUpcomingEarnings(
  ticker: string,
  daysAhead: number = 90
): Promise<FinnhubEarningsCalendarEntry> {
  const from = new Date().toISOString().split("T")[0];
  const to = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const data = await safeJson<{ earningsCalendar?: FinnhubEarningsCalendarEntry[] }>(
    `https://finnhub.io/api/v1/calendar/earnings?symbol=${ticker}&from=${from}&to=${to}&token=${config.finnhubApiKey}`,
    {}
  );
  const entries = data.earningsCalendar || [];
  return entries.length > 0 ? entries[0] : {};
}
