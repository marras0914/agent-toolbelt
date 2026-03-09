import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  url: z.string().url().describe("The URL to fetch and summarize"),
  mode: z
    .enum(["summary", "content", "both"])
    .default("both")
    .describe(
      "'summary' returns only the AI-generated summary. " +
      "'content' returns only the cleaned markdown content. " +
      "'both' returns the full markdown and a summary."
    ),
  focus: z
    .string()
    .optional()
    .describe(
      "Optional: what to focus the summary on. E.g. 'pricing information', 'technical architecture', 'key arguments'. " +
      "If omitted, the summary covers the full content."
    ),
  maxContentLength: z
    .number()
    .int()
    .min(500)
    .max(50_000)
    .default(20_000)
    .describe("Maximum characters of page content to process (500–50000, default 20000)"),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(20000)
    .default(10000)
    .describe("Request timeout in milliseconds (default 10000)"),
});

type Input = z.infer<typeof inputSchema>;

// ----- HTML → clean markdown -----
function htmlToMarkdown(html: string, baseUrl: string): string {
  const $ = cheerio.load(html);

  // Remove noise elements
  $("script, style, nav, footer, header, aside, .sidebar, .ads, .advertisement, .cookie-banner, .popup, noscript, iframe, form").remove();
  $("[class*='nav'], [class*='menu'], [class*='footer'], [class*='header'], [class*='sidebar'], [class*='ad-'], [id*='nav'], [id*='menu'], [id*='footer'], [id*='header'], [id*='sidebar']").remove();

  // Extract main content — prefer semantic content containers
  const mainSelectors = ["main", "article", '[role="main"]', ".post-content", ".article-body", ".content", ".entry-content", "#content", "#main"];
  let contentHtml = "";
  for (const sel of mainSelectors) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 200) {
      contentHtml = el.html() || "";
      break;
    }
  }
  // Fallback to body
  if (!contentHtml) contentHtml = $("body").html() || html;

  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  td.addRule("absoluteLinks", {
    filter: "a",
    replacement: (content, node: any) => {
      const href = node.getAttribute("href");
      if (!href || !content.trim()) return content;
      try {
        const abs = new URL(href, baseUrl).href;
        return `[${content}](${abs})`;
      } catch {
        return content;
      }
    },
  });

  return td.turndown(contentHtml).trim();
}

// ----- Handler -----
async function handler(input: Input) {
  const { url, mode, focus, maxContentLength, timeout } = input;

  // Fetch the page
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let html: string;
  let finalUrl = url;
  let statusCode: number;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AgentToolbelt/1.0; +https://agent-toolbelt-production.up.railway.app)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
    });

    statusCode = response.status;
    finalUrl = response.url || url;

    if (!response.ok) {
      return { url, finalUrl, statusCode, error: `HTTP ${statusCode}`, content: null, summary: null };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return { url, finalUrl, statusCode, error: "Not an HTML page — only HTML URLs are supported", content: null, summary: null };
    }

    html = await response.text();
  } catch (err: any) {
    return {
      url,
      finalUrl: url,
      statusCode: null,
      error: err.name === "AbortError" ? "Request timed out" : err.message,
      content: null,
      summary: null,
    };
  } finally {
    clearTimeout(timer);
  }

  // Convert to clean markdown
  let markdown = htmlToMarkdown(html, finalUrl);

  // Truncate if needed
  const truncated = markdown.length > maxContentLength;
  if (truncated) {
    markdown = markdown.slice(0, maxContentLength) + "\n\n[... content truncated]";
  }

  const result: Record<string, unknown> = {
    url,
    finalUrl,
    statusCode,
    truncated,
    characterCount: markdown.length,
  };

  if (mode === "content" || mode === "both") {
    result.content = markdown;
  }

  if (mode === "summary" || mode === "both") {
    if (!config.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const client = new Anthropic({ apiKey: config.anthropicApiKey });

    const focusInstruction = focus
      ? `Focus specifically on: ${focus}. Ignore content unrelated to this focus.`
      : "Provide a comprehensive summary covering the main points.";

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system:
        "You are a concise summarizer. Extract and summarize the key information from web page content. " +
        "Respond with valid JSON only.",
      messages: [
        {
          role: "user",
          content: `Summarize the following web page content. ${focusInstruction}

Return a JSON object with this exact structure:
{
  "title": "<page title or topic>",
  "summary": "<2-4 sentence summary of the main content>",
  "keyPoints": ["<key point 1>", "<key point 2>", "<up to 5 key points>"],
  "contentType": "<one of: article, documentation, product-page, blog-post, news, landing-page, other>"
}

Page content:
${markdown}`,
        },
      ],
    });

    const rawText = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonText = rawText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

    try {
      result.summary = JSON.parse(jsonText);
    } catch {
      result.summary = { title: null, summary: rawText, keyPoints: [], contentType: "unknown" };
    }
  }

  return result;
}

// ----- Register -----
const webSummarizerTool: ToolDefinition<Input> = {
  name: "web-summarizer",
  description:
    "Fetch a URL, extract the main content as clean Markdown, and generate an AI summary with key points. " +
    "Strips navigation, ads, and boilerplate. Ideal for agents doing research, content ingestion, or competitive analysis. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["web", "scraping", "summarization", "markdown", "research", "llm"],
    pricing: "$0.02 per call",
    pricingMicros: 20_000,
    exampleInput: {
      url: "https://docs.anthropic.com/en/docs/about-claude/models/overview",
      mode: "both",
      focus: "latest model names and context window sizes",
      maxContentLength: 20000,
      timeout: 10000,
    },
  },
};

registerTool(webSummarizerTool);

export default webSummarizerTool;
