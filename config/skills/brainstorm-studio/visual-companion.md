# Visual Companion Guide

Browser-based visual brainstorming companion for showing mockups, diagrams, design graphs, and options.

The companion is a **surface the user walks**, not a folder of pages. Design it with the graph method (`design-graph`, Surface<C,V,N>): content flow (**C**), void states (**V**), needs (**N**). The frame is the constant; screens flow through it. If the frame can render a state this guide cannot name, the interface is lying.

## The Graph

**Job:** the user looks at one visual question, answers it, and the agent continues the conversation with their answer.

**Surfaces**

| Surface | Role | Cardinality |
|---------|------|-------------|
| `Frame` | constant shell: header, status, scroll viewport | one |
| `Status` | live connection channel in the header | live value |
| `Screen` | one content fragment, newest file wins | one at a time |
| `Options` / `Cards` | choose among alternatives | list (0, 1, many) |
| `Mockup` / `Split` / `Graph` | inspect one design or graph | detail |
| `Waiting` | empty screen while the agent is back in terminal | one |
| `Events` | click log the agent reads next turn | append-only |

**C — happy path**

```
open(url?key) → Frame → newest Screen → user reads → click [data-choice]
  → selection + event → agent reads events + terminal → next Screen → …
Status (parallel, live): connecting → connected → reconnecting → disconnected
```

Every screen off this graph is a screen nobody asked for.

**Cardinality** — decide before layout:
- options/cards: list; must survive 0, 1, and many; uniform rows, selection as wash.
- mockup/graph: detail; full metadata, one primary reading.
- status: live; it changes while read — never present it as static chrome.

**V — void states** (each is a designed screen, not a fallback):

| State | When | What the user sees |
|-------|------|--------------------|
| Empty | no screen pushed yet | `Waiting` screen: "Waiting for the agent to push a screen…" |
| Loading | server starting, browser connected, no content | `Status` = "Connecting…"; frame renders immediately |
| Partial | screen resolved, agent back in terminal | `Waiting` screen: "Continuing in terminal…"; stale content cleared |
| Error | server stopped | `Status` = "Disconnected"; frame shows the **paused overlay** (auto-reconnects) |
| Denied | missing session key | server's key-required page |

**N — needs** (a screen without its needs is a hole in the graph):
- Frame needs a live server + valid `?key`. Without the key, never route the user there.
- A click needs `helper.js` (frame-injected) and a `data-choice` attribute on the element.
- Single-select needs the click inside `.options` or `.cards`; add `data-multiselect` to the container to allow many.
- `Waiting` needs the prior step to be terminal-only; it is a move, not a failure.

## The Loop

1. **Confirm the server is alive before pushing or referring to the URL.** Check that `$STATE_DIR/server-info` exists and `$STATE_DIR/server-stopped` does not. If it stopped, restart with the **same `--project-dir`** — same port, the open tab reconnects on its own.
2. **Write HTML** to a new file in `screen_dir`:
   - semantic filenames (`layout.html`, `visual-style.html`, `graph-aer.html`)
   - **never reuse a filename** — each screen is a fresh file
   - use your file-creation tool — **never `cat`/heredoc**
   - the server serves the newest file
3. **Tell the user what to expect and end the turn:** repeat the URL, summarize the screen in one line, ask them to reply in the terminal.
4. **On your next turn:** read `$STATE_DIR/events` (JSON lines of clicks) if it exists, merge with the terminal text, continue.
5. **Iterate or advance:** feedback that changes the current screen gets a new file (`layout-v2.html`). Only move on when the step is validated.
6. **Unload when returning to terminal:** push the waiting screen so the user isn't staring at a resolved choice:

   ```html
   <div class="waiting">
     <p class="subtitle">Continuing in terminal…</p>
   </div>
   ```

## Starting a Session

```bash
# Start AFTER the user approves the companion. --open auto-opens their browser on
# the first screen; --project-dir persists mockups and enables same-port restart.
scripts/start-server.sh --project-dir /path/to/project --open

# Returns: {"type":"server-started","port":52341,
#           "url":"http://localhost:52341/?key=ab12…",
#           "screen_dir":"/path/to/project/.agents/brainstorm-studio/12345-1706000000/content",
#           "state_dir":"/path/to/project/.agents/brainstorm-studio/12345-1706000000/state"}
```

