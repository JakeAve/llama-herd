// Quick end-to-end check without an MCP client: loads the herd, reports
// missing models, and runs one real task against the first available role.
import { findMissingModels, loadHerd } from "./herd.ts";
import { OllamaClient } from "./ollama.ts";

const herd = await loadHerd();
const ollama = new OllamaClient(herd.ollamaHost);

const missing = await findMissingModels(herd, ollama.baseUrl);
console.log("roles:", Object.keys(herd.roles).join(", "));
console.log(
  "missing models:",
  missing.length
    ? missing.map((m) => `${m.role}→${m.model}`).join(", ")
    : "none",
);

const missingRoles = new Set(missing.map((m) => m.role));
const available = Object.entries(herd.roles).find(([r]) =>
  !missingRoles.has(r)
);
if (!available) {
  console.log("no runnable roles — pull a model first");
  Deno.exit(1);
}

const [role, preset] = available;
console.log(`\nrunning smoke task on role "${role}" (${preset.model})...`);
const result = await ollama.chat({
  model: preset.model,
  messages: [
    { role: "system", content: preset.system },
    { role: "user", content: "Reply with exactly: HERD OK" },
  ],
  options: preset.options,
});
console.log(`→ ${result.content.trim()}`);
console.log(`(${result.totalDurationMs}ms, ${result.completionTokens} tokens)`);
