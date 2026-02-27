import { z } from "zod";
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

// ----- Schema Generation Logic -----
// In production, this would call an LLM or use a more sophisticated parser.
// For now, it demonstrates the pattern with rule-based generation.

interface FieldDef {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

function inferFieldsFromDescription(description: string): FieldDef[] {
  const fields: FieldDef[] = [];
  const desc = description.toLowerCase();

  // Common entity patterns
  if (desc.includes("user") || desc.includes("person") || desc.includes("profile")) {
    fields.push(
      { name: "id", type: "string", description: "Unique identifier", required: true },
      { name: "name", type: "string", description: "Full name", required: true },
      { name: "email", type: "string", description: "Email address", required: true },
      { name: "createdAt", type: "string", description: "ISO 8601 creation timestamp", required: true }
    );
  }

  if (desc.includes("product") || desc.includes("item") || desc.includes("listing")) {
    fields.push(
      { name: "id", type: "string", description: "Unique identifier", required: true },
      { name: "title", type: "string", description: "Product title", required: true },
      { name: "description", type: "string", description: "Product description", required: false },
      { name: "price", type: "number", description: "Price in USD", required: true },
      { name: "currency", type: "string", description: "ISO 4217 currency code", required: true }
    );
  }

  if (desc.includes("event") || desc.includes("meeting") || desc.includes("appointment")) {
    fields.push(
      { name: "id", type: "string", description: "Unique identifier", required: true },
      { name: "title", type: "string", description: "Event title", required: true },
      { name: "startTime", type: "string", description: "ISO 8601 start time", required: true },
      { name: "endTime", type: "string", description: "ISO 8601 end time", required: false },
      { name: "location", type: "string", description: "Event location", required: false }
    );
  }

  if (desc.includes("address") || desc.includes("location")) {
    fields.push(
      { name: "street", type: "string", description: "Street address", required: true },
      { name: "city", type: "string", description: "City name", required: true },
      { name: "state", type: "string", description: "State or region", required: false },
      { name: "postalCode", type: "string", description: "Postal/ZIP code", required: true },
      { name: "country", type: "string", description: "ISO 3166-1 country code", required: true }
    );
  }

  // Fallback: generic object
  if (fields.length === 0) {
    fields.push(
      { name: "id", type: "string", description: "Unique identifier", required: true },
      { name: "data", type: "object", description: "Custom data payload", required: true },
      { name: "metadata", type: "object", description: "Additional metadata", required: false }
    );
  }

  return fields;
}

function toJsonSchema(fields: FieldDef[], strict: boolean): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const f of fields) {
    properties[f.name] = { type: f.type, description: f.description };
    if (strict || f.required) required.push(f.name);
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function toTypeScript(fields: FieldDef[], strict: boolean): string {
  const lines = fields.map((f) => {
    const opt = !strict && !f.required ? "?" : "";
    return `  /** ${f.description} */\n  ${f.name}${opt}: ${f.type === "number" ? "number" : "string"};`;
  });
  return `interface GeneratedSchema {\n${lines.join("\n")}\n}`;
}

function toZod(fields: FieldDef[], strict: boolean): string {
  const lines = fields.map((f) => {
    const base = f.type === "number" ? "z.number()" : "z.string()";
    const opt = !strict && !f.required ? `.optional()` : "";
    return `  ${f.name}: ${base}${opt}, // ${f.description}`;
  });
  return `import { z } from "zod";\n\nconst generatedSchema = z.object({\n${lines.join("\n")}\n});`;
}

// ----- Handler -----
async function handler(input: Input) {
  const fields = inferFieldsFromDescription(input.description);

  switch (input.format) {
    case "json_schema":
      return { schema: toJsonSchema(fields, input.strict), format: "json_schema" };
    case "typescript":
      return { schema: toTypeScript(fields, input.strict), format: "typescript" };
    case "zod":
      return { schema: toZod(fields, input.strict), format: "zod" };
  }
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
