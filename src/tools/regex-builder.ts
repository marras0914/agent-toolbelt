import { z } from "zod";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  description: z
    .string()
    .min(1)
    .describe(
      "Natural language description of what you want to match. Examples: 'email addresses', 'US phone numbers', 'dates in MM/DD/YYYY format', 'URLs starting with https', 'words that start with a capital letter'"
    ),
  testStrings: z
    .array(z.string())
    .optional()
    .describe("Optional array of test strings to validate the regex against"),
  flags: z
    .string()
    .default("g")
    .describe("Regex flags (default: 'g' for global). Common: 'gi' for case-insensitive global, 'gm' for multiline"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Regex Pattern Library -----
interface PatternDef {
  keywords: string[];
  pattern: string;
  description: string;
  examples: { match: string[]; noMatch: string[] };
}

const PATTERNS: PatternDef[] = [
  {
    keywords: ["email", "e-mail", "mail address"],
    pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
    description: "Email addresses (RFC 5322 simplified)",
    examples: { match: ["user@example.com", "first.last@company.co.uk"], noMatch: ["@missing.com", "no-at-sign"] },
  },
  {
    keywords: ["url", "http", "https", "web address", "link"],
    pattern: "https?:\\/\\/[^\\s<>\"']+",
    description: "HTTP/HTTPS URLs",
    examples: { match: ["https://example.com", "http://sub.domain.com/path?q=1"], noMatch: ["ftp://other.com", "not a url"] },
  },
  {
    keywords: ["us phone", "phone number", "telephone", "phone"],
    pattern: "(?:\\+?1[-.]?\\s?)?\\(?\\d{3}\\)?[-.]?\\s?\\d{3}[-.]?\\s?\\d{4}",
    description: "US phone numbers (with or without country code, various separators)",
    examples: { match: ["(555) 123-4567", "+1-555-123-4567", "5551234567"], noMatch: ["123", "555-12-4567"] },
  },
  {
    keywords: ["ipv4", "ip address", "ip4"],
    pattern: "\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b",
    description: "IPv4 addresses",
    examples: { match: ["192.168.1.1", "10.0.0.255"], noMatch: ["999.999.999.999", "1.2.3"] },
  },
  {
    keywords: ["ipv6", "ip6"],
    pattern: "(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}",
    description: "IPv6 addresses (full form)",
    examples: { match: ["2001:0db8:85a3:0000:0000:8a2e:0370:7334"], noMatch: ["192.168.1.1"] },
  },
  {
    keywords: ["date", "mm/dd", "mm-dd", "date format"],
    pattern: "(?:0[1-9]|1[0-2])[\\/\\-](?:0[1-9]|[12]\\d|3[01])[\\/\\-](?:19|20)\\d{2}",
    description: "Dates in MM/DD/YYYY or MM-DD-YYYY format",
    examples: { match: ["01/15/2025", "12-31-2024"], noMatch: ["13/01/2025", "2025-01-15"] },
  },
  {
    keywords: ["iso date", "yyyy-mm", "iso 8601"],
    pattern: "\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])(?:T[0-2]\\d:[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|[+-][0-2]\\d:[0-5]\\d)?)?",
    description: "ISO 8601 dates and datetimes",
    examples: { match: ["2025-01-15", "2025-01-15T14:30:00Z"], noMatch: ["01/15/2025", "2025-13-01"] },
  },
  {
    keywords: ["hex color", "color code", "hex code", "colour"],
    pattern: "#(?:[0-9a-fA-F]{3}){1,2}\\b",
    description: "Hex color codes (#RGB or #RRGGBB)",
    examples: { match: ["#fff", "#FF5733", "#00e5a0"], noMatch: ["#gg0000", "ff5733"] },
  },
  {
    keywords: ["credit card", "card number", "cc number"],
    pattern: "\\b(?:4\\d{3}|5[1-5]\\d{2}|6011|3[47]\\d{2})[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b",
    description: "Credit card numbers (Visa, MC, Discover, Amex patterns)",
    examples: { match: ["4111111111111111", "4111-1111-1111-1111"], noMatch: ["1234567890", "0000-0000-0000-0000"] },
  },
  {
    keywords: ["zip", "zip code", "postal code", "us postal"],
    pattern: "\\b\\d{5}(?:-\\d{4})?\\b",
    description: "US ZIP codes (5-digit or ZIP+4)",
    examples: { match: ["90210", "10001-1234"], noMatch: ["1234", "123456"] },
  },
  {
    keywords: ["ssn", "social security"],
    pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b",
    description: "US Social Security Numbers (XXX-XX-XXXX format)",
    examples: { match: ["123-45-6789"], noMatch: ["12-345-6789", "1234567890"] },
  },
  {
    keywords: ["currency", "money", "dollar", "price", "amount"],
    pattern: "\\$[\\d,]+(?:\\.\\d{2})?",
    description: "USD currency amounts",
    examples: { match: ["$100", "$1,234.56", "$0.99"], noMatch: ["€100", "100 dollars"] },
  },
  {
    keywords: ["slug", "url slug", "kebab"],
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    description: "URL-safe slugs (lowercase alphanumeric with hyphens)",
    examples: { match: ["hello-world", "my-post-123"], noMatch: ["Hello World", "has spaces", "UPPERCASE"] },
  },
  {
    keywords: ["uuid", "guid"],
    pattern: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
    description: "UUIDs / GUIDs",
    examples: { match: ["550e8400-e29b-41d4-a716-446655440000"], noMatch: ["not-a-uuid", "12345"] },
  },
  {
    keywords: ["hashtag", "hash tag"],
    pattern: "#[a-zA-Z]\\w{0,139}",
    description: "Hashtags (# followed by alphanumeric characters)",
    examples: { match: ["#hello", "#AI2025"], noMatch: ["#", "# space"] },
  },
  {
    keywords: ["mention", "at mention", "username", "twitter handle"],
    pattern: "@[a-zA-Z_]\\w{0,14}",
    description: "Social media @mentions",
    examples: { match: ["@user", "@John_Doe"], noMatch: ["@", "@ space"] },
  },
  {
    keywords: ["html tag", "html element", "xml tag"],
    pattern: "<\\/?[a-zA-Z][a-zA-Z0-9]*(?:\\s[^>]*)?\\/?>",
    description: "HTML/XML tags",
    examples: { match: ["<div>", '<img src="x" />', "</span>"], noMatch: ["< not a tag >", "plain text"] },
  },
  {
    keywords: ["markdown link", "md link"],
    pattern: "\\[([^\\]]+)\\]\\(([^)]+)\\)",
    description: "Markdown links [text](url)",
    examples: { match: ["[click here](https://example.com)"], noMatch: ["plain text", "https://bare.url"] },
  },
  {
    keywords: ["semver", "semantic version", "version number"],
    pattern: "\\bv?\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)?(?:\\+[\\w.]+)?\\b",
    description: "Semantic version numbers (e.g., 1.2.3, v2.0.0-beta.1)",
    examples: { match: ["1.0.0", "v2.3.1-rc.1", "0.0.1+build.123"], noMatch: ["1.0", "version1"] },
  },
  {
    keywords: ["word", "capital", "capitalized", "proper noun", "uppercase word"],
    pattern: "\\b[A-Z][a-z]+\\b",
    description: "Capitalized words (potential proper nouns)",
    examples: { match: ["Hello", "World", "Alice"], noMatch: ["hello", "ALLCAPS", "a"] },
  },
  {
    keywords: ["number", "integer", "digit"],
    pattern: "-?\\d+(?:,\\d{3})*(?:\\.\\d+)?",
    description: "Numbers (integers and decimals, with optional commas and negatives)",
    examples: { match: ["42", "-3.14", "1,000,000"], noMatch: ["abc", ""] },
  },
];

// ----- Matching Logic -----
function findBestPattern(description: string): PatternDef | null {
  const lower = description.toLowerCase();

  // Score each pattern by keyword matches
  let best: PatternDef | null = null;
  let bestScore = 0;

  for (const p of PATTERNS) {
    let score = 0;
    for (const kw of p.keywords) {
      if (lower.includes(kw)) {
        score += kw.length; // Longer keyword matches are more specific
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best;
}

function testRegex(pattern: string, flags: string, testStrings: string[]): Array<{ input: string; matches: string[]; matched: boolean }> {
  const results: Array<{ input: string; matches: string[]; matched: boolean }> = [];

  for (const str of testStrings) {
    try {
      const regex = new RegExp(pattern, flags);
      const matches: string[] = [];
      let match;
      while ((match = regex.exec(str)) !== null) {
        matches.push(match[0]);
        if (!flags.includes("g")) break;
      }
      results.push({ input: str, matches, matched: matches.length > 0 });
    } catch {
      results.push({ input: str, matches: [], matched: false });
    }
  }

  return results;
}

// ----- Handler -----
async function handler(input: Input) {
  const pattern = findBestPattern(input.description);

  if (!pattern) {
    return {
      success: false,
      message: "Could not find a matching regex pattern for the description. Try being more specific, e.g., 'email addresses', 'US phone numbers', 'hex color codes'.",
      availablePatterns: PATTERNS.map((p) => p.keywords[0]),
    };
  }

  const result: Record<string, unknown> = {
    pattern: pattern.pattern,
    flags: input.flags,
    regexLiteral: `/${pattern.pattern}/${input.flags}`,
    description: pattern.description,
    examples: pattern.examples,
  };

  // Test against provided strings
  if (input.testStrings && input.testStrings.length > 0) {
    result.testResults = testRegex(pattern.pattern, input.flags, input.testStrings);
  }

  // Also provide code snippets
  result.codeSnippets = {
    javascript: `const regex = /${pattern.pattern}/${input.flags};\nconst matches = text.match(regex);`,
    python: `import re\npattern = r"${pattern.pattern}"\nmatches = re.findall(pattern, text${input.flags.includes("i") ? ", re.IGNORECASE" : ""})`,
    typescript: `const regex = new RegExp("${pattern.pattern.replace(/\\/g, "\\\\")}", "${input.flags}");\nconst matches = text.match(regex);`,
  };

  return result;
}

// ----- Register -----
const regexBuilderTool: ToolDefinition<Input> = {
  name: "regex-builder",
  description:
    "Build and test regular expressions from natural language descriptions. Supports 20+ common patterns including emails, URLs, phone numbers, dates, IPs, colors, UUIDs, and more. Returns the regex pattern, flags, code snippets in JS/Python/TS, and optionally tests against provided strings.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["regex", "validation", "parsing", "developer-tools"],
    pricing: "$0.0005 per call",
    exampleInput: {
      description: "email addresses",
      testStrings: ["Contact us at hello@example.com or support@company.co.uk", "No email here"],
      flags: "gi",
    },
  },
};

registerTool(regexBuilderTool);
export default regexBuilderTool;
