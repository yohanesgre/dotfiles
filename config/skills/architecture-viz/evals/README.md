# architecture-viz evals

Regression suite for `architecture-viz`. Built with the `skill-creator` eval loop.

Test cases, prompts, and assertions: `evals.json`. Fixtures are generated, not
committed (`setup_fixtures.sh`), mirroring the sibling `reviewer` / `designer`
suites.

## Setup

```sh
config/skills/architecture-viz/evals/setup_fixtures.sh [target-dir]
# default target: /tmp/opencode/architecture-viz-evals
```

Produces three fixture projects (replace `<fixture>` in the prompts with the
target dir):

| Fixture | Size | Exercises |
|---|---|---|
| `fixture-app/` | ~7 modules + tests | routing/standard eval; planted gaps (`src/legacy.py` dead code, duplicated config default) for the watch-items eval |
| `fixture-tiny/` | 1 file | scale-down: graph must not be padded toward the ~15-node cap |
| `fixture-large/` | 20 modules, 4 subsystems | scale-up: graph must be capped/grouped per subsystem |

## Running

Per case, spawn two subagents with the same prompt from `evals.json`:

1. **with_skill** — tell it to read the current `SKILL.md` and treat it as authoritative.
2. **baseline** — same prompt, pointed at a snapshot of the previous `SKILL.md`.

Point each lane at its own copy of the fixture (copy the fixture before the run),
have it write artifacts into that copy's `docs/`, and save its report under
`outputs/`. Grade against the `assertions` in `evals.json`: one entry per
assertion with `text` / `passed` / `evidence`, plus `summary.pass_rate`
(skill-creator `grading.json` shape). Then aggregate:

```sh
cd ~/.agents/skills/skill-creator
python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name architecture-viz
python eval-viewer/generate_review.py <workspace>/iteration-N \
  --skill-name architecture-viz \
  --benchmark <workspace>/iteration-N/benchmark.json \
  --previous-workspace <workspace>/iteration-<N-1> \
  --static review.html
```

## Reading results

- `eval-0` — standard path: one self-contained HTML, a real SVG graph on the
  template classes, evidence on every node and Watch item, checker quoted clean,
  PNG produced.
- `eval-1` — honesty: the planted gaps must lead the Watch items, with no
  fabricated findings.
- `eval-2` — non-trigger: a data chart request must route to `create-viz`, not
  produce an architecture map. This is the routing/negative case.
- `eval-3` — scale down: a one-file project must yield a 1–2 node graph, not a
  fabricated ~15-node one.
- `eval-4` — scale up: 20 modules must be grouped into ≤15 nodes with detail in
  the panels.

Assertions are text-gradable on the final artifacts: grep the produced HTML for
`g class="n` / `path class="edge"` counts, `path:line` tokens in the Watch items,
the checker's `clean:` line, and the render output path.
