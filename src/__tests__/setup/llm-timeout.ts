// A local 27B model writes ~36 tokens/s, may need a ~60s cold load (donnie
// also serves Hermes), and queues requests from parallel test files.
export const OLLAMA_TIMEOUT_MS = 600_000;

/** A per-test timeout sized for Anthropic, stretched when running on Ollama. */
export function llmTimeout(ms: number): number {
  return process.env.OLLAMA_URL ? OLLAMA_TIMEOUT_MS : ms;
}
