import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(20_000)
    .describe("The LLM prompt to analyze and/or improve"),
  model: z
    .string()
    .default("gpt-4o")
    .describe(
      "Target LLM model to optimize for (e.g. 'gpt-4o', 'claude-3-5-sonnet', 'gpt-3.5-turbo', 'claude-haiku'). " +
      "Affects suggestions about context window, formatting preferences, and model-specific best practices."
    ),
  task: z
    .string()
    .optional()
    .describe(
      "Optional description of what this prompt is trying to accomplish. " +
      "Providing this helps generate more targeted suggestions."
    ),
  mode: z
    .enum(["improve", "analyze", "both"])
    .default("both")
    .describe(
      "'improve' returns an optimized prompt only. " +
      "'analyze' returns issues and scores only. " +
      "'both' returns everything."
    ),
});

type Input = z.infer<typeof inputSchema>;

// ----- Approximate token count -----
function estimateTokens(text: string): number {
  // ~4 chars per token is a reasonable approximation
  return Math.ceil(text.length / 4);
}

// ----- Handler -----
async function handler(input: Input) {
  const { prompt, model, task, mode } = input;

  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const taskHint = task ? `\nThe prompt's intended task: ${task}` : "";
  const modelHint = model ? `\nTarget model: ${model}` : "";

  const systemPrompt =
    "You are an expert prompt engineer with deep knowledge of how LLMs process instructions. " +
    "You analyze prompts for clarity, specificity, structure, and effectiveness. " +
    "Always respond with valid JSON exactly matching the requested schema. " +
    "Be specific and actionable in your feedback. " +
    "When improving prompts, preserve the original intent while fixing issues.";

  const analyzeSchema = `{
  "scores": {
    "clarity": <1-10, how clear and unambiguous the instructions are>,
    "specificity": <1-10, how specific vs vague the prompt is>,
    "structure": <1-10, how well-organized the prompt is>,
    "completeness": <1-10, whether all necessary context is provided>,
    "overall": <1-10, weighted overall quality>
  },
  "issues": [
    "<specific problem found in the prompt>"
  ],
  "suggestions": [
    "<specific actionable suggestion for improvement>"
  ]
}`;

  const improveSchema = `{
  "improvedPrompt": "<the fully rewritten, optimized prompt>",
  "changesSummary": [
    "<brief description of a specific change made and why>"
  ]
}`;

  const bothSchema = `{
  "scores": {
    "clarity": <1-10>,
    "specificity": <1-10>,
    "structure": <1-10>,
    "completeness": <1-10>,
    "overall": <1-10>
  },
  "issues": [
    "<specific problem>"
  ],
  "suggestions": [
    "<specific suggestion>"
  ],
  "improvedPrompt": "<the fully rewritten, optimized prompt>",
  "changesSummary": [
    "<brief description of a specific change made and why>"
  ]
}`;

  const schema = mode === "analyze" ? analyzeSchema : mode === "improve" ? improveSchema : bothSchema;
  const instruction =
    mode === "analyze"
      ? "Analyze the following prompt and identify its strengths and weaknesses."
      : mode === "improve"
      ? "Rewrite the following prompt to be as effective as possible."
      : "Analyze the following prompt and produce an improved version.";

  const userPrompt = `${instruction}${modelHint}${taskHint}

Return a JSON object with this exact structure:
${schema}

Prompt to ${mode === "analyze" ? "analyze" : "optimize"}:
\`\`\`
${prompt}
\`\`\``;

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

  const originalTokens = estimateTokens(prompt);
  const improvedPrompt = parsed.improvedPrompt as string | undefined;
  const improvedTokens = improvedPrompt ? estimateTokens(improvedPrompt) : null;

  const result: Record<string, unknown> = { mode, model };
  if (parsed.scores) result.scores = parsed.scores;
  if (parsed.issues) result.issues = parsed.issues;
  if (parsed.suggestions) result.suggestions = parsed.suggestions;
  if (improvedPrompt) result.improvedPrompt = improvedPrompt;
  if (parsed.changesSummary) result.changesSummary = parsed.changesSummary;
  result.tokenStats = {
    original: originalTokens,
    ...(improvedTokens !== null && { improved: improvedTokens, delta: improvedTokens - originalTokens }),
  };
  return result;
}

// ----- Register -----
const promptOptimizerTool: ToolDefinition<Input> = {
  name: "prompt-optimizer",
  description:
    "Analyze and improve LLM prompts. Scores prompts on clarity, specificity, structure, and completeness. " +
    "Returns an optimized rewrite with a summary of changes. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["prompt", "llm", "optimization", "ai", "productivity"],
    pricing: "$0.05 per call",
    exampleInput: {
      prompt: "Summarize this document and make it shorter and tell me the main points.",
      model: "gpt-4o",
      task: "Document summarization for executive briefings",
      mode: "both",
    },
  },
};

registerTool(promptOptimizerTool);

export default promptOptimizerTool;
