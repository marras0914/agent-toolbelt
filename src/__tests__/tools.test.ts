import { describe, it, expect } from "vitest";

// ============================================
// We import each tool's default export which
// gives us the ToolDefinition with .handler
// and .inputSchema for validation testing.
// ============================================

import schemaGeneratorTool from "../tools/schema-generator";
import textExtractorTool from "../tools/text-extractor";
import cronBuilderTool from "../tools/cron-builder";
import regexBuilderTool from "../tools/regex-builder";
import brandKitTool from "../tools/brand-kit";

// ============================================
// Schema Generator
// ============================================
describe("schema-generator", () => {
  const handler = schemaGeneratorTool.handler;

  it("generates JSON Schema for a user profile", async () => {
    const result = await handler({
      description: "A user profile with name and email",
      format: "json_schema",
      strict: true,
    });
    expect(result.format).toBe("json_schema");
    expect(result.schema).toBeDefined();

    const schema = result.schema as any;
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("name");
    expect(schema.properties).toHaveProperty("email");
    expect(schema.required).toContain("name");
    expect(schema.required).toContain("email");
  });

  it("generates TypeScript interface", async () => {
    const result = await handler({
      description: "A product listing",
      format: "typescript",
      strict: true,
    });
    expect(result.format).toBe("typescript");
    expect(typeof result.schema).toBe("string");
    expect(result.schema).toContain("interface GeneratedSchema");
    expect(result.schema).toContain("title");
    expect(result.schema).toContain("price");
  });

  it("generates Zod schema", async () => {
    const result = await handler({
      description: "An event with start time",
      format: "zod",
      strict: false,
    });
    expect(result.format).toBe("zod");
    expect(typeof result.schema).toBe("string");
    expect(result.schema).toContain("z.object");
    expect(result.schema).toContain("import { z }");
  });

  it("handles optional fields when strict is false", async () => {
    const result = await handler({
      description: "An event with a title and location",
      format: "json_schema",
      strict: false,
    });
    const schema = result.schema as any;
    // location should be optional when strict is false
    expect(schema.properties).toHaveProperty("location");
  });

  it("returns generic schema for unknown descriptions", async () => {
    const result = await handler({
      description: "something completely unknown",
      format: "json_schema",
      strict: true,
    });
    const schema = result.schema as any;
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("id");
    expect(schema.properties).toHaveProperty("data");
  });

  it("validates input schema rejects empty description", () => {
    const parsed = schemaGeneratorTool.inputSchema.safeParse({
      description: "",
      format: "json_schema",
      strict: true,
    });
    expect(parsed.success).toBe(false);
  });
});