Save `screen_dir` and `state_dir`. With `--open` the browser opens itself when the first screen is pushed; still share the URL as a fallback (headless/remote setups won't auto-open).

**The URL contains a session key (`?key=…`).** The server rejects any request without it. Always give the user the **complete** URL from the `url` field — never strip the query string, never hand out a bare `http://host:port`. The key gates HTTP and WebSocket access so a stray tab or another machine can't read screens or inject events. After first load the browser remembers it via cookie, so reloads and `/files/*` assets work without repeating it.

**Finding connection info:** the server writes its startup JSON to `$STATE_DIR/server-info`. If you launched it in the background without capturing stdout, read that file. With `--project-dir`, sessions live under `<project>/.agents/brainstorm-studio/`.

**Note:** pass the project root as `--project-dir` so mockups persist and survive restarts. Without it files go to `/tmp` and are cleaned up. Tell the user to gitignore the session artifacts but keep the specs: ignore `.agents/brainstorm-studio/*` and re-include `!.agents/brainstorm-studio/specs/` (git needs the negation because an excluded parent directory can't be re-included piecemeal).

**Launching by platform:**

**Claude Code** — default works (the script backgrounds itself):
```bash
scripts/start-server.sh --project-dir /path/to/project --open
```
On Windows the script switches to foreground; run the tool call with `run_in_background: true`, then read `$STATE_DIR/server-info` next turn.

**Codex** — auto-detects `CODEX_CI` and foregrounds; run it normally.

**Gemini CLI** — `--foreground` plus `is_background: true` on the shell call:
```bash
scripts/start-server.sh --project-dir /path/to/project --open --foreground
```

**Copilot CLI** — `--foreground` and start the shell call async; keep the returned shellId for `read_bash` / `stop_bash`.

**opencode2** — launch it with the shell tool in background mode (`background: true`) so the process survives across turns; the script also self-backgrounds, so the call returns immediately either way:
```bash
scripts/start-server.sh --project-dir /path/to/project --open
```
Read `$STATE_DIR/server-info` on your next turn for the URL and port. If your build reaps detached children, run `--foreground` and keep the tool call in background mode.

**Other environments** — the server must survive across turns. If detached processes are reaped, use `--foreground` with your platform's background mechanism.

**Remote/containerized (URL unreachable)** — bind a non-loopback host; `--url-host` controls the hostname printed in the JSON:
```bash
scripts/start-server.sh --project-dir /path/to/project --host 0.0.0.0 --url-host localhost
```

## Writing Content Fragments

Write just the content: **C**. The server wraps it in the frame (header, theme CSS, status, helper) automatically.

- Fragment (default): no `<!DOCTYPE>`, no `<html>`, no `<style>`, no `<script>`.
- Full document: only when you need complete control over the page. It is served as-is with the helper injected, and it loses the frame's status pill and void styles.

**Minimal screen:**

```html
<h2>Which layout works better?</h2>
<p class="subtitle">Consider readability and visual hierarchy</p>

<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content">
      <h3>Single Column</h3>
      <p>Clean, focused reading experience</p>
    </div>
  </div>
  <div class="option" data-choice="b" onclick="toggleSelect(this)">
    <div class="letter">B</div>
    <div class="content">
      <h3>Two Column</h3>
      <p>Sidebar navigation with main content</p>
    </div>
  </div>
</div>
```

## Components (C)

### Options (A/B/C choices)

```html
<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content"><h3>Title</h3><p>Description</p></div>
  </div>
</div>
```

**Multi-select:** add `data-multiselect` to the container; each click toggles that item. Without it, selecting one clears the rest.

### Cards (visual designs)

```html
<div class="cards">
  <div class="card" data-choice="design1" onclick="toggleSelect(this)">
    <div class="card-image"><!-- mockup content --></div>
    <div class="card-body"><h3>Name</h3><p>Description</p></div>
  </div>
</div>
```

### Mockup, Split, Pros/Cons

```html
<div class="mockup">
  <div class="mockup-header">Preview: Dashboard Layout</div>
  <div class="mockup-body"><!-- mockup HTML --></div>
</div>

<div class="split">
  <div class="mockup"><!-- left --></div>
  <div class="mockup"><!-- right --></div>
</div>

<div class="pros-cons">
  <div class="pros"><h4>Pros</h4><ul><li>Benefit</li></ul></div>
  <div class="cons"><h4>Cons</h4><ul><li>Drawback</li></ul></div>
</div>
```

### Mock elements (wireframe building blocks)

```html
<div class="mock-nav">Logo | Home | About | Contact</div>
<div style="display: flex;">
  <div class="mock-sidebar">Navigation</div>
  <div class="mock-content">Main content area</div>
</div>
<button class="mock-button">Action Button</button>
<input class="mock-input" placeholder="Input field">
<div class="placeholder">Placeholder area</div>
```

### Typography

`h2` page title · `h3` section heading · `h4` block heading · `.subtitle` secondary text · `.section` spaced block · `.label` small uppercase · `.badge` inline tag (`.badge.a` / `.badge.e` / `.badge.r`).

## Design Graphs

Graphs are first-class content — draw the design, don't describe it.

**A/E/R flow** (logic: happy path, break points, requirements). Nodes carry a kind tag; `.a` solid accent, `.e` dashed warning, `.r` dotted muted, `.n` pill for needs:

```html
<div class="graph">
  <div class="graph-caption">A — happy path · E — break points · R — requirements</div>
  <div class="graph-flow">
    <div class="graph-node a"><span class="k">A</span> Parse input</div>
    <span class="graph-edge">→</span>
    <div class="graph-node a"><span class="k">A</span> Persist record</div>
    <span class="graph-edge">→</span>
    <div class="graph-node e"><span class="k">E</span> Store unavailable</div>
    <span class="graph-edge">→</span>
    <div class="graph-node a"><span class="k">A</span> Return id</div>
  </div>
  <div class="graph-legend">
    <span class="graph-node n">R: DB pool</span>
    <span class="graph-node n">R: auth token</span>
  </div>
</div>
```

**C/V/N surface map** (interface: content flow, void states, needs) — reuse `.graph-flow` for the moves and `.states` for the voids:

```html
<div class="graph">
  <div class="graph-caption">C — content flow</div>
  <div class="graph-flow">
    <div class="graph-node a">Rail (scope)</div>
    <span class="graph-edge">→</span>
    <div class="graph-node a">List (C)</div>
    <span class="graph-edge">→</span>
    <div class="graph-node a">Detail (C)</div>
    <span class="graph-edge">→</span>
    <div class="graph-node a">Commit</div>
  </div>
  <div class="states">
    <div class="state empty"><span class="k">Empty</span>One grey sentence: what appears here.</div>
    <div class="state loading"><span class="k">Loading</span>Sketch keeps the layout's shape.</div>
    <div class="state error"><span class="k">Error</span>What failed, next to what failed.</div>
  </div>
</div>
```

## Void States (V)

Write them deliberately; the frame styles them.

```html
<!-- Wait: nothing pushed yet / agent back in terminal -->
<div class="waiting"><p class="subtitle">Continuing in terminal…</p></div>

<!-- Empty inside a component: one grey sentence, no chrome -->
<p class="empty">No options yet — they will appear here.</p>

<!-- A state matrix (e.g. before/after a design) -->
<div class="states">
  <div class="state partial"><span class="k">Partial</span>Two of three fields arrived; mark the missing one.</div>
  <div class="state denied"><span class="k">Denied</span>Read-only members see no affordance at all.</div>
</div>
```

Do not hand-roll error/loading chrome — the frame owns those styles (`.state`, `.empty`, `.waiting`), and the status pill owns connection state.

## Browser Events Format

Clicks on `[data-choice]` are recorded to `$STATE_DIR/events` (one JSON object per line). The file is cleared when a new screen is pushed.

```jsonl
{"type":"click","choice":"a","text":"Option A - Simple Layout","timestamp":1706000101}
{"type":"click","choice":"c","text":"Option C - Complex Grid","timestamp":1706000108}
```

The stream shows the user's exploration path; the last `choice` is usually the selection, but hesitation is worth asking about. If `events` doesn't exist, the user didn't interact — use their terminal text.

## Design Tips

- **Scale fidelity to the question** — wireframes for layout, polish for polish questions.
- **Explain the question on each page** — "Which layout feels more professional?" not "Pick one".
- **Iterate before advancing** — new file, not an edit.
- **2–4 options max** per screen.
- **Real content when it matters** — placeholder content hides design issues.
- **Keep mockups simple** — layout and structure over pixel-perfection.
- **Swap N before pushing** — walk the screen on day one (empty), at scale (many), with least access (affordances gone), and small/slow (one column, no motion).

## File Naming

Semantic names (`platform.html`, `visual-style.html`, `layout.html`, `graph-aer.html`); never reuse a filename; iterations take a version suffix (`layout-v2.html`). The server serves the newest file by mtime.

## Cleaning Up

```bash
scripts/stop-server.sh $SESSION_DIR
```

With `--project-dir`, mockups persist in `.agents/brainstorm-studio/` for later reference. Only `/tmp` sessions are deleted on stop.

## Reference

- Frame template (CSS component reference): `scripts/frame-template.html`
- Helper script (client behavior, status, selection, reconnect): `scripts/helper.js`
