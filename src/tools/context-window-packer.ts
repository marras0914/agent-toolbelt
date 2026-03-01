import { z } from "zod";
import { get_encoding, Tiktoken } from "tiktoken";
import { ToolDefinition, registerTool } from "./registry";

// ----- Tokenizer -----
const encoderCache: Map<string, Tiktoken> = new Map();

function getEncoder(model: string): Tiktoken {
  // o200k_base: gpt-4o, gpt-4o-mini
  // cl100k_base: everything else (gpt-4, claude, etc.)
  const encoding = ["gpt-4o", "gpt-4o-mini"].includes(model) ? "o200k_base" : "cl100k_base";
  if (!encoderCache.has(encoding)) {
    encoderCache.set(encoding, get_encoding(encoding as any));
  }
  return encoderCache.get(encoding)!;
}

function countTokens(text: string, model: string): number {
  return getEncoder(model).encode(text).length;
}

// ----- Input Schema -----
const chunkSchema = z.object({
  text: z.string().min(1).describe("The content of this chunk"),
  label: z.string().optional().describe("Optional identifier/label for this chunk"),
  priority: z.number().min(0).max(10).default(5).describe("Priority 0–10 (higher = more important, default 5)"),
  metadata: z.record(z.unknown()).optional().describe("Optional metadata to pass through"),
});

const inputSchema = z.object({
  chunks: z
    .array(chunkSchema)
    .min(1)
    .max(500)
    .describe("Array of content chunks to pack into the context window"),
  tokenBudget: z
    .number()
    .int()
    .min(1)
    .describe("Maximum number of tokens allowed in the output"),
  model: z
    .string()
    .default("gpt-4o")
    .describe("Target model for tokenization (affects token counts). E.g. 'gpt-4o', 'claude-3-5-sonnet', 'gpt-4'"),
  strategy: z
    .enum(["priority", "greedy", "balanced"])
    .default("priority")
    .describe(
      "Packing strategy: " +
      "'priority' = highest-priority chunks first (ignores order); " +
      "'greedy' = pack in input order, skip chunks that don't fit; " +
      "'balanced' = rank by priority/token ratio (most value per token first)"
    ),
  separator: z
    .string()
    .default("\n\n")
    .describe("Text inserted between packed chunks. Counts toward the token budget."),
  systemPrompt: z
    .string()
    .optional()
    .describe("Optional system prompt to reserve tokens for. Its tokens are subtracted from the budget before packing."),
  reserveForOutput: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of tokens to reserve for model output (subtracted from budget before packing)."),
});

type Input = z.infer<typeof inputSchema>;
type Chunk = z.infer<typeof chunkSchema>;

// ----- Packing Logic -----

interface ScoredChunk {
  chunk: Chunk;
  tokens: number;
  index: number;
}

function packChunks(
  scored: ScoredChunk[],
  budget: number,
  separatorTokens: number
): { packed: ScoredChunk[]; excluded: ScoredChunk[] } {
  const packed: ScoredChunk[] = [];
  const excluded: ScoredChunk[] = [];
  let used = 0;

  for (const item of scored) {
    const overhead = packed.length > 0 ? separatorTokens : 0;
    if (used + overhead + item.tokens <= budget) {
      packed.push(item);
      used += overhead + item.tokens;
    } else {
      excluded.push(item);
    }
  }

  return { packed, excluded };
}

