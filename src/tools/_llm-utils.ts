/**
 * Parse JSON from an LLM response.
 *
 * Strips markdown code fences first. If JSON.parse still fails — typically
 * because Claude prepended preamble text — falls back to extracting the
 * first balanced {...} block.
 */
export function parseLLMJson(rawText: string): Record<string, unknown> {
  const stripped = rawText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Failed to parse structured response from LLM");
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new Error("Failed to parse structured response from LLM");
    }
  }
}
