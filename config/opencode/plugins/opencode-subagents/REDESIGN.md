# opencode-subagents — redesign (design-graph method)

Method: `design-graph` (r17x). The artifact is an interface: surfaces, units,
states, moves. Shared rule: any state the surface can render must be named here;
any surface reachable without its need met is a design hole.

Scope: **S1 + S2** — a sidebar monitor (S1) with an overflow popup (S2). There
is no per-subagent detail panel.

## Job

> Watch what my subagents are doing right now, at a glance.

Behavioral fact the design must honour: **`done` is not terminal.** OpenCode V2
can resume a completed subagent session, so a row's state can return to
`running`. The surface never caches `done` as final.

## 1. Surfaces, units, states, moves

### Surfaces
| Id | Surface | Host slot | Cardinality |
|----|---------|-----------|-------------|
| S1 | Subagents list | `sidebar.content` | **live list** (many, changing while read) |
| S2 | Overflow popup | host `ui.dialog` | live list of the hidden units |
| S3 | Header aggregate | inside S1 | live scalar |

### Units
- `Row` (S1) — one subagent as a **3-line block**:
  - L1 name/kind row: `statusGlyph + " " + agent` on the left, **`status`
    right-aligned to the content edge** (glyph colored by state: `●` running,
    `✓` done, `✕` error, `◐` interrupted, `○` idle; agent bold `text.default`).
    **No base indent** — depth 1 is flush-left.
  - L2: `model` | `elapsed`.
  - L3: `tokens` | `cost`.

  One field per cell; L2/L3 carry the nesting indent in col A, L1 is flush-left.
  Col B (`status`, `elapsed`, `cost`) is **right-aligned to the content edge**;
  col A is left-aligned. Each cell truncates to its own width; an absent field
  leaves its cell blank — never stretch the other cell into a jammed line.
- `VoidLine` — one designed single-fact line per absent state.
- `MoreLine` — overflow marker; the whole line is the S2 open target.
- `Header` — collapse toggle: **`▼ SUBAGENTS`** expanded / **`▶ SUBAGENTS (N)`**
  collapsed, large chevron matching the host's `▼ MCP`. The whole header line is
  the toggle hit target. Its right side carries the aggregate over the **full**
  descendant set (`N run · $total`), the only right-aligned element in S1.

### States of a `Row`
`running | idle | done(resumable) | error(retryable) | interrupted` ×
`fresh | stale` × `rest`.

`done` and `interrupted` are resumable: a later refresh may show `running`
again. No terminal latch.

### Moves
`collapse/expand` on S1; `open/close` S2. Rows are read-only.

## 1b. S2 layout — overflow table (revision 7)

**User-approved A′ look, rebuilt as a flexbox table.** Supersedes revision 4's
split (metrics on L2): the **full row — including TIME/TOKENS/COST — sits on L1**,
vertically aligned with agent/title/status, and **L2 carries the model alone**.
Each hidden subagent is a **two-line column block**; there is **no
container-width math anywhere**: the renderer's flexbox clamps the flexible
`TITLE`/`MODEL` cell to the real dialog content width, so a row can never
overflow it. Revision 6 makes every fixed column **data-driven and
deterministic** (see the column model): its width is computed once for the whole
hidden set from the actual cell strings, so identical rows always produce an
identical grid. `SubagentRow`/`Row` stays S1's narrow 38-col geometry; the dialog
renders its own `DialogRow`.

### Column model

Each row is one `<box flexDirection="column">` holding two
`<box flexDirection="row" width="100%">` lines; each column is a text node whose
size and alignment come from native layout props. **L1 carries all seven cells
with their values** — glyph, agent, title, status, time, tokens, cost. **L2 has
exactly three nodes**: a blank glyph cell (1), a blank agent cell (`grid.agent`),
then the model with `flexGrow 1`, so the model's left edge stays aligned with the
title column and it spans the whole remaining width.

The fixed columns are **data-driven and deterministic**.
`variants.dialogGrid(rows, now)` computes each column's node width **once for the
whole hidden set**:

```
node width = max(display-width of every row's value, display-width of the header label) + separator length
```

