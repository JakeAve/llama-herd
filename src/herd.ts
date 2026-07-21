import { z } from "zod";

/**
 * Single source of truth for the config shape. config.schema.json (used for
 * editor autocomplete on config.json) is generated from this schema — run
 * `deno task generate-schema` after changing it. `deno task check` fails if
 * the checked-in file has drifted from this schema.
 */
export const RolePresetSchema = z.strictObject({
  model: z.string().describe(
    'Ollama model tag, e.g. "llama3.2:3b". Must already be pulled (`ollama pull <model>`).',
  ),
  description: z.string().describe(
    "Shown to Claude as the role's enum description — keep it short and task-oriented.",
  ),
  system: z.string().describe("System prompt tuned for this role."),
  options: z.record(z.union([z.number(), z.string(), z.boolean()]))
    .describe("Ollama request options, e.g. num_ctx, temperature.")
    .optional(),
  format: z.unknown().describe(
    "Optional JSON schema passed to Ollama's `format` for structured output.",
  ).optional(),
  think: z.boolean().describe(
    "Disable/enable reasoning on hybrid-thinking models (e.g. qwen3.6). Omit for models that don't support the flag.",
  ).optional(),
});

export type RolePreset = z.infer<typeof RolePresetSchema>;

const DEFAULT_MAX_PARALLEL_TASKS = 3;
const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

export const ConfigFileSchema = z.strictObject({
  $schema: z.string().optional(),
  $comment: z.string().optional(),
  maxParallelTasks: z.number().int().min(1)
    .default(DEFAULT_MAX_PARALLEL_TASKS)
    .describe(
      "Max independent tasks accepted in one delegate_batch call. Defaults to 3 if omitted; raise it on beefier hardware.",
    ),
  ollamaHost: z.string().url()
    .default(DEFAULT_OLLAMA_HOST)
    .describe(
      "Base URL of the Ollama server. Defaults to the local instance if omitted. If you point this at a non-local host, also loosen the --allow-net flag in deno.json.",
    ),
  roles: z.record(RolePresetSchema)
    .refine((roles) => Object.keys(roles).length > 0, {
      message: "must define at least one role",
    })
    .describe(
      "Role name -> preset. Role names appear as an enum in the MCP tool schema, so keep them short and task-oriented.",
    ),
});

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

const CONFIG_PATH = new URL("../config.json", import.meta.url);
const DEFAULT_CONFIG_PATH = new URL("../default.config.json", import.meta.url);
const REPO_ROOT_URL = new URL("..", import.meta.url);

export async function loadHerd(): Promise<HerdConfig> {
  const explicit = Deno.env.get("HERD_CONFIG");
  const path = explicit ??
    (await exists(CONFIG_PATH) ? CONFIG_PATH : DEFAULT_CONFIG_PATH);
  const raw = JSON.parse(await Deno.readTextFile(path));
  const result = ConfigFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid herd config (${path}):\n  - ${
        formatZodIssues(result.error).join("\n  - ")
      }`,
    );
  }
  return {
    roles: result.data.roles,
    maxParallelTasks: result.data.maxParallelTasks,
    ollamaHost: result.data.ollamaHost,
    configPath: await Deno.realPath(path),
    repoRoot: await Deno.realPath(REPO_ROOT_URL),
  };
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
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
