import { z } from "zod";
import { get_encoding, Tiktoken } from "tiktoken";
import { ToolDefinition, registerTool } from "./registry";

// ----- Model registry -----
// encoding -> list of model names that use it
const ENCODING_MODELS: Record<string, { models: string[]; pricePerMToken?: { input: number; output: number } }> = {
  cl100k_base: {
    models: ["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo", "text-embedding-ada-002", "text-embedding-3-small", "text-embedding-3-large"],
    pricePerMToken: { input: 0.03, output: 0.06 }, // gpt-4 pricing as reference
  },
  o200k_base: {
    models: ["gpt-4o", "gpt-4o-mini"],
    pricePerMToken: { input: 0.005, output: 0.015 }, // gpt-4o pricing
  },
};

// Claude uses a similar tokenizer (~same density as cl100k). No public package.
// We use cl100k as a close approximation and note it.
const CLAUDE_MODELS = [
  "claude-3-5-sonnet",
  "claude-3-5-haiku",
  "claude-3-opus",
  "claude-3-sonnet",
  "claude-3-haiku",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
];

const CLAUDE_PRICING: Record<string, { input: number; output: number }> = {
  "claude-3-5-sonnet":  { input: 3,    output: 15 },
  "claude-3-5-haiku":   { input: 0.8,  output: 4 },
  "claude-3-opus":      { input: 15,   output: 75 },
  "claude-3-sonnet":    { input: 3,    output: 15 },
  "claude-3-haiku":     { input: 0.25, output: 1.25 },
  "claude-sonnet-4-6":  { input: 3,    output: 15 },
  "claude-opus-4-6":    { input: 15,   output: 75 },
};

const ALL_MODELS = [
  ...Object.values(ENCODING_MODELS).flatMap((e) => e.models),
  ...CLAUDE_MODELS,
];

// ----- Input Schema -----
const inputSchema = z.object({
  text: z.string().min(1).max(200_000).describe("The text to count tokens for"),
  models: z
    .array(z.string())
    .min(1)
    .max(10)
    .default(["gpt-4o", "claude-3-5-sonnet"])
    .describe(`Models to count tokens for. Supported: ${ALL_MODELS.join(", ")}`),
});

type Input = z.infer<typeof inputSchema>;

// ----- Encoder cache (avoid re-initializing per request) -----
const encoderCache: Map<string, Tiktoken> = new Map();

function getEncoder(encoding: string): Tiktoken {
  if (!encoderCache.has(encoding)) {
    encoderCache.set(encoding, get_encoding(encoding as any));
  }
  return encoderCache.get(encoding)!;
}

function countWithEncoding(text: string, encoding: string): number {
  const enc = getEncoder(encoding);
  return enc.encode(text).length;
}

// ----- Handler -----
async function handler(input: Input) {
  const { text, models } = input;
  const results: Record<string, {
    tokens: number;
    encoding: string;
    approximate: boolean;
    estimatedCost?: { input: number; output: number; currency: string };
  }> = {};

  for (const model of models) {
    // Find encoding for OpenAI models
    let encoding: string | null = null;
    let pricing: { input: number; output: number } | undefined;

    for (const [enc, info] of Object.entries(ENCODING_MODELS)) {
      if (info.models.includes(model)) {
        encoding = enc;
        pricing = info.pricePerMToken;
        break;
      }
    }

    if (encoding) {
      const tokens = countWithEncoding(text, encoding);
      results[model] = {
        tokens,
        encoding,
        approximate: false,
        ...(pricing && {
          estimatedCost: {
            input: parseFloat(((tokens / 1_000_000) * pricing.input).toFixed(6)),
            output: parseFloat(((tokens / 1_000_000) * pricing.output).toFixed(6)),
            currency: "USD",
          },
        }),
      };
    } else if (CLAUDE_MODELS.includes(model)) {
      // Claude: use cl100k as approximation
      const tokens = countWithEncoding(text, "cl100k_base");
      const claudePricing = CLAUDE_PRICING[model];
      results[model] = {
        tokens,
        encoding: "cl100k_base (approximate)",
        approximate: true,
        ...(claudePricing && {
          estimatedCost: {
            input: parseFloat(((tokens / 1_000_000) * claudePricing.input).toFixed(6)),
            output: parseFloat(((tokens / 1_000_000) * claudePricing.output).toFixed(6)),
            currency: "USD",
          },
        }),
      };
    } else {
      results[model] = {
        tokens: -1,
        encoding: "unknown",
        approximate: false,
      };
    }
  }

  return {
    characterCount: text.length,
    wordCount: text.trim().split(/\s+/).filter(Boolean).length,
    results,
    supportedModels: ALL_MODELS,
  };
}

// ----- Register -----
const tokenCounterTool: ToolDefinition<Input> = {
  name: "token-counter",
  description:
    "Count tokens for any text across multiple LLM models (GPT-4o, GPT-4, GPT-3.5, Claude 3.x, and more). Returns exact token counts using official tokenizers and estimated API costs per model.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["tokens", "llm", "cost-estimation", "openai", "claude", "utilities"],
    pricing: "$0.0001 per call",
    exampleInput: {
      text: "The quick brown fox jumps over the lazy dog.",
      models: ["gpt-4o", "gpt-3.5-turbo", "claude-3-5-sonnet"],
    },
  },
};

registerTool(tokenCounterTool);

export default tokenCounterTool;
