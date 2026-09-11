# reviewer evals

Regression suite for `reviewer`. Built with the `skill-creator` eval loop.

Test cases, prompts, and assertions: `evals.json`. Fixtures are generated, not
committed — each is a git repo where HEAD is the "before" code and the working
tree holds a planted change.

## Setup

```sh
config/skills/reviewer/evals/setup_fixtures.sh [target-dir]
# default target: /tmp/opencode/reviewer-evals
```

Expected diff stats (printed by the script):

| Fixture | Change | Planted |
|---|---|---|
| eval-0-billing | app.py 16+/16- | SQL injection, off-by-one pagination, swallowed exception + dropped refund guard |
| eval-1-auth | app.py 5+/7- | debug auth bypass, IDOR, timing-unsafe compare, logged secret, predictable md5 token |
| eval-2-perf | app.py 22+/9- | N+1 query, ZeroDivisionError, caller-list mutation, infinite loop |
| eval-3-benign | app.py 35+/2-, test_app.py untracked | nothing — false-positive bait (safe f-string, non-secret `==`, local `sorted`, specific `except`) |
| eval-4-nodiff | clean tree | nothing to review |
| eval-5-nitonly | app.py 6+/1- | O(n^2) dedupe (MED/NIT), unused import (NIT), no SEV |
| eval-6-projectrules | app.py 4+/1- | nothing — project declares review conventions (`.agents/skills/project-review`, `docs/STYLE.md`); the change adds a bare `except:` that violates the style rule |

## Running

Per case, spawn two subagents with the same prompt from `evals.json`:

1. **with_skill** — tell it to read `SKILL.md` and treat it as authoritative.
2. **baseline** — same, but pointed at a snapshot of the previous `SKILL.md`
   (for the first run, the old version being replaced).

Instruct each to inspect the fixture repo with git, stay read-only, and write
its report to `outputs/review.md` under the run directory.

Grade each report against the `assertions` in `evals.json`: one entry per
assertion with `text` / `passed` / `evidence`, plus a `summary.pass_rate`
(skill-creator `grading.json` shape). Then aggregate with skill-creator:

```sh
cd ~/.agents/skills/skill-creator
python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name reviewer
python eval-viewer/generate_review.py <workspace>/iteration-N \
  --skill-name reviewer \
  --benchmark <workspace>/iteration-N/benchmark.json \
  --previous-workspace <workspace>/iteration-<N-1> \
  --static review.html
```

## Reading results

- `eval-0/1/2` — recall: planted defects must be found.
- `eval-3` — precision: bait must not be reported as SEV.
- `eval-4` — no-diff handling: say "nothing to review", never fabricate. This is
  the case that separated the revised skill from the old one (90% vs 80% on the
  iteration-2 suite).
- `eval-5` — severity calibration: no SEV for a merely quadratic helper.
- `eval-6` — project authority: project-declared review conventions must be
  discovered and win over the skill defaults (format + severity vocabulary).

Known assertion caveat: in the original run, `eval-5` demanded the O(n^2) be
graded MED; both configurations said NIT. The assertion above now accepts
MED or NIT as long as the impact is stated.
