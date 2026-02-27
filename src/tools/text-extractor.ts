import { z } from "zod";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(10_000)
    .describe("Raw text to extract structured data from"),
  extractors: z
    .array(
      z.enum([
        "emails",
        "urls",
        "phone_numbers",
        "dates",
        "currencies",
        "addresses",
        "names",
        "json_blocks",
      ])
    )
    .min(1)
    .describe("Which types of data to extract"),
  deduplicate: z.boolean().default(true).describe("Remove duplicate results"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Extraction Logic -----
const PATTERNS: Record<string, { regex: RegExp; postProcess?: (match: string) => string }> = {
  emails: {
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  urls: {
    regex: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g,
  },
  phone_numbers: {
    regex: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
    postProcess: (m) => m.replace(/[.\s()-]/g, "").replace(/^1/, "+1"),
  },
  dates: {
    regex:
      /\b(?:\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/gi,
  },
  currencies: {
    regex: /(?:\$|€|£|¥|₹)\s?[\d,]+(?:\.\d{2})?|\b\d+(?:,\d{3})*(?:\.\d{2})?\s?(?:USD|EUR|GBP|JPY|INR)\b/g,
  },
  addresses: {
    regex:
      /\b\d{1,6}\s+[A-Z][a-zA-Z\s]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place)\b\.?(?:\s*(?:#|Apt|Suite|Ste|Unit)\s*\w+)?(?:\s*,\s*[A-Z][a-zA-Z\s]+)?(?:\s*,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/g,
  },
  names: {
    regex: /\b[A-Z][a-z]+(?:\s[A-Z]\.?)?\s[A-Z][a-z]+\b/g,
  },
  json_blocks: {
    regex: /```json\s*([\s\S]*?)```|\{[\s\S]*?\}/g,
  },
};

function extract(text: string, extractors: string[], deduplicate: boolean) {
  const results: Record<string, string[]> = {};

  for (const extractor of extractors) {
    const pattern = PATTERNS[extractor];
    if (!pattern) continue;

    const matches = text.match(pattern.regex) || [];
    let processed = pattern.postProcess ? matches.map(pattern.postProcess) : matches;

    if (deduplicate) {
      processed = [...new Set(processed)];
    }

    results[extractor] = processed;
  }

  return results;
}

// ----- Handler -----
async function handler(input: Input) {
  const extracted = extract(input.text, input.extractors, input.deduplicate);

  const totalFound = Object.values(extracted).reduce((sum, arr) => sum + arr.length, 0);

  return {
    extracted,
    summary: {
      totalItemsFound: totalFound,
      byType: Object.fromEntries(Object.entries(extracted).map(([k, v]) => [k, v.length])),
    },
  };
}

// ----- Register -----
const textExtractorTool: ToolDefinition<Input> = {
  name: "text-extractor",
  description:
    "Extract structured data (emails, URLs, phone numbers, dates, currencies, addresses, names, JSON blocks) from raw text. Essential for agents processing unstructured documents, emails, or web content.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["extraction", "parsing", "nlp", "data-transformation"],
    pricing: "$0.0005 per call",
    exampleInput: {
      text: "Contact John Smith at john@example.com or call (555) 123-4567. Meeting on Jan 15, 2025 at 123 Main St, Springfield, IL 62701. Budget: $5,000.00 USD.",
      extractors: ["emails", "phone_numbers", "dates", "addresses", "currencies"],
      deduplicate: true,
    },
  },
};

registerTool(textExtractorTool);

export default textExtractorTool;
