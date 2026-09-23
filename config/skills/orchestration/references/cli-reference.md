# CLI reference (pinned — do NOT probe `--help`)

The signatures below are authoritative for the pinned binaries. Every
lane and dispatch path uses ONLY these forms. Trust this file; if a
signature errors, FAST EXIT naming it — never fall back to interactive
discovery (`luvus help all` is the one sanctioned discovery command, and only
outside a lane).

Pinned: `luvus 0.14.2`, `opencode 2.0.1`, `bun`.

## Environment guard

```bash
test "${LUVUS_ENV:-}" = 1          # else FAST EXIT: not a luvus session
command -v luvus opencode bun      # else FAST EXIT naming the missing binary
```

## luvus — exact signatures used by orchestration

Every control command prints a JSON envelope; read IDs from `.result`, never
predict them. Pane ids are strings; tab positions are 1-based; workspace
indexes (`workspace list` → `display_position`) are 0-based.

Layout (the master + lane grid is built once per wave by `lane-layout.ts`,
which wraps the primitives below):

```bash
luvus uhp snapshot                          # .result.workspaces[].tabs[].panes[].pane_id
                                            #   -> the only pane -> tab mapping luvus exposes
luvus workspace list                        # .result.workspaces[].{name,cwd,active,display_position}
luvus workspace focus <display_position>    # 0-based
luvus tab list                              # .result.tabs[].tab (1-based), .active
luvus tab focus <n>
luvus tab new                               # .result.tab (the new tab becomes active, 1 pane)
luvus pane list                             # panes of the ACTIVE tab
luvus pane split <pane-id> --auto --no-focus   # -> .result.pane (new pane id), .result.tab
```

Drive a lane (foreground, visible; pane persists through the loop, closed by
the orchestrator at plan DONE/FAILED):

```bash
luvus pane run <pane-id> bash /abs/path/<slug>-runner.sh   # submits text + Enter
luvus pane run <pane-id> "cd '<abs-worktree>'"             # park the lane shell in its worktree
luvus pane close <pane-id>                                 # only panes YOU created
```

Output inspection:

```bash
luvus wait output <pane-id> --match "<text>" --timeout <s>   # exit 0 = match, 2 = timeout
luvus pane status <pane-id>                                  # .result.{pane,status,agent}
luvus pane read <pane-id>                                    # recent output; EMPTY without an
                                                             # attached client — never a completion signal
```

`sleep` is NOT a completion signal. The lane signal is the return file, waited
on with `lane-wait.ts` (below); `luvus wait output` is only for output text you
must observe mid-lane.

Native agent kinds (only if the user explicitly asks for a non-opencode agent;
orchestration lanes use `pane run`, never these):

```bash
luvus agent list
luvus agent start <name> --kind <backend> --anchor <pane-id> --timeout <s> [-- <args>]
luvus agent prompt <name> "<text>" --wait --timeout <s>
luvus agent keys <name> esc|ctrl+c
luvus agent get <name>
luvus agent read <name> --lines 120
```

Ratio-accurate layout is UHP-only (`luvus pane split` has no ratio flag). The
one bridge used by orchestration is `luvus uhp proxy`, which takes ONE LF-framed JSON
request on stdin (a missing trailing newline is rejected as
`request is missing LF`):

```bash
printf '%s\n' '{"id":"x","method":"layout.apply","params":{"tab":"1","tree":{"Leaf":1}}}' | luvus uhp proxy
```

`layout.apply` requires the tree to contain every pane of that tab exactly
once. Tree grammar (verified against `layout.export`):

```
Node := {"Leaf": <pane-id as a NUMBER>}
      | {"Split": {"a": Node, "axis": 0|1, "b": Node, "ratio": <0..1>}}
```

`axis 0` = side by side (`a` left), `axis 1` = stacked (`a` top), `ratio` =
the fraction of the split that `a` keeps.

## opencode — the only invocation orchestration uses

```bash
opencode run --auto --model <provider/model#variant> --agent <role> "<prompt>"
```

- The prompt is a POSITIONAL argument. There is NO `--prompt` flag.
- `--auto` is MANDATORY on every lane invocation — it auto-approves
  permissions that are not explicitly denied. Never omit it: without it a
  lane stalls on permission prompts or denials.
- `--model provider/model#variant` and `--agent <role>` are required and
  passed explicitly: the agent md `model:` pin does NOT auto-apply to a
  primary `opencode run --auto --agent` session (child/subagent sessions
  only).
- Resume a lane that died before DONE (state lives in the worktree):
  `opencode run --auto --model <...> --agent <role> --session <session-id> "<prompt>"`.
- Other valid flags: `--continue/-c`, `--fork`, `--file/-f`, `--title`,
  `--thinking`, `--format default|json`, `--standalone`, `--server`.
- Preflight auth once: `opencode auth list`. Default model error
  (`No cookie auth cred`) or a bad approved model → FAST EXIT naming it,
  never substitute.

## Canonical lane runner (copy verbatim, fill the `<>`)

Write the brief to `<slug>-brief.md` and this runner to `<slug>-runner.sh`
(both beside the worktree, or `/tmp/opencode/`). One lane, one runner.

```bash
#!/usr/bin/env bash
# orchestration lane runner — generated, do not hand-edit. <slug>
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
opencode run --auto --model "$MODEL" --agent "$ROLE" "$(cat "$BRIEF")" 2>&1 | tee "$TMP"
rc=${PIPESTATUS[0]}

# atomic: the file's appearance means the runner FINISHED, not that the lane
# succeeded. rc=0 is real completion; rc!=0 -> FAST EXIT/WAIT, never green.
{ printf 'rc=%s\n' "$rc"; cat "$TMP"; } > "$TMP.out" && mv "$TMP.out" "$RETURN"
echo "lane $SLUG done rc=$rc -> $RETURN"
```

No trailing `exec $SHELL`: `luvus pane run` submits the command line to the
pane's existing interactive shell, so the pane returns to its prompt (and keeps
its scrollback) when the runner exits.

Wait for completion from the orchestrator side:

```bash
bun ~/.agents/skills/orchestration/scripts/lane-wait.ts <return-file> [timeout-ms]
```
