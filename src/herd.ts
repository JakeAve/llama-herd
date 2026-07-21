export interface RolePreset {
  model: string;
  description: string;
  system: string;
  options?: Record<string, number | string | boolean>;
  /** Optional JSON schema passed to Ollama's `format` for structured output. */
  format?: unknown;
  /** Disable/enable reasoning on hybrid-thinking models (e.g. qwen3.6). Omit for models that don't support the flag. */
  think?: boolean;
}

export interface HerdConfig {
  roles: Record<string, RolePreset>;
  /** Max independent tasks accepted in one delegate_batch call. */
  maxParallelTasks: number;
  /** Base URL of the Ollama server. */
  ollamaHost: string;
}

const DEFAULT_MAX_PARALLEL_TASKS = 3;
const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

const CONFIG_PATH = new URL("../config.json", import.meta.url);
const DEFAULT_CONFIG_PATH = new URL("../default.config.json", import.meta.url);

export async function loadHerd(): Promise<HerdConfig> {
  const explicit = Deno.env.get("HERD_CONFIG");
  const path = explicit ??
    (await exists(CONFIG_PATH) ? CONFIG_PATH : DEFAULT_CONFIG_PATH);
  const raw = JSON.parse(await Deno.readTextFile(path));
  if (!raw.roles || Object.keys(raw.roles).length === 0) {
    throw new Error(`No roles defined in herd config (${path})`);
  }
  return {
    roles: raw.roles,
    maxParallelTasks: raw.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS,
    ollamaHost: raw.ollamaHost ?? DEFAULT_OLLAMA_HOST,
  };
}

async function exists(path: URL): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compare the roster against `ollama list`. Returns the names of roles whose
 * model is not pulled. Never throws on network failure — the server should
 * still start so the error surfaces in tool results instead of a dead server.
 */
export async function findMissingModels(
  config: HerdConfig,
  baseUrl: string,
): Promise<{ role: string; model: string }[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    const { models } = await res.json() as { models: { name: string }[] };
    const pulled = new Set(models.map((m) => m.name));
    return Object.entries(config.roles)
      .filter(([, preset]) =>
        !pulled.has(preset.model) && !pulled.has(`${preset.model}:latest`)
      )
      .map(([role, preset]) => ({ role, model: preset.model }));
  } catch {
    return [];
  }
}
