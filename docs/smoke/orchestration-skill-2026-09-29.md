# Smoke — orchestration skill (2026-09-29)

Deterministic suite over the orchestration skill's machines + the live wave run.
Run by `steward` (raw output), graded here. Tree clean after (no repo mutations;
`status/` fixtures created and removed).

## Result

**44 / 45 PASS** — the single "FAIL" is a grader-spec artifact:

- `T13` expected `grep -c 'rc=7'` = 1, got 2 — the string correctly appears twice
  (summary line + echoed return-file body). `wave-wait.ts` exit code was 0 as
  specified; rc propagation is correct. **Spec bug, not product bug.**
- `T15` note: the spec piped to `head -1`, masking the real rc; raw re-run = rc 1,
  single line `cannot read …` (EISDIR), no stack trace. PASS.

## A. lane-wait.ts — 5/5

| Test | rc | Expect |
|---|---|---|
| no args | 2 | 2 |
| bad timeout (`abc`) | 2 | 2 |
| timeout (missing file, 300 ms) | 1 | 1 |
| present file | 0 | 0 |
| late write (~1 s) | 0 | 0 |

## B. wave-wait.ts — 11/11 (T13 = spec artifact)

| Test | rc | Expect |
|---|---|---|
| no args | 2 | 2 |
| unknown flag | 2 | 2 |
| `--timeout 1.5` / `100abc` / `0` | 2 / 2 / 2 | strict parse |
| all present | 0 | 0 |
| missing listed | 1 | 1 |
| `--any` fast + pending | 0 | 0 |
| late write (~1 s) | 0 | 0 |
| rc=7 propagation | 0 (count 2) | 0 (count 1) — spec artifact |
| duplicates deduped | 0 | 0 |
| directory as file | 1, one line, no stack | 1 |

## C. lane-layout.ts — 14/14

Dry-run exit 0 for N=1/3/6/7/9; all 8 usage rejections rc 2 (no anchor, bad anchor,
bad JSON, empty lanes, duplicate names, master-ratio 2, max-per-tab 0, unknown arg).

Grid math (nominal 160×48, ~2:1 tiles):

| N | tabs | overflow | cols × rows |
|---|---|---|---|
| 1 | 1 | false | 1 × [1] |
| 3 | 1 | false | 2 × [2,1] |
| 6 | 1 | false | 3 × [2,2,2] |
| 7 | 2 | true | 3 × [2,2,2] + overflow tab |
| 9 | 2 | true | 3 × [2,2,2] + overflow tab |

## D. plan-check.sh — 12/12

Baseline GREEN on the live `smoke-parallel-wave` plan (state DONE + report.md).
All 8 RED fixtures detected exactly once: missing plan.md / missing status.md /
bad state enum / 4-line status.md / DONE without report / 2-line lane file /
missing TIMELINE row / loose file in `status/`. Post-cleanup GREEN again;
TIMELINE unpolluted (`zz-` lines = 0), no fixture residue.

## E. Contracts — 8/8

- `validate-skills.sh` rc 0 (37 skills, 5 pre-existing warnings)
- `"one lane at a time"` — absent from the whole skill (rc 1 = no match)
- `"Wave dispatch is a BATCH"` present (SKILL.md); `batch-dispatched` present (jev-layer.md)
- runner stale-clear (`rm -f "$RETURN"`) + shell-timeout note present (cli-reference.md)
- all referenced scripts (`lane-layout.ts`, `lane-wait.ts`, `wave-wait.ts`) and
  reference files (`lane-dispatch.md`, `cli-reference.md`, `jev-layer.md`,
  `edge-cases.md`) resolve

## Live wave (same day, plan `status/smoke-parallel-wave`, DONE)

- 3 lanes (`swe` · `deepseek-v4.1-flash#high`) dispatched as ONE batch at 21:42:56
- returns at 12.2 s / 13.2 s / 19.9 s, all rc=0 — wall 19.9 s vs ~45.2 s serial
- jev pre-filter 9/9 yes; 3 reviewers async (approve / approve-with-nits ×2)
- local commits `ba699cb` / `8930c62` / `2af6dcd` on `smoke/parallel-wave-{a,b,c}`;
  pushed and opened as PRs **#15/#16/#17** (open, not merged)

## Findings

1. **PR CI stays red for everyone (pre-existing).** `validate` fails on
   `design-systems corpus gate (--check)` — identical on main
   (runs 36586351229, 36582003390, 36575741843). Declared on PRs #15–17 per the
   skill's pre-existing-failure rule; merge left to the human while main is red.
   Owner: the designer corpus vendoring change (separate workstream).
2. **lane-layout pre-existing-pane hazard (hit live).** A tab holding panes not
   created by the run makes the atomic `layout.apply` reject the tree; recovery
   required a hand-built apply over all panes. Candidate fix: lane-layout should
   detect foreign panes and fail fast with the remedy, or include them in the grid.
3. **ANSI SGR bytes in lane return captures.** The canonical runner tees
   `opencode run` verbatim; suggest a strip (`sed`) in the runner template.
4. Smoke-harness quirks (not skill defects): brief generator produced a
   self-satisfying gate token on lane C; lane-c artifact's exit-1 row omits
   "or unreadable file".

Verdict: every deterministic surface is green, the live path is proven, and the
two candidate fixes (1 is a separate workstream; 2 and 3 are one-liners) remain.