with `separator length` 1 for the agent (`" "`) and 2 for the rest (`"  "`). The
header label is the **floor** (a short set still shows the full label), the value
is **display-width aware** (a wide agent/status/metric is never truncated), and
an empty set yields the header floors alone. The result is passed to the header
and every row, so all rows and the header align on the same columns; identical
rows always yield an identical grid. There is no `T` computation and no
optional-column dropping — the flexible middle absorbs whatever the dialog width
allows.

```
glyph(1) | agent(grid.agent) | flex(title/model) | status(grid.status, right) | time(grid.time, right) | tokens(grid.tokens, right) | cost(grid.cost, right)
```

At 80 columns the flexible middle cell gets the remainder.

```
  SUBAGENTS                                         6 more · 2 running · $9.32
  AGENT       TITLE                     STATUS    TIME   TOKENS     COST
  ● reviewer    review …middleware …    running     12m    48.2k    $1.23
                anthropic/claude-…
  ✓ researcher  codegraph index for …   done        26m     210k    $4.87
                openai/gpt-5
```

L1 is the complete table row; L2 is the model only, starting at the title
column. Rows stay tight — L1 then L2, no blank line between blocks.

### Text-node props

| cell | line | width | align | truncate | wrapMode | fg / attributes |
|------|------|-------|-------|----------|----------|-----------------|
| glyph | L1 | 1 | left | — | none | `statusStyle().fg`, BOLD |
| agent | L1 | `grid.agent` | left | yes | none | `textDefault`, BOLD |
| title | L1 | `flexGrow 1`, `minWidth 0` | left | yes | none | `textDefault` |
| status | L1 | `grid.status` | right | — | none | `statusStyle().fg`, BOLD |
| time | L1 | `grid.time` | right | — | none | `textMuted` |
| tokens | L1 | `grid.tokens` | right | — | none | `textMuted` |
| cost | L1 | `grid.cost` | right | — | none | `textMuted` |
| glyph | L2 | 1 | left | — | none | `textMuted` (blank) |
| agent | L2 | `grid.agent` | left | yes | none | `textMuted` (blank) |
| model | L2 | `flexGrow 1`, `minWidth 0` | left | yes | none | `textMuted` |

The glyph and the status word share `statusStyle().fg`; the status word is
`BOLD` like the sidebar label. The agent name is bold `textDefault`; the title is
`textDefault`; the model and the right-aligned metrics are `textMuted`; the
header labels are `textMuted`. The blank L2 lead cells keep their node widths so
the model stays aligned with the title column. No row tinting.

### Title row

`<box flexDirection="row" justifyContent="space-between">`: left `SUBAGENTS`
(`textDefault`, `BOLD`), right the aggregate over the hidden set (`textMuted`),
`` `${n} more · ${r} running · ${fmtCost(total)}` `` with the `· ${r} running`
clause dropped at `r = 0` (`variants.dialogAggregate`). The space-between row
right-aligns the aggregate to the inset without width math; the aggregate text
truncates if the dialog is narrower than it. The empty state's right side is
`0 hidden`.

### Header row

Shares the same `grid` (and therefore the same cell widths/alignments) as the
data rows, with muted labels `AGENT / TITLE / STATUS / TIME / TOKENS / COST`
(blank glyph cell, title label `flexGrow 1`), rendered once above the scrollbox,
outside it, so it does not scroll away.

### Empty

The title row shows `0 hidden`; the body shows a padded muted
`no hidden subagents` line; no header row.

### Padding

The title row, header row and scrollbox are wrapped in a single
`<box paddingLeft={2} paddingRight={2} flexDirection="column">`, so every line
gets the same symmetric 2-col inset from box padding rather than from per-cell
string prefixes.

### Scroll behaviour

`<scrollbox maxHeight={17}>` around the data rows; the title and header rows stay
above it. Rows keep the existing overflow order (`windowChildren().overflow`:
running first, agent weight then recency). There is no `+K more` line inside S2 —
the dialog *is* the "more".

