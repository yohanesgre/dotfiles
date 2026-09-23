# Smoke report — goal / orchestration / work-plans skill pipeline

- **date:** 2026-09-23
- **scope:** `config/skills/{goal,orchestration,work-plans}/**` (SKILL.md, references, scripts, assets), `config/opencode/commands/{goal,orchestrate}.md`, live wiring, MCP reachability
- **environment:** opencode v2; `LUVUS_ENV=1`; luvus 0.14.2, opencode 2.0.1, bun; MCP `icm` + `jev-mcp` + `codegraph` enabled, `engram` disabled
- **method:** static graph/ref resolution + live script runs (dry-run where mutation was possible) + throwaway `status/` fixtures (removed) + MCP reachability probes

## Verdict

- **Initial run: 26 passed, 2 failed** — after the fix pass: **core suite 26/0 + fix-verification suite 11/0**
- **10 edge cases found — all resolved** (E1–E7 + E9 fixed; E8 `/orchestrate` live after `hm switch`; E10 body trimmed to 480 lines)
- No blockers: dependency graph acyclic, all skill-relative refs resolve, scripts behave on the happy paths, all three MCPs reachable.

## Suites

| suite | result |
|---|---|
| A. dependency graph (`metadata.requires`, acyclicity, dirs exist) | 1/1 PASS |
| B. cross-reference resolution (14 skill-relative refs) | 1/1 PASS (after fix E9) |
| C. `plan-check.sh` — real plan + usage + 6 failure fixtures | 9/9 PASS |
| D. `lane-wait.ts` — argv/timeout/present/late-file | 5/5 PASS (+2 edge) |
| E. `lane-layout.ts --dry-run` — N=1/3/9, N=0, bad input | 3/5 PASS, 2 FAIL |
| F. live wiring — skill links + commands | 4 PASS, 1 EDGE |

### Positively validated

- `plan-check.sh steward-agent` → **GREEN** on the real DONE plan; flags missing scope-Out, 4-line `status.md`, DONE-without-report, 4-line lane file, missing TIMELINE entry, missing `msg`; usage error exits 2.
- `lane-wait.ts`: absent file → timeout exit 1; present file → exit 0 + contents; file appearing mid-wait → exit 0; `0`/negative/`abc` timeout → exit 2; no args → exit 2.
- `lane-layout.ts --dry-run`: N=1, N=3, N=9 (overflow → 2 tabs) all exit 0; `--max-per-tab 0` rejected (exit 2); `--master-ratio 2` rejected (exit 2); missing `--lanes` rejected (exit 2); `--dry-run` never mutates luvus (verified by code path + no side effects).
- Dependency edges exact: `goal → {orchestration, work-plans}`, `orchestration → {work-plans}`, `work-plans → {}`; no cycles; every required skill dir exists.
- MCP reachability: `icm_memory_stats` OK (731 memories / 9 topics), `jev_models` OK (`jev-latest`), `codegraph_explore` OK (11 KB result).

## Edge cases

| # | severity | finding | evidence | proposed |
|---|---|---|---|---|
| E1 | medium | `lane-layout.ts` rejects N=0 (`--lanes '[]'` → usage exit 2) while `orchestration/SKILL.md:218` says "The grid holds across N=0 (planning: no lane panes, master full width)" | `lane-layout: usage: --lanes '<json>' with >=1 lane is required` | clarify the SKILL text: lane-layout requires ≥1 lane; N=0 means it is not called (master full width) |
| E2 | low | invalid `--lanes` JSON exits **1** (runtime error) not **2** (usage) | `lane-layout: error: JSON Parse error: Unexpected identifier "not"` | classify JSON parse as usage (exit 2) |
| E3 | low | `--anchor` is not validated; non-numeric accepted, dry-run silently emits `"Leaf": null` (real mode would fail later at luvus) | `--anchor abc --dry-run` → rc=0 | validate anchor as an integer |
| E4 | low | duplicate lane names accepted silently | `[{a},{a}]` → rc=0 | reject duplicate names (they identify tiles in the output) |
| E5 | high | `plan-check.sh` does **not** enforce FAILED-has-report (only DONE is checked) — contradicts `work-plans` "FAILED: no `report.md` → write it, then flip" | fixture `state: FAILED` w/o report → no "FAILED without report" message | add the FAILED branch next to the DONE one |
| E6 | high | `plan-check.sh` does **not** validate the state enum — `state: PARTIAL` passes | fixture `state: PARTIAL` → not flagged | validate against `PLAN\|WAIT\|WORKING\|DONE\|FAILED` |
| E7 | medium | `plan-check.sh` counts lines with `wc -l` (newlines): a 3-line `status.md` **without a trailing newline** is counted as 2 → false RED | `printf 'state..\nts..\nmsg..'` (no `\n`) → `status.md is 2 lines, want 3` | count records, not newlines (`grep -c ''` / `awk 'END{print NR}'`) |
| E8 | expected | `/orchestrate` not yet in `~/.config/opencode/commands/` (hm-managed dir; pending `hm switch`); the skill itself is live | `ls ~/.config/opencode/commands/` → only `goal.md` | run `hm switch` (or accept /goal handoff until then) |
| E9 | fixed | `goal/SKILL.md` referenced `assets/plan-template.md` without its owning skill → unresolvable | ref-resolution check flagged `config/skills/goal/assets/plan-template.md MISSING` | **fixed:** now `~/.agents/skills/work-plans/assets/plan-template.md` |
| E10 | note | `orchestration/SKILL.md` body is 498/500 lines (spec recommendation) — near the limit; any addition warns | `validate-skills.sh --verbose` | extract to `references/` before growing further |

