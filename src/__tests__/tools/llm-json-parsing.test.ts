import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parseLLMJson } from "../../tools/_llm-utils";

// Regression coverage for the 2026-08-01 meeting-action-items outage: 23
// consecutive 500s for one user while every other LLM tool in the same catalog
// sweep succeeded seconds before and after.
//
// The cause was the hand-rolled fence-stripper several tools carried:
//
//   rawText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim()
//
// With the `m` flag, `^` matches at the start of ANY line, so a fence buried
// after a preamble is stripped while the preamble itself survives — leaving
// "Here is the JSON:\n{...}", which JSON.parse rejects. The tool then threw and
// the router turned it into a 500. It was deterministic per input, which is why
// one input worked and 23 retries of another never did.
//
// No test could see this: every existing tool test asserted on the input schema
// or the parsed output shape, never on the raw text the model actually returns.

const BODY = '{"meetingTitle":"Q3 Planning","actionItems":[{"id":1,"owner":"Sarah"}],"decisions":["postpone"]}';

describe("parseLLMJson — real model output shapes", () => {
  it.each([
    ["bare JSON", BODY],
    ["fenced with json tag", "```json\n" + BODY + "\n```"],
    ["fenced without tag", "```\n" + BODY + "\n```"],
    ["preamble then fenced", "Here is the extracted information:\n\n```json\n" + BODY + "\n```"],
    ["preamble then bare", "Here is the JSON output:\n\n" + BODY],
    ["fenced then trailing note", "```json\n" + BODY + "\n```\n\nLet me know if you need more."],
    ["preamble and trailing note", "Sure!\n\n" + BODY + "\n\nHope that helps."],
  ])("recovers the object from: %s", (_label, raw) => {
    const parsed = parseLLMJson(raw);
    expect(parsed.meetingTitle).toBe("Q3 Planning");
    expect(Array.isArray(parsed.actionItems)).toBe(true);
  });

  it("preserves nested structure rather than matching only the outermost braces", () => {
    const nested = 'Result:\n{"a":{"b":{"c":[1,2,3]}},"d":"}"}';
    const parsed = parseLLMJson(nested) as any;
    expect(parsed.a.b.c).toEqual([1, 2, 3]);
  });

  it("throws when there is no JSON object at all", () => {
    expect(() => parseLLMJson("I cannot help with that request.")).toThrow(/Failed to parse/);
  });

  it("throws on a truncated object rather than returning a partial one", () => {
    // max_tokens cuts the response mid-object; there is nothing to recover.
    expect(() => parseLLMJson('{"meetingTitle":"Q3","actionItems":[{"id":1,"own')).toThrow(/Failed to parse/);
  });
});

describe("no LLM tool carries the fragile hand-rolled parser", () => {
  const toolsDir = join(__dirname, "../../tools");
  const llmTools = readdirSync(toolsDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ name: f, source: readFileSync(join(toolsDir, f), "utf8") }))
    .filter((t) => t.source.includes("@anthropic-ai/sdk"));

  it("finds LLM-backed tools to check", () => {
    expect(llmTools.length).toBeGreaterThan(5);
  });

  // The specific shape that produced the outage: strip fences, then throw if
  // JSON.parse fails, with no fallback. Tools that fall back to a default
  // instead of throwing (schema-generator, web-summarizer) degrade rather than
  // 500 and are intentionally not covered by this rule.
  it.each(llmTools.map((t) => t.name))("%s does not throw on a bare JSON.parse of stripped text", (name) => {
    const source = llmTools.find((t) => t.name === name)!.source;
    const throwsOnParseFailure =
      /JSON\.parse\(jsonText\)/.test(source) &&
      /throw new Error\("Failed to parse structured response from LLM"\)/.test(source);
    expect(throwsOnParseFailure).toBe(false);
  });
});
