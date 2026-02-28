import { vi, describe, it, expect } from "vitest";

vi.mock("../../tools/registry", () => ({ registerTool: vi.fn() }));

import tool from "../../tools/markdown-converter";

const handler = tool.handler;

describe("markdown-converter", () => {
  describe("HTML to Markdown", () => {
    it("converts h1 to # heading", async () => {
      const r = await handler({ content: "<h1>Hello</h1>", from: "html", to: "markdown", options: {} });
      expect(r.output).toContain("# Hello");
    });

    it("converts h2 to ## heading", async () => {
      const r = await handler({ content: "<h2>Section</h2>", from: "html", to: "markdown", options: {} });
      expect(r.output).toContain("## Section");
    });

    it("converts <strong> to bold", async () => {
      const r = await handler({ content: "<p>Hello <strong>world</strong></p>", from: "html", to: "markdown", options: {} });
      expect(r.output).toContain("**world**");
    });

    it("converts <em> to italic", async () => {
      const r = await handler({ content: "<p>Hello <em>world</em></p>", from: "html", to: "markdown", options: {} });
      expect(r.output).toMatch(/_world_|\*world\*/);
    });

    it("converts <a> to markdown link", async () => {
      const r = await handler({ content: '<a href="https://example.com">Click</a>', from: "html", to: "markdown", options: {} });
      expect(r.output).toContain("[Click](https://example.com)");
    });

    it("converts <ul><li> to bullet list", async () => {
      const r = await handler({ content: "<ul><li>One</li><li>Two</li></ul>", from: "html", to: "markdown", options: {} });
      expect(r.output).toContain("One");
      expect(r.output).toContain("Two");
    });

    it("uses asterisk bullet marker when specified", async () => {
      const r = await handler({
        content: "<ul><li>Item</li></ul>",
        from: "html",
        to: "markdown",
        options: { bulletListMarker: "*" },
      });
      // Turndown may pad with spaces: "* Item" or "*   Item"
      expect(r.output).toMatch(/^\*/m);
      expect(r.output).toContain("Item");
    });
  });

  describe("Markdown to HTML", () => {
    it("converts # heading to <h1>", async () => {
      const r = await handler({ content: "# Hello", from: "markdown", to: "html", options: {} });
      expect(r.output).toContain("<h1>");
      expect(r.output).toContain("Hello");
    });

    it("converts **bold** to <strong>", async () => {
      const r = await handler({ content: "Hello **world**", from: "markdown", to: "html", options: {} });
      expect(r.output).toContain("<strong>");
    });

    it("converts [link](url) to <a>", async () => {
      const r = await handler({ content: "[Click here](https://example.com)", from: "markdown", to: "html", options: {} });
      expect(r.output).toContain("<a");
      expect(r.output).toContain("https://example.com");
    });

    it("converts - list to <ul>", async () => {
      const r = await handler({ content: "- Item one\n- Item two", from: "markdown", to: "html", options: {} });
      expect(r.output).toContain("<ul>");
      expect(r.output).toContain("<li>");
    });
  });

  describe("same format passthrough", () => {
    it("returns input unchanged when from === to", async () => {
      const content = "<p>Hello</p>";
      const r = await handler({ content, from: "html", to: "html", options: {} });
      expect(r.output).toBe(content);
      expect(r).toHaveProperty("note");
    });
  });

  describe("response shape", () => {
    it("includes from, to, inputLength, outputLength", async () => {
      const r = await handler({ content: "<h1>Hi</h1>", from: "html", to: "markdown", options: {} });
      expect(r).toHaveProperty("from", "html");
      expect(r).toHaveProperty("to", "markdown");
      expect(r).toHaveProperty("inputLength");
      expect(r).toHaveProperty("outputLength");
      expect(r.inputLength).toBe("<h1>Hi</h1>".length);
    });
  });
});