// ----- Handler -----
async function handler(input: Input) {
  const { chunks, tokenBudget, model, strategy, separator, systemPrompt, reserveForOutput } = input;

  // Calculate effective budget
  const systemTokens = systemPrompt ? countTokens(systemPrompt, model) : 0;
  const effectiveBudget = tokenBudget - systemTokens - reserveForOutput;

  if (effectiveBudget <= 0) {
    return {
      packed: [],
      excluded: chunks.map((c, i) => ({ ...c, tokens: countTokens(c.text, model), index: i })),
      packedText: "",
      stats: {
        tokenBudget,
        systemPromptTokens: systemTokens,
        reservedForOutput: reserveForOutput,
        effectiveBudget,
        tokensUsed: 0,
        tokensRemaining: 0,
        chunksTotal: chunks.length,
        chunksPacked: 0,
        chunksExcluded: chunks.length,
        utilizationPercent: 0,
      },
      model,
      strategy,
    };
  }

  const separatorTokens = separator ? countTokens(separator, model) : 0;

  // Score each chunk
  const scored: ScoredChunk[] = chunks.map((chunk, index) => ({
    chunk,
    tokens: countTokens(chunk.text, model),
    index,
  }));

  // Sort by strategy
  let ordered: ScoredChunk[];
  switch (strategy) {
    case "priority":
      // Highest priority first, ties broken by original order
      ordered = [...scored].sort((a, b) =>
        (b.chunk.priority ?? 5) - (a.chunk.priority ?? 5) || a.index - b.index
      );
      break;
    case "greedy":
      // Original order — just skip what doesn't fit
      ordered = [...scored];
      break;
    case "balanced":
      // Rank by priority-per-token (value density). Avoid div-by-zero.
      ordered = [...scored].sort((a, b) => {
        const densityA = (a.chunk.priority ?? 5) / Math.max(a.tokens, 1);
        const densityB = (b.chunk.priority ?? 5) / Math.max(b.tokens, 1);
        return densityB - densityA || a.index - b.index;
      });
      break;
  }

  const { packed, excluded } = packChunks(ordered, effectiveBudget, separatorTokens);

  // Restore original order for packed chunks (maintain reading flow)
  packed.sort((a, b) => a.index - b.index);

  const packedText = packed.map((s) => s.chunk.text).join(separator);
  const tokensUsed = packed.reduce((sum, s, i) => sum + s.tokens + (i > 0 ? separatorTokens : 0), 0);

  return {
    packed: packed.map((s) => ({
      label: s.chunk.label,
      priority: s.chunk.priority ?? 5,
      tokens: s.tokens,
      text: s.chunk.text,
      metadata: s.chunk.metadata,
      originalIndex: s.index,
    })),
    excluded: excluded.map((s) => ({
      label: s.chunk.label,
      priority: s.chunk.priority ?? 5,
      tokens: s.tokens,
      text: s.chunk.text,
      metadata: s.chunk.metadata,
      originalIndex: s.index,
      reason: s.tokens > effectiveBudget ? "chunk_too_large" : "budget_exhausted",
    })),
    packedText,
    stats: {
      tokenBudget,
      systemPromptTokens: systemTokens,
      reservedForOutput: reserveForOutput,
      effectiveBudget,
      tokensUsed,
      tokensRemaining: effectiveBudget - tokensUsed,
      chunksTotal: chunks.length,
      chunksPacked: packed.length,
      chunksExcluded: excluded.length,
      utilizationPercent: Math.round((tokensUsed / effectiveBudget) * 100),
    },
    model,
    strategy,
  };
}

// ----- Register -----
const contextWindowPackerTool: ToolDefinition<Input> = {
  name: "context-window-packer",
  description:
    "Intelligently pack content chunks into a token budget for LLM context windows. " +
    "Given an array of text chunks with optional priorities, selects the best subset that fits within the token limit. " +
    "Three strategies: 'priority' (highest priority first), 'greedy' (input order), 'balanced' (most priority-per-token). " +
    "Accounts for system prompt tokens and output reservation. " +
    "Returns the packed chunks in original order, excluded chunks with reasons, and detailed token usage stats.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["tokens", "llm", "context-window", "packing", "rag", "agent"],
    pricing: "$0.001 per call",
    exampleInput: {
      chunks: [
        { text: "User profile: Alice, enterprise customer since 2022.", label: "user_context", priority: 9 },
        { text: "Recent support tickets: 3 open, 2 resolved this week.", label: "tickets", priority: 7 },
        { text: "Product documentation section 1: Getting started...", label: "docs_1", priority: 4 },
        { text: "Product documentation section 2: Advanced features...", label: "docs_2", priority: 3 },
        { text: "Previous conversation summary: User asked about billing.", label: "history", priority: 8 },
      ],
      tokenBudget: 4096,
      model: "gpt-4o",
      strategy: "priority",
      separator: "\n\n",
      reserveForOutput: 1024,
    },
  },
};

registerTool(contextWindowPackerTool);
export default contextWindowPackerTool;
