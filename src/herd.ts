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
  /** Absolute path to the config file actually loaded. */
  configPath: string;
  /**
   * Absolute path to the llama-herd repo root (derived from this module's own
   * location, not Deno.cwd()
   */
  repoRoot: string;
}

const DEFAULT_MAX_PARALLEL_TASKS = 3;
const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

const CONFIG_PATH = new URL("../config.json", import.meta.url);
const DEFAULT_CONFIG_PATH = new URL("../default.config.json", import.meta.url);
const REPO_ROOT_URL = new URL("..", import.meta.url);

export async function loadHerd(): Promise<HerdConfig> {
  const explicit = Deno.env.get("HERD_CONFIG");
  const path = explicit ??
    (await exists(CONFIG_PATH) ? CONFIG_PATH : DEFAULT_CONFIG_PATH);
  const raw = JSON.parse(await Deno.readTextFile(path));
  const errors = validateConfig(raw);
  if (errors.length > 0) {
    throw new Error(
      `Invalid herd config (${path}):\n  - ${errors.join("\n  - ")}`,
    );
  }
  return {
    roles: raw.roles,
    maxParallelTasks: raw.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS,
    ollamaHost: raw.ollamaHost ?? DEFAULT_OLLAMA_HOST,
    configPath: await Deno.realPath(path),
    repoRoot: await Deno.realPath(REPO_ROOT_URL),
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

const TOP_LEVEL_KEYS = new Set([
  "$schema",
  "$comment",
  "maxParallelTasks",
  "ollamaHost",
  "roles",
]);
const ROLE_PRESET_KEYS = new Set([
  "model",
  "description",
  "system",
  "options",
  "format",
  "think",
]);

/** Structural validation matching config.schema.json. Returns human-readable error messages, empty if valid. */
function validateConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return ["config must be a JSON object"];
  }
  const config = raw as Record<string, unknown>;

  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`unknown top-level key "${key}"`);
  }

  if (
    "maxParallelTasks" in config &&
    (!Number.isInteger(config.maxParallelTasks) ||
      (config.maxParallelTasks as number) < 1)
  ) {
    errors.push(`"maxParallelTasks" must be an integer >= 1`);
  }

  if ("ollamaHost" in config && typeof config.ollamaHost !== "string") {
    errors.push(`"ollamaHost" must be a string`);
  }

  if (!("roles" in config)) {
    errors.push(`missing required "roles"`);
  } else if (
    typeof config.roles !== "object" || config.roles === null ||
    Array.isArray(config.roles)
  ) {
    errors.push(`"roles" must be an object`);
  } else {
    const roles = config.roles as Record<string, unknown>;
    if (Object.keys(roles).length === 0) {
      errors.push(`"roles" must define at least one role`);
    }
    for (const [name, preset] of Object.entries(roles)) {
      validateRolePreset(name, preset, errors);
    }
  }

  return errors;
}

function validateRolePreset(
  name: string,
  raw: unknown,
  errors: string[],
): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push(`role "${name}" must be an object`);
    return;
  }
  const preset = raw as Record<string, unknown>;

  for (const key of Object.keys(preset)) {
    if (!ROLE_PRESET_KEYS.has(key)) {
      errors.push(`role "${name}" has unknown key "${key}"`);
    }
  }
  for (const field of ["model", "description", "system"] as const) {
    if (typeof preset[field] !== "string") {
      errors.push(`role "${name}" is missing required string "${field}"`);
    }
  }
  if (
    "options" in preset &&
    (typeof preset.options !== "object" || preset.options === null ||
      Array.isArray(preset.options))
  ) {
    errors.push(`role "${name}" has "options" that must be an object`);
  }
  if ("think" in preset && typeof preset.think !== "boolean") {
    errors.push(`role "${name}" has "think" that must be a boolean`);
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
