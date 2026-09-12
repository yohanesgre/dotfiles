# opencode-subagents — sidebar upgrade plan

Scope chosen by user: upgrade the **`sidebar.content` section** (not a full
panel). Read `RESEARCH.md` first — it is the authoritative API/constraint
reference for installed OpenCode **2.0.2** (binary-verified). The plan below was
produced by the `architect` agent, which could not read `RESEARCH.md` (sandbox);
its RESEARCH references are reconciled here and are not open questions.

## Global constraints (every phase)

- `/** @jsxImportSource @opentui/solid */` at top of every `.tsx`.
- Never `usePlugin()`; `data`/`theme` only via props from the `tui.tsx` closure.
- Never `border`/`title` on a `<box>` inside slot content — freezes the renderer.
- Flex spacers collapse in slot content: one padded string per `<text>` node,
  lines ≤ `CONTENT_W = 37`.
- Only 2.0.2 event names (RESEARCH.md §4). `session.next.*` does not exist.
- No local `.d.ts`; do not invent API beyond
  `listen / session.list / session.get / session.status / session.sync / ui.slot`.
- `tui.tsx` prop contract `{ sessionID, data, theme }` frozen. `index.ts` untouched.

## Resolved decisions

- **D1 tree** — walk full `data.session.list()` adjacency, DFS pre-order,
  cycle-guarded; add `depth` to `SubagentSummary`; indent `"  "` × `min(depth,2)`;
  re-budget widths so lines stay ≤ `CONTENT_W`. Same `•` bullet at all depths.
- **D2 overflow** — assume slot content has no scroll API (UNVERIFIED, Phase 0
  measures). Fallback: `MAX_VISIBLE` cap (start 8), running always kept, muted
  `+K more · M running` line.
- **D3 activity** — per-child `Activity { kind, label, at }`; `session.tool.called`
  → tool label, `session.text.delta` → `writing`, `session.reasoning.*` →
  `thinking`, `session.step.started` → `working`. Row 2 swaps to activity only
  while running and fresh (TTL 5s → `waiting…`). Keeps 2-line-per-child invariant.
- **D4 efficiency** — handler mutates activity O(1) + one trailing debounce
  (300ms); refresh syncs only running/dirty ids; keep 2s poll (event coverage of
  token/cost UNVERIFIED).
- **D5 void/partial** — loading = header + muted `syncing…`; empty = hidden;
  error = header + `errorLine`; partial = footer `! K sync failed`.
- **D6 contract** — `tui.tsx`/`index.ts` never change; no new props.

## Phases

### Phase 0 — baseline + dev harness (no source change)
Artifact: `BASELINE.md`.
1. Confirm worktree parity with `main` for the plugin path.
2. Dev loop: sync plugin dir to `~/.config/opencode/plugins/opencode-subagents/`,
   `opencode service restart`. (Hot reload UNVERIFIED.)
3. Capture sidebar at 80×24 and 80×40 for: 0 children, 1 running, 3 mixed, 9
   (force overflow).
4. **Overflow verdict**: does slot content scroll/clip/wrap/push? Record exact
   observation. Measure sidebar row budget → seed `MAX_VISIBLE`.
5. Nesting check: does `session.list()` expose grandchildren? (Current code shows
   direct children only.)
6. Record `opencode service restart` + log path recipe (`~/.local/share/opencode/log/opencode.log`).

Gate: `BASELINE.md` has commands, captures, explicit overflow verdict, row-count, `MAX_VISIBLE`.

### Phase 1 — nested tree (depth)
Files: `types.ts`, `useSubagents.tsx`, `variants.ts`, `SubagentSection.tsx`.
- `types.ts`: `depth` on `SubagentSummary`; `summarizeSession(info, status, depth)`.
- `useSubagents.tsx`: replace direct-child filter with DFS descendant walk over
  `session.list()` adjacency, cycle-guarded; `known` = all descendants; generalize
  the `session.created` branch to any known ancestor.
- `variants.ts`: `indentFor(depth)`; `row1`/`row2` subtract indent from widths.
- `SubagentSection.tsx`: pass `child.depth`; no new layout nodes.

