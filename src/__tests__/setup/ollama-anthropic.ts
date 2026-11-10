// A stand-in for the Anthropic SDK client that sends `messages.create` to a
// local Ollama server instead. Test-only: the vitest setup file swaps it in for
// `@anthropic-ai/sdk` when OLLAMA_URL is set (donnie, e.g.
// http://192.168.50.8:11434), so the LLM tool tests run free and keep working
// when the Anthropic balance is empty. Production code never imports this.
//
// It covers only what the tools use: `system`, text `messages`, `max_tokens`,
// `temperature`, and reading `content[0].text` / `stop_reason` back.

type TextBlock = { type: "text"; text: string };
type Content = string | Array<{ type: string; text?: string }>;

interface CreateParams {
  model?: string;
  max_tokens: number;
  system?: Content;
  messages: Array<{ role: "user" | "assistant"; content: Content }>;
  temperature?: number;
}

function toText(content: Content | undefined): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .map((b) => {
      if (b.type !== "text") throw new Error(`ollama shim: unsupported content block "${b.type}"`);
      return b.text ?? "";
    })
    .join("\n");
}

export class OllamaAnthropic {
  private url: string;
  private model: string;

  constructor(_opts?: unknown) {
    this.url = (process.env.OLLAMA_URL || "").replace(/\/$/, "");
    this.model = process.env.OLLAMA_MODEL || "qwen3.8:27b";
  }

  messages = {
    create: async (params: CreateParams) => {
      const system = toText(params.system);
      const messages = [
        ...(system ? [{ role: "system", content: system }] : []),
        ...params.messages.map((m) => ({ role: m.role, content: toText(m.content) })),
      ];

      const res = await fetch(`${this.url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          // qwen3 thinks by default; the tools want the answer, not the reasoning.
          think: false,
          // Keep the model loaded across a test run. donnie also serves Hermes,
          // and a cold load of a 27B model takes about a minute.
          keep_alive: "15m",
          messages,
          options: {
            num_predict: params.max_tokens,
            num_ctx: 16384,
            ...(params.temperature != null ? { temperature: params.temperature } : {}),
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`ollama shim: ${res.status} ${(await res.text()).slice(0, 300)}`);
      }

      const out = (await res.json()) as {
        message?: { content?: string };
        done_reason?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const content: TextBlock[] = [{ type: "text", text: out.message?.content ?? "" }];
      return {
        id: "ollama",
        type: "message",
        role: "assistant",
        model: this.model,
        content,
        stop_reason: out.done_reason === "length" ? "max_tokens" : "end_turn",
        usage: { input_tokens: out.prompt_eval_count ?? 0, output_tokens: out.eval_count ?? 0 },
      };
    },
  };
}
