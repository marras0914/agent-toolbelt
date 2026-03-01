import { z } from "zod";
import { faker } from "@faker-js/faker";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  schema: z
    .record(z.unknown())
    .describe("JSON Schema object describing the shape of the mock data to generate"),
  count: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(1)
    .describe("Number of mock records to generate (1–100)"),
  seed: z
    .number()
    .int()
    .optional()
    .describe("Optional seed for reproducible output"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Mock Value Generator -----

function generateValue(schema: Record<string, unknown>, depth = 0): unknown {
  if (depth > 8) return null;

  // Handle $ref, allOf, oneOf, anyOf minimally
  if (schema.allOf && Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return generateValue(schema.allOf[0] as Record<string, unknown>, depth);
  }
  if (schema.oneOf && Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return generateValue(schema.oneOf[0] as Record<string, unknown>, depth);
  }
  if (schema.anyOf && Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return generateValue(schema.anyOf[0] as Record<string, unknown>, depth);
  }

  // Enum
  if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
    return faker.helpers.arrayElement(schema.enum as unknown[]);
  }

  // Const
  if ("const" in schema) return schema.const;

  // Example / default
  if (schema.example !== undefined) return schema.example;
  if (schema.examples && Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0];
  }

  const type = schema.type as string | string[] | undefined;
  const resolvedType = Array.isArray(type) ? type[0] : type;

  switch (resolvedType) {
    case "object":
      return generateObject(schema, depth);
    case "array":
      return generateArray(schema, depth);
    case "string":
      return generateString(schema);
    case "number":
    case "integer":
      return generateNumber(schema, resolvedType === "integer");
    case "boolean":
      return faker.datatype.boolean();
    case "null":
      return null;
    default:
      // No type — try to infer from properties
      if (schema.properties) return generateObject(schema, depth);
      if (schema.items) return generateArray(schema, depth);
      return faker.word.sample();
  }
}

function generateObject(schema: Record<string, unknown>, depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required as string[]) || [];

  if (!properties) return {};

  for (const [key, propSchema] of Object.entries(properties)) {
    const isRequired = required.includes(key);
    // 80% chance to include optional fields
    if (!isRequired && faker.datatype.boolean({ probability: 0.2 })) continue;
    // Inject the property key as a hint for string generation
    const schemaWithHint = propSchema.title || propSchema.description
      ? propSchema
      : { ...propSchema, _propKey: key };
    result[key] = generateValue(schemaWithHint, depth + 1);
  }

  return result;
}

function generateArray(schema: Record<string, unknown>, depth: number): unknown[] {
  const minItems = (schema.minItems as number) ?? 1;
  const maxItems = (schema.maxItems as number) ?? Math.min(minItems + 4, 5);
  const count = faker.number.int({ min: minItems, max: maxItems });
  const items = schema.items as Record<string, unknown> | undefined;

  if (!items) return Array.from({ length: count }, () => faker.word.sample());
  return Array.from({ length: count }, () => generateValue(items, depth + 1));
}

