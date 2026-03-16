import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { AgentToolbelt } from "./client.js";

/**
 * Create a set of LangChain DynamicStructuredTools from an AgentToolbelt client.
 *
 * @example
 * ```ts
 * import { AgentToolbelt } from "agent-toolbelt";
 * import { createLangChainTools } from "agent-toolbelt/langchain";
 * import { createReactAgent } from "@langchain/langgraph/prebuilt";
 * import { ChatOpenAI } from "@langchain/openai";
 *
 * const client = new AgentToolbelt({ apiKey: process.env.AGENT_TOOLBELT_KEY! });
 * const tools = createLangChainTools(client);
 *
 * const agent = createReactAgent({ llm: new ChatOpenAI({ model: "gpt-4o" }), tools });
 * ```
 */
export function createLangChainTools(client: AgentToolbelt): DynamicStructuredTool[] {
  return [
    // ---- Text Extractor ----
    new DynamicStructuredTool({
      name: "extract_from_text",
      description:
        "Extract structured data from raw, unstructured text. " +
        "Use this when you need to pull out specific types of data from a document, email, web page, or any text — " +
        "such as all email addresses, phone numbers, dates, URLs, currencies, addresses, or names. " +
        "Returns a structured JSON object with arrays of matched items per type. " +
        "Example use cases: parsing contact info from a scraped page, finding all dates in a contract, extracting prices from a product description.",
      schema: z.object({
        text: z.string().describe("The raw text to extract data from"),
        extractors: z
          .array(z.enum(["emails", "urls", "phone_numbers", "dates", "currencies", "addresses", "names", "json_blocks"]))
          .describe("Which types of data to extract. Pick all that apply."),
        deduplicate: z.boolean().default(true).describe("Remove duplicate results"),
      }),
      func: async ({ text, extractors, deduplicate }) => {
        const result = await client.textExtractor({ text, extractors, deduplicate });
        return JSON.stringify(result);
      },
    }),

    // ---- Token Counter ----
    new DynamicStructuredTool({
      name: "count_tokens",
      description:
        "Count how many tokens a piece of text will consume in different LLM models, and estimate the API cost. " +
        "Use this before sending large text to an LLM to check if it fits in the context window, " +
        "to compare costs across models, or to decide whether to chunk or summarize content. " +
        "Supports GPT-4o, GPT-4, GPT-3.5-turbo, Claude 3.5 Sonnet, Claude 3 Opus, and 10+ other models. " +
        "Returns exact token counts for OpenAI models and close approximations for Claude.",
      schema: z.object({
        text: z.string().describe("The text to count tokens for"),
        models: z
          .array(z.string())
          .default(["gpt-4o", "claude-3-5-sonnet"])
          .describe("Models to count tokens for. Defaults to gpt-4o and claude-3-5-sonnet."),
      }),
      func: async ({ text, models }) => {
        const result = await client.tokenCounter({ text, models });
        return JSON.stringify(result);
      },
    }),

    // ---- Schema Generator ----
    new DynamicStructuredTool({
      name: "generate_schema",
      description:
        "Generate a JSON Schema, TypeScript interface, or Zod validation schema from a plain English description of a data structure. " +
        "Use this when you need to define a data model, validate incoming data, or create type definitions without writing them by hand. " +
        "Example: 'a user profile with name, email, and subscription tier' → full JSON Schema with required fields and types. " +
        "Ideal for agents that dynamically create or validate data structures based on user requirements.",
      schema: z.object({
        description: z.string().describe("Plain English description of the data structure. Be specific about field names and types."),
        format: z
          .enum(["json_schema", "typescript", "zod"])
          .default("json_schema")
          .describe("Output format: json_schema (standard), typescript (TS interface), or zod (Zod validator)"),
        strict: z.boolean().default(true).describe("If true, all fields are required"),
      }),
      func: async ({ description, format, strict }) => {
        const result = await client.schemaGenerator({ description, format, strict });
        return typeof result.schema === "string"
          ? result.schema
          : JSON.stringify(result.schema, null, 2);
      },
    }),

    // ---- CSV to JSON ----
    new DynamicStructuredTool({
      name: "csv_to_json",
      description:
        "Convert CSV data into typed JSON. " +
        "Use this when you have spreadsheet data, database exports, or any CSV-formatted content that needs to be processed as structured JSON. " +
        "Automatically detects delimiters (comma, tab, semicolon, pipe), converts numbers to actual numbers, " +
        "'true'/'false' to booleans, empty cells to null, and infers column types. " +
        "Returns an array of row objects with column names as keys.",
      schema: z.object({
        csv: z.string().describe("The CSV content to convert"),
        delimiter: z.enum(["auto", ",", ";", "\t", "|"]).default("auto").describe("Column delimiter (auto-detects by default)"),
        hasHeader: z.boolean().default(true).describe("Whether the first row contains column names"),
        typeCast: z.boolean().default(true).describe("Auto-convert values to numbers, booleans, and nulls"),
        limit: z.number().optional().describe("Max rows to return (useful for large files)"),
      }),
      func: async ({ csv, delimiter, hasHeader, typeCast, limit }) => {
        const result = await client.csvToJson({ csv, delimiter, hasHeader, typeCast, limit, skipEmptyRows: true });
        return JSON.stringify(result);
      },
    }),

    // ---- Markdown Converter ----
    new DynamicStructuredTool({
      name: "convert_markdown",
      description:
        "Convert HTML to clean Markdown, or Markdown to HTML. " +
        "Use HTML→Markdown when you've fetched a web page and need clean, readable text for an LLM — " +
        "stripping HTML tags, preserving structure (headings, lists, code blocks, links, tables). " +
        "Use Markdown→HTML when you need to render content in a web context. " +
        "Handles complex HTML including nested lists, code blocks with language hints, tables, and inline formatting.",
      schema: z.object({
        content: z.string().describe("The content to convert"),
        from: z.enum(["html", "markdown"]).describe("Input format"),
        to: z.enum(["html", "markdown"]).describe("Output format"),
      }),
      func: async ({ content, from, to }) => {
        const result = await client.markdownConverter({ content, from, to });
        return result.output;
      },
    }),

    // ---- URL Metadata ----
    new DynamicStructuredTool({
      name: "fetch_url_metadata",
      description:
        "Fetch a URL and extract its metadata: page title, meta description, Open Graph tags (og:image, og:type, og:site_name), " +
        "Twitter card tags, favicon URL, canonical URL, author, and publish/modified dates. " +
        "Use this to enrich a URL with context before presenting it to a user, " +
        "to get the main image or description for a link preview, " +
        "or to quickly understand what a page is about without reading the full content.",
      schema: z.object({
        url: z.string().url().describe("The URL to fetch metadata from"),
        timeout: z.number().default(8000).describe("Request timeout in ms (default 8000)"),
      }),
      func: async ({ url, timeout }) => {
        const result = await client.urlMetadata({ url, timeout });
        return JSON.stringify(result);
      },
    }),

    // ---- Regex Builder ----
    new DynamicStructuredTool({
      name: "build_regex",
      description:
        "Build and test a regular expression from a natural language description. " +
        "Use this when you need a regex pattern for validation, parsing, or data extraction — " +
        "without needing to write or debug regex syntax yourself. " +
        "Supports 20+ common patterns: email, URL, phone number, date, IP address, hex color, UUID, slug, JWT, credit card, SSN, and more. " +
        "Optionally test the pattern against provided strings. Returns ready-to-use code in JavaScript, Python, and TypeScript.",
      schema: z.object({
        description: z.string().describe("What the regex should match (e.g. 'valid email addresses', 'US phone numbers with area code')"),
        testStrings: z.array(z.string()).optional().describe("Optional strings to test the regex against"),
        flags: z.string().default("g").describe("Regex flags (default: 'g' for global)"),
      }),
      func: async ({ description, testStrings, flags }) => {
        const result = await client.regexBuilder({ description, testStrings, flags });
        return JSON.stringify(result);
      },
    }),

    // ---- Cron Builder ----
    new DynamicStructuredTool({
      name: "build_cron",
      description:
        "Convert a natural language schedule description into a cron expression. " +
        "Use this when setting up scheduled jobs, tasks, or automation workflows. " +
        "Examples: 'every weekday at 9am EST', 'first Monday of every month at noon', 'every 15 minutes', 'twice a day at 8am and 6pm'. " +
        "Returns the cron expression, a human-readable confirmation of the schedule, and the next 5 run times.",
      schema: z.object({
        description: z.string().describe("Natural language schedule description"),
        timezone: z.string().default("UTC").describe("Timezone (e.g. 'America/New_York', 'Europe/London')"),
      }),
      func: async ({ description, timezone }) => {
        const result = await client.cronBuilder({ description, timezone });
        return JSON.stringify(result);
      },
    }),

    // ---- Address Normalizer ----
    new DynamicStructuredTool({
      name: "normalize_address",
      description:
        "Normalize a US mailing address to USPS standard format. " +
        "Use this when cleaning address data for mailing, geocoding, deduplication, or database storage. " +
        "Expands abbreviations (st→ST, ave→AVE, apt→APT), standardizes directionals (north→N), " +
        "converts state names to abbreviations (California→CA), and parses the address into components. " +
        "Returns a confidence score (high/medium/low) indicating parse quality.",
      schema: z.object({
        address: z.string().describe("The address to normalize (e.g. '123 main st apt 4b, springfield, il 62701')"),
        includeComponents: z.boolean().default(true).describe("Include parsed components (street number, city, state, ZIP, etc.)"),
      }),
      func: async ({ address, includeComponents }) => {
        const result = await client.addressNormalizer({ address, includeComponents });
        return JSON.stringify(result);
      },
    }),

    // ---- Color Palette ----
    new DynamicStructuredTool({
      name: "generate_color_palette",
      description:
        "Generate a color palette from a description, mood, industry, or hex color seed. " +
        "Use this for branding, UI design, or any task requiring a cohesive set of colors. " +
        "Accepts moods ('calm', 'energetic', 'luxurious'), industries ('fintech', 'healthcare', 'fashion'), " +
        "nature themes ('sunset', 'ocean', 'forest'), or a specific hex color to build around. " +
        "Returns hex/RGB/HSL values, WCAG accessibility contrast scores, and ready-to-use CSS custom properties.",
      schema: z.object({
        description: z.string().describe("Description of desired palette (e.g. 'professional fintech blue', 'warm sunset', '#3B82F6')"),
        count: z.number().int().min(2).max(10).default(5).describe("Number of colors (2-10)"),
        format: z.enum(["hex", "rgb", "hsl", "all"]).default("all").describe("Color format in output"),
      }),
      func: async ({ description, count, format }) => {
        const result = await client.colorPalette({ description, count, format });
        return JSON.stringify(result);
      },
    }),

    // ---- Document Comparator ----
    new DynamicStructuredTool({
      name: "compare_documents",
      description:
        "Compare two versions of a document and produce a semantic diff. " +
        "Use this to understand what changed between drafts, versions, or revisions of any text document — " +
        "contracts, READMEs, policies, essays, terms of service, code documentation, etc. " +
        "Returns additions, deletions, and modifications with significance ratings and an overall change assessment. " +
        "The 'structured' mode gives a categorized breakdown; 'summary' gives a quick overview; 'detailed' gives full prose analysis.",
      schema: z.object({
        original: z.string().describe("The original version of the document"),
        revised: z.string().describe("The revised version of the document"),
        mode: z
          .enum(["summary", "detailed", "structured"])
          .default("structured")
          .describe("Output format: 'structured' (categorized lists), 'detailed' (prose), 'summary' (brief overview)"),
        context: z.string().optional().describe("Document type for more relevant analysis (e.g. 'terms of service', 'employment contract')"),
      }),
      func: async ({ original, revised, mode, context }) => {
        const result = await client.documentComparator({ original, revised, mode, context });
        return JSON.stringify(result);
      },
    }),

    // ---- Contract Clause Extractor ----
    new DynamicStructuredTool({
      name: "extract_contract_clauses",
      description:
        "Extract and analyze key clauses from a contract or legal document. " +
        "Use this to quickly understand the key terms in any legal agreement — " +
        "who the parties are, payment terms, termination conditions, liability caps, IP ownership, confidentiality obligations, and more. " +
        "Optionally flags risky or one-sided clauses with severity ratings and plain-language explanations. " +
        "Ideal for contract review, due diligence, or surfacing terms that need negotiation.",
      schema: z.object({
        contract: z.string().describe("The contract or legal document text to analyze"),
        clauses: z
          .array(z.enum(["parties", "dates", "payment_terms", "termination", "liability", "ip_ownership", "confidentiality", "governing_law", "penalties", "renewal", "warranties", "dispute_resolution"]))
          .default(["parties", "dates", "payment_terms", "termination", "liability", "ip_ownership", "confidentiality", "governing_law", "penalties", "renewal", "warranties", "dispute_resolution"])
          .describe("Which clause types to extract"),
        flagRisks: z.boolean().default(true).describe("Flag clauses that may be unfavorable or risky"),
      }),
      func: async ({ contract, clauses, flagRisks }) => {
        const result = await client.contractClauseExtractor({ contract, clauses, flagRisks });
        return JSON.stringify(result);
      },
    }),

    // ---- Prompt Optimizer ----
    new DynamicStructuredTool({
      name: "optimize_prompt",
      description:
        "Analyze and improve an LLM prompt for clarity, specificity, structure, and completeness. " +
        "Use this when a prompt isn't performing well, to prepare prompts before deploying them, " +
        "or to learn what makes a good prompt for a specific model. " +
        "Returns scores (1-10) for each quality dimension, a list of issues found, " +
        "an improved rewrite, and a summary of what changed and why. " +
        "Supports targeting specific models: gpt-4o, claude-3-5-sonnet, gpt-3.5-turbo, etc.",
      schema: z.object({
        prompt: z.string().describe("The LLM prompt to analyze and/or improve"),
        model: z.string().default("gpt-4o").describe("Target model to optimize for"),
        task: z.string().optional().describe("What this prompt is trying to accomplish (helps generate targeted suggestions)"),
        mode: z
          .enum(["improve", "analyze", "both"])
          .default("both")
          .describe("'both' returns analysis + improved prompt; 'analyze' scores only; 'improve' rewrites only"),
      }),
      func: async ({ prompt, model, task, mode }) => {
        const result = await client.promptOptimizer({ prompt, model, task, mode });
        return JSON.stringify(result);
      },
    }),

    // ---- Meeting Action Items ----
    new DynamicStructuredTool({
      name: "extract_meeting_action_items",
      description:
        "Extract structured action items, key decisions, and a summary from meeting notes or transcripts. " +
        "Use this after a meeting to automatically generate a task list with owners, deadlines, and priorities. " +
        "Works with raw transcripts, bullet-point notes, or any free-form meeting text. " +
        "Returns each action item with the responsible person, what needs to be done, deadline (if mentioned), and priority level. " +
        "The 'full' format also includes a meeting summary and list of decisions made.",
      schema: z.object({
        notes: z.string().describe("Meeting notes or transcript to extract action items from"),
        format: z
          .enum(["action_items_only", "full"])
          .default("full")
          .describe("'full' includes summary and decisions; 'action_items_only' returns just the task list"),
        participants: z
          .array(z.string())
          .optional()
          .describe("Known participant names to help with owner attribution"),
      }),
      func: async ({ notes, format, participants }) => {
        const result = await client.meetingActionItems({ notes, format, participants });
        return JSON.stringify(result);
      },
    }),

    // ---- Image Metadata Stripper ----
    new DynamicStructuredTool({
      name: "strip_image_metadata",
      description:
        "Strip EXIF, GPS location, IPTC, XMP, and ICC metadata from an image for privacy protection. " +
        "Use this before uploading or sharing images to remove sensitive embedded data like GPS coordinates, " +
        "camera model, timestamps, copyright notices, and editing history. " +
        "Accepts base64-encoded JPEG, PNG, WebP, or TIFF images. " +
        "Returns the cleaned image as base64 along with a report of what was removed and the file size reduction.",
      schema: z.object({
        image: z.string().describe("Base64-encoded image data (JPEG, PNG, WebP, or TIFF). Do not include the data URI prefix."),
        format: z.enum(["jpeg", "png", "webp", "preserve"]).default("preserve").describe("Output format. 'preserve' keeps the original format."),
        quality: z.number().int().min(1).max(100).default(90).describe("Output quality for lossy formats (1-100)"),
      }),
      func: async ({ image, format, quality }) => {
        const result = await client.imageMetadataStripper({ image, format, quality });
        return JSON.stringify(result);
      },
    }),

    // ---- Brand Kit ----
    new DynamicStructuredTool({
      name: "generate_brand_kit",
      description:
        "Generate a complete brand kit from a company name, industry, and aesthetic keywords. " +
        "Use this when a user needs a full visual identity: color palette, typography pairings, and design tokens. " +
        "Powered by color psychology — maps industries to appropriate hues (fintech→blues, healthcare→greens, etc.) " +
        "and vibes to color adjustments (luxurious→desaturated darks, playful→saturated brights). " +
        "Returns Google Fonts pairings, WCAG accessibility scores, and ready-to-paste CSS custom properties or Tailwind config.",
      schema: z.object({
        name: z.string().describe("Company or brand name (e.g. 'Solaris Health', 'Bolt Finance')"),
        industry: z.string().optional().describe("Industry or sector (e.g. 'fintech', 'healthcare', 'fashion', 'saas', 'food & beverage')"),
        vibe: z.array(z.string()).optional().describe("Aesthetic keywords (e.g. ['modern', 'minimal'], ['bold', 'playful'], ['luxurious', 'elegant'])"),
        targetAudience: z.string().optional().describe("Who the brand is for (e.g. 'enterprise B2B', 'gen-z consumers')"),
        format: z.enum(["full", "tokens", "css", "tailwind"]).default("full").describe("Output format: full (everything), tokens (JSON), css (custom properties), tailwind (config)"),
      }),
      func: async ({ name, industry, vibe, targetAudience, format }) => {
        const result = await client.brandKit({ name, industry, vibe, targetAudience, format });
        return JSON.stringify(result);
      },
    }),

    // ---- API Response Mocker ----
    new DynamicStructuredTool({
      name: "mock_api_response",
      description:
        "Generate realistic mock API responses from a JSON Schema. " +
        "Use this when you need test fixtures, seed data, or sample payloads for development or testing. " +
        "Supports nested objects, arrays, string formats (email, uuid, date-time, url, phone), " +
        "field-name heuristics (a field named 'email' gets an email, 'createdAt' gets an ISO timestamp), " +
        "enums, and min/max constraints. " +
        "Set seed for reproducible output. Returns 1–100 records matching the schema.",
      schema: z.object({
        schema: z.record(z.unknown()).describe("JSON Schema object describing the shape of the mock data"),
        count: z.number().int().min(1).max(100).default(1).describe("Number of mock records to generate (1–100)"),
        seed: z.number().int().optional().describe("Optional seed for reproducible output"),
      }),
      func: async ({ schema, count, seed }) => {
        const result = await client.apiResponseMocker({ schema, count, seed });
        return JSON.stringify(result);
      },
    }),

    // ---- Context Window Packer ----
    new DynamicStructuredTool({
      name: "pack_context_window",
      description:
        "Pack content chunks into a token budget for an LLM context window. " +
        "Use this when you have more content than fits in the context window and need to select the most important pieces. " +
        "Three strategies: 'priority' (highest-priority chunks first), 'greedy' (input order, skip what doesn't fit), " +
        "'balanced' (most priority-per-token — maximizes value density). " +
        "Chunks are always returned in original input order to preserve reading flow. " +
        "Returns packed chunks, excluded chunks with reasons, the concatenated packed text, and detailed token stats.",
      schema: z.object({
        chunks: z.array(z.object({
          text: z.string().describe("Content of this chunk"),
          label: z.string().optional().describe("Optional identifier for this chunk"),
          priority: z.number().min(0).max(10).default(5).describe("Importance score 0–10 (higher = more important)"),
          metadata: z.record(z.unknown()).optional().describe("Optional passthrough metadata"),
        })).describe("Content chunks to pack"),
        tokenBudget: z.number().int().describe("Maximum tokens allowed in the output"),
        model: z.string().default("gpt-4o").describe("Target model for tokenization (e.g. 'gpt-4o', 'claude-3-5-sonnet')"),
        strategy: z.enum(["priority", "greedy", "balanced"]).default("priority").describe("Packing strategy"),
        separator: z.string().default("\n\n").describe("Text between packed chunks (counts toward budget)"),
        systemPrompt: z.string().optional().describe("System prompt to reserve tokens for (subtracted from budget)"),
        reserveForOutput: z.number().int().min(0).default(0).describe("Tokens to reserve for model output"),
      }),
      func: async ({ chunks, tokenBudget, model, strategy, separator, systemPrompt, reserveForOutput }) => {
        const result = await client.contextWindowPacker({ chunks, tokenBudget, model, strategy, separator, systemPrompt, reserveForOutput });
        return JSON.stringify(result);
      },
    }),

    // ---- Web Summarizer ----
    new DynamicStructuredTool({
      name: "summarize_web_page",
      description:
        "Fetch a URL, strip navigation/ads/boilerplate, and return clean Markdown content plus an AI-generated summary with key points. " +
        "Use this for research, content ingestion, competitive analysis, or feeding web content to an LLM without noise. " +
        "Returns the page title, a 2-4 sentence summary, up to 5 key points, and content type classification. Powered by Claude.",
      schema: z.object({
        url: z.string().url().describe("The URL to fetch and summarize"),
        mode: z.enum(["summary", "content", "both"]).default("both").describe("'summary' = AI summary only, 'content' = clean markdown only, 'both' = full content + summary"),
        focus: z.string().optional().describe("What to focus the summary on, e.g. 'pricing', 'technical architecture', 'key arguments'"),
        maxContentLength: z.number().int().min(500).max(50000).default(20000).describe("Max characters of page content to process"),
        timeout: z.number().int().min(1000).max(20000).default(10000).describe("Request timeout in milliseconds"),
      }),
      func: async ({ url, mode, focus, maxContentLength, timeout }) => {
        const result = await client.webSummarizer({ url, mode, focus, maxContentLength, timeout });
        return JSON.stringify(result);
      },
    }),

    // ---- Dependency Auditor ----
    new DynamicStructuredTool({
      name: "audit_dependencies",
      description:
        "Audit npm and PyPI packages for known security vulnerabilities using the OSV database (same source as GitHub Dependabot). " +
        "Pass a list of packages with versions, or paste raw package.json / requirements.txt content. " +
        "Returns CVE IDs, severity ratings (CRITICAL/HIGH/MODERATE/LOW), fixed versions, and advisory links per package. " +
        "Results are sorted by severity. Use this before suggesting dependency upgrades or when reviewing a project's security posture.",
      schema: z.object({
        packages: z.array(z.object({
          name: z.string().describe("Package name"),
          version: z.string().optional().describe("Version to check (e.g. '4.17.11')"),
          ecosystem: z.enum(["npm", "pypi"]).describe("Package ecosystem"),
        })).optional().describe("Packages to audit"),
        manifest: z.string().optional().describe("Raw package.json or requirements.txt content"),
        manifestType: z.enum(["package.json", "requirements.txt", "auto"]).default("auto").describe("Manifest format"),
        includeDevDependencies: z.boolean().default(true).describe("Include devDependencies from package.json"),
        minSeverity: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).default("LOW").describe("Minimum severity to include"),
      }),
      func: async ({ packages, manifest, manifestType, includeDevDependencies, minSeverity }) => {
        const result = await client.dependencyAuditor({ packages, manifest, manifestType, includeDevDependencies, minSeverity });
        return JSON.stringify(result);
      },
    }),
  ];
}
