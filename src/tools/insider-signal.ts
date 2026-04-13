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

async function fetchInsiderTransactions(ticker: string): Promise<unknown[]> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${config.finnhubApiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    return Array.isArray(data.data) ? data.data : [];
  } catch { return []; }
}

async function fetchInsiderSentiment(ticker: string): Promise<unknown[]> {
  try {
    // Finnhub insider sentiment — rolling 3-month windows
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/insider-sentiment?symbol=${ticker}&from=2024-01-01&token=${config.finnhubApiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    return Array.isArray(data.data) ? data.data.slice(-6) : [];
  } catch { return []; }
}

async function handler(input: Input) {
  const { ticker } = input;

  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!config.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not configured");

  const fetchedAt = new Date().toISOString();
  const [transactions, sentiment] = await Promise.all([
    fetchInsiderTransactions(ticker),
    fetchInsiderSentiment(ticker),
  ]);

  if ((transactions as any[]).length === 0) {
    throw new Error(`No insider transaction data found for "${ticker}". Please verify the symbol.`);
  }

  // Classify transactions
  const recent = (transactions as any[]).slice(0, 20);
  const purchases = recent.filter((t: any) => t.transactionCode === "P");
  const sales = recent.filter((t: any) => t.transactionCode === "S");
  const grantAwards = recent.filter((t: any) => ["A", "M", "F"].includes(t.transactionCode));

  const totalPurchaseShares = purchases.reduce((sum: number, t: any) => sum + (t.change || 0), 0);
  const totalSaleShares = Math.abs(sales.reduce((sum: number, t: any) => sum + (t.change || 0), 0));

  // Format notable trades for the prompt
  const tradeRows = recent.slice(0, 15).map((t: any) => {
    const direction = t.transactionCode === "P" ? "PURCHASE"
      : t.transactionCode === "S" ? "SALE"
      : t.transactionCode === "A" ? "AWARD"
      : t.transactionCode === "M" ? "OPTION_EXERCISE"
      : t.transactionCode === "F" ? "TAX_WITHHOLDING"
      : t.transactionCode;
    const shares = t.change != null ? `${t.change > 0 ? "+" : ""}${t.change.toLocaleString()} shares` : "";
    const price = t.transactionPrice ? ` @ $${t.transactionPrice.toFixed(2)}` : "";
    const value = t.transactionPrice && t.change
      ? ` ($${Math.abs(Math.round(t.transactionPrice * t.change / 1000))}k)`
      : "";
    return `  ${t.transactionDate}: ${t.name} (${t.position || "insider"}) — ${direction} ${shares}${price}${value}`;
  });

  // Sentiment data
  const sentimentRows = (sentiment as any[]).map((s: any) =>
    `  ${s.year}-${String(s.month).padStart(2, "0")}: MSPR ${s.mspr?.toFixed(2) ?? "N/A"} | Change ${s.change?.toLocaleString() ?? "N/A"} shares`
  );

  const dataContext = [
    `Ticker: ${ticker}`,
    `Recent transactions analyzed: ${recent.length}`,
    `Open market purchases: ${purchases.length} trades (+${totalPurchaseShares.toLocaleString()} shares total)`,
    `Open market sales: ${sales.length} trades (-${totalSaleShares.toLocaleString()} shares total)`,
    `Awards/option exercises/tax withholding: ${grantAwards.length} transactions (typically routine)`,
    "",
    "Transaction detail (most recent first):",
    ...tradeRows,
    sentimentRows.length > 0 ? "\nInsider Sentiment (monthly MSPR score, +1 = max bullish, -1 = max bearish):" : "",
    ...sentimentRows,
  ].filter(Boolean).join("\n");

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const systemPrompt =
    "You are a professional stock analyst specializing in insider trading signal interpretation. " +
    "Write clearly for a retail investor who wants to know: is this insider activity meaningful? " +
    "Key distinctions: open-market purchases (strong signal), open-market sales (weak/mixed signal — could be diversification), " +
    "awards and option exercises (routine, not meaningful), cluster buying by multiple insiders (strong signal). " +
    "Always respond with valid JSON matching the exact schema. Base analysis strictly on provided data.";

  const userPrompt =
    `Interpret the insider trading activity for ${ticker}. Is it a meaningful signal?\n\n` +
    dataContext +
    `\n\nReturn a JSON object with this exact structure:
{
  "signal": "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell",
  "confidence": "high" | "medium" | "low",
  "oneLiner": "one sentence capturing the key signal from insider activity",
  "interpretation": "2-3 sentences interpreting the overall pattern. Distinguish meaningful open-market purchases from routine sales/awards.",
  "notableTrades": [
    { "who": "name and title", "action": "what they did", "significance": "why it matters or why it doesn't" }
  ],
  "buyingPressure": "description of purchasing activity",
  "sellingPressure": "description of selling activity and whether it's likely routine or conviction-based",
  "verdict": "2 sentences — net bottom line for a long-term investor: should this insider activity change your view of the stock?"
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
      transactionsAnalyzed: recent.length,
      openMarketPurchases: purchases.length,
      openMarketSales: sales.length,
      routineTransactions: grantAwards.length,
      netSharesPurchased: totalPurchaseShares - totalSaleShares,
    },
    dataSources: {
      fetchedAt,
      finnhub: { success: (transactions as any[]).length > 0 },
    },
    generatedAt: new Date().toISOString(),
  };
}

const insiderSignalTool: ToolDefinition<Input> = {
  name: "insider-signal",
  description:
    "Interpret insider trading activity for any stock. Classifies open-market purchases vs. routine sales/awards, " +
    "identifies cluster buying, and explains whether the activity is a meaningful buy or sell signal. " +
    "Returns signal strength (strong_buy → strong_sell), confidence, and a plain-English verdict. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["stocks", "investing", "finance", "insider-trading", "llm"],
    pricing: "$0.05 per call",
    pricingMicros: 50_000,
    exampleInput: { ticker: "NVDA" },
  },
};

registerTool(insiderSignalTool);
export default insiderSignalTool;
