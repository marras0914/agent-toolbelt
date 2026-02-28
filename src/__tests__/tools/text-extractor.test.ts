import { vi, describe, it, expect } from "vitest";

vi.mock("../../tools/registry", () => ({ registerTool: vi.fn() }));

import tool from "../../tools/text-extractor";

const handler = tool.handler;

describe("text-extractor", () => {
  describe("emails", () => {
    it("extracts a single email", async () => {
      const r = await handler({ text: "Contact us at hello@example.com", extractors: ["emails"], deduplicate: true });
      expect(r.extracted.emails).toEqual(["hello@example.com"]);
    });

    it("extracts multiple emails", async () => {
      const r = await handler({ text: "a@b.com and c@d.org", extractors: ["emails"], deduplicate: true });
      expect(r.extracted.emails).toHaveLength(2);
    });

    it("deduplicates emails", async () => {
      const r = await handler({ text: "a@b.com repeated: a@b.com", extractors: ["emails"], deduplicate: true });
      expect(r.extracted.emails).toEqual(["a@b.com"]);
    });

    it("returns all when deduplicate is false", async () => {
      const r = await handler({ text: "a@b.com and a@b.com", extractors: ["emails"], deduplicate: false });
      expect(r.extracted.emails).toHaveLength(2);
    });

    it("returns empty array when no emails found", async () => {
      const r = await handler({ text: "no emails here", extractors: ["emails"], deduplicate: true });
      expect(r.extracted.emails).toEqual([]);
    });
  });

  describe("urls", () => {
    it("extracts https URLs", async () => {
      const r = await handler({ text: "Visit https://example.com/path for info", extractors: ["urls"], deduplicate: true });
      expect(r.extracted.urls).toContain("https://example.com/path");
    });

    it("extracts http URLs", async () => {
      const r = await handler({ text: "See http://old-site.com", extractors: ["urls"], deduplicate: true });
      expect(r.extracted.urls).toContain("http://old-site.com");
    });
  });

  describe("phone_numbers", () => {
    it("extracts and normalizes a US phone number", async () => {
      const r = await handler({ text: "Call (555) 123-4567 anytime", extractors: ["phone_numbers"], deduplicate: true });
      expect(r.extracted.phone_numbers[0]).toMatch(/5551234567/);
    });

    it("handles dotted format", async () => {
      const r = await handler({ text: "555.867.5309", extractors: ["phone_numbers"], deduplicate: true });
      expect(r.extracted.phone_numbers[0]).toMatch(/5558675309/);
    });
  });

  describe("currencies", () => {
    it("extracts dollar amounts", async () => {
      const r = await handler({ text: "Budget is $1,500.00 USD", extractors: ["currencies"], deduplicate: true });
      expect(r.extracted.currencies.some((c) => c.includes("1,500") || c.includes("USD"))).toBe(true);
    });

    it("extracts euro amounts", async () => {
      const r = await handler({ text: "Price: €200", extractors: ["currencies"], deduplicate: true });
      expect(r.extracted.currencies[0]).toContain("200");
    });
  });

  describe("dates", () => {
    it("extracts MM/DD/YYYY format", async () => {
      const r = await handler({ text: "Meeting on 12/25/2025", extractors: ["dates"], deduplicate: true });
      expect(r.extracted.dates).toContain("12/25/2025");
    });

    it("extracts month name format", async () => {
      const r = await handler({ text: "Launch is Jan 15, 2025", extractors: ["dates"], deduplicate: true });
      expect(r.extracted.dates.length).toBeGreaterThan(0);
    });
  });

  describe("multiple extractors", () => {
    it("extracts multiple types simultaneously", async () => {
      const r = await handler({
        text: "Email john@example.com, call 555-123-4567, budget $500",
        extractors: ["emails", "phone_numbers", "currencies"],
        deduplicate: true,
      });
      expect(r.extracted.emails).toHaveLength(1);
      expect(r.extracted.phone_numbers).toHaveLength(1);
      expect(r.extracted.currencies).toHaveLength(1);
    });
  });

  describe("summary", () => {
    it("summary counts match extracted arrays", async () => {
      const r = await handler({
        text: "a@b.com and c@d.org",
        extractors: ["emails"],
        deduplicate: true,
      });
      expect(r.summary.byType.emails).toBe(r.extracted.emails.length);
      expect(r.summary.totalItemsFound).toBe(r.extracted.emails.length);
    });
  });
});
