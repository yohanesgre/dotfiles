---
name: architecture-viz
description: 'Create a self-contained HTML architecture visualization of a codebase — a hand-authored SVG dependency graph plus subsystem, flow, and risk panels. Use when the user asks to visualize, map, diagram, draw, or chart a project''s architecture, dependencies, module structure, service graph, bootstrap flow, or how the system fits together; or when an architecture doc needs a viewer-friendly visual. Output is one offline HTML file. Not for data charts (create-viz), pre-code design graphs (design-thinking), or text call-flow answers (design-thinking).'
---

# Architecture Viz — HTML dependency graphs that read well

Produce a single self-contained HTML file that a human can open and understand: a layered dependency graph (hand-authored SVG, no libraries, no CDN), a boot/runtime sequence, per-subsystem panels, and an evidence footer. The hard part is not drawing boxes — it is **placement**: labels, arrows, and corridors. This skill encodes the rules that keep the graph readable, the failure modes that make it unreadable, and a verification loop that catches them without eyeballing.

This is for *documenting an existing system*. For charts of data use create-viz; for drawing a design before code exists use design-thinking; for call-path text answers use design-thinking.

## 1. Research first — build a node/edge inventory with evidence

Never draw from memory or filenames alone. Map the system before touching SVG.

- Delegate the mapping to a research/explore agent if the harness has one; otherwise read the core files yourself. Require `path:line` evidence for every claim.
- Inventory to collect, as a table:
  - **nodes** — name, layer (bootstrap / services / consumers / engine / config / tooling / tests), one-line responsibility, evidence path:line
  - **edges** — from → to, verb (constructs / owns / resolves / calls / persists / creates / deferred), solid vs dashed
  - **boot sequence** — ordered steps with failure behavior (rollback, guards, fail-fast)
  - **watch items** — gaps, inconsistencies, dead code, unimplemented designs; these make the viz trustworthy rather than marketing
- Layer the system left-to-right or top-to-bottom: composition root → services → consumers; engines/config on the outside. Pick 3–4 columns max.
- Keep the graph **runtime-only**; editor tooling and tests get their own panels below (a mixed graph is unreadable).
- Cap the graph at ~15 nodes. More means group into one box per subsystem and detail it in the panels.

## 2. Lay out on a coordinate grid BEFORE writing SVG

Write down explicit coordinates and path `d` strings first; edit numbers on paper, not by nudging rendered pixels. The rules below exist because the failure mode is always the same: tight gutters and labels squeezed between lines.

**Canvas and boxes**

