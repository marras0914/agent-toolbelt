import { vi, describe, it, expect } from "vitest";

vi.mock("../../tools/registry", () => ({ registerTool: vi.fn() }));

import tool from "../../tools/color-palette";

const handler = tool.handler;

describe("color-palette", () => {
  describe("basic output shape", () => {
    it("returns the requested number of colors", async () => {
      const r = await handler({ description: "ocean", count: 3, format: "all", includeShades: false });
      expect(r.colors).toHaveLength(3);
    });

    it("defaults to 5 colors", async () => {
      const r = await handler({ description: "calm", count: 5, format: "all", includeShades: false });
      expect(r.colors).toHaveLength(5);
    });

    it("returns up to 10 colors", async () => {
      const r = await handler({ description: "forest", count: 10, format: "all", includeShades: false });
      expect(r.colors).toHaveLength(10);
    });
  });

  describe("color format", () => {
    it("hex format includes hex but no rgb/hsl strings", async () => {
      const r = await handler({ description: "ocean", count: 2, format: "hex", includeShades: false });
      expect(r.colors[0].hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(r.colors[0]).not.toHaveProperty("rgb");
    });

    it("all format includes hex, rgb, hsl", async () => {
      const r = await handler({ description: "ocean", count: 2, format: "all", includeShades: false });
      expect(r.colors[0].hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(r.colors[0]).toHaveProperty("rgb");
      expect(r.colors[0]).toHaveProperty("hsl");
    });

    it("hex values are valid uppercase 6-digit hex", async () => {
      const r = await handler({ description: "sunset", count: 5, format: "hex", includeShades: false });
      for (const color of r.colors) {
        expect(color.hex).toMatch(/^#[0-9A-F]{6}$/);
      }
    });
  });

  describe("WCAG scores", () => {
    it("includes WCAG contrast scores", async () => {
      const r = await handler({ description: "fintech", count: 3, format: "all", includeShades: false });
      for (const color of r.colors) {
        expect(color.wcag).toHaveProperty("contrastOnWhite");
        expect(color.wcag).toHaveProperty("contrastOnBlack");
        expect(color.wcag.contrastOnWhite).toBeGreaterThan(0);
      }
    });
  });

  describe("shades", () => {
    it("does not include shades by default", async () => {
      const r = await handler({ description: "ocean", count: 3, format: "all", includeShades: false });
      expect(r.colors[0]).not.toHaveProperty("shades");
    });

    it("includes shades when requested", async () => {
      const r = await handler({ description: "ocean", count: 3, format: "all", includeShades: true });
      expect(r.colors[0]).toHaveProperty("shades");
      expect(r.colors[0].shades).toHaveProperty("light");
      expect(r.colors[0].shades).toHaveProperty("dark");
    });
  });

  describe("CSS output", () => {
    it("returns CSS custom properties", async () => {
      const r = await handler({ description: "ocean", count: 3, format: "all", includeShades: false });
      expect(r.css).toContain(":root");
      expect(r.css).toContain("--color-1");
      expect(r.css).toContain("--color-2");
      expect(r.css).toContain("--color-3");
    });
  });

  describe("theme matching", () => {
    it("matches 'ocean' keyword", async () => {
      const r = await handler({ description: "ocean blue calm", count: 5, format: "hex", includeShades: false });
      expect(r.paletteName).toBeTruthy();
    });

    it("matches 'fintech' keyword", async () => {
      const r = await handler({ description: "fintech blue", count: 5, format: "hex", includeShades: false });
      expect(r.paletteName).toBeTruthy();
    });

    it("handles hex seed color in description", async () => {
      const r = await handler({ description: "#3B82F6", count: 5, format: "all", includeShades: false });
      expect(r.paletteName).toBe("Custom");
      expect(r.colors[0].hex).toBe("#3B82F6");
    });
  });

  describe("swatches", () => {
    it("returns comma-separated hex swatches", async () => {
      const r = await handler({ description: "ocean", count: 3, format: "all", includeShades: false });
      const swatches = r.swatches.split(", ");
      expect(swatches).toHaveLength(3);
      expect(swatches[0]).toMatch(/^#[0-9A-F]{6}$/);
    });
  });
});