Gate: grandchild appears indented; collapse hides whole tree; no freeze.

Post-review correction (applied): the flat list was globally sorted running-first,
which could render a running grandchild above its idle parent. Ordering is now
owned solely by `descendants()` — sibling groups sorted running-first then
created, DFS pre-order preserved; the render-time `sortChildren` was removed.
`known` is re-derived after each refresh. `useSubagents.tsx` renamed to `.ts`
(no JSX). Verified by `bun test` on fixtures (DFS parent-before-child, widths ≤ 37).

### Phase 2 — event-driven refresh efficiency (invisible)
Files: `useSubagents.tsx`.
- `refresh(ids)` syncs only given ids; full pass on first load/create.
- `scheduleRefresh(ids)`: one trailing 300ms timer, union of pending ids; handlers
  schedule instead of calling `refresh()` directly. Poll unchanged.

Gate: zero visual delta; rapid spawn/kill no flicker; CPU sane.

### Phase 3 — live activity line
Blocking prereq: confirm payload keys empirically (RESEARCH.md §4 gives event
names, not payload shapes; no `.d.ts`). Verify `session.tool.called` tool-name
key, `session.text.delta` shape, `session.reasoning.*` names, `sessionID` presence.
Files: `types.ts`, `useSubagents.tsx`, `variants.ts`, `SubagentSection.tsx`.
- `types.ts`: `Activity`; optional `activity` on `SubagentSummary`.
- `useSubagents.tsx`: `activity: Record<sessionID, Activity>`; map events; clear on
  terminal/idle; merge into summaries; scheduling from Phase 2.
- `variants.ts`: `activityLine(child, now, p)` — fresh (<5s) label, stale
  `waiting…`, else `undefined`.
- `SubagentSection.tsx`: row 2 = `activityLine() ?? row2`.

Gate: tool name shows while running; `writing` during streaming; `waiting…` after
5s stall; reverts on done.

### Phase 4 — overflow windowing
Files: `variants.ts`, `SubagentSection.tsx`.
- `MAX_VISIBLE` seeded from Phase 0 (default 8).
- `windowChildren(sorted, max)`: window along the **DFS order produced by
  `descendants()`** — never re-sort running-first globally, or Phase 1's
  parent-before-child invariant breaks. Keep running children that are already
  in the DFS window; return `hidden`/`hiddenRunning`.
- `moreLine(hidden, hiddenRunning)` muted `+K more · M running`.
- Render window; header count stays total.

Gate: exactly MAX rows + more-line; running never dropped; no wrap; fits `CONTENT_W`.

### Phase 5 — void/partial states
Files: `types.ts`, `useSubagents.tsx`, `variants.ts`, `SubagentSection.tsx`.
- `failedCount` on `SubagentsState`.
- `loadingLine()` = `syncing…`; `partialLine(k)` = `! K sync failed`.
- Loading branch header + muted line; rows branch optional partial footer; empty
  stays hidden; error unchanged.

Gate: loading line on cold start; partial footer with rows; error still works;
empty hidden.

## Suggested commits (only on explicit request)

- `feat(opencode-subagents): nested subagent tree with depth indent`
- `refactor(opencode-subagents): coalesce event-driven refresh, sync running only`
- `feat(opencode-subagents): live activity line for running subagents`
- `feat(opencode-subagents): window rows with "+K more" overflow line`
- `feat(opencode-subagents): loading and partial-sync void states`

## Open assumptions (all need empirical confirmation)

| # | Assumption | Resolved by |
|---|---|---|
| A3 | Slot content has no scroll/viewport API | Phase 0 step 4 |
| A4 | `session.list()` returns grandchildren | Phase 0 step 5 / Phase 1 |
| A5 | `session.created` payload `parentID` works for any known ancestor | Phase 1 |
| A6 | tool-name key / reasoning event names / delta payload shape | Phase 3 prereq |
| A7 | TUI needs process restart to reload plugin; loader logs no plugin errors | Phase 0 step 2 |
| A8 | `MAX_VISIBLE`=8, debounce 300ms, TTL 5s | tunable |
| A9 | Row-2 activity swap (vs 3rd line) accepted | user can flip |
