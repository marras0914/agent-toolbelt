const DEFAULT_BASE_URL = "https://agent-toolbelt-production.up.railway.app";

export interface AgentToolbeltOptions {
  apiKey: string;
  baseUrl?: string;
}

// ----- Result types -----
export interface ToolResponse<T> {
  success: boolean;
  tool: string;
  version: string;
  durationMs: number;
  result: T;
}

export interface SchemaGeneratorResult {
  schema: object | string;
  format: "json_schema" | "zod" | "typescript";
}

export interface TextExtractorResult {
  extracted: Record<string, string[]>;
  summary: { totalItemsFound: number; byType: Record<string, number> };
}

export interface TokenCountResult {
  characterCount: number;
  wordCount: number;
  results: Record<string, {
    tokens: number;
    encoding: string;
    approximate: boolean;
    estimatedCost?: { input: number; output: number; currency: string };
  }>;
  supportedModels: string[];
}

export interface CsvToJsonResult {
  success: boolean;
  rows: Record<string, unknown>[];
  headers: string[];
  rowCount: number;
  totalRows: number;
  columnCount: number;
  columnTypes: Record<string, string>;
  detectedDelimiter?: string;
  truncated?: boolean;
}

export interface MarkdownConverterResult {
  output: string;
  from: string;
  to: string;
  inputLength: number;
  outputLength: number;
}

export interface UrlMetadataResult {
  url: string;
  finalUrl: string;
  statusCode: number | null;
  error?: string;
  metadata: {
    title: string | null;
    description: string | null;
    favicon: string | null;
    canonical: string | null;
    author: string | null;
    themeColor: string | null;
    publishedTime: string | null;
    modifiedTime: string | null;
    og: Record<string, string>;
    twitter: Record<string, string>;
  } | null;
}

export interface RegexBuilderResult {
  pattern: string;
  flags: string;
  regexLiteral: string;
  description: string;
  category: string;
  codeSnippets: { javascript: string; python: string; typescript: string };
  testResults?: Array<{ input: string; matched: boolean; matches: string[] }>;
}

export interface CronBuilderResult {
  expression: string;
  humanReadable: string;
  timezone: string;
  fields: Record<string, string>;
  nextRuns: string[];
  warnings: string[];
}

export interface AddressNormalizerResult {
  original: string;
  normalized: string;
  confidence: "high" | "medium" | "low";
  components?: {
    streetNumber?: string;
    preDirectional?: string;
    streetName?: string;
    streetType?: string;
    postDirectional?: string;
    secondaryUnit?: string;
    secondaryNumber?: string;
    city?: string;
    state?: string;
    zip?: string;
    zip4?: string;
  };
}

export interface ColorPaletteResult {
  paletteName: string;
  paletteLabel: string;
  colors: Array<{
    index: number;
    name: string;
    hex: string;
    rgb?: string;
    hsl?: string;
    wcag: { contrastOnWhite: number; contrastOnBlack: number; gradeOnWhite: string; gradeOnBlack: string };
  }>;
  css: string;
  swatches: string;
}

// ----- Client -----
export class AgentToolbelt {
  private apiKey: string;
  private baseUrl: string;

  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL }: AgentToolbeltOptions) {
    if (!apiKey) throw new Error("AgentToolbelt: apiKey is required");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async call<T>(tool: string, input: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/tools/${tool}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(
        `AgentToolbelt API error (${res.status}): ${err.message || err.error || res.statusText}`
      );
    }

    const data = await res.json() as ToolResponse<T>;
    return data.result;
  }

  /** Generate JSON Schema, TypeScript, or Zod from a plain-English description */
  schemaGenerator(input: {
    description: string;
    format?: "json_schema" | "zod" | "typescript";
    strict?: boolean;
  }): Promise<SchemaGeneratorResult> {
    return this.call("schema-generator", input);
  }

  /** Extract emails, URLs, phone numbers, dates, currencies, addresses, or names from text */
  textExtractor(input: {
    text: string;
    extractors: Array<"emails" | "urls" | "phone_numbers" | "dates" | "currencies" | "addresses" | "names" | "json_blocks">;
    deduplicate?: boolean;
  }): Promise<TextExtractorResult> {
    return this.call("text-extractor", input);
  }

  /** Count tokens across multiple LLM models with cost estimates */
  tokenCounter(input: {
    text: string;
    models?: string[];
  }): Promise<TokenCountResult> {
    return this.call("token-counter", input);
  }

  /** Convert CSV to typed JSON with auto-delimiter detection and type casting */
  csvToJson(input: {
    csv: string;
    delimiter?: "auto" | "," | ";" | "\t" | "|";
    hasHeader?: boolean;
    typeCast?: boolean;
    limit?: number;
    skipEmptyRows?: boolean;
  }): Promise<CsvToJsonResult> {
    return this.call("csv-to-json", input);
  }

  /** Convert HTML to Markdown or Markdown to HTML */
  markdownConverter(input: {
    content: string;
    from: "html" | "markdown";
    to: "html" | "markdown";
    options?: { headingStyle?: "atx" | "setext"; bulletListMarker?: "-" | "*" | "+"; codeBlockStyle?: "fenced" | "indented" };
  }): Promise<MarkdownConverterResult> {
    return this.call("markdown-converter", input);
  }

  /** Fetch a URL and extract title, description, OG tags, favicon, and more */
  urlMetadata(input: {
    url: string;
    timeout?: number;
  }): Promise<UrlMetadataResult> {
    return this.call("url-metadata", input);
  }

  /** Build and test regular expressions from natural language */
  regexBuilder(input: {
    description: string;
    testStrings?: string[];
    flags?: string;
  }): Promise<RegexBuilderResult> {
    return this.call("regex-builder", input);
  }

  /** Convert a natural language schedule to a cron expression */
  cronBuilder(input: {
    description: string;
    timezone?: string;
  }): Promise<CronBuilderResult> {
    return this.call("cron-builder", input);
  }

  /** Normalize a US address to USPS format with component parsing */
  addressNormalizer(input: {
    address: string;
    includeComponents?: boolean;
  }): Promise<AddressNormalizerResult> {
    return this.call("address-normalizer", input);
  }

  /** Generate a color palette from a description or hex color */
  colorPalette(input: {
    description: string;
    count?: number;
    format?: "hex" | "rgb" | "hsl" | "all";
    includeShades?: boolean;
  }): Promise<ColorPaletteResult> {
    return this.call("color-palette", input);
  }
}
