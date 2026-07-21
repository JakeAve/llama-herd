import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { findMissingModels, type HerdConfig, loadHerd } from "./herd.ts";
import { type ChatResult, OllamaClient } from "./ollama.ts";

const herd = await loadHerd();
const ollama = new OllamaClient(herd.ollamaHost);

const missing = await findMissingModels(herd, ollama.baseUrl);
for (const { role, model } of missing) {
  console.error(
    `[llama-herd] warning: role "${role}" needs model "${model}" which is not pulled — run: ollama pull ${model}`,
  );
}

const roleNames = Object.keys(herd.roles) as [string, ...string[]];

interface DelegateArgs {
  role: string;
  task: string;
  context?: string;
  instructions?: string;
}

function rosterDoc(config: HerdConfig): string {
  return Object.entries(config.roles)
    .map(([name, p]) => `- "${name}": ${p.description}`)
    .join("\n");
}

function runRole(
  config: HerdConfig,
  role: string,
  task: string,
  context?: string,
  instructions?: string,
): Promise<ChatResult> {
  const preset = config.roles[role];
  const system = instructions
    ? `${preset.system}\n\nAdditional instructions for this task:\n${instructions}`
    : preset.system;
  const user = context ? `${task}\n\n---\n\n${context}` : task;
  return ollama.chat({
    model: preset.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    options: preset.options,
    format: preset.format,
    think: preset.think,
  });
}

function toToolResult(result: ChatResult) {
  return {
    content: [{
      type: "text" as const,
      text: result.content +
        `\n\n[${result.model} · ${result.totalDurationMs}ms · ${result.promptTokens}→${result.completionTokens} tok]`,
    }],
  };
}

function toErrorResult(err: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: `Error: ${err instanceof Error ? err.message : String(err)}`,
    }],
    isError: true,
  };
}

const server = new McpServer({ name: "llama-herd", version: "0.1.0" });

server.registerTool("delegate", {
  description:
    `Delegate a task to a local model worker (cheap, private, free). Best for bulk mechanical text work — summarizing, extracting, classifying, transforming provided material — not for tasks needing deep reasoning. Roles:\n${
      rosterDoc(herd)
    }`,
  inputSchema: {
    role: z.enum(roleNames).describe("Which preset worker to use"),
    task: z.string().describe("The task to perform, stated directly"),
    context: z.string().optional().describe(
      "Material the task operates on (file contents, text, code). The worker sees ONLY what you pass here.",
    ),
    instructions: z.string().optional().describe(
      "Optional extra steering appended to the role's system prompt (e.g. output format, focus areas)",
    ),
  },
}, async ({ role, task, context, instructions }: DelegateArgs) => {
  try {
    return toToolResult(await runRole(herd, role, task, context, instructions));
  } catch (err) {
    return toErrorResult(err);
  }
});

server.registerTool("delegate_batch", {
  description:
    `Fan out multiple independent tasks to local model workers in parallel. Same semantics as delegate, one entry per task. Results return in input order. Max ${herd.maxParallelTasks} tasks per call.`,
  inputSchema: {
    tasks: z.array(z.object({
      role: z.enum(roleNames),
      task: z.string(),
      context: z.string().optional(),
      instructions: z.string().optional(),
    })).min(1).max(herd.maxParallelTasks),
  },
}, async ({ tasks }: { tasks: DelegateArgs[] }) => {
  const results = await Promise.allSettled(
    tasks.map((t) => runRole(herd, t.role, t.task, t.context, t.instructions)),
  );
  const text = results.map((r, i) =>
    r.status === "fulfilled"
      ? `### Task ${
        i + 1
      }\n${r.value.content}\n[${r.value.model} · ${r.value.totalDurationMs}ms]`
      : `### Task ${i + 1}\nError: ${r.reason?.message ?? r.reason}`
  ).join("\n\n");
  return { content: [{ type: "text" as const, text }] };
});

server.registerTool("delegate_custom", {
  description:
    "Escape hatch: run a task on any pulled Ollama model with a custom system prompt. Use ONLY when no preset role fits — prefer delegate. Model must already be pulled.",
  inputSchema: {
    model: z.string().describe('Ollama model tag, e.g. "qwen3.6:35b-a3b"'),
    system_prompt: z.string(),
    task: z.string(),
    context: z.string().optional(),
  },
}, async (
  { model, system_prompt, task, context }: {
    model: string;
    system_prompt: string;
    task: string;
    context?: string;
  },
) => {
  try {
    const result = await ollama.chat({
      model,
      messages: [
        { role: "system", content: system_prompt },
        {
          role: "user",
          content: context ? `${task}\n\n---\n\n${context}` : task,
        },
      ],
    });
    console.error(
      `[llama-herd] delegate_custom used (model=${model}) — consider promoting to a role in config.json`,
    );
    return toToolResult(result);
  } catch (err) {
    return toErrorResult(err);
  }
});

await server.connect(new StdioServerTransport());
console.error(
  `[llama-herd] serving ${roleNames.length} roles: ${roleNames.join(", ")}`,
);
