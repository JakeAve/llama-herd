# llama-herd 🦙

An MCP server that lets Claude Code delegate work to a herd of local Ollama
models — free, private, parallel workers for bulk mechanical tasks.

## How it works

Claude Code ──(MCP, stdio)──▶ llama-herd ──(HTTP)──▶ Ollama

The herd is a **preset roster** (`config.json`): each role maps to a model, a
tuned system prompt, and Ollama options (`num_ctx`, `temperature`, optional
structured-output `format`). Roles show up as an enum in the tool schema, so
Claude picks a worker instead of improvising model configs.

## Tools

- `delegate` — run one task on a preset role (`worker`, `coder`, `classifier`,
  …)
- `delegate_batch` — fan out independent tasks in parallel, up to
  `maxParallelTasks` (config, default 3)
- `delegate_custom` — escape hatch: any pulled model + custom system prompt. If
  Claude reaches for this often, the roster is missing a role.

## Prerequisites

- Deno: https://docs.deno.com/runtime/getting_started/installation
- Ollama: https://ollama.com/download

## Setup

```sh
# create your personal config from the lightweight defaults
cp default.config.json config.json

# pull whatever models your config.json roster references
deno task pull-models

# register with Claude Code
claude mcp add llama-herd -- deno task --cwd /path/to/llama-herd start
```

Smoke test (no MCP client needed): `deno task smoke`

### Git hooks

The repo ships pre-commit and pre-push hooks in `.githooks/` that run
`deno task check` (fmt check + lint + type check). Git doesn't pick these up
automatically — after cloning, run once:

```sh
deno task setup
```

This points git at `.githooks/` and marks the hooks executable. The setting is
local to your clone (not checked in), so each contributor runs it once.

## Tasks

```sh
deno task setup        # One-time: configure git hooks after cloning
deno task start         # Run the MCP server
deno task smoke         # End-to-end check without an MCP client
deno task pull-models   # Pull/update every model in the active config
deno task check         # fmt check + lint + type check
deno task pre-commit    # check (run by .githooks/pre-commit)
deno task pre-push      # check (run by .githooks/pre-push)
```

## Config

There are two config files, validated against `config.schema.json`:

- `default.config.json` — committed, lightweight roster (small models that run
  on modest hardware). Ships as the fallback when no personal config exists.
- `config.json` — gitignored, your personal roster. Copy `default.config.json`
  to `config.json` (see above) and swap in whatever models your hardware can
  handle.

`loadHerd()` uses `config.json` if it exists, otherwise falls back to
`default.config.json`. Set the `HERD_CONFIG` env var to point at a config file
outside the repo instead — that's the one setting that can't live in the config
file itself, since it's what locates it.

`maxParallelTasks` (top-level, default `3`) caps how many tasks `delegate_batch`
accepts per call — raise it if your hardware can run more roster models
concurrently.

`ollamaHost` (top-level, default `"http://127.0.0.1:11434"`) sets the Ollama
server URL. If you point it at a non-local host, also loosen the `--allow-net`
flag in `deno.json`, which is locked to `127.0.0.1,localhost` by default.

Missing models are warned about at startup (stderr) but don't prevent the server
from starting. Run `deno task pull-models` any time to pull/update every model
referenced in the active config (`config.json`, or `default.config.json` if none
exists).
