# opencode.depth

A [Luvus](https://luvus.dev) companion module that gives OpenCode panes an
authoritative status and makes the sessions behind them visible: orchestration
lanes started with `opencode run` and background subagents that have no pane of
their own.

The shipped `luvus-v2` integration reports root-session identity for the TUI it
runs in. This module watches OpenCode's public HTTP/SSE surface instead and
publishes status through `agent.report` (authority `integration_report`), plus a
dock, a bar widget, and AGENTS titles.

## Requirements

- Luvus `>= 0.14.2` (the manifest declares `min_luvus_version = 0.14.2`).
- A running OpenCode shared service (`~/.local/state/opencode/service.json`).
- `bun` on the path of the Luvus **server** process (module commands run there).

## Install / link

```sh
luvus module link /path/to/config/luvus/modules/opencode-depth
luvus module info opencode.depth
luvus module log opencode.depth
```

`link` runs the `[[startup]]` launcher, which starts one detached watcher and
exits. The watcher is single-instance (pidfile under `LUVUS_MODULE_STATE_DIR`);
re-running `link` or the pane event hooks will not start a second one.

Open the monitor pane for a live tree:

```sh
luvus module pane open opencode.depth monitor --placement overlay
```

### Run mechanism (M1 note)

`[[panes]]` are **not** started automatically by `luvus module link` — a pane
opens only via `luvus module pane open`. The long-lived watcher is therefore
started by `[[startup]]` (a one-shot launcher, `src/startup.ts`) as a detached
process (`spawn(..., {detached:true})`), and revived by the `pane.created` /
`pane.closed` hooks (`scripts/nudge.sh`) if it ever dies. The monitor pane is a
separate `[[panes]]` entry.

### Start / stop

```sh
# start (idempotent)
luvus module run opencode.depth start

# stop
luvus module run opencode.depth stop
# equivalently:
kill "$(cat "${LUVUS_MODULE_STATE_DIR:-$HOME/.luvus/modules/state/opencode.depth}/opencode-depth.pid")"
```

### Logs

`luvus module log opencode.depth` shows only the **startup/action** commands Luvus
ran (the one-shot launcher, `start`, `stop`). The long-lived watcher runs
detached, so its own log is a file:

```sh
tail -f "${LUVUS_MODULE_STATE_DIR:-$HOME/.luvus/modules/state/opencode.depth}/opencode-depth.watcher.log"
```

The same directory holds `opencode-depth.pid`, `opencode-depth.monitor.json`
(the monitor pane's data), `opencode-depth.seq.json`, and the settings snapshot.
The watcher log never contains the module token or the OpenCode password.

The watcher releases every lease it holds on `SIGTERM`/`SIGINT` and clears the
dock, bar, and titles, so Luvus falls back to native detection. Start is
single-instance and atomic (one winner, losers exit quietly); stop only signals
a pid whose command line names `watcher.ts` and clears a stale pidfile.

## Settings (Settings → Modules)

| key | default | meaning |
|---|---|---|
| `source` | `opencode/depth` | `agent.report` integration source id |
| `ttl_s` | `900` | lease TTL in seconds (renewed at TTL/3) |
| `max_rows` | `16` | maximum dock rows |
| `bar` | `true` | publish the Luvus Bar widget |
| `title` | `true` | publish AGENTS sidebar titles |

## Surfaces

- **Dock `OPENCODE`** (sidebar, right) — one row per child session and per
  headless root lane, `dot` = `idle|working|blocked|done`. Empty → `no active
  children`. OpenCode unreachable → `opencode unreachable` (tone `error`).
- **Bar `OpenCode`** (top-right, priority 60) — overall `state`, a `done/total`
  badge, and a blocked badge when any pane is blocked. Hidden when nothing is
  mapped; `OC !` when degraded.
- **AGENTS titles** — `<N> subagents · <M> blocked` on a pane with children
  (OSC titles still win).
- **Monitor pane** — roots, lanes, children, connection state, skipped panes.

## Status model

Per mapped pane, over the pane's session tree (root + descendants via
`parentID`):

1. any pending permission request in the tree → `blocked` (message carries the
   request id and action);
2. any execution active → `working`;
3. a terminal execution (`succeeded|failed|interrupted`) within 120 s → `done`;
4. otherwise `idle`.

Exact `agent_session` mapping wins. A pane with no session is matched to a root
session by `cwd` (newest active drain first); ambiguous `cwd` is skipped and
logged, never guessed.

## Known blind spot

A detached background shell (`bash` tool with `background: true`) has no public
OpenCode session contract, so it is not observable. Background *subagent*
sessions are (they carry `parentID`).

## Tests

```sh
bun test          # unit + one live-process integration test
bun run typecheck
```

The integration test starts a real watcher against a fake OpenCode server and a
fake `luvus` binary, asserts a report is published, then asserts `SIGTERM`
releases the lease. No credentials are read or written.

## Uninstall

```sh
luvus module unlink opencode.depth
```

This removes the dock, bar, and titles. The watcher's leases expire on `ttl_s`
(or are released immediately if you stop the process first, as above).
