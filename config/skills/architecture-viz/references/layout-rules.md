# Layout rules — coordinate recipe and label catalogue

Detailed geometry for hand-authored SVG dependency graphs. Read this when the graph is non-trivial (≥6 nodes or ≥2 edges sharing a corridor).

## 1. Canvas and grid

| thing | value |
|---|---|
| viewBox width | 1440 (template `.wrap` is 1340px wide − 2×28px padding = 1284px content → ~0.89 scale) |
| node width | 340–360 |
| column gap | ≥120px; 180+ if labels/edges share the gutter |
| row pitch | node height + ≥60px free band for labels/edges (64-tall rows → 130 pitch; 124-tall rows → ≥184) |
| node height | 64 = title + 1 sub; 76–124 = title + 2 subs |
| label font | mono 11px → avg advance ≈ 6.6px/char (estimate width, then verify) |
| label box | ascent 8.5 above baseline, descent 2.5 below |

The template's SVG uses columns `x = 60`, `520`, `1060` (canvas 1440, 340–360 wide boxes, right margin 40) and its single sample row at `y = 88` (box 88–152, edge at y 120). Worked example rows below assume 64-tall boxes: `y = 40`, `170`, `300`, `430`, `560`, `690`, `820` (pitch 130 = 64 + 66 free). A row of 76–124-tall boxes needs pitch ≥184; recompute rather than reusing the 64-row list.

Reserve **dedicated corridors**: 
- left margin `x < 60` — long bypass routes + rotated labels
- between col1 and col2: `x = 400..520`
- between col2 and col3: `x = 880..1060`
- top band `y = 0..36`, above the first row baseline (`y = 40`) — cross-canvas horizontal runs (config loads) + their labels

Layer classes and palette tokens (the template maps these; any other `class="n <layer>"` falls back to a neutral grey):

| layer | class | token | colour |
|---|---|---|---|
| bootstrap | `n boot` | `--a` | `#f2b344` |
| services | `n svc` | `--c` | `#38bdf8` |
| consumers | `n cons` | `--e` | `#4ade80` |
| engine | `n eng` | `--b` | `#a78bfa` |
| config | `n cfg` | `--d` | `#2dd4bf` |
| tooling | `n tool` | `--g` | `#94a3b8` |
| tests | `n test` | `--h` | `#60a5fa` |

## 2. Edges

Procedure — do this on paper before writing `<path>`:

1. List edges: `(from, to, verb, style)`.
2. Choose departure and arrival **points on node edges** (y inside the source's vertical span; x inside the target's span) spread across the edge so parallel edges don't stack on the same 10px.
3. Pick elbow lane(s): for `M… H… V… H…` routes, the shared vertical is a lane. One lane per edge family; if two edges must share an x, give them disjoint y spans.
4. Write the `d` string with explicit numbers: `M400,200 H470 V52 H1060`.
5. Check every segment against every node rect — the rectangle-span test:
   `segment.y in [rect.y0-pad, rect.y1+pad]` and `segment.x-range overlaps [rect.x0, rect.x1]` (diagonal `L` runs: proper segment-vs-rect intersection) → violation. Endpoints may touch a box edge; only a passage through the interior counts. The checker enforces this for every edge segment.
6. Endpoints must sit **exactly** on a node edge (within 2px); the checker verifies.

Conventions: solid = constructs/owns/creates/calls, dashed = resolve/deferred/future; arrowhead = caller → callee. Legend states both.

## 3. Label placement catalogue

Place each label by case, in this priority:

**A — horizontal run, room above** (normal case): anchor `middle`, `y = line.y - 8`, centered on the run's midpoint.
`<text class="elabel" x="765" y="44" text-anchor="middle">loads configs (parallel, async)</text>`

**B — vertical run, room right**: anchor `start`, `x = line.x + 12`, `y = midpoint + 4`.

**C — corner boxed in** (label would enter a node or cross another line): attach to a different segment of the same edge (the final approach run is usually free), or shorten the label. Example: `additive load` above the arrowhead approach instead of centered on the long run.

**D — two parallel stubs (danger)**: never stack two labels between two parallel lines — association becomes ambiguous. Put each label **outside** its own line (above the upper line / below the lower line), or center each on its own final approach segment.

