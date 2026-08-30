---
name: cli
description: 'Generic CLI work — workflow, definition, standards for any command-line task. Use whenever user asks to build, change, fix, or review a CLI, terminal tool, command-line program, subcommand, flag parsing, help text, TUI, anything running in terminal taking commands. Also trigger on "add a command", "new subcommand", "fix this CLI bug", "exit codes", "make this scriptable", "CLI flags", work in cli/ directory. Browser UI task → use `frontend` skill instead.'
---

# CLI Work

## What CLI work is

Anything running in terminal taking commands: one-shot commands, subcommand trees, flags, prompts, TUI screens, output contracts (stdout/stderr, exit codes). Judged by human or script experience: predictable behavior, clear output, correct exit codes, scriptability — not compile.

## Load stack skill first

Runtime conventions in stack skills. Identify runtime from entry point + package config, load matching:

| Runtime | Skill |
|---------|-------|
| Bun (shebang `#!/usr/bin/env bun`, Effect programs, co-located tests) | `cli-bun-effect` |
| Other | matching `cli-*` skill if exists, else existing code in repo |

## Workflow

### 1. Understand before code

- Read entry point + command you're changing + co-located test if exists. Run existing command, see current behavior + `--help`.
- CLI README = documented command contract. Help text + docs are public API.
- Existing pattern (command module, env var, config file, error convention)? Reuse before inventing.

### 2. Build it

Follow stack skill conventions. Universal non-negotiables:

- **Predictable structure**: consistent command naming; same flag names + semantics across commands.
- **Output discipline**: data stdout, progress + errors stderr. Never mix. Script-parsed output: stable, machine-readable form (JSON) where matters.
- **Exit codes**: 0 success, non-zero failure; distinct codes for distinct error classes when callers depend. Every failure exits, none silently swallow.
- **Help is product**: every command + flag documented in `--help`. That's discovery.
- **Scriptable by default**: prompts only in TTY, never when stdin isn't terminal; flags + env vars cover everything a prompt can ask.
- **Explicit precedence**: flags > env vars > config files > defaults. Document it.
- **Actionable errors**: failure message names command, cause, fix; prints stderr with command prefix.

### 3. Verify

- Co-located test for new logic (parsing, command behavior, config, exit codes).
- Project verification: typecheck, tests, build/compile. Fix failures.
- Run built command, exercise each changed path: success, failure, `--help`, env-vs-flag precedence, exit codes (`echo $?`).

### 4. Review before done

- Self-review: looks like existing commands? `--help` complete? Exit codes right? Output stable + parseable?
- Forgotten details: unknown-flag errors, missing-argument errors, empty-state output, non-TTY behavior, version output.

## Design principles

- **Consistency beats cleverness.** Mimic existing commands over "better" different behavior.
- **Scriptability is feature.** Every script-needed interaction reachable without prompt.
- **Silence is state, not accident.** Quiet success (Unix philosophy) unless verbose; noise → stderr.
- **Fail loudly + early.** Invalid flags/args → clear message + non-zero exit, never proceed on guess.

## Ambiguity

Check stack skill conventions, then existing commands in same CLI. Docs conflict with code, or task contradicts documented behavior → stop, report to user. Never resolve silently.