## Reproduce

```bash
# static + fixtures + scripts (throwaway status/ fixtures are created and removed)
# NOTE: the /tmp scripts are throwaway — re-create them from the checks above if absent.
bash /tmp/opencode/smoke-skills.sh
bash /tmp/opencode/smoke-edges.sh
bash /tmp/opencode/smoke-fixes.sh   # fix-verification (E1–E7)

# skills conformance
bash scripts/validate-skills.sh --manifest config/skills/sources.json

# MCP reachability (via execute/Code Mode)
#   tools.icm.icm_memory_stats() · tools["jev-mcp"].jev_models() · tools.codegraph.codegraph_explore(...)
```

## Fix pass (post-report)

All actionable findings fixed and re-verified; suites re-run green.

| # | fix |
|---|---|
| E1 | `orchestration/SKILL.md` now states `lane-layout.ts` requires ≥1 lane and is not called at N=0 (was an inaccurate "grid holds across N=0" claim) |
| E2 | `lane-layout.ts` wraps `JSON.parse` → `UsageError` (exit 2) |
| E3 | `lane-layout.ts` validates `--anchor` as an integer (exit 2) |
| E4 | `lane-layout.ts` rejects duplicate lane names (exit 2) |
| E5 | `plan-check.sh` enforces `report.md` for FAILED as well as DONE |
| E6 | `plan-check.sh` validates the state enum (`PLAN\|WAIT\|WORKING\|DONE\|FAILED`) |
| E7 | `plan-check.sh` counts records (`awk 'END{print NR}'`) instead of newlines, for `status.md` and lane files |
| E9 | already fixed during the initial run (goal asset ref made absolute) |
| E8 | `bash scripts/hm-switch.sh` run (hostname `homestation` → `desktop`), exit 0 → `/orchestrate` now live in `~/.config/opencode/commands/`. **Gotcha found:** the command file was untracked, and Nix's git-aware flake fetcher excludes untracked files — the first switch built a store path without it; `git add config/opencode/commands/orchestrate.md` + re-switch fixed it (skills are unaffected: their activation symlinks the repo path directly) |
| E10 | `Edge cases` extracted to `references/edge-cases.md` (pointer left inline); `orchestration/SKILL.md` 499 → 480 lines |

Verification: core suite **26 passed / 0 failed**; fix-verification suite **11 passed / 0 failed**; real `steward-agent` plan still GREEN; `validate-skills.sh --manifest` exit 0 (50 skills, 7 warnings); `orchestration/SKILL.md` 480/500 lines; `bash -n plan-check.sh` OK.

## Review pass (independent `reviewer` agent)

Verdict: **approve with nits — ship**; no critical/high findings; the split was confirmed lossless against the 565-line pre-split monolith, and the pinned CLI forms were re-verified against luvus 0.14.2 / opencode v2.0.15. All reported items applied and re-verified:

| sev | finding | fix |
|---|---|---|
| MED | `goal/SKILL.md` Phase 3 still carried an in-loop/DONE writer instruction → double writer | replaced with a pointer to `orchestration` § Plan close-out |
| MED | runner claimed the return file "can only mean real completion", but `rc` was never persisted — a failed lane still looked green | runner writes `rc=` into the return file; docs/lane-wait/SKILL reworded; new break point "lane return with rc≠0" |
| LOW | `CONFIGURATION.md` claimed the report was tracked (it is untracked) | wording corrected |
| LOW | `CONFIGURATION.md` commands tree listed a `/design-thinking` command that does not exist | clause dropped |
| LOW | `work-plans` § Validate wording stale | now names the state enum + DONE/FAILED report |
| LOW | `lane-layout.ts` silently skipped workspace focus when the anchor workspace was not found | now throws (dry-run exempt) |
| LOW | `--anchor` accepted `0x10` / `1e3` | strict `/^[0-9]+$/` |
| NIT | `plan-check.sh` `tr -d '[:space:]'` collapsed internal spaces (`WORK ING` validated) | strips only CR + trailing padding |
| NIT | `plan-check.sh` plan name unsanitized (`../..` escaped `status/`) | validates `[a-z0-9-]`, exit 2 |
| NIT | `CONFIGURATION.md` dependency entry said `mem_save`; audit line refs stale | updated |
| NIT | reproduce commands point at ephemeral `/tmp` scripts | throwaway note added |
| pre-existing | `lane-dispatch.md` said researcher "fan out background/async" (contradicts AGENTS.md foreground-only) | corrected to foreground children |
| pre-existing | `plan-template.md` break-points table missing separator row | added |

Re-verification: core suite **26/0**, fix suite **11/0**, new probes (anchor `0x10`/`1e3` → exit 2, plan `../..` → exit 2, `WORK ING` flagged), `validate-skills` exit 0 (7 warnings), `orchestration/SKILL.md` 484/500 lines, `bash -n plan-check.sh` OK.

## Open items

None from this audit. Unrelated pre-existing drift surfaced by the switch: `skills-sync.sh --global --check` reports **33 externalized skills missing** (vercel/job-hunter/vasilyu/…; `cloudflare-skills: install failed`) — network-dependent and non-fatal, and not caused by this session's changes (`sources.json` only gained `orchestration` in `keep`).