**E — margin bypass route**: rotated label along the vertical margin segment:
`<text class="elabel" transform="translate(16,430) rotate(-90)" text-anchor="middle">WhenReady(onReady, onFailed)</text>`
Glyphs extend from `x-8.5` (ascent) to `x+2.5` (descent) around the translate point; keep ≥4px from the line.

**F — label still colliding**: widen the corridor by shifting the far column +40…+80px (cheap, canvas is 1440 wide) before shortening text. Prefer meaning over abbreviation.

All labels carry the halo: `.elabel { paint-order: stroke; stroke: <panel-bg>; stroke-width: 4px; }` so lines passing under stay readable.

## 4. Anti-patterns (observed in practice)

- **50px gutters.** Everything collides: labels overlap boxes, two arrows share a lane, arrowheads land on wrong boxes. Fix: ≥120px corridors, 340-wide boxes, split rows.
- **Free-form curves** (`C…` beziers) to reach distant nodes. They land wherever, cross boxes, and cannot be linted. Fix: orthogonal elbows through corridors (the checker rejects `C/S/Q/T/A` as a parse error).
- **Label floating between two lines** it doesn't belong to → readers mis-associate. Fix: glue each label to its own segment (cases A/B/D).
- **Labels starting flush at a node edge** in a busy corner → they visually merge with the box. Fix: offset 10px+ and prefer the midpoint of the run.
- **Mixed runtime + editor nodes** in one graph → spaghetti. Fix: runtime graph only; tooling/tests as HTML panels below.
- **Long sub-lines in small boxes** — text clipped at render. Fix: box height/width per rule table, ≤2 sub-lines, and the checker's text-fit test.
- **Re-rendering after every pixel-nudge.** Slow and noisy. Fix: batch edits, run the checker, one screenshot + vision pass per revision.

## 5. Verification loop

1. `python3 <skill-dir>/scripts/check-svg-overlaps.py <file>` → fix findings (it approximates font width; treat as lint). It also runs the rectangle-span test (edge segment through a node box) for you.
   - Exit codes: `0` clean (prints `clean: … N nodes, M edges, K labels`), `1` findings, `2` usage or parse error (malformed SVG, renamed classes, unsupported path command, no nodes/edges/labels). Exit `2` is a hard stop, never a pass.
2. `bash <skill-dir>/scripts/render-check.sh <file> /tmp/viz.png` → screenshot. Exit codes: `0` fresh PNG, `1` browser present but failed, `2` usage/missing file/bad width-height, `3` no browser found. A pre-existing PNG is never accepted as a fresh render.
3. Text-only model: delegate the PNG to a vision agent (name the vision model explicitly; this user prefers `opencode-go/mimo-v2.5`). Ask for: label/line/box overlaps with coordinates, detached labels, arrowheads off edges, clipped text, remaining tightness.
4. Apply fixes, re-run 1–2 once. Ship when clean + no visible findings.

## 6. Checker contract

`scripts/check-svg-overlaps.py` parses a fixed subset; keep generated SVGs on it or it exits `2` instead of guessing. Required per SVG it inspects:

- **node groups** — `<g class="n[ <layer>]" transform="translate(x,y)">` with a **direct** `<rect width height>` child; the first `<text>` child is the node name. No transformed ancestor: a node nested under a `<g transform=…>` (or transformed `<svg>`) is a parse error, not a silent check at untransformed coordinates.
- **edges** — `<path class="edge[ dash]" d="…">` using absolute `M/H/V/L/Z` only, including compact syntax (`M400,120H900,300`) and repeated coordinates. No curves, no relative commands, no `transform` attribute, no transformed ancestor. Both ends of every subpath must land on a node edge.
- **edge labels** — `<text class="elabel[ …]">` with either `x`/`y` attributes or `transform="translate(x,y)"` (optionally `rotate(-90)`), never both; `text-anchor` `start`/`middle`/`end`; no transformed ancestor.

Anything else — `C/S/Q/T/A`, lowercase relative commands, `rotate(a x y)`, `matrix(...)`, an x/y-plus-transform label, a `transform` on a `path.edge`, or any transformed ancestor — is a parse error, never silently skipped. If no nodes, edges, or labels parse, the checker exits `2` rather than reporting clean, and the clean line always reports the parsed counts. Keep this list in sync with the counts the checker prints.

When several `<svg>` elements are present, the checker picks the first containing a node group; pass the optional `svg-index` argument to override.