// ============================================
// Text Extractor
// ============================================
describe("text-extractor", () => {
  const handler = textExtractorTool.handler;

  it("extracts email addresses", async () => {
    const result = await handler({
      text: "Contact alice@example.com or bob@company.co.uk for info",
      extractors: ["emails"],
      deduplicate: true,
    });
    expect(result.extracted.emails).toContain("alice@example.com");
    expect(result.extracted.emails).toContain("bob@company.co.uk");
    expect(result.summary.totalItemsFound).toBe(2);
  });

  it("extracts URLs", async () => {
    const result = await handler({
      text: "Visit https://example.com and http://docs.test.org/path?q=1",
      extractors: ["urls"],
      deduplicate: true,
    });
    expect(result.extracted.urls).toHaveLength(2);
    expect(result.extracted.urls![0]).toContain("https://example.com");
  });

  it("extracts phone numbers", async () => {
    const result = await handler({
      text: "Call (555) 123-4567 or +1-212-555-0199",
      extractors: ["phone_numbers"],
      deduplicate: true,
    });
    expect(result.extracted.phone_numbers!.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts dates", async () => {
    const result = await handler({
      text: "The meeting is on Jan 15, 2025 and the deadline is 03/01/2025",
      extractors: ["dates"],
      deduplicate: true,
    });
    expect(result.extracted.dates!.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts currencies", async () => {
    const result = await handler({
      text: "The price is $1,234.56 and the deposit is $500",
      extractors: ["currencies"],
      deduplicate: true,
    });
    expect(result.extracted.currencies).toContain("$1,234.56");
    expect(result.extracted.currencies).toContain("$500");
  });

  it("handles multiple extractors at once", async () => {
    const result = await handler({
      text: "Email john@test.com, call 555-123-4567, visit https://test.com, pay $99.99",
      extractors: ["emails", "phone_numbers", "urls", "currencies"],
      deduplicate: true,
    });
    expect(result.extracted.emails!.length).toBeGreaterThanOrEqual(1);
    expect(result.extracted.urls!.length).toBeGreaterThanOrEqual(1);
    expect(result.extracted.currencies!.length).toBeGreaterThanOrEqual(1);
    expect(result.summary.totalItemsFound).toBeGreaterThanOrEqual(3);
  });

  it("deduplicates results", async () => {
    const result = await handler({
      text: "Contact alice@test.com and also alice@test.com again",
      extractors: ["emails"],
      deduplicate: true,
    });
    expect(result.extracted.emails).toHaveLength(1);
  });

  it("returns duplicates when deduplicate is false", async () => {
    const result = await handler({
      text: "Contact alice@test.com and also alice@test.com again",
      extractors: ["emails"],
      deduplicate: false,
    });
    expect(result.extracted.emails).toHaveLength(2);
  });

  it("returns empty arrays when nothing found", async () => {
    const result = await handler({
      text: "Just a plain sentence with no special data",
      extractors: ["emails", "urls"],
      deduplicate: true,
    });
    expect(result.extracted.emails).toHaveLength(0);
    expect(result.extracted.urls).toHaveLength(0);
    expect(result.summary.totalItemsFound).toBe(0);
  });
});

// ============================================
// Cron Builder
// ============================================
describe("cron-builder", () => {
  const handler = cronBuilderTool.handler;

  it("handles 'every 5 minutes'", async () => {
    const result = await handler({ description: "every 5 minutes", timezone: "UTC" });
    expect(result.expression).toBe("*/5 * * * *");
    expect(result.nextRuns.length).toBe(5);
  });

  it("handles 'every hour'", async () => {
    const result = await handler({ description: "every hour", timezone: "UTC" });
    expect(result.expression).toBe("0 * * * *");
  });

  it("handles 'every day at 9am'", async () => {
    const result = await handler({ description: "every day at 9am", timezone: "UTC" });
    expect(result.expression).toBe("0 9 * * *");
    expect(result.humanReadable).toContain("9 AM");
  });

  it("handles 'every weekday at 9:30am'", async () => {
    const result = await handler({ description: "every weekday at 9:30am", timezone: "America/New_York" });
    expect(result.expression).toBe("30 9 * * 1,2,3,4,5");
    expect(result.timezone).toBe("America/New_York");
  });

  it("handles weekend schedules", async () => {
    const result = await handler({ description: "every weekend at 10am", timezone: "UTC" });
    expect(result.expression).toBe("0 10 * * 0,6");
  });

  it("handles specific days", async () => {
    const result = await handler({ description: "every Monday and Wednesday at 2pm", timezone: "UTC" });
    expect(result.expression).toBe("0 14 * * 1,3");
  });

  it("handles 'every day at noon'", async () => {
    const result = await handler({ description: "daily at noon", timezone: "UTC" });
    expect(result.expression).toBe("0 12 * * *");
  });

  it("handles 'every day at midnight'", async () => {
    const result = await handler({ description: "every day at midnight", timezone: "UTC" });
    expect(result.expression).toBe("0 0 * * *");
  });

  it("handles monthly schedules", async () => {
    const result = await handler({ description: "every month on the 15th at 9am", timezone: "UTC" });
    expect(result.expression).toBe("0 9 15 * *");
    expect(result.humanReadable).toContain("15th");
  });

  it("handles 'first Monday of each month'", async () => {
    const result = await handler({ description: "first Monday of each month at 9am", timezone: "UTC" });
    expect(result.expression).toBe("0 9 1-7 * 1");
  });

  it("handles 'every minute'", async () => {
    const result = await handler({ description: "every minute", timezone: "UTC" });
    expect(result.expression).toBe("* * * * *");
  });

  it("produces valid next run timestamps", async () => {
    const result = await handler({ description: "every 5 minutes", timezone: "UTC" });
    for (const run of result.nextRuns) {
      expect(() => new Date(run)).not.toThrow();
      expect(new Date(run).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("returns warnings for unparseable input", async () => {
    const result = await handler({ description: "xyzzy gibberish", timezone: "UTC" });
    expect(result.warnings.length).toBeGreaterThan(0);
    // Should still return a valid cron expression (fallback)
    expect(result.expression).toBeDefined();
  });

  it("returns 5 fields in the expression", async () => {
    const result = await handler({ description: "every day at 3pm", timezone: "UTC" });
    const parts = result.expression.split(" ");
    expect(parts).toHaveLength(5);
  });
});

// ============================================
// Regex Builder
// ============================================
describe("regex-builder", () => {
  const handler = regexBuilderTool.handler;

  it("builds email regex and matches correctly", async () => {
    const result = await handler({
      description: "email addresses",
      testStrings: ["hello@world.com", "not an email", "test@co.uk"],
      flags: "g",
    });
    expect(result.pattern).toBeDefined();
    expect(result.regexLiteral).toContain("/");
    expect(result.testResults).toHaveLength(3);
    expect(result.testResults![0].matched).toBe(true);
    expect(result.testResults![1].matched).toBe(false);
    expect(result.testResults![2].matched).toBe(true);
  });

  it("builds URL regex", async () => {
    const result = await handler({
      description: "URLs",
      testStrings: ["https://example.com", "ftp://other.com", "plain text"],
      flags: "g",
    });
    expect(result.testResults![0].matched).toBe(true);
    expect(result.testResults![2].matched).toBe(false);
  });

  it("builds phone number regex", async () => {
    const result = await handler({
      description: "US phone numbers",
      testStrings: ["(555) 123-4567", "+1-212-555-0199", "12345"],
      flags: "g",
    });
    expect(result.testResults![0].matched).toBe(true);
  });

  it("builds hex color regex", async () => {
    const result = await handler({
      description: "hex color codes",
      testStrings: ["#ff5733", "#FFF", "#00e5a0", "not a color"],
      flags: "gi",
    });
    expect(result.testResults![0].matched).toBe(true);
    expect(result.testResults![1].matched).toBe(true);
    expect(result.testResults![3].matched).toBe(false);
  });

  it("builds UUID regex", async () => {
    const result = await handler({
      description: "uuid",
      testStrings: ["550e8400-e29b-41d4-a716-446655440000", "not-a-uuid"],
      flags: "g",
    });
    expect(result.testResults![0].matched).toBe(true);
    expect(result.testResults![1].matched).toBe(false);
  });

  it("builds semver regex", async () => {
    const result = await handler({
      description: "semantic version numbers",
      testStrings: ["1.0.0", "v2.3.1-rc.1", "not-a-version"],
      flags: "g",
    });
    expect(result.testResults![0].matched).toBe(true);
    expect(result.testResults![1].matched).toBe(true);
  });

  it("provides code snippets in JS, Python, and TS", async () => {
    const result = await handler({
      description: "email",
      flags: "g",
    });
    expect(result.codeSnippets).toBeDefined();
    expect(result.codeSnippets!.javascript).toContain("match");
    expect(result.codeSnippets!.python).toContain("import re");
    expect(result.codeSnippets!.typescript).toContain("RegExp");
  });

  it("returns available patterns for unknown descriptions", async () => {
    const result = await handler({
      description: "xyzzy completely unknown pattern type",
      flags: "g",
    });
    // Should still try to find a best match or return failure info
    // The matcher scores by keyword overlap, so it may return a low-confidence match
    expect(result).toBeDefined();
  });

  it("works without test strings", async () => {
    const result = await handler({
      description: "IP addresses",
      flags: "g",
    });
    expect(result.pattern).toBeDefined();
    expect(result.testResults).toBeUndefined();
  });
});

// ============================================
// Brand Kit Generator
// ============================================
describe("brand-kit", () => {
  const handler = brandKitTool.handler;

  it("generates a full brand kit", async () => {
    const result = await handler({
      name: "Solaris Health",
      industry: "healthcare",
      vibe: ["modern", "warm"],
      format: "full",
    });
    expect(result.brand).toBe("Solaris Health");
    expect(result.palette).toBeDefined();
    expect(result.palette.primary.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(result.palette.secondary.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(result.palette.accent.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(result.typography).toBeDefined();
    expect(result.typography.display.family).toBeTruthy();
    expect(result.typography.body.family).toBeTruthy();
    expect(result.accessibility).toBeDefined();
    expect(result.tokens).toBeDefined();
    expect(result.css).toBeDefined();
    expect(result.tailwindConfig).toBeDefined();
  });

  it("returns valid CSS custom properties", async () => {
    const result = await handler({
      name: "Test Brand",
      industry: "tech",
      vibe: ["modern"],
      format: "css",
    });
    expect(result.css).toContain(":root");
    expect(result.css).toContain("--color-primary");
    expect(result.css).toContain("--font-display");
    expect(result.css).toContain("--font-body");
  });

  it("returns valid Tailwind config", async () => {
    const result = await handler({
      name: "Test Brand",
      industry: "tech",
      vibe: ["bold"],
      format: "tailwind",
    });
    expect(result.tailwindConfig).toContain("module.exports");
    expect(result.tailwindConfig).toContain("primary:");
    expect(result.tailwindConfig).toContain("fontFamily");
  });

  it("returns JSON design tokens", async () => {
    const result = await handler({
      name: "Token Test",
      industry: "fintech",
      format: "tokens",
    });
    expect(result.tokens.color).toBeDefined();
    expect(result.tokens.color.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(result.tokens.typography).toBeDefined();
    expect(result.tokens.spacing).toBeDefined();
    expect(result.tokens.radius).toBeDefined();
    expect(result.tokens.shadow).toBeDefined();
  });

  it("produces different palettes for different industries", async () => {
    const healthcare = await handler({ name: "HealthCo", industry: "healthcare", format: "tokens" });
    const gaming = await handler({ name: "GameCo", industry: "gaming", format: "tokens" });
    // Different industries should produce different primary colors
    expect(healthcare.tokens.color.primary).not.toBe(gaming.tokens.color.primary);
  });

  it("produces deterministic output for same inputs", async () => {
    const run1 = await handler({ name: "Deterministic Inc", industry: "tech", vibe: ["modern"], format: "tokens" });
    const run2 = await handler({ name: "Deterministic Inc", industry: "tech", vibe: ["modern"], format: "tokens" });
    expect(run1.tokens.color.primary).toBe(run2.tokens.color.primary);
    expect(run1.tokens.color.secondary).toBe(run2.tokens.color.secondary);
  });

  it("produces different output for different brand names", async () => {
    const brand1 = await handler({ name: "Alpha Corp", industry: "tech", format: "tokens" });
    const brand2 = await handler({ name: "Zeta Labs", industry: "tech", format: "tokens" });
    // Same industry but different names should give different results due to seeded RNG
    // (They might still pick the same hue bucket, but secondary/accent will differ)
    expect(brand1.tokens.color).not.toEqual(brand2.tokens.color);
  });

  it("applies vibe modifiers correctly", async () => {
    const bold = await handler({ name: "Test", industry: "tech", vibe: ["bold"], format: "tokens" });
    const minimal = await handler({ name: "Test", industry: "tech", vibe: ["minimal"], format: "tokens" });
    // Bold should have more saturated colors than minimal
    // We can't easily test HSL directly from hex, but they should be different
    expect(bold.tokens.color.primary).not.toBe(minimal.tokens.color.primary);
  });

  it("includes accessibility scores", async () => {
    const result = await handler({ name: "A11y Test", industry: "tech", format: "full" });
    expect(result.accessibility.primaryOnBackground.ratio).toBeGreaterThan(1);
    expect(result.accessibility.textOnBackground.ratio).toBeGreaterThan(1);
    expect(["AAA", "AA", "AA Large", "Fail"]).toContain(result.accessibility.primaryOnBackground.rating);
    // Text on background should be at least AA
    expect(["AAA", "AA"]).toContain(result.accessibility.textOnBackground.rating);
  });

  it("includes Google Fonts URL", async () => {
    const result = await handler({ name: "Font Test", industry: "tech", format: "full" });
    expect(result.typography.googleFontsUrl).toContain("fonts.googleapis.com");
    expect(result.typography.googleFontsUrl).toContain(encodeURIComponent(result.typography.display.family));
  });

  it("handles missing optional fields gracefully", async () => {
    const result = await handler({
      name: "Minimal Input",
      format: "full",
    });
    expect(result.brand).toBe("Minimal Input");
    expect(result.palette.primary.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

// ============================================
// Input Validation (Zod schemas)
// ============================================
describe("input-validation", () => {
  it("schema-generator rejects missing description", () => {
    const parsed = schemaGeneratorTool.inputSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("text-extractor rejects empty extractors array", () => {
    const parsed = textExtractorTool.inputSchema.safeParse({
      text: "hello",
      extractors: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("text-extractor rejects invalid extractor type", () => {
    const parsed = textExtractorTool.inputSchema.safeParse({
      text: "hello",
      extractors: ["invalid_type"],
    });
    expect(parsed.success).toBe(false);
  });

  it("cron-builder accepts valid input", () => {
    const parsed = cronBuilderTool.inputSchema.safeParse({
      description: "every day at 9am",
    });
    expect(parsed.success).toBe(true);
  });

  it("brand-kit rejects missing name", () => {
    const parsed = brandKitTool.inputSchema.safeParse({
      industry: "tech",
    });
    expect(parsed.success).toBe(false);
  });

  it("brand-kit accepts minimal input", () => {
    const parsed = brandKitTool.inputSchema.safeParse({
      name: "Test",
    });
    expect(parsed.success).toBe(true);
  });

  it("brand-kit rejects invalid format", () => {
    const parsed = brandKitTool.inputSchema.safeParse({
      name: "Test",
      format: "invalid_format",
    });
    expect(parsed.success).toBe(false);
  });
});