function generateString(schema: Record<string, unknown>): string {
  const format = schema.format as string | undefined;
  const fieldName = (schema.title as string || schema.description as string || schema._propKey as string || "").toLowerCase();

  // Format-based generation
  switch (format) {
    case "email": return faker.internet.email();
    case "uri":
    case "url": return faker.internet.url();
    case "uuid": return faker.string.uuid();
    case "date": return faker.date.recent().toISOString().split("T")[0];
    case "date-time": return faker.date.recent().toISOString();
    case "time": return `${faker.number.int({ min: 0, max: 23 }).toString().padStart(2, "0")}:${faker.number.int({ min: 0, max: 59 }).toString().padStart(2, "0")}:00`;
    case "ipv4": return faker.internet.ipv4();
    case "ipv6": return faker.internet.ipv6();
    case "hostname": return faker.internet.domainName();
    case "phone": return faker.phone.number();
    case "password": return faker.internet.password();
    case "binary":
    case "byte": return faker.string.alphanumeric(16);
  }

  // Pattern-based generation
  if (schema.pattern) {
    try {
      return faker.helpers.fromRegExp(schema.pattern as string);
    } catch {
      // fall through
    }
  }

  // Field-name heuristics
  if (/\bid\b/.test(fieldName)) return faker.string.uuid();
  if (/email/.test(fieldName)) return faker.internet.email();
  if (/phone|tel/.test(fieldName)) return faker.phone.number();
  if (/url|link|href|website/.test(fieldName)) return faker.internet.url();
  if (/image|photo|avatar|picture/.test(fieldName)) return faker.image.url();
  if (/first.?name|firstname/.test(fieldName)) return faker.person.firstName();
  if (/last.?name|lastname|surname/.test(fieldName)) return faker.person.lastName();
  if (/username|user_name/.test(fieldName)) return faker.internet.username();
  if (/\bname\b/.test(fieldName)) return faker.person.fullName();
  if (/company|org/.test(fieldName)) return faker.company.name();
  if (/address|street/.test(fieldName)) return faker.location.streetAddress();
  if (/city/.test(fieldName)) return faker.location.city();
  if (/state|province/.test(fieldName)) return faker.location.state();
  if (/country/.test(fieldName)) return faker.location.country();
  if (/zip|postal/.test(fieldName)) return faker.location.zipCode();
  if (/description|summary|bio|about/.test(fieldName)) return faker.lorem.sentence();
  if (/title|subject|heading/.test(fieldName)) return faker.lorem.words(3);
  if (/color|colour/.test(fieldName)) return faker.color.rgb();
  if (/currency/.test(fieldName)) return faker.finance.currencyCode();
  if (/price|amount|cost/.test(fieldName)) return faker.commerce.price();
  if (/status/.test(fieldName)) return faker.helpers.arrayElement(["active", "inactive", "pending"]);
  if (/role/.test(fieldName)) return faker.helpers.arrayElement(["admin", "user", "moderator"]);
  if (/token|key|secret/.test(fieldName)) return faker.string.alphanumeric(32);
  if (/date|time|at$/.test(fieldName)) return faker.date.recent().toISOString();
  if (/slug/.test(fieldName)) return faker.helpers.slugify(faker.lorem.words(2));
  if (/tag/.test(fieldName)) return faker.word.adjective();
  if (/note|comment|message|text|content/.test(fieldName)) return faker.lorem.paragraph();

  // minLength/maxLength constraints
  const minLen = (schema.minLength as number) ?? 3;
  const maxLen = (schema.maxLength as number) ?? 20;
  return faker.string.alphanumeric({ length: { min: minLen, max: maxLen } });
}

function generateNumber(schema: Record<string, unknown>, integer: boolean): number {
  const min = (schema.minimum as number) ?? (schema.exclusiveMinimum as number) ?? 0;
  const max = (schema.maximum as number) ?? (schema.exclusiveMaximum as number) ?? 1000;

  if (integer) {
    return faker.number.int({ min, max });
  }
  const raw = faker.number.float({ min, max });
  const multipleOf = schema.multipleOf as number | undefined;
  if (multipleOf) return Math.round(raw / multipleOf) * multipleOf;
  return Math.round(raw * 100) / 100;
}

// ----- Handler -----
async function handler(input: Input) {
  if (input.seed !== undefined) {
    faker.seed(input.seed);
  }

  const schema = input.schema as Record<string, unknown>;
  const records = Array.from({ length: input.count }, () => generateValue(schema));
  const result = input.count === 1 ? records[0] : records;

  return {
    data: result,
    count: input.count,
    schema: {
      type: schema.type ?? "object",
      title: schema.title ?? undefined,
    },
  };
}

// ----- Register -----
const apiResponseMockerTool: ToolDefinition<Input> = {
  name: "api-response-mocker",
  description:
    "Generate realistic mock API responses from a JSON Schema. Supports nested objects, arrays, string formats (email, uuid, date, url), field-name heuristics, and reproducible output via seed. Perfect for testing agents, seeding dev databases, or generating fixture data.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["mock", "testing", "fixtures", "json-schema", "faker"],
    pricing: "$0.0005 per call",
    exampleInput: {
      schema: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          email: { type: "string", format: "email" },
          age: { type: "integer", minimum: 18, maximum: 80 },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "email"],
      },
      count: 3,
    },
  },
};

registerTool(apiResponseMockerTool);
export default apiResponseMockerTool;
