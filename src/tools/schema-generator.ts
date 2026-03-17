import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  description: z
    .string()
    .min(1)
    .describe("Natural language description of the data structure you need a schema for"),
  format: z
    .enum(["json_schema", "zod", "typescript"])
    .default("json_schema")
    .describe("Output format for the generated schema"),
  strict: z
    .boolean()
    .default(true)
    .describe("Whether to require all fields (no optionals)"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Handler -----
async function handler(input: Input) {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const formatInstructions: Record<string, string> = {
    json_schema: `Return a valid JSON Schema (draft 2020-12) object. Include $schema, type, properties (each with type and description), required array, and additionalProperties: false.`,
    typescript: `Return a TypeScript interface named GeneratedSchema. Include JSDoc comments on each field. Use proper TypeScript types (string, number, boolean, string[], etc.).`,
    zod: `Return a complete Zod schema. Start with import { z } from "zod"; then define const generatedSchema = z.object({...}). Use .optional() for optional fields and include inline comments.`,
  };

  const strictInstruction = input.strict
    ? "Make all fields required."
    : "Mark clearly optional fields as optional.";

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system:
      "You are a schema generation expert. Generate accurate, idiomatic schemas from natural language descriptions. " +
      "Return only the schema code or object — no explanation, no markdown fences, no extra text.",
    messages: [
      {
        role: "user",
        content: `Generate a schema for: "${input.description}"

Format: ${input.format}
${strictInstruction}
${formatInstructions[input.format]}`,
      },
    ],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text.trim() : "";

  // Strip markdown fences if the model included them
  const schema = raw.replace(/^```(?:json|typescript|ts|zod)?\n?/m, "").replace(/\n?```$/m, "").trim();

  // For json_schema, parse into an object
  if (input.format === "json_schema") {
    try {
      return { schema: JSON.parse(schema), format: input.format };
    } catch {
      return { schema, format: input.format };
    }
  }

  return { schema, format: input.format };
}

// ----- Register -----
const schemaGeneratorTool: ToolDefinition<Input> = {
  name: "schema-generator",
  description: "Generate JSON Schema, TypeScript interfaces, or Zod schemas from natural language descriptions. Useful for agents that need to validate data structures on the fly.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["schema", "validation", "code-generation"],
    pricing: "$0.001 per call",
    exampleInput: {
      description: "A user profile with name, email, and signup date",
      format: "json_schema",
      strict: true,
    },
  },
};

registerTool(schemaGeneratorTool);

export default schemaGeneratorTool;
