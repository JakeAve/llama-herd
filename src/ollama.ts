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

/** Ollama responded, but with a non-2xx status (e.g. 404 model not found). */
export class OllamaHttpError extends Error {
  constructor(readonly status: number, readonly model: string, body: string) {
    super(`Ollama ${status} for model "${model}": ${body}`);
    this.name = "OllamaHttpError";
  }
}

/** Couldn't reach Ollama at all (not running, wrong host, network down). */
export class OllamaConnectionError extends Error {
  constructor(readonly baseUrl: string, cause: unknown) {
    super(`Can't reach Ollama at ${baseUrl} — is it running?`);
    this.name = "OllamaConnectionError";
    this.cause = cause;
  }
}

export class OllamaClient {
  constructor(readonly baseUrl: string) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
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
    } catch (err) {
      throw new OllamaConnectionError(this.baseUrl, err);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new OllamaHttpError(res.status, req.model, body);
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
