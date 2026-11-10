import { vi } from "vitest";
import dotenv from "dotenv";
import { OLLAMA_TIMEOUT_MS } from "./llm-timeout";

// Load .env here, before any tool module imports the SDK, so OLLAMA_URL from
// .env is visible when the mock factory below runs.
dotenv.config();

// With OLLAMA_URL set, every `new Anthropic()` in the tools talks to Ollama
// (donnie) instead of the paid API. Without it, the real SDK is used, exactly
// as before. A test file that mocks the SDK itself (watchlist-scan-fetch)
// still wins, because its vi.mock is registered after this one.
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  if (!process.env.OLLAMA_URL) return actual;
  const { OllamaAnthropic } = await import("./ollama-anthropic");
  return { ...actual, default: OllamaAnthropic, Anthropic: OllamaAnthropic };
});

// Haiku-sized timeouts are too short for a local model. Raise the default
// here; tests with their own timeout wrap it in llmTimeout() (llm-timeout.ts).
if (process.env.OLLAMA_URL) {
  vi.setConfig({ testTimeout: OLLAMA_TIMEOUT_MS });
}
