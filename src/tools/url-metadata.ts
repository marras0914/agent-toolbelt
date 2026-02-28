import { z } from "zod";
import * as cheerio from "cheerio";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  url: z.string().url().describe("The URL to fetch metadata from"),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(15000)
    .default(8000)
    .describe("Request timeout in milliseconds (1000-15000, default 8000)"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Helper -----
function absoluteUrl(base: string, href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

// ----- Handler -----
async function handler(input: Input) {
  const { url, timeout } = input;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let html: string;
  let finalUrl = url;
  let statusCode: number;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AgentToolbelt/1.0; +https://agent-toolbelt-production.up.railway.app)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
    });

    statusCode = response.status;
    finalUrl = response.url || url;

    if (!response.ok) {
      return {
        url,
        finalUrl,
        statusCode,
        error: `HTTP ${statusCode}`,
        metadata: null,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return {
        url,
        finalUrl,
        statusCode,
        contentType,
        error: "Not an HTML page",
        metadata: null,
      };
    }

    html = await response.text();
  } catch (err: any) {
    return {
      url,
      finalUrl: url,
      statusCode: null,
      error: err.name === "AbortError" ? "Request timed out" : err.message,
      metadata: null,
    };
  } finally {
    clearTimeout(timer);
  }

  const $ = cheerio.load(html);

  // Core metadata
  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("title").text().trim() ||
    null;

  const description =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    null;

  // OG tags
  const og: Record<string, string> = {};
  $("meta[property^='og:']").each((_, el) => {
    const prop = $(el).attr("property")?.replace("og:", "");
    const content = $(el).attr("content");
    if (prop && content) og[prop] = content;
  });

  // Twitter card tags
  const twitter: Record<string, string> = {};
  $("meta[name^='twitter:']").each((_, el) => {
    const name = $(el).attr("name")?.replace("twitter:", "");
    const content = $(el).attr("content");
    if (name && content) twitter[name] = content;
  });

  // Favicon
  const faviconHref =
    $('link[rel="icon"]').attr("href") ||
    $('link[rel="shortcut icon"]').attr("href") ||
    $('link[rel="apple-touch-icon"]').attr("href") ||
    "/favicon.ico";
  const favicon = absoluteUrl(finalUrl, faviconHref);

  // Canonical URL
  const canonical = absoluteUrl(finalUrl, $('link[rel="canonical"]').attr("href"));

  // Theme color
  const themeColor = $('meta[name="theme-color"]').attr("content") || null;

  // Author
  const author =
    $('meta[name="author"]').attr("content") ||
    $('meta[property="article:author"]').attr("content") ||
    null;

  // Published / modified dates
  const publishedTime =
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[name="date"]').attr("content") ||
    null;
  const modifiedTime =
    $('meta[property="article:modified_time"]').attr("content") || null;

  return {
    url,
    finalUrl,
    statusCode,
    metadata: {
      title,
      description,
      favicon,
      canonical,
      author,
      themeColor,
      publishedTime,
      modifiedTime,
      og,
      twitter,
    },
  };
}

// ----- Register -----
const urlMetadataTool: ToolDefinition<Input> = {
  name: "url-metadata",
  description:
    "Fetch a URL and extract metadata: title, description, Open Graph tags, Twitter card tags, favicon, canonical URL, author, and publish dates. Ideal for agents that need to enrich links with context.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["url", "metadata", "og-tags", "scraping", "enrichment"],
    pricing: "$0.001 per call",
    exampleInput: {
      url: "https://github.com/anthropics/anthropic-sdk-python",
      timeout: 8000,
    },
  },
};

registerTool(urlMetadataTool);

export default urlMetadataTool;
