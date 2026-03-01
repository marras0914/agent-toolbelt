import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  original: z
    .string()
    .min(1)
    .max(50_000)
    .describe("The original version of the document"),
  revised: z
    .string()
    .min(1)
    .max(50_000)
    .describe("The revised version of the document"),
  mode: z
    .enum(["summary", "detailed", "structured"])
    .default("structured")
    .describe(
      "'summary' — brief overview of what changed. " +
      "'detailed' — full prose explanation of every change. " +
      "'structured' — categorized lists of additions, deletions, and modifications with context."
    ),
  context: z
    .string()
    .optional()
    .describe("Optional: what type of document this is (e.g. 'software contract', 'README', 'terms of service'). Helps generate more relevant analysis."),
});

type Input = z.infer<typeof inputSchema>;

// ----- Handler -----
async function handler(input: Input) {
  const { original, revised, mode, context } = input;

  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const contextHint = context ? `\nDocument type: ${context}` : "";

  const systemPrompt =
    "You are an expert document analyst specializing in comparing and diffing text documents. " +
    "You identify meaningful semantic changes, not just whitespace or formatting differences. " +
    "Always respond with valid JSON exactly matching the requested schema. " +
    "Be precise and specific — quote relevant text when describing changes.";

  const schemas: Record<string, string> = {
    summary: `{
  "summary": "2-4 sentence overview of what changed between the two versions",
  "overallAssessment": "minor | moderate | major",
  "changeCount": <estimated number of distinct changes>,
  "stats": {
    "additions": <count of added sections/paragraphs/items>,
    "deletions": <count of removed sections/paragraphs/items>,
    "modifications": <count of changed sections/paragraphs/items>
  }
}`,
    detailed: `{
  "summary": "2-4 sentence overview of what changed",
  "overallAssessment": "minor | moderate | major",
  "analysis": "Full detailed prose explanation of every meaningful change, organized logically",
  "stats": {
    "additions": <count>,
    "deletions": <count>,
    "modifications": <count>
  }
}`,
    structured: `{
  "summary": "2-4 sentence overview of what changed",
  "overallAssessment": "minor | moderate | major",
  "additions": [
    { "description": "what was added", "content": "the added text or a short excerpt", "significance": "high | medium | low" }
  ],
  "deletions": [
    { "description": "what was removed", "content": "the removed text or a short excerpt", "significance": "high | medium | low" }
  ],
  "modifications": [
    { "description": "what changed", "before": "original text excerpt", "after": "revised text excerpt", "significance": "high | medium | low" }
  ],
  "stats": {
    "additions": <count>,
    "deletions": <count>,
    "modifications": <count>
  }
}`,
  };

  const userPrompt = `Compare the following two document versions and produce a ${mode} diff analysis.${contextHint}

Return a JSON object with this exact structure:
${schemas[mode]}

--- ORIGINAL DOCUMENT ---
${original}

--- REVISED DOCUMENT ---
${revised}`;

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

  return {
    mode,
    ...parsed,
  };
}

// ----- Register -----
const documentComparatorTool: ToolDefinition<Input> = {
  name: "document-comparator",
  description:
    "Compare two versions of a document and produce a semantic diff. Identifies additions, deletions, and modifications with significance ratings. " +
    "Works with contracts, READMEs, terms of service, technical docs, essays, or any text. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["document", "diff", "comparison", "legal", "writing", "llm"],
    pricing: "$0.05 per call",
    exampleInput: {
      original: "Payment is due within 30 days. Late fees apply after 45 days.",
      revised: "Payment is due within 14 days. A 2% late fee applies after 30 days. Accounts unpaid after 60 days will be sent to collections.",
      mode: "structured",
      context: "payment terms in a service contract",
    },
  },
};

registerTool(documentComparatorTool);

export default documentComparatorTool;