**Revision 7:** the scrollbox renders with `scrollbarOptions={{ visible: false }}`
so it reserves no scrollbar column; otherwise its children (the rows) are one
column narrower than the header row above it and every right-anchored column
shifts one cell left. This keeps header and rows aligned whether or not the list
scrolls (host `dialog-select.tsx` uses the same option).

**Revision 8:** `TIME` (S2) and `elapsed` (S1 L2) are the **session's own
duration**, not wall-clock since `created`. While `running` they tick with `now`;
once finished they **freeze at completion** — `time.idle`, falling back to
`time.updated`, floored at 0 — so a finished row stops growing. A resumed
`running` session can carry a stale `idle`, so the status check wins.
`sessionDuration(child, now)` is the single source for both surfaces, and
`dialogGrid` sizes the `TIME` column from it, so the frozen value keeps its
column width.

### Truncation

Native `truncate` (verified on `@opentui/core` 0.5.12) ellipsizes overflow with
`...`; without it, `wrapMode="none"` clips at the cell width. `truncate` is set on
the agent, title and model cells (the variable-width ones); the fixed
right-aligned cells are sized by `dialogGrid` to contain their widest value, so
the status column floors at the `STATUS` label and widens to `interrupted` (11)
when present — no fixed cell ever truncates its value.

## 2. C — happy path flow graph

```
Host session view
   │  (slot mounted for the viewed session)
   ▼
S1 SubagentsList ──collapse/expand──► S1 (same surface, no body)
   │  click "+N more"
   ▼
S2 Overflow popup ──ESC/backdrop──► closed
   ▲
   └── live refresh keeps row state current (running ⇄ done ⇄ running)
```

Two surfaces: S1 reshapes its own body on collapse; S2 is a transient overlay
opened only while S1 has hidden units.

## 3. Cardinality

- S1 is a **live list**: each unit is a small 2-column block; never reorder the
  row under the cursor; survive 0 / 1 / 10,000.
- S3 is a live scalar over all descendants, never the only signal of change.

## 4. V — void states (all designed)

| V | When | S1 renders |
|---|------|-----------|
| Empty | hydrated, zero descendants | header + grey `no subagents` |
| Loading | not yet hydrated | header + grey `loading subagents…` |
| Partial | rows exist, some syncs failed | rows + warning `! K sync failed` |
| Error | nothing could be fetched | header + `sync failed — <reason>` |
| Denied | n/a | — |
| Unhydrated | restart before the index fills | `Loading`, re-read until settled — never `Empty` |

Empty and Loading must remain visually distinct.

S2 has one defensive void: opened with zero hidden units it renders a muted
`no hidden subagents` line instead of an empty list. In practice the trigger
refuses to open when the overflow is empty, so the line is a safety net.

## 5. N — needs on the edges

- S1 needs: the viewed `sessionID`; the **descendant set**; theme.
- The blocker found in live testing: the TUI data layer is SSE-cached and empty
  right after a restart. `data.session.list()` is the only working 2.0.2 surface
  (`client.v2` and `client.session.children` do not exist). Hydration reads that
  list (recursing by `parentID`) and, if it is empty, stays `Loading`.
- **First-frame constraint:** the host slot renderer does NOT add nodes after
  mount. Every row must exist on the **first frame**, so the store is seeded
  **synchronously** at mount from `data.session.list()` + `data.session.get(id)`;
  the async refresh then updates values in place. Async must never be
  responsible for introducing structure.
