export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  options?: Record<string, number | string | boolean>;
  format?: unknown;
  think?: boolean;
}

export interface ChatResult {
  content: string;
  model: string;
  totalDurationMs: number;
  promptTokens: number;
  completionTokens: number;
}

export class OllamaClient {
  constructor(readonly baseUrl: string) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        options: req.options,
        format: req.format,
        think: req.think,
        stream: false,
        // Keep roster models resident: cold loads are 10s+ for big models.
        keep_alive: -1,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama ${res.status} for model "${req.model}": ${body}`);
    }
    const data = await res.json();
    return {
      content: data.message?.content ?? "",
      model: data.model,
      totalDurationMs: Math.round((data.total_duration ?? 0) / 1e6),
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
    };
  }
}