- `viewBox` width 1440 (the template's `.wrap` is 1340px wide with 28px padding → 1284px content → ~0.89 scale). Vertical space is cheap; width is not.
- Node boxes ~340–360 wide. Heights: 64 (2 lines), 76–124 (3 lines) — title + up to 2 mono sub-lines.
- Columns of 3–4; horizontal corridors between columns ≥120px (180+ when several edges and labels share them). Vertical free bands between rows ≥60px for labels.
- Leave a full free band between a node column and the edge corridor; do not route lines through node rows.

**Edges**

- Orthogonal elbows only (`M… H… V…`, absolute commands; `L` for a deliberate diagonal). No curves. Each path starts and ends exactly on a node edge (departure y/x inside the edge's span); the checker verifies both ends of every subpath.
- Direction = caller → callee / consumer → dependency. State it in the legend.
- Solid = constructs / owns / creates / calls; dashed = resolve / deferred / future. State it in the legend.
- One lane per edge family. If two edges share an x (or y), give them **disjoint spans** on the shared axis; never overlap two lines.
- Verify every segment against every node rect (rectangle-span test) before rendering — a line through a box reads as a bug. The checker enforces this for every edge segment.

**Labels (the part everyone gets wrong)**

- Attach each label to its own edge: centered above a horizontal run, or just right of a vertical run, 8–12px off the line. Prefer the **midpoint of the longest segment**; if that spot is occupied, use the free band adjacent to the run.
- Never let a label enter a node rect or cross another line. The checker enforces this.
- Halo every label so it stays legible over the dot grid: `paint-order: stroke; stroke: <bg>; stroke-width: 4px`.
- Rotated labels (`transform="translate(x,y) rotate(-90)"`) only for long texts along a free margin. Keep them in the margin, never inside a corridor.
- If a corner is boxed in (labels with nowhere to go), first widen the corridor by shifting the far column, then shorten the label. Do not stack two labels between two parallel lines — the association becomes ambiguous.
- Legend under the graph: node colors by layer, plus the two line styles.

`<skill-dir>/references/layout-rules.md` has the detailed geometry recipe, worked coordinates, the label-placement catalogue, and the anti-patterns (50px gutters, free-form curves, floating labels) with what to do instead.

## 3. Build the page

Start from `assets/template.html` — copy it and fill it in. Its structure (keep it):

1. Header: title, one-line subtitle (what the system is + "no gameplay/business logic yet" honesty), stat chips (script count, key counts, test status).
2. **Runtime dependency graph** — the hero SVG. One `<section>`.
3. **Boot/runtime sequence** — numbered timeline, each step with the trigger and the failure behavior.
4. Two-column subsystem panels — per subsystem: how it works + its rules/invariants, with inline `path:line` refs.
5. **Editor/tooling** and **tests & seams** panels.
6. **Watch items** — gaps with severity chips; this is where trust is earned.
7. Footer: "static snapshot — <date>" + evidence paths.

Constraints: everything inline (no CDN, no JS needed) so it renders offline and in any preview pane; SVG text uses a mono font at 11px for labels; do not redesign the palette per project — reuse the template tokens (one color per layer).

## 4. Verify before delivering (mandatory)

Two passes; never claim "looks right" without at least one, ideally both:

```bash
python3 <skill-dir>/scripts/check-svg-overlaps.py docs/architecture.html   # exit 0 = clean
bash <skill-dir>/scripts/render-check.sh docs/architecture.html /tmp/viz.png
```

- Checker exit codes: `0` clean, `1` findings, `2` usage/parse error. A malformed graph (renamed classes, missing `rect`, an unsupported path command, no nodes/edges/labels) exits `2` and never prints "clean"; the clean line reports the parsed counts (`clean: <file> (svg #N): N nodes, M edges, K labels`). Treat it as a lint — it approximates font width — but treat a parse error as a hard stop, not a pass.
- Checker reports: label→node overlaps, label→line crossings, label→label overlaps, arrowheads not landing on node edges, node text wider than its box, and **edge segments crossing node box interiors** (the rectangle-span test; a segment may touch a box edge at its endpoints but not pass through the interior). Fix findings, re-run until clean.
- The checker's DOM contract — the exact classes/attributes it parses — is in `references/layout-rules.md` § Checker contract; keep generated SVGs on it.
- Render exit codes: `0` fresh PNG written, `1` browser present but no fresh PNG (its stderr is shown), `2` usage/missing file/bad width-height, `3` no chromium/chrome found. A stale PNG from a previous revision is never accepted.
- The render pass screenshots the page headlessly (chromium/chrome; falls back to manual open). If you are a text-only model, delegate the PNG to a **vision agent** and explicitly name a vision-capable model (this user prefers `opencode-go/mimo-v2.5`; otherwise ask). Checklist: any overlap with coordinates, detached/ambiguous labels, arrowheads off edges, clipped text, where it still feels tight.
- Batch fixes: one round of edits → checker → one render+vision per revision. Do not re-render per pixel.
- If the desktop browser is connected, present the result with the preview pane; otherwise report the file path. Suggested store: `docs/architecture.html`.

## Bundled resources

- `references/layout-rules.md` — geometry recipe, coordinate worked example, label catalogue, checker contract, anti-patterns. Read when the graph is non-trivial (≥6 nodes or ≥2 shared corridors). Paths in it and in `scripts/` resolve against the skill directory (`<skill-dir>/…`); `docs/architecture.html` is project-relative.
- `assets/template.html` — copy-and-fill skeleton (dark theme, tokens, SVG defs, section scaffolds).
- `scripts/check-svg-overlaps.py` — deterministic overlap/landing checker for the template's class conventions; the required DOM contract is in `references/layout-rules.md` § Checker contract.
- `scripts/render-check.sh` — headless screenshot helper (exit codes in § 4).
- `evals/evals.json` — realistic test prompts for validating the skill (fixtures via `evals/setup_fixtures.sh`).
