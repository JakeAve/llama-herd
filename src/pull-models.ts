import { loadHerd } from "./herd.ts";

const herd = await loadHerd();
const models = [
  ...new Set(Object.values(herd.roles).map((preset) => preset.model)),
];

console.error(
  `[llama-herd] pulling ${models.length} model(s): ${models.join(", ")}`,
);

let failed = 0;
for (const model of models) {
  console.error(`\n[llama-herd] ollama pull ${model}`);
  const command = new Deno.Command("ollama", {
    args: ["pull", model],
    stdout: "inherit",
    stderr: "inherit",
  });
  let success: boolean;
  try {
    ({ success } = await command.output());
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      console.error(
        `\n[llama-herd] "ollama" command not found — install it from https://ollama.com/download`,
      );
      Deno.exit(1);
    }
    throw err;
  }
  if (!success) {
    failed++;
    console.error(`[llama-herd] failed to pull "${model}"`);
  }
}

if (failed > 0) {
  console.error(
    `\n[llama-herd] ${failed} of ${models.length} model(s) failed to pull`,
  );
  Deno.exit(1);
}

console.error(`\n[llama-herd] all models up to date`);
