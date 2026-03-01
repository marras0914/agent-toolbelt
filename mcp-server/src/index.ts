#!/usr/bin/env node

/**
 * Agent Toolbelt MCP Server
 *
 * Exposes Agent Toolbelt API tools as MCP tools that can be used by:
 * - Claude Desktop
 * - Claude Code
 * - VS Code (Copilot MCP)
 * - Any other MCP-compatible client
 *
 * This server acts as a bridge: it receives MCP tool calls via stdio,
 * forwards them to the Agent Toolbelt HTTP API, and returns results.
 *
 * Configuration:
 *   AGENT_TOOLBELT_URL  — Base URL of your deployed API (default: http://localhost:3000)
 *   AGENT_TOOLBELT_KEY  — Your API key (atb_...)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ----- Configuration -----
const API_BASE_URL = process.env.AGENT_TOOLBELT_URL || "http://localhost:3000";
const API_KEY = process.env.AGENT_TOOLBELT_KEY || "";

// ----- HTTP helper -----
async function callToolApi(toolName: string, input: Record<string, unknown>): Promise<unknown> {
  const url = `${API_BASE_URL}/api/tools/${toolName}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(
      `Agent Toolbelt API error (${response.status}): ${(error as any).message || JSON.stringify(error)}`
    );
  }

  return response.json();
}

// ----- Create MCP Server -----
const server = new McpServer({
  name: "agent-toolbelt",
  version: "1.0.0",
});

// ----- Tool: Schema Generator -----
server.registerTool(
  "generate_schema",
  {
    title: "Schema Generator",
    description:
      "Generate a JSON Schema, TypeScript interface, or Zod validation schema from a natural language description of a data structure. " +
      "Examples: 'a user profile with name, email, and signup date', 'a product listing with title, price, and inventory count'.",
    inputSchema: {
      description: z
        .string()
        .describe(
          "Natural language description of the data structure you want a schema for"
        ),
      format: z
        .enum(["json_schema", "zod", "typescript"])
        .default("json_schema")
        .describe(
          "Output format: json_schema (standard JSON Schema), typescript (TS interface), or zod (Zod validation schema)"
        ),
      strict: z
        .boolean()
        .default(true)
        .describe(
          "If true, all fields are required. If false, optional fields are marked as optional"
        ),
    },
  },
  async ({ description, format, strict }) => {
    const result = await callToolApi("schema-generator", {
      description,
      format,
      strict,
    });

    const data = result as any;
    const schema = data.result?.schema;

    // Format output nicely for the LLM
    const output =
      typeof schema === "string"
        ? schema
        : JSON.stringify(schema, null, 2);

    return {
      content: [
        {
          type: "text" as const,
          text: `Generated ${format || "json_schema"} schema:\n\n\`\`\`${format === "typescript" ? "typescript" : format === "zod" ? "typescript" : "json"}\n${output}\n\`\`\`\n\nGenerated in ${data.durationMs}ms.`,
        },
      ],
    };
  }
);

// ----- Tool: Text Extractor -----
server.registerTool(
  "extract_from_text",
  {
    title: "Text Extractor",
    description:
      "Extract structured data from raw text: emails, URLs, phone numbers, dates, currencies, addresses, names, or JSON blocks. " +
      "Useful for parsing documents, emails, web content, or any unstructured text into clean structured data.",
    inputSchema: {
      text: z
        .string()
        .describe("The raw text to extract data from"),
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
        .describe(
          "Which types of data to extract. Choose one or more: emails, urls, phone_numbers, dates, currencies, addresses, names, json_blocks"
        ),
      deduplicate: z
        .boolean()
        .default(true)
        .describe("Remove duplicate results within each type"),
    },
  },
  async ({ text, extractors, deduplicate }) => {
    const result = await callToolApi("text-extractor", {
      text,
      extractors,
      deduplicate,
    });

    const data = result as any;
    const extracted = data.result?.extracted || {};
    const summary = data.result?.summary || {};

    // Build a clean text output
    const lines: string[] = [];
    lines.push(`Extracted ${summary.totalItemsFound || 0} items from text:\n`);

    for (const [type, items] of Object.entries(extracted)) {
      const arr = items as string[];
      if (arr.length > 0) {
        lines.push(`**${type}** (${arr.length}):`);
        for (const item of arr) {
          lines.push(`  • ${item}`);
        }
        lines.push("");
      }
    }

    lines.push(`Processed in ${data.durationMs}ms.`);

    return {
      content: [
        {
          type: "text" as const,
          text: lines.join("\n"),
        },
      ],
    };
  }
);

// ----- Tool: Cron Builder -----
server.registerTool(
  "build_cron",
  {
    title: "Cron Expression Builder",
    description:
      "Convert natural language schedule descriptions into cron expressions. " +
      "Examples: 'every weekday at 9am', 'first Monday of each month at noon', 'every 5 minutes'. " +
      "Returns the expression, human-readable confirmation, and next 5 run times.",
    inputSchema: {
      description: z
        .string()
        .describe("Natural language schedule description"),
      timezone: z
        .string()
        .default("UTC")
        .describe("Timezone for context"),
    },
  },
  async ({ description, timezone }) => {
    const result = await callToolApi("cron-builder", { description, timezone });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**Cron Expression:** \`${r.expression}\``,
      `**Schedule:** ${r.humanReadable}`,
      `**Timezone:** ${r.timezone}`,
      "",
      "**Fields:**",
      `  minute: ${r.fields.minute} | hour: ${r.fields.hour} | day: ${r.fields.dayOfMonth} | month: ${r.fields.month} | weekday: ${r.fields.dayOfWeek}`,
      "",
      "**Next 5 runs (UTC):**",
      ...r.nextRuns.map((t: string, i: number) => `  ${i + 1}. ${t}`),
    ];

    if (r.warnings?.length > 0) {
      lines.push("", "**Warnings:**", ...r.warnings.map((w: string) => `  ⚠ ${w}`));
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// ----- Tool: Regex Builder -----
server.registerTool(
  "build_regex",
  {
    title: "Regex Builder & Tester",
    description:
      "Build and test regular expressions from natural language descriptions. " +
      "Supports emails, URLs, phones, dates, IPs, colors, UUIDs, and 15+ more patterns. " +
      "Returns the pattern, code snippets in JS/Python/TS, and optional test results.",
    inputSchema: {
      description: z
        .string()
        .describe("What to match (e.g., 'email addresses', 'hex color codes', 'semantic versions')"),
      testStrings: z
        .array(z.string())
        .optional()
        .describe("Optional strings to test the regex against"),
      flags: z
        .string()
        .default("g")
        .describe("Regex flags (default: 'g')"),
    },
  },
  async ({ description, testStrings, flags }) => {
    const result = await callToolApi("regex-builder", { description, testStrings, flags });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**Pattern:** \`${r.regexLiteral}\``,
      `**Description:** ${r.description}`,
      "",
      "**Code snippets:**",
      "```javascript",
      r.codeSnippets.javascript,
      "```",
      "```python",
      r.codeSnippets.python,
      "```",
    ];

    if (r.testResults) {
      lines.push("", "**Test results:**");
      for (const t of r.testResults) {
        const status = t.matched ? "✓" : "✗";
        lines.push(`  ${status} "${t.input}" → ${t.matched ? t.matches.join(", ") : "no match"}`);
      }
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// ----- Tool: Brand Kit Generator -----
server.registerTool(
  "generate_brand_kit",
  {
    title: "Brand Kit Generator",
    description:
      "Generate a complete brand kit from a company name, industry, and aesthetic keywords. " +
      "Returns a color palette with WCAG accessibility scores, curated typography pairings, " +
      "and design tokens in JSON, CSS, or Tailwind format.",
    inputSchema: {
      name: z.string().describe("Company or brand name"),
      industry: z
        .string()
        .optional()
        .describe("Industry (e.g., 'fintech', 'healthcare', 'fashion')"),
      vibe: z
        .array(z.string())
        .optional()
        .describe("Aesthetic keywords: 'modern', 'playful', 'luxurious', 'minimal', 'bold', etc."),
      format: z
        .enum(["full", "tokens", "css", "tailwind"])
        .default("full")
        .describe("Output format"),
    },
  },
  async ({ name, industry, vibe, format }) => {
    const result = await callToolApi("brand-kit", { name, industry, vibe, format });
    const data = result as any;
    const r = data.result;

    if (format === "css") {
      return {
        content: [{ type: "text" as const, text: `Brand kit for **${name}**:\n\n\`\`\`css\n${r.css}\n\`\`\`\n\nFonts: ${r.fonts?.display} + ${r.fonts?.body}\nAccessibility: Primary on background ${r.accessibility?.primaryOnBackground?.rating} (${r.accessibility?.primaryOnBackground?.ratio}:1)` }],
      };
    }

    if (format === "tailwind") {
      return {
        content: [{ type: "text" as const, text: `Brand kit for **${name}**:\n\n\`\`\`javascript\n${r.tailwindConfig}\n\`\`\`\n\nFonts: ${r.fonts?.display} + ${r.fonts?.body}` }],
      };
    }

    // Full or tokens format
    return {
      content: [{ type: "text" as const, text: `Brand kit for **${name}**:\n\n\`\`\`json\n${JSON.stringify(r, null, 2).slice(0, 3000)}\n\`\`\`\n\n*(Full result may be truncated — use 'css' or 'tailwind' format for focused output)*` }],
    };
  }
);

// ----- Tool: Markdown Converter -----
server.registerTool(
  "convert_markdown",
  {
    title: "Markdown Converter",
    description:
      "Convert HTML to clean Markdown, or Markdown to HTML. " +
      "Use HTML→Markdown when you've fetched a web page and need readable text for an LLM — strips tags, preserves headings, lists, code blocks, links, and tables. " +
      "Use Markdown→HTML when rendering content in a web context.",
    inputSchema: {
      content: z.string().describe("The content to convert"),
      from: z.enum(["html", "markdown"]).describe("Input format"),
      to: z.enum(["html", "markdown"]).describe("Output format"),
    },
  },
  async ({ content, from, to }) => {
    const result = await callToolApi("markdown-converter", { content, from, to });
    const data = result as any;
    return {
      content: [{ type: "text" as const, text: data.result?.output || "" }],
    };
  }
);

// ----- Tool: URL Metadata -----
server.registerTool(
  "fetch_url_metadata",
  {
    title: "URL Metadata",
    description:
      "Fetch a URL and extract its metadata: title, description, Open Graph tags (og:image, og:type), " +
      "Twitter card tags, favicon, canonical URL, author, and publish date. " +
      "Use to enrich links with context or understand what a page is about without reading the full content.",
    inputSchema: {
      url: z.string().url().describe("The URL to fetch metadata from"),
      timeout: z.number().default(8000).describe("Request timeout in milliseconds (default 8000)"),
    },
  },
  async ({ url, timeout }) => {
    const result = await callToolApi("url-metadata", { url, timeout });
    const data = result as any;
    const r = data.result;

    if (r.error) {
      return { content: [{ type: "text" as const, text: `Error fetching ${url}: ${r.error}` }] };
    }

    const m = r.metadata;
    const lines = [
      `**URL:** ${r.finalUrl}`,
      `**Title:** ${m?.title || "—"}`,
      `**Description:** ${m?.description || "—"}`,
      `**Author:** ${m?.author || "—"}`,
      `**Published:** ${m?.publishedTime || "—"}`,
      `**Favicon:** ${m?.favicon || "—"}`,
      `**Canonical:** ${m?.canonical || "—"}`,
    ];

    if (m?.og && Object.keys(m.og).length > 0) {
      lines.push("", "**Open Graph:**");
      for (const [k, v] of Object.entries(m.og)) {
        lines.push(`  og:${k}: ${v}`);
      }
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Token Counter -----
server.registerTool(
  "count_tokens",
  {
    title: "Token Counter",
    description:
      "Count tokens for any text across multiple LLM models and get per-model cost estimates. " +
      "Use before sending text to an LLM to check context window usage or compare costs across models. " +
      "Supports GPT-4o, GPT-4, GPT-3.5-turbo, Claude 3.5 Sonnet, Claude 3 Opus, and 10+ more.",
    inputSchema: {
      text: z.string().describe("The text to count tokens for"),
      models: z
        .array(z.string())
        .default(["gpt-4o", "claude-3-5-sonnet"])
        .describe("Models to count tokens for"),
    },
  },
  async ({ text, models }) => {
    const result = await callToolApi("token-counter", { text, models });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**Characters:** ${r.characterCount.toLocaleString()}`,
      `**Words:** ${r.wordCount.toLocaleString()}`,
      "",
      "**Token counts:**",
    ];

    for (const [model, info] of Object.entries(r.results) as any) {
      const approx = info.approximate ? " (approx)" : "";
      const cost = info.estimatedCost
        ? ` | input ~$${info.estimatedCost.input} / output ~$${info.estimatedCost.output}`
        : "";
      lines.push(`  ${model}: **${info.tokens.toLocaleString()} tokens**${approx}${cost}`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: CSV to JSON -----
server.registerTool(
  "csv_to_json",
  {
    title: "CSV to JSON",
    description:
      "Convert CSV data to typed JSON. Auto-detects delimiters, uses the first row as headers, " +
      "and casts values to proper types (numbers, booleans, nulls). " +
      "Use when processing spreadsheet exports or any CSV-formatted data.",
    inputSchema: {
      csv: z.string().describe("The CSV content to convert"),
      delimiter: z.enum(["auto", ",", ";", "\t", "|"]).default("auto").describe("Column delimiter"),
      hasHeader: z.boolean().default(true).describe("Whether the first row contains column names"),
      typeCast: z.boolean().default(true).describe("Auto-convert values to proper types"),
      limit: z.number().optional().describe("Max rows to return"),
    },
  },
  async ({ csv, delimiter, hasHeader, typeCast, limit }) => {
    const result = await callToolApi("csv-to-json", { csv, delimiter, hasHeader, typeCast, limit, skipEmptyRows: true });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**Rows:** ${r.rowCount}${r.truncated ? ` (truncated from ${r.totalRows})` : ""}`,
      `**Columns:** ${r.columnCount} — ${r.headers.join(", ")}`,
      `**Detected delimiter:** ${r.detectedDelimiter || delimiter}`,
      "",
      "**Column types:**",
      ...Object.entries(r.columnTypes || {}).map(([k, v]) => `  ${k}: ${v}`),
      "",
      "**Data (first 3 rows):**",
      "```json",
      JSON.stringify(r.rows.slice(0, 3), null, 2),
      "```",
      r.rows.length > 3 ? `\n...and ${r.rows.length - 3} more rows` : "",
    ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Address Normalizer -----
server.registerTool(
  "normalize_address",
  {
    title: "Address Normalizer",
    description:
      "Normalize a US mailing address to USPS standard format. " +
      "Expands abbreviations (st→ST, ave→AVE), standardizes directionals, converts state names to codes. " +
      "Returns parsed components and a confidence score (high/medium/low).",
    inputSchema: {
      address: z.string().describe("The US address to normalize"),
      includeComponents: z.boolean().default(true).describe("Include parsed address components in response"),
    },
  },
  async ({ address, includeComponents }) => {
    const result = await callToolApi("address-normalizer", { address, includeComponents });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**Original:** ${r.original}`,
      `**Normalized:** ${r.normalized}`,
      `**Confidence:** ${r.confidence}`,
    ];

    if (r.components && includeComponents) {
      lines.push("", "**Components:**");
      for (const [k, v] of Object.entries(r.components)) {
        if (v) lines.push(`  ${k}: ${v}`);
      }
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Color Palette -----
server.registerTool(
  "generate_color_palette",
  {
    title: "Color Palette Generator",
    description:
      "Generate a color palette from a description, mood, industry, or hex seed color. " +
      "Accepts moods (calm, energetic, luxurious), industries (fintech, healthcare, fashion), " +
      "nature themes (sunset, ocean, forest), or a specific hex color. " +
      "Returns hex/RGB/HSL values, WCAG accessibility scores, and CSS custom properties.",
    inputSchema: {
      description: z.string().describe("Description of the desired palette (e.g. 'calm fintech blue', 'sunset', '#3B82F6')"),
      count: z.number().int().min(2).max(10).default(5).describe("Number of colors (2-10)"),
      format: z.enum(["hex", "rgb", "hsl", "all"]).default("all").describe("Color format in output"),
      includeShades: z.boolean().default(false).describe("Include light/dark shades for each color"),
    },
  },
  async ({ description, count, format, includeShades }) => {
    const result = await callToolApi("color-palette", { description, count, format, includeShades });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**Palette:** ${r.paletteName} — ${r.paletteLabel}`,
      `**Swatches:** ${r.swatches}`,
      "",
      "**Colors:**",
      ...r.colors.map((c: any) =>
        `  ${c.index}. ${c.hex}${c.rgb ? ` | ${c.rgb}` : ""}${c.hsl ? ` | ${c.hsl}` : ""} | on-white: ${c.wcag.gradeOnWhite} | on-black: ${c.wcag.gradeOnBlack}`
      ),
      "",
      "**CSS:**",
      "```css",
      r.css,
      "```",
    ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Image Metadata Stripper -----
server.registerTool(
  "strip_image_metadata",
  {
    title: "Image Metadata Stripper",
    description:
      "Strip EXIF, GPS, IPTC, XMP, and ICC metadata from an image for privacy. " +
      "Use before uploading or sharing images to remove sensitive embedded data like GPS coordinates, " +
      "camera model, timestamps, and editing history. " +
      "Accepts base64-encoded JPEG, PNG, WebP, or TIFF. Returns cleaned base64 image with a removal report.",
    inputSchema: {
      image: z.string().describe("Base64-encoded image (JPEG, PNG, WebP, TIFF). No data URI prefix."),
      format: z.enum(["jpeg", "png", "webp", "preserve"]).default("preserve").describe("Output format ('preserve' keeps original)"),
      quality: z.number().int().min(1).max(100).default(90).describe("Quality for lossy formats (1-100)"),
    },
  },
  async ({ image, format, quality }) => {
    const result = await callToolApi("image-metadata-stripper", { image, format, quality });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**Metadata stripped:** ${r.metadataStripped ? "Yes" : "No (no metadata found)"}`,
      r.strippedFields.length > 0 ? `**Removed:** ${r.strippedFields.join(", ")}` : "",
      "",
      `**Original:** ${(r.original.sizeBytes / 1024).toFixed(1)} KB | ${r.original.width}×${r.original.height} | ${r.original.format}`,
      `**Output:** ${(r.output.sizeBytes / 1024).toFixed(1)} KB | format: ${r.outputFormat}`,
      `**Size reduction:** ${r.output.reductionBytes > 0 ? `${(r.output.reductionBytes / 1024).toFixed(1)} KB (${r.output.reductionPercent}%)` : "none"}`,
      "",
      "_Cleaned image returned as base64 in the API response. Use the SDK or raw API to access the image data._",
    ].filter(Boolean);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Discover Tools -----
server.registerTool(
  "list_tools",
  {
    title: "List Available Tools",
    description:
      "List all tools available in the Agent Toolbelt API catalog, including descriptions and pricing.",
    inputSchema: {},
  },
  async () => {
    const url = `${API_BASE_URL}/api/tools/catalog`;
    const response = await fetch(url);
    const data = (await response.json()) as any;

    const lines: string[] = [];
    lines.push(`Agent Toolbelt — ${data.count} tools available:\n`);

    for (const tool of data.tools || []) {
      lines.push(`**${tool.name}** (v${tool.version})`);
      lines.push(`  ${tool.description}`);
      if (tool.metadata?.pricing) {
        lines.push(`  Pricing: ${tool.metadata.pricing}`);
      }
      lines.push(`  Endpoint: POST ${tool.endpoint}`);
      lines.push("");
    }

    return {
      content: [
        {
          type: "text" as const,
          text: lines.join("\n"),
        },
      ],
    };
  }
);

// ----- Resource: API Documentation -----
server.registerResource(
  "api-docs",
  "toolbelt://docs",
  {
    title: "Agent Toolbelt API Documentation",
    description: "Full API documentation for the Agent Toolbelt service",
  },
  async (uri) => {
    const url = `${API_BASE_URL}/api/docs`;
    const response = await fetch(url);
    const docs = await response.json();

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(docs, null, 2),
        },
      ],
    };
  }
);

// ----- Prompt: Schema Generation Workflow -----
server.registerPrompt(
  "generate-data-model",
  {
    title: "Generate Data Model",
    description:
      "Guided workflow for creating a data model schema from a description",
    argsSchema: {
      entity: z.string().describe("The entity to model (e.g., 'user', 'order', 'product')"),
      context: z
        .string()
        .optional()
        .describe("Additional context about the data model requirements"),
    },
  },
  ({ entity, context }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `I need a complete data model for a "${entity}" entity.`,
            context ? `Context: ${context}` : "",
            "",
            "Please:",
            "1. Use the generate_schema tool to create a JSON Schema for this entity",
            "2. Then generate the TypeScript interface version",
            "3. Then generate the Zod validation schema version",
            "4. Provide a brief summary of the fields and their purposes",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      },
    ],
  })
);

// ----- Prompt: Extract & Analyze -----
server.registerPrompt(
  "extract-and-analyze",
  {
    title: "Extract & Analyze Text",
    description:
      "Extract all structured data from text and provide analysis",
    argsSchema: {
      text: z.string().describe("The text to analyze"),
    },
  },
  ({ text }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Please analyze the following text by extracting all structured data from it.",
            "",
            "Use the extract_from_text tool with all relevant extractors (emails, urls, phone_numbers, dates, currencies, addresses, names).",
            "",
            `Text to analyze:\n\`\`\`\n${text}\n\`\`\``,
            "",
            "After extraction, provide a summary of what was found and any notable patterns.",
          ].join("\n"),
        },
      },
    ],
  })
);

// ----- Connect via stdio transport -----
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol messages)
  console.error("Agent Toolbelt MCP server started");
  console.error(`  API: ${API_BASE_URL}`);
  console.error(`  Key: ${API_KEY ? API_KEY.slice(0, 12) + "..." : "not set"}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