- Viewport: ~37-col sidebar. Window to a line budget (4 units) with `+K more`.
- S2 needs: the hidden units (the window's overflow slice), theme, the host
  `ui.dialog.show` capability, and the **content width** (`§1b Width source`).
  It renders the `DialogRow` wide table (`§1b`), not the S1 3-line block, and
  shares the same 1s tick, so it is live; its mount path permits dynamic rows
  (unlike S1).

## 6. Boundary

Normalize `session.list()`/`get()` data into `SubagentSummary` once, at the
boundary (`summarizeSession`). "Index not ready" is a distinct value, not an
empty array.

## 7. Behavior wraps, never reshapes

Poll cadence, the relative-clock tick, and collapse are layers. Removing them
must not remove content.

## 8. Scope attention

S2 is a transient overlay opened from S1 and dismissed by ESC/backdrop; it holds
no persistent state. Collapse state is the only persistent UI state; no focus is
acquired, so nothing must be released.

## 9. Swap N — re-walk four times

- **Day one** — no subagents: `no subagents`; graph legible.
- **Year three** — 10,000 sessions: window to 4 units + `+K more`; header
  aggregate still totals all.
- **Least access** — n/a (no permissions on sessions).
- **Small + slow** — restart + slow index: `Loading` then fills; narrow width
  keeps cells within `CONTENT_W`.

## 10. Tree = C, variants = V

- Component tree renders the happy path only (header + rows). `SubagentRow` is
  S1's frame; S2's popup renders `DialogRow` (`§1b`).
- `variants.ts` enumerates every V state and Row state. No state branching in
  the tree beyond the `<Switch>` over `voidKind` and S2's zero-hidden fallback.

## Frame discipline (host constraint)

The slot renderer cannot add or move nodes after mount, so S1 renders a **fixed
frame** on the first frame: header (label + aggregate), a void line, exactly
`MAX_UNITS` four-line row blocks (every text node present, blank when unused),
and a more line. All later changes are text rewrites.

Consequence for ordering: the window orders **running units first** (globally),
so a resumed `done → running` subagent is written into the top slot on the next
refresh — a text swap, never a node move. Inside the running group the order is
**agent weight first, then recency** (most recently updated, tie-broken by most
recently created); the rest (done/idle) group keeps plain recency. Weight is
lower-is-more-important and unknown kinds rank last:

| Agent | Weight |
| --- | --- |
| `reviewer` | 0 |
| `swe` | 1 |
| `researcher` | 2 |
| `steward` | 3 |
| unknown | 100 |

This keeps important agents visible within the `MAX_UNITS` (4) sidebar window
even when a resumed unit would otherwise sort ahead of them. The header
aggregate reflects the full descendant set (`N run · $total`); the header nodes
are function children so they repaint with the frame.

## Craft — no padding, one accent per row

- **No top padding**: there is no standalone void row. The header's right slot
  carries the aggregate when the frame is `rows`/`partial`, and the void
  sentence (`loading subagents…` / `no subagents` / `sync failed — …`) when it is
  `loading`/`empty`/`error`. Nothing consumes a row when there is data.
- **No horizontal padding**: rows are flush to the sidebar content edge. Only
  nesting (depth ≥ 2) indents, by one step.
- **One accent per row**: the colored status glyph. Everything else is
  `text.default` (agent, bold) or `textMuted` (model, tokens, cost, elapsed).
- **Overflow** stays a single bottom line (`+K more`) so extra units never claim
  more than one line.

## Gap list — current plugin vs this graph

1. Rows packed facts horizontally → now a 2-column grid, one field per cell.
2. `Empty`/`Loading` rendered nothing → designed lines.
3. `Unhydrated` indistinguishable from `Empty` → hydration state; `Loading`
   until the list settles.
4. No `Partial` state → `! K sync failed` footer.
5. Small `▾`/`▸` chevron → large host-matching `▼`/`▶`, full-line hit target.
6. Error line could exceed 37 cols → clamped.
7. Async-only first paint produced a permanent `loading` ghost → synchronous
   first-frame seeding (host renderer constraint).
8. `interrupted` status was unreachable → distinct warning state.

## Verifications — RESOLVED (2.0.2)

- Children listing: `data.session.list()` (works; returns all sessions incl.
  children). `client.v2` and `client.session.children` do NOT exist on 2.0.2.
- TUI data layer also exposes `data.session.message.list` (used by nothing now).
- `done` sessions are resumable via `POST /api/session/{id}/prompt` with
  `resume: true` — informational only; this plugin exposes no continue action.
- Host renderer does not add nodes after mount (see §5).

## Next step

S1 and S2 are implemented. Remaining polish: exact window height vs the real
sidebar row budget (never measured), unicode-width truncation, and confirming
the collapse round-trip and the S2 open/close live. No per-subagent detail panel.
