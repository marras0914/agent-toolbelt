---
title: "I Stopped Writing JSON Schemas and Regex by Hand. Here's What I Do Instead."
description: "Two of the most tedious parts of backend development — generating schemas and writing regex — can be fully automated. Here's how I handle them now."
tags: ["typescript", "devtools", "api", "productivity"]
cover_image: https://agent-toolbelt-production.up.railway.app/og.png
published: true
---

There are two types of code that every backend developer writes too much of: JSON schemas and regex patterns.

They're not hard. They're just *tedious*. And they have a way of taking 30 minutes when you expected 5. The schema you wrote by hand has a typo. The regex works for 90% of cases but misses the edge case you didn't think of. You open regex101 for the third time this week.

I solved this by turning both into API calls. Here's how.

---

## The JSON Schema Problem

If you're building APIs, validating LLM output, or defining TypeScript interfaces, you're writing JSON schemas. Manually. From example data that you already have.

This is the classic definition of a task that should not require a human.

### The workflow before

1. Take your example JSON object
2. Open json-schema.org or remember the syntax
3. Manually map each field to its type
4. Add `required`, `additionalProperties`, format strings for dates
5. Test it, find the typo in `"propeties"`, fix it
6. If you want a TypeScript interface too: do it all again

### The workflow now

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/schema-generator \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "orderId": "ord_abc123",
      "customer": {
        "id": "usr_456",
        "email": "jane@example.com"
      },
      "items": [
        { "sku": "WIDGET-001", "quantity": 2, "price": 19.99 }
      ],
      "total": 39.98,
      "status": "pending",
      "createdAt": "2024-03-01T14:22:00Z"
    },
    "format": "json-schema"
  }'
```

Response:
```json
{
  "schema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
      "orderId": { "type": "string" },
      "customer": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "email": { "type": "string", "format": "email" }
        },
        "required": ["id", "email"]
      },
      "items": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "sku": { "type": "string" },
            "quantity": { "type": "integer" },
            "price": { "type": "number" }
          },
          "required": ["sku", "quantity", "price"]
        }
      },
      "total": { "type": "number" },
      "status": { "type": "string" },
      "createdAt": { "type": "string", "format": "date-time" }
    },
    "required": ["orderId", "customer", "items", "total", "status", "createdAt"]
  },
  "format": "json-schema"
}
```

Notice it:
- Detected the nested object structure
- Inferred `email` format from the value
- Detected `date-time` format from the ISO string
- Correctly typed `quantity` as `integer` and `price` as `number`
- Populated `required` correctly

Switch `"format"` to `"typescript"` and you get:

```typescript
interface Output {
  orderId: string;
  customer: {
    id: string;
    email: string;
  };
  items: Array<{
    sku: string;
    quantity: number;
    price: number;
  }>;
  total: number;
  status: string;
  createdAt: string;
}
```

### Where I use this

**Validating LLM output.** When I ask a model to return structured data, I take an example of the output I want, run it through schema-generator, and use the result with Zod or Ajv for validation. This cuts the schema-writing step entirely.

**Documenting undocumented APIs.** Hit the endpoint, grab the response, generate the schema. Done.

**Starting TypeScript interfaces.** I paste in a sample API response and get a starting interface. It's not always perfect (it can't infer discriminated unions or enums), but it's 80% of the work in one API call.

---

## The Regex Problem

Regex is write-once-debug-forever. The pattern that works in isolation fails in production because of a format variant you didn't consider. Then you're back in regex101, debugging character classes.

I'll be honest: I know regex well enough to write most patterns I need. But I've stopped doing it manually because there's no good reason to.

### Describing what you want in English

```bash
curl -X POST https://agent-toolbelt-production.up.railway.app/api/tools/regex-builder \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Extract version numbers like 1.0.0, 2.13.4, or v3.0.0-beta.1 from a string",
    "testString": "Using express@4.18.2, react@18.2.0, and typescript@v5.0.0-beta.1"
  }'
```

Response:
```json
{
  "pattern": "v?\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)?",
  "flags": "g",
  "explanation": "Optionally matches a leading 'v', then three dot-separated numbers (major.minor.patch), followed by an optional pre-release suffix starting with a hyphen",
  "matches": ["4.18.2", "18.2.0", "v5.0.0-beta.1"]
}
```

The `explanation` field is what makes this useful beyond just getting the pattern. It tells you *what* the pattern does so you can verify it matches your mental model, and adjust the description if not.

### The feedback loop

The real workflow isn't one-shot — it's iterative:

```bash
# First attempt
"description": "Match US phone numbers"
# → Too loose, matches 7-digit numbers

# Refined
"description": "Match 10-digit US phone numbers with optional country code +1, supporting formats: (555) 123-4567, 555-123-4567, 555.123.4567, +15551234567"
# → Gets exactly what you want with the edge cases handled
```

The description-based approach forces you to be precise about what you actually want, which surfaces edge cases earlier than writing the pattern directly would.

### Where I use this

**Data pipelines.** Extracting structured data from unstructured text — dates, IDs, amounts, codes — without hand-crafting patterns for each format variant.

**Input validation.** Describe the valid format for your domain (order IDs, SKUs, reference numbers) and get the validation pattern.

**AI agent tools.** When an agent needs to extract something specific from a large document, I build the pattern with a description and hand it to the agent as a tool parameter.

---

## Using Both Together

The combination becomes powerful when you're building data extraction pipelines. Example: processing invoice emails from multiple vendors with different formats.

```typescript
import { AgentToolbelt } from "agent-toolbelt";

const toolbelt = new AgentToolbelt({ apiKey: process.env.TOOLBELT_KEY });

// Step 1: Build extraction patterns from a description
const { pattern: invoiceNumberPattern } = await toolbelt.regexBuilder({
  description: "Extract invoice numbers like INV-2024-001, #12345, or Invoice: 98765",
  testString: sampleInvoiceText,
});

const { pattern: amountPattern } = await toolbelt.regexBuilder({
  description: "Extract dollar amounts like $1,234.56 or USD 1234.56",
  testString: sampleInvoiceText,
});

// Step 2: Extract data using the patterns
const invoiceNumber = new RegExp(invoiceNumberPattern).exec(emailBody)?.[0];
const amount = new RegExp(amountPattern).exec(emailBody)?.[0];

// Step 3: Validate the structured output
const { schema } = await toolbelt.schemaGenerator({
  input: { invoiceNumber, amount, vendor: "...", date: "..." },
  format: "json-schema",
});

// Now you have validated, typed data from unstructured email text
```

Three API calls replaced what would have been a morning of work: designing the extraction logic, writing the patterns, defining the schema, wiring up validation.

---

## The Broader Point

The best developer tools are the ones that handle the mechanics so you can think about the problem. JSON schemas and regex patterns are mechanics — the interesting part is what you do with the extracted data.

Both tools are available with the same API key. Pricing is fractions of a cent per call. No setup, no library to install (unless you want the TypeScript SDK), no configuration.

**Get started:** [agent-toolbelt-production.up.railway.app](https://agent-toolbelt-production.up.railway.app)

---

*Agent Toolbelt is a collection of focused, pay-per-call API tools for developers and AI agents. [See all 14 tools →](https://agent-toolbelt-production.up.railway.app)*
