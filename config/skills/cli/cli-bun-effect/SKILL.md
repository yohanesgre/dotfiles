---
name: cli-bun-effect
description: 'Conventions for Bun + Effect-TS CLIs — bun shebang executables, Effect-driven command programs, dependency-free arg parsing, co-located tests. Load whenever CLI work in project whose cli/ entry runs on bun with Effect-TS dispatch (shebang `#!/usr/bin/env bun` + Effect programs), or adding commands, flags, env handling, tests to such CLI. Generic `cli` skill defers stack details here. Different runtime/framework → load or create that stack''s `cli-*` variant; don''t apply these conventions to non-Bun/non-Effect CLI.'
---

# Bun + Effect-TS CLI Conventions

Bun runtime + Effect-TS command programs. Covers this combo specifically; future CLI on other stack (node + commander, go + cobra, ...) gets own `cli-*` variant.

## Tools

- Effect patterns (services, layers, schemas, error handling) → also load `effect-ts` skill.
- Diff review before merge → load `code-review`.

## Layout

- Flat `src/` modules, one per command domain (`api.ts`, `config.ts`, `deploy.ts`, ...).
- `index.ts` — entry: arg parsing, command dispatch, Effect program boundary.
- `version.ts` — single source for `--version`/help.
- Co-located tests: `module.test.ts` next to module.

## Entry point & dispatch

- Shebang `#!/usr/bin/env bun`; file directly runnable.
- Dev via project script (e.g. `bun run cli/src/index.ts`); prod compiled binary — entry free of environment assumptions.
- Dispatch is Effect program: config service provided at edge, failures print with command prefix then `exit(1)`. Only exit paths via boundary.

## Arg parsing

- Tiny hand-rolled parser, no deps: `--flag=value` + `--flag value` forms, positionals, boolean flags.
- Unknown flags + missing required args → clear error + non-zero exit. Never silently ignored.

## Config & env precedence

- Flags > env vars > saved config; documented in header comment.
- Interactive prompts only when stdin TTY; scripts always pass flags/env.
- Auth via same API client as app (same token scheme) — don't reimplement.

## Output & errors

- Data stdout; progress + errors stderr.
- Failure messages: command prefix, cause, fix; then `exit(1)`.
- Stable output for scripts; machine-readable form where callers parse.

## Testing

- Co-located `*.test.ts`; run with `bun test`.
- Cover parsing (flag forms, precedence), command behavior, config load/save, exit codes.

## Quality gates

Typecheck, `bun test`, build/compile binary, then manual run of each changed path (success, failure, `--help`, exit codes).
