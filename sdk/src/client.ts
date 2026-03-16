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

interface BrandKitColor {
  name: string;
  hex: string;
  hsl: string;
  rgb: string;
  values: { h: number; s: number; l: number };
}

interface BrandKitAccessibilityCheck {
  ratio: number;
  rating: string;
}

export interface BrandKitResult {
  brand: string;
  industry?: string;
  vibes?: string[];
  palette?: {
    primary: BrandKitColor;
    secondary: BrandKitColor;
    accent: BrandKitColor;
    background: BrandKitColor;
    surface: BrandKitColor;
    text: BrandKitColor;
    textMuted: BrandKitColor;
    success: BrandKitColor;
    warning: BrandKitColor;
    error: BrandKitColor;
  };
  typography?: {
    display: { family: string; weights: string[]; usage: string };
    body: { family: string; weights: string[]; usage: string };
    scale: Record<string, string>;
    googleFontsUrl: string;
  };
  accessibility?: {
    primaryOnBackground: BrandKitAccessibilityCheck;
    textOnBackground: BrandKitAccessibilityCheck;
    primaryOnWhite: BrandKitAccessibilityCheck;
  };
  tokens?: Record<string, unknown>;
  css?: string;
  tailwindConfig?: string;
  fonts?: { display: string; body: string; googleFontsUrl?: string };
}

export interface DocumentComparatorResult {
  mode: string;
  summary: string;
  overallAssessment: "minor" | "moderate" | "major";
  analysis?: string;
  additions?: Array<{ description: string; content: string; significance: "high" | "medium" | "low" }>;
  deletions?: Array<{ description: string; content: string; significance: "high" | "medium" | "low" }>;
  modifications?: Array<{ description: string; before: string; after: string; significance: "high" | "medium" | "low" }>;
  stats: { additions: number; deletions: number; modifications: number };
}

export interface ContractClauseResult {
  found: boolean;
  summary?: string;
  excerpt?: string | null;
  details?: Record<string, unknown>;
}

export interface ContractRiskFlag {
  clause: string;
  issue: string;
  severity: "high" | "medium" | "low";
  excerpt: string;
}

export interface ContractClauseExtractorResult {
  contractType: string;
  clausesRequested: number;
  clausesFound: number;
  clauses: Record<string, ContractClauseResult>;
  riskFlags?: ContractRiskFlag[];
  riskSummary?: string;
}

export interface PromptOptimizerResult {
  mode: "improve" | "analyze" | "both";
  model: string;
  scores?: {
    clarity: number;
    specificity: number;
    structure: number;
    completeness: number;
    overall: number;
  };
  issues?: string[];
  suggestions?: string[];
  improvedPrompt?: string;
  changesSummary?: string[];
  tokenStats: {
    original: number;
    improved?: number;
    delta?: number;
  };
}

export interface MeetingActionItem {
  id: number;
  owner: string;
  task: string;
  deadline?: string;
  priority: "high" | "medium" | "low";
  context?: string;
}

export interface MeetingActionItemsResult {
  meetingTitle: string;
  actionItems: MeetingActionItem[];
  actionItemCount: number;
  summary?: string;
  decisions?: string[];
}

export interface ImageMetadataStripperResult {
  image: string;
  outputFormat: string;
  original: {
    sizeBytes: number;
    format?: string;
    width?: number;
    height?: number;
    channels?: number;
    hasExif?: boolean;
    hasIcc?: boolean;
    hasIptc?: boolean;
    hasXmp?: boolean;
    orientation?: number;
    density?: number;
  };
  output: {
    sizeBytes: number;
    reductionBytes: number;
    reductionPercent: number;
  };
  metadataStripped: boolean;
  strippedFields: string[];
}

export interface ApiResponseMockerResult {
  data: unknown;
  count: number;
  schema: { type: string; title?: string };
}

export interface DependencyVulnerability {
  id: string;
  cves: string[];
  summary: string;
  severity: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | "UNKNOWN";
  fixedIn: string[];
  published?: string;
  url: string;
  cweIds?: string[];
}

export interface DependencyAuditorResult {
  vulnerable: Array<{
    package: string;
    version?: string;
    ecosystem: string;
    vulnerabilities: DependencyVulnerability[];
    highestSeverity: string;
  }>;
  clean: string[];
  summary: {
    totalPackages: number;
    vulnerablePackages: number;
    cleanPackages: number;
    totalVulnerabilities: number;
    bySeverity: Record<string, number>;
    riskLevel: "NONE" | "MODERATE" | "HIGH" | "CRITICAL";
  };
}

