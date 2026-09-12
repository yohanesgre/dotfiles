# opencode-subagents — redesign (design-graph method)

Method: `design-graph` (r17x). The artifact is an interface: surfaces, units,
states, moves. Shared rule: any state the surface can render must be named here;
any surface reachable without its need met is a design hole.

Scope: **S1 only** — a sidebar monitor. There is no detail panel.

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
| S3 | Header aggregate | inside S1 | live scalar |

### Units
- `Row` — one subagent as a **3-line block**:
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
- `MoreLine` — overflow marker.
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
`collapse/expand` only. Rows are read-only.

## 2. C — happy path flow graph

```
Host session view
   │  (slot mounted for the viewed session)
   ▼
S1 SubagentsList ──collapse/expand──► S1 (same surface, no body)
   ▲
   └── live refresh keeps row state current (running ⇄ done ⇄ running)
```

One surface. The only move reshapes its own body, not the graph.

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

## 6. Boundary

Normalize `session.list()`/`get()` data into `SubagentSummary` once, at the
boundary (`summarizeSession`). "Index not ready" is a distinct value, not an
empty array.

## 7. Behavior wraps, never reshapes

Poll cadence, the relative-clock tick, and collapse are layers. Removing them
must not remove content.

## 8. Scope attention

No overlays. Collapse state is the only persistent UI state; no focus is
acquired, so nothing must be released.

## 9. Swap N — re-walk four times

- **Day one** — no subagents: `no subagents`; graph legible.
- **Year three** — 10,000 sessions: window to 4 units + `+K more`; header
  aggregate still totals all.
- **Least access** — n/a (no permissions on sessions).
- **Small + slow** — restart + slow index: `Loading` then fills; narrow width
  keeps cells within `CONTENT_W`.

## 10. Tree = C, variants = V

- Component tree renders the happy path only (header + rows).
- `variants.ts` enumerates every V state and Row state. No state branching in
  the tree beyond the `<Switch>` over `voidKind`.

## Frame discipline (host constraint)

The slot renderer cannot add or move nodes after mount, so S1 renders a **fixed
frame** on the first frame: header (label + aggregate), a void line, exactly
`MAX_UNITS` four-line row blocks (every text node present, blank when unused),
and a more line. All later changes are text rewrites.

Consequence for ordering: the window orders **running units first** (globally),
so a resumed `done → running` subagent is written into the top slot on the next
refresh — a text swap, never a node move. The header aggregate reflects the full
descendant set (`N run · $total`); the header nodes are function children so
they repaint with the frame.

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

S1 is implemented. Remaining polish: exact window height vs the real sidebar row
budget (never measured), unicode-width truncation, and confirming the collapse
round-trip live. No detail panel.
