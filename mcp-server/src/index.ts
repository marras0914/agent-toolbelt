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
const API_BASE_URL = process.env.AGENT_TOOLBELT_URL || "https://agent-toolbelt-production.up.railway.app";
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

// ----- Server factory (creates a fresh instance with all tools registered) -----
function createServer() {
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

// ----- Tool: Document Comparator -----
server.registerTool(
  "compare_documents",
  {
    title: "Document Comparator",
    description:
      "Compare two versions of a document and produce a semantic diff with additions, deletions, and modifications. " +
      "Works with contracts, READMEs, policies, essays, or any text. Powered by Claude.",
    inputSchema: {
      original: z.string().describe("The original version of the document"),
      revised: z.string().describe("The revised version of the document"),
      mode: z.enum(["summary", "detailed", "structured"]).default("structured").describe("Output format"),
      context: z.string().optional().describe("Document type for more relevant analysis"),
    },
  },
  async ({ original, revised, mode, context }) => {
    const result = await callToolApi("document-comparator", { original, revised, mode, context });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**Document Comparison** — ${r.overallAssessment?.toUpperCase()} changes`,
      `**Summary:** ${r.summary}`,
      `**Stats:** +${r.stats?.additions} additions, -${r.stats?.deletions} deletions, ~${r.stats?.modifications} modifications`,
    ];

    if (mode === "structured") {
      if (r.additions?.length) {
        lines.push("", "**Additions:**");
        r.additions.forEach((a: any) => lines.push(`  [${a.significance}] ${a.description}\n  > ${a.content}`));
      }
      if (r.deletions?.length) {
        lines.push("", "**Deletions:**");
        r.deletions.forEach((d: any) => lines.push(`  [${d.significance}] ${d.description}\n  > ${d.content}`));
      }
      if (r.modifications?.length) {
        lines.push("", "**Modifications:**");
        r.modifications.forEach((m: any) => lines.push(`  [${m.significance}] ${m.description}\n  Before: ${m.before}\n  After:  ${m.after}`));
      }
    } else if (mode === "detailed" && r.analysis) {
      lines.push("", "**Analysis:**", r.analysis);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Contract Clause Extractor -----
server.registerTool(
  "extract_contract_clauses",
  {
    title: "Contract Clause Extractor",
    description:
      "Extract key clauses from a contract — parties, payment terms, termination, liability, IP ownership, confidentiality, and more. " +
      "Optionally flags risky or one-sided clauses with severity ratings. Powered by Claude.",
    inputSchema: {
      contract: z.string().describe("The contract or legal document text"),
      clauses: z
        .array(z.enum(["parties", "dates", "payment_terms", "termination", "liability", "ip_ownership", "confidentiality", "governing_law", "penalties", "renewal", "warranties", "dispute_resolution"]))
        .default(["parties", "dates", "payment_terms", "termination", "liability", "ip_ownership", "confidentiality", "governing_law", "penalties", "renewal", "warranties", "dispute_resolution"])
        .describe("Which clause types to extract"),
      flagRisks: z.boolean().default(true).describe("Flag risky or unfavorable clauses"),
    },
  },
  async ({ contract, clauses, flagRisks }) => {
    const result = await callToolApi("contract-clause-extractor", { contract, clauses, flagRisks });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**${r.contractType}**`,
      `**Clauses found:** ${r.clausesFound} of ${r.clausesRequested} requested`,
    ];

    if (r.clauses) {
      lines.push("", "**Extracted Clauses:**");
      for (const [key, val] of Object.entries(r.clauses) as any) {
        if (val.found) {
          lines.push(`\n**${key.replace(/_/g, " ").toUpperCase()}**`);
          lines.push(`  ${val.summary}`);
          if (val.excerpt) lines.push(`  _"${val.excerpt}"_`);
        }
      }
    }

    if (flagRisks && r.riskFlags?.length) {
      lines.push("", "**⚠ Risk Flags:**");
      r.riskFlags.forEach((f: any) =>
        lines.push(`  [${f.severity.toUpperCase()}] ${f.clause.replace(/_/g, " ")}: ${f.issue}\n  > "${f.excerpt}"`)
      );
      if (r.riskSummary) lines.push("", `**Risk Summary:** ${r.riskSummary}`);
    } else if (flagRisks) {
      lines.push("", "**No significant risk flags found.**");
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Prompt Optimizer -----
server.registerTool(
  "optimize_prompt",
  {
    title: "Prompt Optimizer",
    description:
      "Analyze and improve an LLM prompt. Scores clarity, specificity, structure, and completeness. " +
      "Returns an optimized rewrite with a summary of what changed and why. Powered by Claude.",
    inputSchema: {
      prompt: z.string().describe("The LLM prompt to analyze and/or improve"),
      model: z.string().default("gpt-4o").describe("Target model (e.g. 'gpt-4o', 'claude-3-5-sonnet')"),
      task: z.string().optional().describe("What this prompt is trying to accomplish"),
      mode: z
        .enum(["improve", "analyze", "both"])
        .default("both")
        .describe("'both' returns analysis + improved prompt; 'analyze' scores only; 'improve' rewrites only"),
    },
  },
  async ({ prompt, model, task, mode }) => {
    const result = await callToolApi("prompt-optimizer", { prompt, model, task, mode });
    const data = result as any;
    const r = data.result;

    const lines: string[] = [`**Prompt Optimizer** (targeting: ${r.model})`];

    if (r.scores) {
      lines.push(
        "",
        "**Scores:**",
        `  Clarity:      ${r.scores.clarity}/10`,
        `  Specificity:  ${r.scores.specificity}/10`,
        `  Structure:    ${r.scores.structure}/10`,
        `  Completeness: ${r.scores.completeness}/10`,
        `  Overall:      ${r.scores.overall}/10`
      );
    }

    if (r.issues?.length) {
      lines.push("", "**Issues found:**", ...r.issues.map((i: string) => `  - ${i}`));
    }

    if (r.suggestions?.length) {
      lines.push("", "**Suggestions:**", ...r.suggestions.map((s: string) => `  - ${s}`));
    }

    if (r.improvedPrompt) {
      lines.push("", "**Improved prompt:**", "```", r.improvedPrompt, "```");
    }

    if (r.changesSummary?.length) {
      lines.push("", "**Changes made:**", ...r.changesSummary.map((c: string) => `  - ${c}`));
    }

    lines.push(
      "",
      `**Token stats:** original: ${r.tokenStats.original}${r.tokenStats.improved ? ` → improved: ${r.tokenStats.improved} (${r.tokenStats.delta > 0 ? "+" : ""}${r.tokenStats.delta})` : ""}`
    );

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Meeting Action Items -----
server.registerTool(
  "extract_meeting_action_items",
  {
    title: "Meeting Action Items",
    description:
      "Extract structured action items, decisions, and a summary from meeting notes or transcripts. " +
      "Identifies task owners, deadlines, and priorities. Powered by Claude.",
    inputSchema: {
      notes: z.string().describe("Meeting notes or transcript"),
      format: z
        .enum(["action_items_only", "full"])
        .default("full")
        .describe("'full' includes summary and decisions; 'action_items_only' returns just the task list"),
      participants: z
        .array(z.string())
        .optional()
        .describe("Known participant names to help with owner attribution"),
    },
  },
  async ({ notes, format, participants }) => {
    const result = await callToolApi("meeting-action-items", { notes, format, participants });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**${r.meetingTitle}**`,
      `**Action Items (${r.actionItemCount}):**`,
      "",
      ...r.actionItems.map((item: any) => {
        const deadline = item.deadline ? ` | due: ${item.deadline}` : "";
        const context = item.context ? `\n     _${item.context}_` : "";
        return `${item.id}. [${item.priority.toUpperCase()}] **${item.owner}** — ${item.task}${deadline}${context}`;
      }),
    ];

    if (format === "full" && r.summary) {
      lines.push("", `**Summary:** ${r.summary}`);
    }

    if (format === "full" && r.decisions?.length) {
      lines.push("", "**Decisions:**", ...r.decisions.map((d: string) => `- ${d}`));
    }

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

// ----- Tool: API Response Mocker -----
server.registerTool(
  "mock_api_response",
  {
    title: "API Response Mocker",
    description:
      "Generate realistic mock API responses from a JSON Schema. " +
      "Supports nested objects, arrays, string formats (email, uuid, date-time, url), " +
      "field-name heuristics, enums, and min/max constraints. " +
      "Set seed for reproducible output. Returns 1–100 records.",
    inputSchema: {
      schema: z.record(z.unknown()).describe("JSON Schema object describing the shape of the mock data"),
      count: z.number().int().min(1).max(100).default(1).describe("Number of mock records to generate (1–100)"),
      seed: z.number().int().optional().describe("Optional seed for reproducible output"),
    },
  },
  async ({ schema, count, seed }) => {
    const result = await callToolApi("api-response-mocker", { schema, count, seed });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**Generated ${r.count} mock record${r.count !== 1 ? "s" : ""}** (schema type: ${r.schema.type})`,
      "",
      "```json",
      JSON.stringify(r.data, null, 2),
      "```",
    ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Dependency Auditor -----
server.registerTool(
  "audit_dependencies",
  {
    title: "Dependency Auditor",
    description:
      "Audit npm and PyPI packages for known CVEs using the OSV database (GitHub Dependabot's source). " +
      "Pass packages directly or paste package.json / requirements.txt content.",
    inputSchema: {
      packages: z.array(z.object({
        name: z.string(),
        version: z.string().optional(),
        ecosystem: z.enum(["npm", "pypi"]),
      })).optional().describe("Packages to audit"),
      manifest: z.string().optional().describe("Raw package.json or requirements.txt"),
      manifestType: z.enum(["package.json", "requirements.txt", "auto"]).default("auto"),
      includeDevDependencies: z.boolean().default(true),
      minSeverity: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).default("LOW"),
    },
  },
  async ({ packages, manifest, manifestType, includeDevDependencies, minSeverity }) => {
    const result = await callToolApi("dependency-auditor", { packages, manifest, manifestType, includeDevDependencies, minSeverity });
    const data = result as any;
    const r = data.result;

    const riskEmoji: Record<string, string> = { NONE: "✅", MODERATE: "⚠️", HIGH: "🔴", CRITICAL: "🚨" };
    const sevEmoji: Record<string, string> = { LOW: "🔵", MODERATE: "🟡", HIGH: "🔴", CRITICAL: "🚨" };

    const lines = [
      `${riskEmoji[r.summary.riskLevel] || "⚠️"} **Risk Level: ${r.summary.riskLevel}**`,
      `**${r.summary.vulnerablePackages}/${r.summary.totalPackages} packages vulnerable** | ${r.summary.totalVulnerabilities} total vulnerabilities`,
      Object.keys(r.summary.bySeverity).length > 0
        ? `**By severity:** ${Object.entries(r.summary.bySeverity).map(([s, n]) => `${s}: ${n}`).join(", ")}`
        : "",
      "",
    ];

    for (const pkg of r.vulnerable) {
      lines.push(`**${pkg.package}${pkg.version ? `@${pkg.version}` : ""} [${pkg.highestSeverity}]**`);
      for (const v of pkg.vulnerabilities) {
        const cve = v.cves[0] ? ` (${v.cves[0]})` : "";
        const fix = v.fixedIn.length > 0 ? ` → fix: ${v.fixedIn[0]}` : "";
        lines.push(`  ${sevEmoji[v.severity] || "•"} ${v.severity} ${v.id}${cve}${fix}`);
        lines.push(`    ${v.summary}`);
        lines.push(`    ${v.url}`);
      }
      lines.push("");
    }

    if (r.clean.length > 0) {
      lines.push(`✅ **Clean packages:** ${r.clean.join(", ")}`);
    }

    return { content: [{ type: "text" as const, text: lines.filter(Boolean).join("\n") }] };
  }
);

// ----- Tool: Earnings Analysis -----
server.registerTool(
  "earnings_analysis",
  {
    title: "Earnings Analysis",
    description:
      "Analyze a stock's earnings track record — EPS beat/miss history, revenue trend, and what it means " +
      "for long-term investors. Returns verdict, beat rate, revenue trajectory, last quarter summary, and what to watch next.",
    inputSchema: {
      ticker: z.string().describe("Stock ticker symbol (e.g. NVDA, AAPL, MSFT)"),
    },
  },
  async ({ ticker }) => {
    const result = await callToolApi("earnings-analysis", { ticker });
    const data = result as any;
    const r = data.result;

    const verdictIcon = {
      strong_compounder: "★ STRONG COMPOUNDER",
      consistent: "✓ CONSISTENT",
      mixed: "~ MIXED",
      volatile: "⚡ VOLATILE",
      deteriorating: "▼ DETERIORATING",
    }[r.verdict as string] || r.verdict;

    const lines = [
      `**${r.ticker}** Earnings — ${verdictIcon}`,
      `_${r.oneLiner}_`,
      "",
      `**Beat Rate:** ${r.beatRate}`,
      `**Revenue Trend:** ${r.revenueTrend}`,
      "",
      `**Revenue Read:** ${r.revenueRead}`,
      `**EPS Read:** ${r.epsRead}`,
      "",
      `**Last Quarter:** ${r.lastQuarterSummary}`,
      "",
      `**Long-Term Read:** ${r.longTermRead}`,
      `**Watch For Next:** ${r.watchForNext}`,
    ];

    if (r.upcomingDate) lines.push("", `_Next earnings: ${r.upcomingDate}_`);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Insider Signal -----
server.registerTool(
  "insider_signal",
  {
    title: "Insider Signal",
    description:
      "Interpret insider trading activity for any stock. Classifies open-market purchases vs. routine sales/awards, " +
      "identifies cluster buying, and explains whether the activity is a meaningful signal. " +
      "Returns signal strength (strong_buy → strong_sell) and a plain-English verdict.",
    inputSchema: {
      ticker: z.string().describe("Stock ticker symbol (e.g. NVDA, AAPL, MSFT)"),
    },
  },
  async ({ ticker }) => {
    const result = await callToolApi("insider-signal", { ticker });
    const data = result as any;
    const r = data.result;

    const signalIcon = {
      strong_buy: "▲▲ STRONG BUY SIGNAL",
      buy: "▲ BUY SIGNAL",
      neutral: "◆ NEUTRAL",
      sell: "▼ SELL SIGNAL",
      strong_sell: "▼▼ STRONG SELL SIGNAL",
    }[r.signal as string] || r.signal;

    const lines = [
      `**${r.ticker}** Insider Activity — ${signalIcon} (${r.confidence} confidence)`,
      `_${r.oneLiner}_`,
      "",
      r.interpretation,
      "",
      `**Buying:** ${r.buyingPressure}`,
      `**Selling:** ${r.sellingPressure}`,
    ];

    if (r.notableTrades?.length) {
      lines.push("", "**Notable Trades:**");
      for (const t of r.notableTrades) {
        lines.push(`- **${t.who}** — ${t.action}`, `  _${t.significance}_`);
      }
    }

    lines.push("", `**Verdict:** ${r.verdict}`);

    const d = r.rawData;
    lines.push("", `_${d.transactionsAnalyzed} transactions analyzed | ${d.openMarketPurchases} purchases, ${d.openMarketSales} sales, ${d.routineTransactions} routine_`);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Valuation Snapshot -----
server.registerTool(
  "valuation_snapshot",
  {
    title: "Valuation Snapshot",
    description:
      "Assess whether a stock is cheap, fair, or expensive. Pulls P/E, P/S, EV/EBITDA, FCF yield, ROE, and margins, " +
      "then synthesizes them into a verdict with a specific buy zone price level.",
    inputSchema: {
      ticker: z.string().describe("Stock ticker symbol (e.g. NVDA, AAPL, MSFT)"),
    },
  },
  async ({ ticker }) => {
    const result = await callToolApi("valuation-snapshot", { ticker });
    const data = result as any;
    const r = data.result;

    const verdictIcon = {
      very_cheap: "🟢🟢 VERY CHEAP",
      cheap: "🟢 CHEAP",
      fair: "🟡 FAIR VALUE",
      expensive: "🟠 EXPENSIVE",
      very_expensive: "🔴 VERY EXPENSIVE",
    }[r.verdict as string] || r.verdict;

    const m = r.metrics;
    const metricParts: string[] = [];
    if (m.peRatio) metricParts.push(`P/E: ${m.peRatio}x`);
    if (m.psRatio) metricParts.push(`P/S: ${m.psRatio}x`);
    if (m.evEbitda) metricParts.push(`EV/EBITDA: ${m.evEbitda}x`);
    if (m.fcfYield) metricParts.push(`FCF Yield: ${m.fcfYield}%`);
    if (m.roe) metricParts.push(`ROE: ${m.roe}%`);
    if (m.netMargin) metricParts.push(`Net Margin: ${m.netMargin}%`);

    const lines = [
      `**${r.companyName} (${r.ticker})** — ${verdictIcon}`,
      `_${r.oneLiner}_`,
      "",
      metricParts.length ? `_${metricParts.join(" | ")}_` : "",
      "",
      `**Valuation:** ${r.multiplesSummary}`,
      `**P/E Read:** ${r.peRead}`,
      `**Quality:** ${r.qualityRead}`,
      `**Growth Context:** ${r.growthContext}`,
      "",
      `**Buy Zone:** ${r.buyZone}`,
      `**Bottom Line:** ${r.bottomLine}`,
    ].filter(Boolean);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Bear vs Bull -----
server.registerTool(
  "bear_vs_bull",
  {
    title: "Bear vs Bull",
    description:
      "Generate a structured bull vs. bear case for any stock. Steelmans both sides with specific data, " +
      "then delivers a net verdict and the key question investors need to answer before buying.",
    inputSchema: {
      ticker: z.string().describe("Stock ticker symbol (e.g. NVDA, AAPL, MSFT)"),
    },
  },
  async ({ ticker }) => {
    const result = await callToolApi("bear-vs-bull", { ticker });
    const data = result as any;
    const r = data.result;

    const verdictIcon = {
      bull_wins: "▲ BULL WINS",
      slight_bull: "↗ SLIGHT BULL EDGE",
      too_close: "◆ TOO CLOSE TO CALL",
      slight_bear: "↘ SLIGHT BEAR EDGE",
      bear_wins: "▼ BEAR WINS",
    }[r.verdict as string] || r.verdict;

    const lines = [
      `**${r.companyName} (${r.ticker})** — ${verdictIcon}`,
      "",
      "## 🟢 Bull Case",
      ...r.bullCase.map((c: any, i: number) => `**${i + 1}. ${c.argument}**\n${c.detail}`),
      "",
      "## 🔴 Bear Case",
      ...r.bearCase.map((c: any, i: number) => `**${i + 1}. ${c.argument}**\n${c.detail}`),
      "",
      `**Verdict:** ${r.verdictRationale}`,
      "",
      `**Key Question:** ${r.keyDebate}`,
      `**Best For:** ${r.forInvestorsWho}`,
    ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Stock Thesis -----
server.registerTool(
  "stock_thesis",
  {
    title: "Stock Investment Thesis",
    description:
      "Generate a long-term investment thesis for any stock. Pulls live financials, valuation metrics, " +
      "insider trades, and analyst ratings, then synthesizes them into a Motley Fool-style research note. " +
      "Returns a bullish/neutral/bearish verdict, thesis paragraphs, key strengths, risks, and valuation read. " +
      "Use when you want fundamental analysis of a stock for long-term investing.",
    inputSchema: {
      ticker: z.string().describe("Stock ticker symbol (e.g. NVDA, AAPL, MSFT)"),
      timeHorizon: z
        .enum(["1-2 years", "3-5 years", "5+ years"])
        .default("3-5 years")
        .describe("Investment time horizon"),
    },
  },
  async ({ ticker, timeHorizon }) => {
    const result = await callToolApi("stock-thesis", { ticker, timeHorizon });
    const data = result as any;
    const r = data.result;

    const verdictIcon = r.verdict === "bullish" ? "▲ BULLISH" : r.verdict === "bearish" ? "▼ BEARISH" : "◆ NEUTRAL";

    const lines = [
      `**${r.companyName} (${r.ticker})** — ${verdictIcon}`,
      `_${r.oneLiner}_`,
      "",
      r.thesis,
      "",
      "**Key Strengths:**",
      ...r.keyStrengths.map((s: string) => `- ${s}`),
      "",
      "**Key Risks:**",
      ...r.keyRisks.map((s: string) => `- ${s}`),
      "",
      `**Valuation:** ${r.valuation}`,
      `**Insider Activity:** ${r.insiderRead}`,
      `**Analyst Consensus:** ${r.analystRead}`,
      `**Watch For:** ${r.watchFor}`,
    ];

    if (r.dataSnapshot) {
      const d = r.dataSnapshot;
      const parts: string[] = [];
      if (d.currentPrice) parts.push(`Price: $${d.currentPrice}`);
      if (d.marketCapBillions) parts.push(`Market Cap: $${d.marketCapBillions}B`);
      if (d.peRatio) parts.push(`P/E: ${d.peRatio}`);
      if (d.analystConsensus) {
        const c = d.analystConsensus;
        parts.push(`Analysts: ${c.buy}B / ${c.hold}H / ${c.sell}S`);
      }
      if (parts.length) lines.push("", `_${parts.join(" | ")}_`);
    }

    lines.push("", `_Time horizon: ${r.timeHorizon} | Generated ${new Date(r.generatedAt).toLocaleDateString()}_`);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ----- Tool: Context Window Packer -----
server.registerTool(
  "pack_context_window",
  {
    title: "Context Window Packer",
    description:
      "Pack content chunks into a token budget for an LLM context window. " +
      "Selects the best subset of chunks that fits within the token limit using priority, greedy, or balanced strategies. " +
      "Use when you have more content than fits in the context window.",
    inputSchema: {
      chunks: z.array(z.object({
        text: z.string().describe("Content of this chunk"),
        label: z.string().optional().describe("Optional identifier"),
        priority: z.number().min(0).max(10).default(5).describe("Importance 0–10"),
        metadata: z.record(z.unknown()).optional(),
      })).describe("Content chunks to pack"),
      tokenBudget: z.number().int().describe("Maximum tokens allowed"),
      model: z.string().default("gpt-4o").describe("Target model for tokenization"),
      strategy: z.enum(["priority", "greedy", "balanced"]).default("priority").describe("Packing strategy"),
      separator: z.string().default("\n\n").describe("Text between chunks"),
      systemPrompt: z.string().optional().describe("System prompt to reserve tokens for"),
      reserveForOutput: z.number().int().min(0).default(0).describe("Tokens to reserve for output"),
    },
  },
  async ({ chunks, tokenBudget, model, strategy, separator, systemPrompt, reserveForOutput }) => {
    const result = await callToolApi("context-window-packer", { chunks, tokenBudget, model, strategy, separator, systemPrompt, reserveForOutput });
    const data = result as any;
    const r = data.result;

    const lines = [
      `**Packed ${r.stats.chunksPacked}/${r.stats.chunksTotal} chunks** | ${r.stats.tokensUsed}/${r.stats.effectiveBudget} tokens (${r.stats.utilizationPercent}% utilized)`,
      `**Strategy:** ${r.strategy} | **Model:** ${r.model}`,
      r.stats.systemPromptTokens > 0 ? `**System prompt:** ${r.stats.systemPromptTokens} tokens reserved` : "",
      r.stats.reservedForOutput > 0 ? `**Output reservation:** ${r.stats.reservedForOutput} tokens` : "",
      "",
      r.packed.length > 0 ? `**Packed chunks:**\n${r.packed.map((p: any) => `- ${p.label || `chunk[${p.originalIndex}]`} (priority ${p.priority}, ${p.tokens} tokens)`).join("\n")}` : "",
      r.excluded.length > 0 ? `\n**Excluded chunks:**\n${r.excluded.map((e: any) => `- ${e.label || `chunk[${e.originalIndex}]`} (${e.tokens} tokens, ${e.reason})`).join("\n")}` : "",
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

  return server;
}

// ----- Smithery sandbox export (allows capability scanning without real credentials) -----
export function createSandboxServer() {
  return createServer();
}

// ----- Connect via stdio transport -----
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol messages)
  console.error("Agent Toolbelt MCP server started");
  console.error(`  API: ${API_BASE_URL}`);
  console.error(`  Key: ${API_KEY ? API_KEY.slice(0, 12) + "..." : "not set"}`);
}

// Only run when executed directly (not when imported for scanning).
// If import.meta.url is accessible, we're in ESM context (running as binary) — always run.
// If it throws, we're being imported in CJS context (e.g. Smithery scanner) — skip.
let _isMain = false;
try {
  _isMain = !!import.meta.url;
} catch (_) {
  _isMain = false;
}
if (_isMain) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
