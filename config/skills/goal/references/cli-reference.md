# CLI reference (pinned — do NOT probe `--help`)

The signatures below are authoritative for the pinned binaries. Every
`/goal` lane and dispatch path uses ONLY these forms. Nested `--help` is
not implemented in herdr (`herdr pane run --help`, `herdr agent prompt
--help`, `herdr agent --help` all print the SAME top-level help), so
running `--help` to discover syntax is wasted work and adds nondeterministic
steps. Trust this file; if a signature errors, FAST EXIT naming it — never
fall back to interactive discovery.

Pinned: `herdr 0.9.0`, `opencode2 v0.0.0-beta-19425`, `bun`.

## Environment guard

```bash
test "${HERDR_ENV:-}" = 1          # else FAST EXIT: not a herdr session
command -v herdr opencode2 bun      # else FAST EXIT naming the missing binary
```

## herdr — exact signatures used by /goal

All control commands return JSON; read IDs from the response, never predict
them.

Layout (master + lane grid is built once per wave by `lane-layout.ts`; the
raw primitives it wraps):

```bash
herdr pane layout --pane <pane-id>                 # .result.layout.panes[].rect
herdr pane split --pane <id> --direction right|down --ratio <r> --no-focus --cwd <dir>
                                                   # -> .result.pane.pane_id
herdr tab create --no-focus --cwd <dir>            # -> .result.tab.tab_id, .result.root_pane.pane_id
herdr pane current --current                       # -> .result.pane.pane_id (caller)
```

Drive a lane (foreground, visible, pane persists):

```bash
herdr pane run <pane-id> "bash /abs/path/<slug>-runner.sh"   # sends text + Enter
herdr pane read <pane-id> --source recent-unwrapped --lines 120
herdr pane close <pane-id>                                   # only panes YOU created
```

`sleep`/`pane wait-output` are NOT the lane-completion signal — wait on the
return file with `lane-wait.ts` (below).

Native agent kinds (only if the user explicitly asks for a non-opencode2
agent; `/goal` lanes use `pane run`, never these):

```bash
herdr agent start <name> --kind <backend> --pane <pane-id> [-- <args...>]
herdr agent prompt <name> "<text>" --wait --timeout 120000
herdr agent wait <name> --until blocked --timeout 120000
herdr agent get <name>
herdr agent read <name> --source recent-unwrapped --lines 120
herdr agent send-keys <name> esc|ctrl+c
herdr agent list
```

## opencode2 — the only invocation /goal uses

```bash
opencode2 run --auto --model <provider/model#variant> --agent <role> "<prompt>"
```

- The prompt is a POSITIONAL argument. There is NO `--prompt` flag.
- `--auto` auto-approves permissions that are not explicitly denied.
- `--model provider/model#variant` and `--agent <role>` are required and
  passed explicitly: the agent md `model:` pin does NOT auto-apply to a
  primary `opencode2 run --agent` session (child/subagent sessions only).
- Resume a lane that died before DONE (state lives in the worktree):
  `opencode2 run --auto --model <...> --agent <role> --session <session-id> "<prompt>"`.
- Other valid flags: `--continue/-c`, `--fork`, `--file/-f`, `--title`,
  `--thinking`, `--format default|json`, `--standalone`, `--server`.
- Preflight auth once: `opencode2 auth list`. Default model error
  (`No cookie auth cred`) or a bad approved model → FAST EXIT naming it,
  never substitute.

## Canonical lane runner (copy verbatim, fill the `<>`)

Write the brief to `<slug>-brief.md` and this runner to `<slug>-runner.sh`
(both beside the worktree, or `/tmp/opencode/`). One lane, one runner.

```bash
#!/usr/bin/env bash
# /goal lane runner — generated, do not hand-edit. <slug>
set -uo pipefail
ROLE="<swe|designer>"
MODEL="<provider/model#variant>"      # read from ~/.config/opencode/agents/<role>.md model:
WORKTREE="<abs worktree path>"
SLUG="<slug>"
DIR="$(dirname "$WORKTREE")"
BRIEF="$DIR/$SLUG-brief.md"
RETURN="$DIR/$SLUG-return.md"
TMP="$RETURN.tmp"

cd "$WORKTREE" || { echo "FAST EXIT: no worktree $WORKTREE"; exit 1; }

# foreground, live output visible in the pane AND captured for the record
opencode2 run --auto --model "$MODEL" --agent "$ROLE" "$(cat "$BRIEF")" 2>&1 | tee "$TMP"
rc=${PIPESTATUS[0]}

# atomic: the file's appearance can only mean real completion. LAST step.
mv "$TMP" "$RETURN"
echo "lane $SLUG done rc=$rc -> $RETURN"

# hand the pane back to an interactive shell (pane persists; never close it)
exec "${SHELL:-bash}" -i
```

Wait for completion from the orchestrator side:

```bash
bun ~/.agents/skills/goal/scripts/lane-wait.ts <return-file> [timeout-ms]
```
