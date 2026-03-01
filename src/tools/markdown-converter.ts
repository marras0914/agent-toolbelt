import { z } from "zod";
import TurndownService from "turndown";
import { marked } from "marked";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  content: z.string().min(1).max(100_000).describe("The content to convert"),
  from: z.enum(["html", "markdown"]).describe("Input format"),
  to: z.enum(["html", "markdown"]).describe("Output format"),
  options: z
    .object({
      headingStyle: z
        .enum(["atx", "setext"])
        .optional()
        .describe("Markdown heading style: atx (#) or setext (underline)"),
      bulletListMarker: z
        .enum(["-", "*", "+"])
        .optional()
        .describe("Bullet list marker character"),
      codeBlockStyle: z
        .enum(["fenced", "indented"])
        .optional()
        .describe("Code block style in markdown output"),
    })
    .optional(),
});

type Input = z.infer<typeof inputSchema>;

// ----- Handler -----
async function handler(input: Input) {
  const { content, from, to, options } = input;

  if (from === to) {
    return { output: content, from, to, note: "Input and output formats are the same" };
  }

  let output: string;

  if (from === "html" && to === "markdown") {
    const td = new TurndownService({
      headingStyle: options?.headingStyle ?? "atx",
      bulletListMarker: options?.bulletListMarker ?? "-",
      codeBlockStyle: options?.codeBlockStyle ?? "fenced",
    });
    output = td.turndown(content);
  } else {
    // markdown → html
    output = await marked(content, { async: true });
  }

  return {
    output,
    from,
    to,
    inputLength: content.length,
    outputLength: output.length,
  };
}

// ----- Register -----
const markdownConverterTool: ToolDefinition<Input> = {
  name: "markdown-converter",
  description:
    "Convert between HTML and Markdown. HTML → Markdown for clean agent-readable content; Markdown → HTML for rendering. Handles headings, lists, links, code blocks, tables, and more.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["markdown", "html", "conversion", "formatting", "content"],
    pricing: "$0.0005 per call",
    exampleInput: {
      content: "<h1>Hello World</h1><p>This is a <strong>bold</strong> paragraph with a <a href='https://example.com'>link</a>.</p><ul><li>Item one</li><li>Item two</li></ul>",
      from: "html",
      to: "markdown",
      options: { headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" },
    },
  },
};

registerTool(markdownConverterTool);

export default markdownConverterTool;
