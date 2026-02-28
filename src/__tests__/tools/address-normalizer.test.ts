import { vi, describe, it, expect } from "vitest";

vi.mock("../../tools/registry", () => ({ registerTool: vi.fn() }));

import tool from "../../tools/address-normalizer";

const handler = tool.handler;

describe("address-normalizer", () => {
  describe("street type normalization", () => {
    it("expands 'street' to ST", async () => {
      const r = await handler({ address: "123 Main Street, Springfield, IL 62701", includeComponents: true });
      expect(r.normalized).toContain("ST");
      expect(r.components?.streetType).toBe("ST");
    });

    it("expands 'avenue' to AVE", async () => {
      const r = await handler({ address: "456 Oak Avenue, Chicago, IL 60601", includeComponents: true });
      expect(r.components?.streetType).toBe("AVE");
    });

    it("expands 'boulevard' to BLVD", async () => {
      const r = await handler({ address: "789 Sunset Boulevard, Los Angeles, CA 90028", includeComponents: true });
      expect(r.components?.streetType).toBe("BLVD");
    });

    it("expands 'drive' to DR", async () => {
      const r = await handler({ address: "100 Maple Drive, Austin, TX 73301", includeComponents: true });
      expect(r.components?.streetType).toBe("DR");
    });
  });

  describe("state normalization", () => {
    it("expands full state name to abbreviation", async () => {
      const r = await handler({ address: "123 Main St, Springfield, Illinois 62701", includeComponents: true });
      expect(r.components?.state).toBe("IL");
    });

    it("keeps two-letter state abbreviation", async () => {
      const r = await handler({ address: "123 Main St, Springfield, IL 62701", includeComponents: true });
      expect(r.components?.state).toBe("IL");
    });
  });

  describe("secondary unit parsing", () => {
    it("parses apartment unit", async () => {
      const r = await handler({ address: "123 Main St apt 4B, Springfield, IL 62701", includeComponents: true });
      expect(r.components?.secondaryUnit).toBe("APT");
      expect(r.components?.secondaryNumber).toBe("4B");
    });

    it("parses suite", async () => {
      const r = await handler({ address: "456 Oak Ave Suite 200, Chicago, IL 60601", includeComponents: true });
      expect(r.components?.secondaryUnit).toBe("STE");
    });
  });

  describe("address components", () => {
    it("parses street number", async () => {
      const r = await handler({ address: "123 Main St, Springfield, IL 62701", includeComponents: true });
      expect(r.components?.streetNumber).toBe("123");
    });

    it("parses city", async () => {
      const r = await handler({ address: "123 Main St, Springfield, IL 62701", includeComponents: true });
      expect(r.components?.city).toBe("Springfield");
    });

    it("parses ZIP code", async () => {
      const r = await handler({ address: "123 Main St, Springfield, IL 62701", includeComponents: true });
      expect(r.components?.zip).toBe("62701");
    });

    it("parses ZIP+4", async () => {
      const r = await handler({ address: "123 Main St, Springfield, IL 62701-1234", includeComponents: true });
      expect(r.components?.zip).toBe("62701");
      expect(r.components?.zip4).toBe("1234");
    });

    it("omits components when includeComponents is false", async () => {
      const r = await handler({ address: "123 Main St, Springfield, IL 62701", includeComponents: false });
      expect(r.components).toBeUndefined();
    });
  });

  describe("confidence scoring", () => {
    it("returns high confidence for complete address", async () => {
      const r = await handler({ address: "123 Main St, Springfield, IL 62701", includeComponents: true });
      expect(r.confidence).toBe("high");
    });

    it("returns medium or low confidence for partial address", async () => {
      const r = await handler({ address: "Main St", includeComponents: true });
      expect(["low", "medium"]).toContain(r.confidence);
    });
  });

  describe("output", () => {
    it("includes original address in response", async () => {
      const input = "123 main st, springfield, il 62701";
      const r = await handler({ address: input, includeComponents: true });
      expect(r.original).toBe(input);
    });

    it("returns a normalized string", async () => {
      const r = await handler({ address: "123 main street, springfield, il 62701", includeComponents: true });
      expect(r.normalized).toContain("123");
      expect(r.normalized).toContain("ST");
    });
  });
});
