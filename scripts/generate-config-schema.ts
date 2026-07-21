/**
 * Generates config.schema.json from the Zod schema in src/herd.ts so the two
 * can never drift apart. Run `deno task generate-schema` after changing the
 * schema, or `deno task generate-schema -- --check` (used by `deno task
 * check`) to fail if the checked-in file is stale.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { ConfigFileSchema } from "../src/herd.ts";

const OUTPUT_PATH = new URL("../config.schema.json", import.meta.url);

const { $schema: _drop, ...body } = zodToJsonSchema(ConfigFileSchema, {
  target: "jsonSchema7",
  $refStrategy: "none",
}) as { $schema?: string; [key: string]: unknown };

const output = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/jacobavery/llama-herd/config.schema.json",
  title: "llama-herd config",
  description:
    "The herd roster. Each role maps to a model + tuned system prompt + Ollama options.",
  ...body,
};

const text = JSON.stringify(output, null, 2) + "\n";

if (Deno.args.includes("--check")) {
  const current = await Deno.readTextFile(OUTPUT_PATH).catch(() => null);
  if (current !== text) {
    console.error(
      "config.schema.json is stale — run `deno task generate-schema`.",
    );
    Deno.exit(1);
  }
} else {
  await Deno.writeTextFile(OUTPUT_PATH, text);
  console.error(`[llama-herd] wrote ${OUTPUT_PATH.pathname}`);
}
