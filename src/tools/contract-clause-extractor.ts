import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const CLAUSE_TYPES = [
  "parties",
  "dates",
  "payment_terms",
  "termination",
  "liability",
  "ip_ownership",
  "confidentiality",
  "governing_law",
  "penalties",
  "renewal",
  "warranties",
  "dispute_resolution",
] as const;

const inputSchema = z.object({
  contract: z
    .string()
    .min(10)
    .max(100_000)
    .describe("The contract or legal document text to analyze"),
  clauses: z
    .array(z.enum(CLAUSE_TYPES))
    .default([...CLAUSE_TYPES])
    .describe(
      "Which clause types to extract. Defaults to all. " +
      "Options: parties, dates, payment_terms, termination, liability, ip_ownership, " +
      "confidentiality, governing_law, penalties, renewal, warranties, dispute_resolution"
    ),
  flagRisks: z
    .boolean()
    .default(true)
    .describe("If true, flag clauses that may be unfavorable or risky (one-sided terms, missing protections, unusual penalties)"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Handler -----
async function handler(input: Input) {
  const { contract, clauses, flagRisks } = input;

  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const systemPrompt =
    "You are an expert contract analyst and legal document reviewer. " +
    "You extract and summarize key clauses from contracts and legal agreements with precision. " +
    "Always respond with valid JSON exactly matching the requested schema. " +
    "When quoting contract text, use the exact wording from the document. " +
    "Risk flags should be specific and actionable — explain exactly why a clause is concerning.";

  const clauseDescriptions: Record<string, string> = {
    parties: "names, roles, and contact details of all parties involved",
    dates: "effective date, expiration date, key milestones, and deadlines",
    payment_terms: "amounts, payment schedules, currencies, and billing conditions",
    termination: "conditions and notice requirements for ending the agreement",
    liability: "liability caps, indemnification obligations, and damage limitations",
    ip_ownership: "who owns intellectual property created under the agreement",
    confidentiality: "NDA terms, what information is protected, and for how long",
    governing_law: "which jurisdiction's laws apply and where disputes are handled",
    penalties: "late fees, breach penalties, and liquidated damages",
    renewal: "auto-renewal conditions, notice periods, and renewal terms",
    warranties: "representations, guarantees, and disclaimers",
    dispute_resolution: "arbitration, mediation, or litigation procedures",
  };

  const requestedClauses = clauses.map((c) => `- ${c}: ${clauseDescriptions[c]}`).join("\n");

  const riskInstructions = flagRisks
    ? `
For each extracted clause, also evaluate whether it poses a risk to the party receiving this analysis.
Include a "riskFlags" array in your response listing any concerning clauses with:
- clause: which clause type
- issue: specific concern in plain language
- severity: "high" | "medium" | "low"
- excerpt: the exact contract text that is concerning`
    : "";

  const userPrompt = `Extract the following clause types from this contract:
${requestedClauses}
${riskInstructions}

Return a JSON object with this structure:
{
  "contractType": "inferred type of contract (e.g. 'Software License Agreement', 'Employment Contract')",
  "clauses": {
    "<clause_type>": {
      "found": true | false,
      "summary": "plain-English summary of the clause",
      "excerpt": "direct quote of the most relevant text (or null if not found)",
      "details": { <structured key-value pairs relevant to this clause type, e.g. amount, date, jurisdiction> }
    }
    // ... one entry per requested clause type
  }${flagRisks ? `,
  "riskFlags": [
    {
      "clause": "<clause_type>",
      "issue": "plain-language description of the risk",
      "severity": "high | medium | low",
      "excerpt": "the specific text that is concerning"
    }
  ],
  "riskSummary": "overall risk assessment in 1-2 sentences"` : ""}
}

Only include clause types that were requested. If a clause is not found in the document, set found: false and omit excerpt/details.

Contract text:
${contract}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
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

  const clauseResults = parsed.clauses as Record<string, unknown>;
  const foundCount = clauseResults
    ? Object.values(clauseResults).filter((c: any) => c?.found).length
    : 0;

  return {
    contractType: parsed.contractType ?? "Unknown",
    clausesRequested: clauses.length,
    clausesFound: foundCount,
    clauses: clauseResults,
    ...(flagRisks && {
      riskFlags: parsed.riskFlags ?? [],
      riskSummary: parsed.riskSummary ?? "",
    }),
  };
}

// ----- Register -----
const contractClauseExtractorTool: ToolDefinition<Input> = {
  name: "contract-clause-extractor",
  description:
    "Extract and summarize key clauses from contracts and legal documents. " +
    "Identifies parties, payment terms, termination conditions, liability caps, IP ownership, confidentiality, and more. " +
    "Optionally flags risky or one-sided clauses with severity ratings. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["contract", "legal", "extraction", "risk", "llm", "enterprise"],
    pricing: "$0.10 per call",
    exampleInput: {
      contract: "This Software License Agreement is entered into between Acme Corp ('Licensor') and Client Inc ('Licensee')...",
      clauses: ["parties", "payment_terms", "termination", "liability", "ip_ownership"],
      flagRisks: true,
    },
  },
};

registerTool(contractClauseExtractorTool);

export default contractClauseExtractorTool;