export interface ContextWindowPackerResult {
  packed: Array<{
    label?: string;
    priority: number;
    tokens: number;
    text: string;
    metadata?: Record<string, unknown>;
    originalIndex: number;
  }>;
  excluded: Array<{
    label?: string;
    priority: number;
    tokens: number;
    text: string;
    metadata?: Record<string, unknown>;
    originalIndex: number;
    reason: "chunk_too_large" | "budget_exhausted";
  }>;
  packedText: string;
  stats: {
    tokenBudget: number;
    systemPromptTokens: number;
    reservedForOutput: number;
    effectiveBudget: number;
    tokensUsed: number;
    tokensRemaining: number;
    chunksTotal: number;
    chunksPacked: number;
    chunksExcluded: number;
    utilizationPercent: number;
  };
  model: string;
  strategy: string;
}

export interface WebSummarizerResult {
  url: string;
  finalUrl: string;
  statusCode: number | null;
  truncated: boolean;
  characterCount: number;
  content?: string;
  summary?: {
    title: string | null;
    summary: string;
    keyPoints: string[];
    contentType: string;
  };
  error?: string;
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

  /** Compare two document versions and produce a semantic diff */
  documentComparator(input: {
    original: string;
    revised: string;
    mode?: "summary" | "detailed" | "structured";
    context?: string;
  }): Promise<DocumentComparatorResult> {
    return this.call("document-comparator", input);
  }

  /** Extract and analyze key clauses from a contract or legal document */
  contractClauseExtractor(input: {
    contract: string;
    clauses?: Array<"parties" | "dates" | "payment_terms" | "termination" | "liability" | "ip_ownership" | "confidentiality" | "governing_law" | "penalties" | "renewal" | "warranties" | "dispute_resolution">;
    flagRisks?: boolean;
  }): Promise<ContractClauseExtractorResult> {
    return this.call("contract-clause-extractor", input);
  }

  /** Analyze and improve an LLM prompt — scores clarity, specificity, structure, and completeness */
  promptOptimizer(input: {
    prompt: string;
    model?: string;
    task?: string;
    mode?: "improve" | "analyze" | "both";
  }): Promise<PromptOptimizerResult> {
    return this.call("prompt-optimizer", input);
  }

  /** Extract action items, decisions, and summary from meeting notes or transcripts */
  meetingActionItems(input: {
    notes: string;
    format?: "action_items_only" | "full";
    participants?: string[];
  }): Promise<MeetingActionItemsResult> {
    return this.call("meeting-action-items", input);
  }

  /** Strip EXIF, GPS, ICC, IPTC, and XMP metadata from a base64-encoded image */
  imageMetadataStripper(input: {
    image: string;
    format?: "jpeg" | "png" | "webp" | "preserve";
    quality?: number;
  }): Promise<ImageMetadataStripperResult> {
    return this.call("image-metadata-stripper", input);
  }

  /** Generate a full brand kit — color palette, typography, CSS/Tailwind tokens */
  brandKit(input: {
    name: string;
    industry?: string;
    vibe?: string[];
    targetAudience?: string;
    format?: "full" | "tokens" | "css" | "tailwind";
  }): Promise<BrandKitResult> {
    return this.call("brand-kit", input);
  }

  /** Generate realistic mock API responses from a JSON Schema */
  apiResponseMocker(input: {
    schema: Record<string, unknown>;
    count?: number;
    seed?: number;
  }): Promise<ApiResponseMockerResult> {
    return this.call("api-response-mocker", input);
  }

  /** Audit npm and PyPI packages for known CVEs using the OSV database */
  dependencyAuditor(input: {
    packages?: Array<{ name: string; version?: string; ecosystem: "npm" | "pypi" }>;
    manifest?: string;
    manifestType?: "package.json" | "requirements.txt" | "auto";
    includeDevDependencies?: boolean;
    minSeverity?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  }): Promise<DependencyAuditorResult> {
    return this.call("dependency-auditor", input);
  }

  /** Fetch a URL, extract main content as clean Markdown, and generate an AI summary with key points */
  webSummarizer(input: {
    url: string;
    mode?: "summary" | "content" | "both";
    focus?: string;
    maxContentLength?: number;
    timeout?: number;
  }): Promise<WebSummarizerResult> {
    return this.call("web-summarizer", input);
  }

  /** Pack content chunks into a token budget for LLM context windows */
  contextWindowPacker(input: {
    chunks: Array<{ text: string; label?: string; priority?: number; metadata?: Record<string, unknown> }>;
    tokenBudget: number;
    model?: string;
    strategy?: "priority" | "greedy" | "balanced";
    separator?: string;
    systemPrompt?: string;
    reserveForOutput?: number;
  }): Promise<ContextWindowPackerResult> {
    return this.call("context-window-packer", input);
  }
}
