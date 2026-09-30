# OpenCode Configuration — Changelog

Dated entries for `config/opencode/CONFIGURATION.md`, newest first. Moved out of CONFIGURATION.md 2026-09-24; full history in git. Append new entries here, not in CONFIGURATION.md.

## Dated entries (newest first)

## 2026-09-30 — crumb pilot: the sub-wave, run for real

The crumb execution contract shipped as design and selftests; this is the first live run of it. One lane, two disjoint crumbs, two worker panes. Wall **119s vs 289s** serial — **−58.8%**, clearing the ≥25% gate. Zero scope violations. Per-join lane-verify GREEN on both crumbs. The green set is committed at `d59bee0` and landed to `main` in this change.

What it ships: `work-plans/scripts/selftest-plan-check.sh` (8 checks: well-formed crumb plan, shared file with and without a direct edge, edge to a missing id, missing gate, `files: —` placeholder, space-separated resource overlap, legacy plan without `## Tasks`) and `ORCH_SINCE` in `run-report.sh` (+3 selftest checks: `1d` window, `<N>h` and literal `YYYY-MM-DD` cutoffs, empty window).

Evidence: `selftest-logging.sh` 7/7 → exit 0, `selftest-plan-check.sh` 8/8 → exit 0, `selftest-lane-verify.sh` a–i → exit 0, `bash scripts/validate-skills.sh` rc 0 (37 skills, 5 pre-existing warnings). Committed, **not pushed**.

## 2026-09-30 — atomic-task dispatch: crumbs in lanes

A lane used to be one opaque task: one worker, one worktree, one shot at a vague "done". That makes disjoint work sequential, and it makes an over-broad failure expensive — a single bad edit costs the whole lane. This lands atomic-task dispatch, where a lane carries several **crumbs** (atomic tasks) whose file sets are provably disjoint, so they can run in parallel and fail independently. It went design → POC → real build: the design pass fixed the granularity unit and the rollback unit, the POC proved the sub-wave dispatch shape, and only then did the skill text change.

- **work-plans**: plans now document `## Acceptance` + `## Tasks` as crumb tables (id, files, done-when). `scripts/plan-check.sh` enforces what prose cannot — crumb file sets must be mutually disjoint, ids unique, every acceptance criterion reachable from some crumb, every crumb assigned to a lane. The declared-vs-enforced split is the point: the plan declares, `plan-check` refuses to pass a plan that lies.
- **orchestration**: `references/crumb-execution.md` is the execution contract — **sub-wave** dispatch (a wave is a set of crumbs that are disjoint from each other), one worker pane per crumb, a `lane-verify.sh` run on **each** join, and the **commit-between-sets** rule: a wave's crumbs are committed before the next wave begins, so rollback never has to disentangle another crumb's commits.
- **lane-verify**: `scripts/lane-verify.sh` is the per-join gate — snapshot, scoped gates, verdict, and rollback on failure. `--lane` filters gates to the declared crumb union; manifest paths must be contained in the worktree, and `..` manifests, non-git worktrees, and malformed manifests are refused (exit 2) with nothing executed. One joining crumb failing rolls back that join and fails the lane; siblings are untouched.
- **Failure policy**: snapshot-then-verify-then-rollback per join, never a blind `git reset`. New files absent from the snapshot are deleted on rollback; a refused or interrupted verify leaves the prior snapshot state intact rather than half-reverted.

**Adversarial review chain**: the build went through review, which found 1 SEV on the destructive path plus 6 MED findings and a batch of NITs — all fixed, re-review approved. The destructive-path SEV is why rollback is snapshot-scoped and containment-guarded at all. `scripts/selftest-lane-verify.sh` (scenarios a–i) is the standing evidence that those fixes hold: out-of-scope file caught with a RED verdict, clean tree GREEN with `rc=` markers, rollback restoring modified + deleted files, `..`/malformed/non-git refusals, `--lane` gate filtering with the declared union honored, containment guards, and both refused-snapshot cases.

The logging selftest from the demo lane is folded in as a separate commit: `scripts/selftest-logging.sh` closes the standing watch item "no automated test for runlog/report" and was itself produced by the first live lane run through the new logging loop — the feature dogfooding its own observability path.

Evidence: `bash scripts/validate-skills.sh` → rc 0 (37 skills, 5 pre-existing warnings); `selftest-lane-verify.sh` scenarios a–i all `ok` → exit 0; `selftest-logging.sh` all 4 checks pass → exit 0; `bash -n` clean on `plan-check.sh`, `lane-verify.sh`, `selftest-lane-verify.sh`; plan compat check 9/9 status plans GREEN. Committed, **not pushed**.

## 2026-09-30 — orchestration run logging: central log, report, diagnosis loop

Orchestration runs had no cross-run observability: nothing recorded which repo, plan, or lane a run belonged to, so slow or repeatedly-failing lanes could only be diagnosed from memory. This adds an always-on but **advisory** run log plus a report and a written improvement loop. Advisory means the logger can never fail a lane — `runlog.sh` exits 0 on any error (missing `jq`, unwritable path, no git) and every step is guarded.

- **Central log**: `config/skills/orchestration/scripts/runlog.sh <lane|plan> key=value ...` appends one compact JSON line per event to `~/.local/state/orchestration/runs.jsonl` — a single log for all projects, overridable with `ORCH_LOG`. A relative `ORCH_LOG` is hardened: it is not resolved against the caller's cwd, so a lane running in a worktree cannot scatter the log.
- **Repo attribution**: every event carries a `repo` field computed from `git rev-parse --git-common-dir` (with a `--show-toplevel` fallback for the main worktree, where the common dir is the relative `.git`). This is the worktree-correctness fix — a lane in `.worktrees/<plan>-<lane>` logs the main repo name, not the worktree name. `repo` is reserved; callers cannot override it.
- **Report**: `scripts/run-report.sh` reads that one log and prints lanes grouped by repo/plan, plans, failures, and signals (repeated failures for the same repo/plan/lane, `iter>1` rework churn, slowest top-10 lanes, recent `fix` events), with the `ORCH_REPO` env filter applying to every section. The `fix` event type is the convention that closes the loop: a diagnosis that changes behavior is logged as a `fix`, so the next report shows what was already corrected.
- **Diagnosis loop**: new `config/skills/orchestration/references/run-diagnosis.md` — report → root cause → smallest fix → re-measure → log the `fix`. It maps each signal (lane `rc≠0`, plan `verdict != DONE`, repeated failures, `iter>1`, stable slow lanes) to the owning text and its evidence file, and restates the single-writer discipline so a rule is never duplicated across two files.
- **Wiring**: the `cli-reference.md` runner template plus a new § Run log, `lane-dispatch.md` dispatch logging, and the `SKILL.md` close-out step. `SKILL.md` is now at its 500/500 line cap.
- **Architecture viz**: `docs/architecture-orchestration-logging.html` (hand-authored SVG subsystem/flow/risk panels) — checker and `vision` verified.

Evidence: `bash scripts/validate-skills.sh` → rc 0, 37 skills, 5 pre-existing warnings; `bash -n` clean on both new scripts. E2E samples: a cross-repo demo log producing dotfiles + lexa rows, and a fixture exercising repeated-failure, `iter>1`, and `fix` detection. No push; no other files touched.

## 2026-09-30 — swe skill + agent prompt compression

Prompt-compression pass on the two `swe` prompts. Wording-only: dedupe plus prose tightening, **zero rules or behavior removed** (verified by line diff). Skill `config/skills/swe/SKILL.md` 4586 → 4059 B (−11.5%); agent `config/opencode/agents/swe.md` 2348 → 2303 B. No permission change, no `steps` change, no routing change — the jg-first line, memory two-tier contract, design-authority rule, and deny-by-default envelope are intact.

Jev advisory scores, before → after: skill efficiency 1.20 → 2.07 (the intended win), skill quality 2.99 → 2.97 (noise-level, still max); agent efficiency 1.95, agent quality 2.98 (advisory only, no regression signal).

Gate: `bash scripts/validate.sh` → 940 passed / 0 failed / 4 skipped, exit 0. YAML frontmatter re-parsed on both files (`name`/`description`; `description`/`mode`/`model`/`steps: 60`/`permissions` 18 rules unchanged). Installed copies (`~/.config/opencode/agents/swe.md`, `~/.agents/skills/swe/SKILL.md`) are nix-store symlinks into this repo and still serve the old bytes until the next home-manager activation. No CONFIGURATION.md change needed (its `swe` row documents behavior and permissions, both unchanged). No commit, no push.

## 2026-09-30 — gloss module review fixes: drop the sycoca step, wire the hotkey

Adversarial review of the gloss Nix module (approve-with-nits) left two user-facing MEDs plus code NITs and required docs.

- **MED-1** — `home/modules/gloss/default.nix` ran `kbuildsycoca6 --noincremental` after copying the plasmoid, justified by a false premise. Plasma 6 applet discovery does not go through KSycoca (the live `ksycoca6_*` DB carries no applet IDs; `kpackagetool6 -t Plasma/Applet --list` scans `~/.local/share/plasma/plasmoids/` directly). The call is deleted; the comment now says a new directory is picked up on plasmashell's next start, and that the plan's original `kpackagetool6 --generate-index` does not exist in KF6.
- **MED-2** — the widget promised `Meta+Ctrl+G` but set no `globalShortcut` and never called `lookUpSelection()`. `main.qml` now defaults `Plasmoid.globalShortcut` to `Meta+Ctrl+G` (imperatively, only while empty, so a user-picked sequence survives) and runs the selection lookup when the popup expands; a rendered `GLOSS_FIXTURE` is left alone. The "Configure Gloss → Keyboard Shortcuts" page is real — plasma-desktop's `AppletConfiguration.qml` injects `ConfigurationShortcuts.qml` for every applet.
- **Code NITs** — `src` is now a `lib.fileset.toSource` union (a widget/test edit no longer rehashes the crate; `postUnpack` dropped); unused `config` module arg dropped; `version` read from `Cargo.toml`; the key activation gained `trap 'rm -f "$_tmp"' EXIT`, a `chmod 600` repair before the `cmp`, and a corrected comment (the env var may also exist via the env module).
- **Docs** — `README.md` module list gains `gloss`; `config/opencode/CONFIGURATION.md` gains a Gloss section.

Gates: `nix flake check --no-build`, `nix fmt -- --check flake.nix home/`, `deadnix -L --fail flake.nix home/`, and `nix build --offline '.#homeConfigurations."yohanes@laptop".activationPackage'` (100 tests in-sandbox); `qmllint` rc 0 on all widget `.qml` and the offscreen `qml6` smoke clean. No hm-switch, no commit, no push.

## 2026-09-29 — implementation delegation upgraded to a global MUST

Bounded implementation-code changes now dispatch `swe` by default in every project — via the `subagent` tool or the project's orchestration lane. The primary lands docs, tracking, and non-behavior upkeep directly; inline exceptions are category-scoped (comments, formatting, single-literal fixes). Dispatch requires a settled brief (decision ref, exact files, acceptance criteria, test commands) because `swe` denies `question`/`subagent` and cannot clarify mid-task. A project's `AGENTS.md` may override the rule. Files: `config/opencode/{AGENTS.md,CONFIGURATION.md}`.

## 2026-09-29 — orchestration: co-wave lanes run as a batch (concurrency fix)

The dispatch order read literally serial — `lane-dispatch.md` said "one lane at a time", so co-wave lanes the graph declares independent were started and waited one by one (1–2 lanes live at once). Now steps 1–3 run once per wave, step 4 fires EVERY lane before any wait (`luvus pane run` is non-blocking), worktree setups run concurrently, and the wait joins the wave.

- `config/skills/orchestration/references/lane-dispatch.md` — order rewritten: batch dispatch; serialize only shared-file collisions + the `steward` subagent; a wait timeout is not a dead lane (`luvus pane status` first).
- `config/skills/orchestration/SKILL.md` §4.1/§4.2 — worktrees created before any per-lane setup, setups concurrent; new "Wave dispatch is a BATCH" rule (dispatch-one/wait-one is a deviation).
- `config/skills/orchestration/references/cli-reference.md` — wait section documents both forms.
- New `config/skills/orchestration/scripts/wave-wait.ts` — joins N return files (`--any` returns on the first lane so its reviewer can spawn early; default timeout 600000 ms; exit 0/1/2 like `lane-wait.ts`).
- `config/skills/orchestration/references/jev-layer.md` — dispatch-time checklist gains `batch-dispatched` (all wave lanes fired before any wait).
- Post-review hardening (same day, `reviewer` approve-with-nits): the canonical lane runner clears stale return files before starting (a present file always belongs to the current run); the concurrent per-worktree setup form is pinned; `wave-wait.ts` guards unreadable files and parses `--timeout` strictly; the wait docs note the shell-timeout ceiling.
- Smoke follow-ups (same day): the canonical lane runner strips ANSI SGR from lane return captures; `lane-layout.ts` preflights foreign tab panes (fail-fast, zero mutations) and gains a best-effort rollback with empty-id guards; lane-dispatch step 3 documents the anchor-tab invariant.
- Viz pages: `docs/architecture-orchestration.html` (dependency map) and `docs/orchestration-wave-running.html` (parallel-wave runtime view) — both checker-clean and render-verified.

## 2026-09-29 — designer design-systems corpus

- Vendored 113 OpenDesign design-system packages into `config/skills/designer/references/design-systems/` (7.49 MB stripped; selection.json + PROVENANCE pin + generated INDEX/index.json).
- New `scripts/design-systems-sync.sh` (`--sync --add --report --check --index --list`); `--check` wired into `scripts/validate.sh`.
- `designer` skill: +9-line route section pointing at INDEX.md (<=2 packages per consult).
- Corpus gate fix (same day): `pkg_sha256` pins `LC_ALL=C` (collation-dependent aggregate hash passed in dev en_US.UTF-8 but failed CI under C — 113/113 `sha mismatch`); new `--rehash` regenerates PROVENANCE deterministically (guards against missing/empty package dirs, idempotent); all 113 hashes refreshed. CI-equivalent `LC_ALL=C validate.sh --ci` → 379 passed / 0 failed.

## 2026-09-29 — Fix `brainstorm-studio` frame-template placeholder collision

`scripts/frame-template.html` carried a second `<!-- CONTENT -->` token inside its own CSS comment header. `server.cjs` replaces only the *first* occurrence, so that one won: pushed screens were injected into the CSS comment block and every companion page rendered blank. Both comment lines now say "the CONTENT marker" in plain prose, leaving exactly one occurrence — the real placeholder.

- `config/skills/brainstorm-studio/scripts/frame-template.html` — 2 comment lines reworded (no behavior/template change).

Local patch to an externalized skill; `CONFIGURATION.md` unchanged (it inventories skill *sets* and wiring, not per-file patches — that belongs in this log). No commit, no push.

## 2026-09-29 — Install Cloudflare `cf` CLI via upstream activation

Cloudflare's new agent-oriented CLI (`cloudflare/cf`, open beta 1.0.0-beta.5, announced 2026-09-28) is not in nixpkgs, so it follows the fast-moving-tool policy (upstream installers, not nixpkgs): bun global install in the `upstreamInstall` activation, re-run on every hm-switch for latest upstream. Verified live before wiring: `cf --help`, `cf cli search "deploy a worker"`, `cf tools` (2936 MCP tool definitions), `bun install -g --trust cf@latest` → `~/.bun/bin/cf` 1.0.0-beta.5, bins `cf` + `cloudflare`, running on system node 24.21.0.

- `home/modules/upstream/default.nix` — new `cf` block after `jev-mcp`: `bun install -g --trust cf@latest`, `is_upstream` guard, non-blocking `warn`.
- `home/modules/manual/default.nix` — activation comment list gains `cf`.
- `config/opencode/CONFIGURATION.md` — new current-state section (what it is, install path, node >=22 runtime, community-check snapshot, no OpenCode integration yet).

Context: nixpkgs has no `cf` (checked `nix eval nixpkgs#cf` + `nix search nixpkgs 'cloudflare'` 2026-09-29 — only the old `cloudflare-cli` 5.1.7) and lags fast-moving tools, so the existing upstream pattern applies. Community check: `github.com/cloudflare/cf` 209 stars, last push 2026-09-28 (passes 100-star / 3-month bar; repo 1 week old, 1 fork — young beta).

Gates: validate.sh --ci exit 0 (38 passed / 0 failed / 4 skipped); nix fmt clean; hm-switch exit 0 (generation 170); cf 1.0.0-beta.5 runs (--version + cli search). No commit, no push.

## 2026-09-28 — `architecture-viz` vertical-fit check in overlap checker

The overlap checker only tested horizontal fit, so a node whose last text line sat flush against (or past) the bottom of its own box passed — the vertically-squashed case the 2026-09-28 hardening pass didn't cover. A vertical-fit rule closes it: node text landing within 12px of a node box's top or bottom edge is flagged. The reference file and the skill itself now carry the baseline/height recipe that produces compliant boxes, plus the explicit "boxes sized from the top only" anti-pattern, and SKILL.md routes detail graphs (the denser, tighter case) at the same sizing discipline.

- `config/skills/architecture-viz/scripts/check-svg-overlaps.py` — new vertical-fit check: last baseline within 12px of a node box's bottom (and text near the top edge) is flagged.
- `config/skills/architecture-viz/references/layout-rules.md` — baseline/height sizing recipe + the "boxes sized from the top only" anti-pattern.
- `config/skills/architecture-viz/SKILL.md` — box sizing guidance and detail-graph guidance for the tighter layout.

Gates: `validate-skills.sh --manifest config/skills/sources.json` exit 0 (37 skills, 5 pre-existing warnings). No commit, no push, no stage.

## 2026-09-28 — `call-graph` folded into `design-thinking`

One r17x entry point, per user decision. The 2026-09-24 review had kept `call-graph` standalone (real usage: 5 invocations / 3 reads), but the two skills duplicated the same paradigm and `design-thinking` already routes its other materials by reference file — the answer material now lives the same way. The gist's four files (`DESIGN_THINKING` / `OPT_DESIGN_GRAPH` / `OPT_GRAPH_PROTOCOL` / `ECALL_GRAPH_IN_YOUR_AGENTS`) now map 1:1 onto design-thinking's four references.

- `config/skills/design-thinking/references/call-graph.md` (new; was `config/skills/call-graph/references/output-format.md`, superset of the gist's ECALL file) — paradigm header added, output contract unchanged.
- `config/skills/design-thinking/SKILL.md` — router gains the answer row; description absorbs the call-graph triggers (how-it-works, caller/callee, request path, trace, upstream/downstream, Indonesian phrases) and drops the sibling pointer; `Pipelines` + `Common mistakes` gain the answer-mode lines.
- Dependents updated: `explorer` description, `brainstorm-studio`, `architecture-viz` (description + body), `researcher` agent route, `AGENTS.md` (researcher delegation + tool-selection rows; live copy updates at next hm-switch), `sources.json` keep (34→33), `CONFIGURATION.md` (researcher route row; inventory 34→33 dirs; 22→21 local; 2 r17x → 1). Stale `~/.agents/skills/call-graph` symlink removed — the live skill scan already serves the merged skill.
- Gates: `validate-skills.sh --manifest config/skills/sources.json` exit 0 (37 skills, 5 pre-existing warnings); `bash scripts/validate.sh --ci` exit 0 (38 passed / 0 failed / 4 skipped). No commit, no push, no nix rebuild, no hm-switch.

## 2026-09-28 — Enable OpenCode's built-in attention sounds (`attention.sound`)

OpenCode v2.0.18 defaults `attention.sound` and `attention.notifications` to `false`, so the built-in `opencode.notifications` TUI plugin (`packages/tui/src/feature-plugins/system/notifications.ts`, `attention.ts`) was silent. Meanwhile Luvus 0.14.2 never queues its own cues for panes whose state is written by `agent.report` / `integration_report` — which is every pane the `opencode.pulse` module publishes — so neither the Luvus blocked nor the done cue fired. `attention.sound: true` turns on the OpenCode-side cue instead: question / permission / done / subagent_done / error. It is independent of Luvus's own notification sounds, which stay enabled. `attention.notifications` stays off. The same edit synced the previously live-only `session` block (`permissions: "autoaccept"`, `thinking: "show"`) from the live file into the repo copy, so both copies are now byte-identical.

- `config/opencode/cli.json` — gains `attention: { "sound": true }` and the `session` block (live copy matched).
- `config/opencode/CONFIGURATION.md` — new `### TUI prefs (cli.json)` subsection with the current file contents and the cue/independence notes; no dated entry added there (that file is current-state only).

No commit, no push, no nix rebuild, no hm-switch.

## 2026-09-28 — Add `build` to jg/Jev routing docs

The built-in `build` agent already held the widest permissions — `opencode.jsonc` sets `default_agent: "build"` with `"build": { "mode": "all" }` and no permission envelope, so it inherits the global `permission: allow` (shell `*`, `execute`, every MCP tool including `codegraph_*` and `jev-mcp_*`) — but the jg/Jev routing docs only listed the custom agents. This documents `build` explicitly so the routing rules are complete for it; no config change (no `build.md`, `opencode.jsonc` untouched).

- `config/opencode/AGENTS.md` — jg routing matrix gains a `build` row — blanket allow (global `permission: allow`; no agent envelope) — with the same universal order; Jev direct-call list now names the built-in `build` as reaching jev via the blanket allow, distinct from the nested `jev-mcp_*` envelopes.
- `config/opencode/CONFIGURATION.md` — agent-prose "other agents cannot call it" corrected (build can, via blanket allow); per-agent table gains a `build` row (built-in, `mode: all`, blanket allow, routing documented now); § Behavior search Permissions + Codegraph grants bullets note build's blanket-allow access; AGENTS.md digest enumerations include build.
- `config/opencode/opencode.jsonc`, `config/opencode/agents/` — untouched (no `build.md` created).

No commit, no push, no nix rebuild.

## 2026-09-28 — Harden `architecture-viz` verify loop; skill committed

The skill's mandatory verify loop was only as trustworthy as its checkers, and review found both could bless a broken map. `render-check.sh` happily reused a stale PNG from a previous edit, so a changed template could be "verified" against the old render; it now fails when the screenshot is older than its input. `check-svg-overlaps.py` was hardened to parse what it actually documents — compact path syntax (`M x y L x y …`), a count guard against a truncated element list, segment-through-node-box intersection, and exit codes `0` clean / `1` overlaps found / `2` checker error, with no raw tracebacks leaking to the caller. The false-clean routes those two gaps opened are closed. The checker's required DOM contract is now documented, and the eval suite follows the repo convention (notes + assertions + generated fixtures + README, 5 evals including a non-trigger and a scale case) instead of a bare spec list. This commit lands the previously-untracked `config/skills/architecture-viz` dir, so the `skillsLinks` activation owns the symlink rather than a manual one.

- `config/skills/architecture-viz/scripts/render-check.sh` — freshness guard; a PNG older than the template aborts the verify loop.
- `config/skills/architecture-viz/scripts/check-svg-overlaps.py` — compact-path parsing, count guard, segment-through-node-box, rc 0/1/2, no tracebacks.
- `config/skills/architecture-viz/references/layout-rules.md` — documents the DOM contract the checker parses.
- `config/skills/architecture-viz/evals/{evals.json,setup_fixtures.sh,README.md}` — 5 evals (non-trigger + scale included) with notes, assertions, generated fixtures.
- `config/opencode/CONFIGURATION.md` — local-authored viz entry notes the hardened checker + committed dir.

Gates: `validate-skills.sh --manifest config/skills/sources.json` exit 0 (38 skills, 5 pre-existing warnings), `--dir config/skills/architecture-viz --strict --verbose` 0 warnings, `check-svg-overlaps.py assets/template.html` rc 0, `python3 -m json.tool evals/evals.json` OK. Committed, not pushed.

## 2026-09-28 — Add `architecture-viz` skill; sync vision model docs to `mimo-v2.5`

New local-authored skill `config/skills/architecture-viz` (34th committed dir; 22 local): turns a codebase into a self-contained HTML architecture map — hand-authored SVG dependency graph, boot timeline, subsystem panels, watch items — with the layout discipline learned from the CookingGame viz iteration (wide corridors, orthogonal elbows, labels attached to their own segment) plus a mandatory verify loop. Bundles `scripts/check-svg-overlaps.py` (deterministic label/line/box/arrowhead lint), `scripts/render-check.sh` (headless chromium screenshot), `references/layout-rules.md`, `assets/template.html`, `evals/evals.json`. Wired as `~/.agents/skills/architecture-viz` → repo path via a manual symlink matching the `skillsLinks` activation; `validate-skills.sh --manifest` green (38 skills), the new skill strict-clean.

- `config/opencode/agents/vision.md` — no change: already pins `opencode-go/mimo-v2.5` (dotfiles == live, confirmed by diff; the stale CONFIGURATION text was the drift, not the config).
- `config/opencode/CONFIGURATION.md` — vision model references (agent-list prose + agent-table row) corrected `mimo-v2.6-flash` → `mimo-v2.5`; committed-skills counts 33→34 dirs / 21→22 local; local-authored list gains the viz skill.
- `config/opencode/AGENTS.md` — Vision Delegation names the pinned model instead of "model-agnostic — inherits the session model".
- `config/opencode/opencode.jsonc`, `config/skills/sources.json` — untouched.

No commit, no push, no nix rebuild — `~/.config/opencode/{AGENTS,CONFIGURATION}.md` stay on the current store build until the next hm-switch (the vision pin itself was already live). The user preference is also encoded in the skill: vision delegation names `opencode-go/mimo-v2.5`.

## 2026-09-28 — Grant `codegraph` to `designer`; annotate `steward` as codegraph-free

Resolves the doc-vs-enforcement gap left by the jg expansion: the universal fallback order (`jg → codegraph → grep/glob`) claims a codegraph rung that the `steward` and `designer` permission envelopes did not actually have (neither holds `execute` nor `codegraph_*`). Jev judgment `add_designer_only` 0.73 — designer benefit 0.77, steward benefit 0.27 (no). `steward` keeps no codegraph and its matrix row now says so instead of claiming the rung.

- `config/opencode/agents/designer.md` — added `execute` / `*` and `codegraph_*` / `*` allow rules after the `skill` allow (Code Mode needs both: `execute` to reach the namespace, `codegraph_*` to pass the deny-all base for the nested call); body routing line notes the `tools.codegraph.codegraph_explore` path. Design-only boundary and `edit` rules untouched.
- `config/opencode/AGENTS.md` — routing matrix: `designer` row now records the `execute` + `codegraph_*` grant; `steward` row Order cell is `jg when authed → grep/glob (no codegraph permission)`.
- `config/opencode/CONFIGURATION.md` — `designer` agent-table row lists the codegraph/`execute` grant and keeps `jg → codegraph → grep/glob`; `steward` row states no codegraph grant; § Behavior search gained a **Codegraph grants** bullet listing which agents hold the grant (designer in, steward out) with the Jev numbers.
- `config/opencode/opencode.jsonc` — untouched.

No commit, no push, no nix rebuild. `scripts/validate.sh` green.

## 2026-09-28 — Add `designer` to `jg` routing (exclusion reversed)

The earlier 2026-09-28 `jg` expansion excluded `designer` as "not a code-lookup agent". A Jev re-judgment overrules that: designer genuinely benefits from jg (0.91), grep/glob alone is insufficient (0.24), and `include_narrow` scored 0.95 at confidence 0.93. Reason: designer reviews implementations for design drift, responsiveness, and accessibility, and grounds specs in existing UI code — both need codebase search beyond grep/glob.

- `config/opencode/agents/designer.md` — added the two allow rules (`shell` / `jg *`, `shell` / `command -v jg`) directly after the `shell: *` ask, so later specific rules override the ask and jg is frictionless; body gained one routing line (jg when `command -v jg` succeeds and it is authenticated → else codegraph → `grep`/`glob`). Design-only / never-edit-implementation boundary untouched.
- `config/opencode/AGENTS.md` — routing matrix row `designer`/`vision` split: `designer` gets its own row matching `reviewer` (`shell: *` ask with explicit `jg *` + `command -v jg` allow, frictionless), `vision` keeps no grant (image-only, no shell, not applicable).
- `config/opencode/CONFIGURATION.md` — `designer` agent-table row notes the narrow jg grant and first-rung routing; § Behavior search `Permissions` bullet and the § Summary agent list now include `designer` among the narrow-grant agents.
- `config/opencode/opencode.jsonc` — untouched.

Routing order unchanged for the set: `jg` (installed AND `jg doctor` authenticated) → codegraph `codegraph_explore` (`.codegraph/` present) → `grep`/`glob`. No commit, no push, no nix rebuild.

## 2026-09-28 — Expand `jg` routing to `architect`/`reviewer`/`steward`

Drift found: the `AGENTS.md` § "Behavior search (`jg` — jevgrep)" routing matrix claimed `architect`/`reviewer`/`designer`/`steward` had "no jg grant", but enforcement disagreed — `steward`'s `shell: *` allow let jg run, `reviewer`/`designer` `shell: *` ask silently blocked frictionless jg, `architect` had no shell at all so jg was impossible. Goal: jg effectively used across the code-lookup agents. Jev judgment `expand_narrow_grants`, confidence 0.99, P=1.00.

- `config/opencode/agents/architect.md` — added narrow `shell` allow for `jg *` + `command -v jg` after the `execute` allow (its first shell capability); body routing line added after the Read-only paragraph. Read-only + Code Mode caveats intact.
- `config/opencode/agents/reviewer.md` — added the same two allow rules directly after the `shell: *` ask (later specific rules override the ask); body routing line added. Full-prose output mandate intact.
- `config/opencode/agents/steward.md` — no permission change (`shell: *` already allows jg); body routing line only.
- `config/opencode/AGENTS.md` — routing matrix rewritten from 3 data rows to 6: `swe`, `researcher`, `architect`, `reviewer`, `steward`, `designer`/`vision`.
- `config/opencode/CONFIGURATION.md` — agent-table rows for `steward`/`architect`/`reviewer` and the § Behavior search `Permissions` bullet updated; the § Summary sentence no longer says "narrow `shell` grant for `researcher` only".
- `config/opencode/opencode.jsonc` — untouched.

`designer` deliberately excluded: not a code-lookup agent. Routing order for the expanded set: `jg` (installed AND `jg doctor` authenticated) → codegraph `codegraph_explore` (`.codegraph/` present) → `grep`/`glob`. No commit, no push, no nix rebuild.

## 2026-09-28 — Remove `davila7-claude-code-templates` source entry

`config/skills/sources.json`: the `davila7-claude-code-templates` block (repo, `game-development` skill, scope `project`) removed — user reports the source is no longer used. Sources 21 → 20.

- No orphan cleanup: `game-development` was never in `keep`/`keepNested`, no `config/skills/game-development/` dir, no symlink, no other file (md/sh/json/nix) referenced the repo or the skill.
- `config/opencode/CONFIGURATION.md` needed no edit (never mentioned the entry).

Gates: `python -m json.tool` OK, `scripts/validate-skills.sh --manifest config/skills/sources.json` exit 0 (37 skills, 5 pre-existing warnings), `grep -c "davila7/claude-code-templates" config/skills/sources.json` 0. No commit, no push.

## 2026-09-28 — Remove `Unity-Technologies-skills` source entry entirely

`config/skills/sources.json`: the `Unity-Technologies-skills` block (repo, 22 skills, ondemand note) removed — zero mentions left, no per-project repo record. Local project use is raw `npx skills add Unity-Technologies/skills` only. `CONFIGURATION.md` needed no edit (never mentioned the entry). Gates: `python -m json.tool` OK, `scripts/validate-skills.sh --manifest config/skills/sources.json` exit 0 (37 skills, 5 pre-existing warnings), `grep -ri unity config/skills/sources.json` 0. No commit, no push.

## 2026-09-28 — Drop `arvindrk-extract-design-system-wired` source entry

Tombstone removed; upstream never re-added. No behavior change.

- `config/skills/sources.json`: removed source `arvindrk-extract-design-system-wired` (repo `arvindrk/extract-design-system`, scope already `dropped` since 2026-09-24). Sources 20 → 19 (working-tree count; the 2026-09-24 removal of `obra-superpowers-wired` is uncommitted).
- No orphan cleanup needed: `extract-design-system` was never in `keep`, no `config/skills/extract-design-system/` dir (removed 2026-09-24), no `~/.agents/skills/extract-design-system` symlink, no other file references it.
- `config/opencode/CONFIGURATION.md` counts unchanged (33 dirs / 21 local / 12 wired — entry described a source record, not a dir).

## 2026-09-28 — Nuke local-infra skills `lexa-cli` + `docs-hub`

Two unused local-authored skills removed; committed skill set 35 → 33 dirs (23 → 21 local, 12 wired unchanged). Nothing routes to them after the repoints below.

- `config/skills/lexa-cli/` + `config/skills/docs-hub/` (`git rm -rf`, staged; `docs-hub` carried `agents/openai.yaml`, `private_SKILL.md`, `scripts/list_docs.py`). `lexa-cli` removed wholesale (SKILL + tree).
- `config/skills/sources.json`: `keep` 35 → 33 (drop `lexa-cli`, `docs-hub`). JSON re-validated with `python3 -m json.tool`.
- `config/skills/steward/SKILL.md`: docs-sync route repointed to `documentation` only (dropped the `docs-hub` publish cell at the chore table); §2 requires list drops `docs-hub` (line 66).
- `config/opencode/CONFIGURATION.md`: committed-skills counts 35 → 33 dirs, local 23 → 21; local-infra group now `transcribe`/`nix`.
- `~/.agents/skills/`: removed the stale per-skill symlinks `lexa-cli` + `docs-hub` (both were dangling `-L` links into the deleted repo dirs; no real dirs touched).
- Gates: `bash scripts/validate-skills.sh --manifest config/skills/sources.json` exit 0; `bash scripts/validate.sh` all pass. No commit, no push.

## 2026-09-28 — Unity skills `project` → `ondemand`; 22 global copies removed

Unity-Technologies/skills (22 skills) no longer install globally on hm-switch — they are per-project only now.

- `config/skills/sources.json`: `Unity-Technologies-skills` scope `project` → `ondemand` (skills list, repo, per-project note preserved; note now names `--source Unity-Technologies-skills`).
- `scripts/skills-sync.sh`: `_scope_filter` accepts a space-separated scope list; `--source` matches `project` + `ondemand` (new `SELECTABLE_TSV`), `--all`/`--global` bulk stay `project`-only; error text now "no project/ondemand source matches".
- `scripts/validate-skills.sh`: `ondemand` added to the accepted scope set (was rejecting the Unity entry).
- `~/.agents/skills/`: backed up 22 real Unity dirs to `~/.agents/skills.backup/unity-2026-09-28/` and removed them from the global root (guard: `[ -d ] && [ ! -L ]`; no symlinks touched).
- Gates: `bash scripts/validate-skills.sh --manifest config/skills/sources.json` exit 0. `bash scripts/skills-sync.sh --global --check` still exits 1 but reports **no Unity line** — missing count dropped 55 → 33, exactly the 22 Unity skills; the remaining 33 are pre-existing unrelated drift (cloudflare `sandbox-sdk`, `game-development`, nextlevelbuilder, openai, paramchoudhary, vercel, wexxwuther, vasilyu never globally installed). No commit.
- Per-project restore: `bash scripts/skills-sync.sh --source Unity-Technologies-skills --project <dir>`.

## 2026-09-28 — Phase 3: de-wire remaining `obra/superpowers` set (obra wired 0); `writing-plans` reauthored local bare

Third and final de-wiring pass. Six verbatim upstream copies with 0 loads were deleted outright; `writing-plans` stays under its own name as a local bare skill. `obra/superpowers` now has 0 wired skills.

| Upstream (removed) | Result |
|---|---|
| `brainstorming` | deleted (superseded by `brainstorm-studio`) |
| `finishing-a-development-branch` | deleted (integration menu folded into `git-workflow`) |
| `subagent-driven-development` | deleted (handoff now `orchestration`) |
| `systematic-debugging` | deleted |
| `test-driven-development` | deleted |
| `writing-skills` | deleted |
| `writing-plans` | local bare (name kept) |

- `config/skills/`: reauthored `writing-plans/SKILL.md` bare (save path `.agents/plans/YYYY-MM-DD-<feature-name>.md`, handoff to `orchestration`, no `superpowers:` refs; `plan-document-reviewer-prompt.md` kept). Deleted `brainstorming/`, `finishing-a-development-branch/`, `subagent-driven-development/`, `systematic-debugging/`, `test-driven-development/`, `writing-skills/` (`git rm -r`, staged).
- Repoints (before delete): `skill-first` (`brainstorming`→`brainstorm-studio`; `systematic-debugging`→prose); `git-workflow` config + `.agents` copies (finishing menu inlined compact as the integration menu); `steward` push/PR row drops the finishing skill; `brainstorm-studio` description drops the plain-`brainstorming` pointer; `docs-hub` SKILL + `private_SKILL` drop the dead `docs/superpowers` plan pointer; `omp/agents/brainstormer.md` autoload + deferral → `brainstorm-studio`; `CONFIGURATION.md` wiring drops the "defers core process to `brainstorming`" clause.
- `config/skills/sources.json`: `keep` 41 → 35 (remove 6); `obra-superpowers-wired` entry deleted; `obra-superpowers-dropped` extended to all 14 upstream skills with the phase-3 note. Validated with `python3 -m json.tool`.
- `config/opencode/CONFIGURATION.md`: counts 41 → 35 dirs (22 local / 19 wired → 23 local / 12 wired), obra wired 7 → 0, `writing-plans` added to the local process group.
- Gates: `bash scripts/validate-skills.sh --manifest config/skills/sources.json` exit 0; `bash scripts/validate.sh` all pass.
- **Reload required**: `hm-switch` to drop the stale `~/.agents/skills/` symlinks — not run in this change. No commit made.

## 2026-09-28 — Phase 2: drop 3 dead upstream skills, reauthor `verification-before-completion` as local `completion-verification`

Second de-wiring pass over the `obra/superpowers` wired set. Four verbatim upstream copies had 0 loads ever; three were deleted outright, the fourth — a live gate referenced by name — was re-authored as a local bare skill.

| Upstream (removed) | Result |
|---|---|
| `dispatching-parallel-agents` | deleted (dead) |
| `using-git-worktrees` | deleted (dead) |
| `executing-plans` | deleted (dead) |
| `verification-before-completion` | local bare `completion-verification` |

- `config/skills/`: created `completion-verification/SKILL.md` (~28 lines, bare — no scripts, no `superpowers:` prefix; description kept verbatim; evidence-before-claim gate: run command, read output, then claim). Deleted `dispatching-parallel-agents/`, `using-git-worktrees/`, `executing-plans/`, `verification-before-completion/` (`git rm -r`, staged).
- Repoints: `steward/SKILL.md` (gate row + requires list), `systematic-debugging/SKILL.md`, `writing-skills/SKILL.md` `verification-before-completion` → `completion-verification`. `writing-plans/SKILL.md` and `subagent-driven-development/SKILL.md` dropped all `executing-plans` / `using-git-worktrees` refs to plain prose (no replacement skill this phase). No remaining refs to the 3 deleted names.
- `config/skills/sources.json`: `keep` 44 → 41 (remove 4, add `completion-verification`); `obra-superpowers-wired.skills` 11 → 7; `obra-superpowers-dropped` gains the 4 names + phase-2 note. Validated with `python3 -m json.tool`.
- `config/opencode/CONFIGURATION.md`: counts 44 → 41 dirs (21 local / 23 wired → 22 local / 19 wired), `obra` 11 → 7, `completion-verification` added to the local process group.
- Gates: `bash scripts/validate-skills.sh --manifest config/skills/sources.json` exit 0; `bash scripts/validate.sh` all pass.
- **Reload required**: `hm-switch` to drop the stale `~/.agents/skills/` symlinks and pick up `completion-verification`, plus an opencode restart — neither run in this change. No commit made.

## 2026-09-28 — De-wire three `obra/superpowers` process skills into local bare copies

`obra/superpowers` wired set 14 → 11. Three skills the repo carried as verbatim wired copies were re-authored as local bare skills so their process can evolve in-repo without the `--wired --force` overwrite hazard:

| Wired (removed) | Local bare (new) |
|---|---|
| `using-superpowers` | `skill-first` |
| `requesting-code-review` | `review-request` (keeps `code-reviewer.md` inside) |
| `receiving-code-review` | `review-response` |

- Why: they route core behavior by name across agents and `AGENTS.md`, so they must be editable in-repo; the wired copies pinned an upstream we do not control and `--wired --force` would clobber local edits. Bare rewrites drop the `superpowers:` prefix and the `references/` platform files.
- `config/skills/`: created `skill-first/`, `review-request/{SKILL.md,code-reviewer.md}`, `review-response/`; deleted `using-superpowers/`, `requesting-code-review/`, `receiving-code-review/`.
- Repoints: `subagent-driven-development/SKILL.md` `../requesting-code-review/code-reviewer.md` → `../review-request/code-reviewer.md` (4 refs, incl. the final-review wording); `executing-plans/SKILL.md` dropped the `../using-superpowers/references/` parenthetical; `writing-skills/SKILL.md` replaced two dead `references/` links with plain-text runtime-dir guidance.
- `config/skills/sources.json`: `keep` swaps the 3 names for the 3 new ones (still 44 dirs); `obra-superpowers-wired.skills` 14 → 11; new provenance source `obra-superpowers-dropped` (scope `dropped`) records the three upstream skills and the replacement. Validated with `python3 -m json.tool`.
- `config/opencode/CONFIGURATION.md`: counts updated to 21 local / 23 wired (was 18/26), `obra` 14 → 11, new names added to the local process group.
- Gates: `bash scripts/validate-skills.sh --manifest config/skills/sources.json` exit 0; `bash scripts/validate.sh` all pass.
- **Reload required**: the new skills need a `hm-switch` (recreates the `~/.agents/skills/` symlinks; the 3 stale ones were removed here) and an opencode restart — neither run in this change. No commit made.

## 2026-09-28 — `jg` pilot findings folded into routing docs

Pilot: `.tmp/pilot-jg.md` (jg 0.4.2, dotfiles repo + one unindexed scratch project; `jg doctor` pass — auth now done). No permission or routing-order change; this is a correctness patch to how the existing rung is judged.

- `End context.` is **not** a completeness sentinel — SIGINT (rc 130) partial output ends with it. Callers must gate on the exit code: `0` complete, `2` incomplete, `1` failed, `130` interrupted. rc 2 was not reproducible; treat missing context as unknown.
- Validation/usage errors print to **stdout, not stderr** (stderr empty) — a stdout-only parser can read an error line as context.
- rc 0 with **locations-only** results is not an answer: a config question returned 23 correct file leads and 0 source excerpts, so the follow-up grep was still needed. Locations-only → drop to `grep`/`glob`.
- **codegraph is blind to JSONC/Markdown config** (no symbol entries for `opencode.jsonc` / agent MD) and returned unrelated plugin TS for a config question. Config-shaped questions go straight to grep; codegraph stays for real code.
- Cost 3 s (small tree) → 31–41 s (this repo); `--concurrency 1` ~33% slower, no quality gain. `jg` ignores the codegraph index entirely (works unindexed).
- Takes effect at the next `hm-switch` (agent prompt files are symlinked into `~/.config/opencode/agents/`); no opencode restart needed for prompt-only edits.
- Takes effect at the next `hm-switch` (agent prompt files are symlinked into `~/.config/opencode/agents/`); no opencode restart needed for prompt-only edits.
- Touched: `config/opencode/AGENTS.md` § Behavior search (4 new rules: exit codes, stdout errors, locations-only fallback, codegraph config blindness), `config/opencode/CONFIGURATION.md` § Behavior search (auth now verified, exit-code + evidence-quality bullets, routing line notes the gate).

## 2026-09-28 — Behavior search `jg` (jevgrep) wired into agents

- Installed `jg` 0.4.2 from npm `@dzhng/jevgrep` to `~/.local/bin` (`npm install -g --prefix $HOME/.local`); a plain global install fails `EACCES` on `/usr/lib/node_modules`. Requires Node 22+ (v24.21.0 present). Not Nix-managed.
- Installed the `jevgrep` skill globally: `npx skills add dzhng/jevgrep --skill jevgrep --global --yes` → `~/.agents/skills/jevgrep`. Recorded in `config/skills/sources.json` as `dzhng-jevgrep` (scope `project`, `updated` bumped to 2026-09-28) so `scripts/skills-sync.sh --source dzhng-jevgrep` restores it. Note: `npx skills add --global` is the CLI's global-install flag; the recorded scope is `project`, and `skills-sync.sh --global` includes the project scope in addition to user scope.
- **Auth is pending and is the user's step**: `jg doctor` reports `Run jg auth or use jg auth --provider NAME --stdin.` The user runs `jg auth --provider opencode` (or the `--stdin` form); no agent runs it or handles the secret. Until then jg falls through to the fallback chain.
- `config/opencode/agents/researcher.md`: added `shell` allows for `jg *` and `command -v jg` only — the first shell access in that envelope; every other shell command stays denied. Prompt boundary line updated from "you have NO `shell`" and the inline-tool list now names jg.
- `config/opencode/agents/swe.md`: one routing line (jg first when `command -v jg` succeeds, else codegraph → `grep`/`glob`); permission envelope unchanged.
- `architect`/`reviewer`/`designer`/`steward` untouched — no jg grant.
- `config/opencode/AGENTS.md`: new § Behavior search (`jg` — jevgrep) with the per-agent routing matrix and the universal fallback order (jg → codegraph → `grep`/`glob` → `researcher`).
- `config/opencode/CONFIGURATION.md`: new § Behavior search section, plus the researcher and swe table rows and the AGENTS.md section list updated.

## 2026-09-27 — Share OpenCode MCP servers with Codex

- Added `home/modules/codex/default.nix`, imported by `home/common.nix`; Home Manager activation idempotently registers `browser-use`, `codegraph`, and `jev-mcp` with Codex via `codex mcp add`, preserving unrelated `~/.codex/config.toml` settings.
- Browser-use uses `browser-use-mcp` (key from `~/.config/browser-use/key`) with the existing localhost proxy/model settings; codegraph and jev-mcp use their bun-global executables.

## 2026-09-26 — Luvus `opencode.depth` module extracted to standalone repo, renamed `opencode.pulse`

- The Luvus module formerly vendored at `config/luvus/modules/opencode-depth/` is now a standalone publishable project at `~/projects/luvus-opencode-pulse` (the repo root is the module root); the vendored copy was deleted from dotfiles.
- Module id renamed `opencode.depth` → `opencode.pulse`, display name "OpenCode Pulse", default `source` setting `opencode/pulse`; state dir `opencode.pulse`, dock row id `pulse`, watcher log `opencode-pulse.watcher.log`.
- Dotfiles home-manager activation `home.activation.luvusOpencodePulseModule` (`home/modules/luvus/default.nix`) now links `$HOME/projects/luvus-opencode-pulse` and probes `luvus module info opencode.pulse`. Unchanged semantics: warn-only, `$DRY_RUN_CMD`-gated, no-op when already linked to that path.

## 2026-09-26 — `opencode.depth` fallback location tagging (PR #14)

- `client.listShellsWithLocation()` returns the `/api/shell` envelope's `location.directory` alongside the shells; the existing `listShells()` delegates to it with an unchanged return shape.
- The zero-directory unscoped fallback now tags the shells it returns with that envelope location via `reconcileShellsByDirectory`, so the directory enters `trackedShellDirectories` and a later scoped empty response drops them normally. Fixes the phantom-`working` case: a missed `shell.exited` on a fallback-tracked shell no longer retained a stale live shell, because the directory was known but untracked.
- A `null` envelope location keeps the previous behavior — the `hasDirectorylessShells()` skip still protects a truly location-less fallback.
- Proofs: test-toggle runs over `config/luvus/modules/opencode-depth/` — the new fallback-tagging cases fail with tagging disabled and pass with it enabled; the existing `hasDirectorylessShells()`-skip case still fails when the skip is removed and passes when restored.
- Merged as PR #14 (squash `c1e65b2`).

## 2026-09-26 — `opencode.depth` hardening (PR #13)

- `unmappedRoots()` is now subtree-scoped for live-work presence: a headless root stays in the dock/monitor while any descendant holds a live shell or is active, past the 120 s done window. The done window itself stays root-only, so an idle long-terminal root still disappears as before. This retires the PR #12 limit "`unmappedRoots()` still ignores live shells".
- The zero-directory unscoped `GET /api/shell` fallback reconcile is now skipped while any tracked shell has no known directory. Without that guard, a successful empty response to the unscoped listing could wipe a live shell that simply had no directory known yet.
- `shellDirectories()` ordering made explicit: tracked-shell directories first, then event directories, then session directories, deduped and sliced at 16 — so a shell's own directory survives the cap when the shell is live.
- Each fix has a regression test, verified failing before the fix and passing after.
- Merged as PR #13 (squash `b18c44a`).

## 2026-09-26 — `opencode.depth` live-shell tracking (PR #12)

- `opencode.depth` now treats any live shell of a mapped session tree as `working`, so a pane no longer falls to `done`/`idle` when the execution goes terminal while a shell is still running. Tracking is incremental over SSE: `shell.created` adds (`data.info.metadata.sessionID` + `data.info.id` + `location.directory`), `shell.exited` removes (`data.id`), `shell.deleted` is ignored.
- Backfill/reconcile uses the **location-scoped** shell endpoint — `GET /api/shell?location[directory]=<enc>`, one request per known directory (the session's `location.directory` plus every directory seen in a `shell.created` event), deduped and bounded at 16 with the remainder sliced. Gotcha: the unscoped listing is not a valid substitute, so a directory that fails to answer keeps its already-known shells while a successful empty response drops only that directory's shells. The merged result is guarded by a monotonic `shellVersion`, so an exit delivered over SSE mid-fetch can never be resurrected by a stale list.
- Limits corrected: the earlier "a detached background shell is unobservable" claim is now wrong. The model-facing shell tool cannot request `background: true` at all — only harness-only shells run detached — and the public shell payload carries no background/foreground discriminator, so all live shells count as working. `unmappedRoots()` still ignores live shells, so a lane held only by a shell can be hidden from the dock after the 120 s terminal window. Reviewer NITs accepted (zero-directory fallback, >16-directory slicing).
- Merged as PR #12 (squash `5fcfa8d`).

## 2026-09-26 — `opencode.depth` Luvus module (PR #11)

- New Luvus module `config/luvus/modules/opencode-depth/` (Bun/TS) — watches OpenCode's public HTTP/SSE surface and publishes **authoritative** pane status through UHP `agent.report` (authority `integration_report`, source `opencode/depth`), plus per-child/headless-lane dock rows, Luvus Bar counts, and aggregate AGENTS titles. Pane status is now authoritative (`integration_report`) instead of Luvus's native screen scraping; the stock `luvus-v2` integration keeps reporting root-session identity only (ownership; luvus-managed, untouched).
- Activation: `home.activation.luvusOpencodeDepthModule` in `home/modules/luvus/default.nix` links the module when unregistered or linked elsewhere — warn-only, never fails the switch. Watcher starts detached via the `[[startup]]` launcher (atomic pidfile, single-instance, revived by the `pane.created`/`pane.closed` hooks). Commands: `luvus module run opencode.depth start|stop`; monitor pane opens manually (`luvus module pane open opencode.depth monitor --placement overlay`). Settings: `source`/`ttl_s` (≥60s, default 900)/`max_rows`/`bar`/`title`.
- Known limits: a detached background shell (`bash` with `background: true`) is unobservable (background *subagent* sessions are mapped via `parentID`); durable-log replay is resync-via-poll; `blocked` from permission requests is not reproducible under the global `permission: allow`.
- Merged as PR #11 (squash `f3ffcbe`).
- Later superseded: the module now also reports `blocked` for a pending server-visible `question` form (`metadata.kind = "question"`), which still fires under the global `permission: allow`.

## 2026-09-25 — reviewer low-confidence escalation cap + eval-7-standard

- Skill revision `248862f4` (live) changed the Depth routing rule: confidence below 0.6 escalates one tier, **capped at `standard`** unless a risk area is present — uncertainty alone is not a reason for a deep hunt. Rationale: the previous free escalation burned deep-hunt budget on ambiguous-but-benign changes.
- Eval suite grew 7 → 8 cases. `eval-7-standard` added: moderate no-risk warehouse refactor; asserts MED edge findings, a test gap, no SEV, and APPROVE / APPROVE WITH NITS.
- Eval files touched: `config/skills/reviewer/evals/setup_fixtures.sh` (+ eval-7 fixture block), `config/skills/reviewer/evals/evals.json` (+ case 7), `config/skills/reviewer/evals/README.md` (+ fixture row, routing-verification section).
- Validation after `opencode reload`: clean 8-case run, 36/36 assertions pass. Routing observed — deep: eval-0, eval-1; standard: eval-2, eval-3, eval-6, eval-7; quick: eval-5; none: eval-4. All three tiers now exercised.
- Files: `config/opencode/CONFIGURATION.md` (reviewer depth-routing entry: escalation cap + 8-case/36-assertion suite), `docs/configuration-changelog.md`. No commit, no push.

## 2026-09-25 — reviewer skill depth routing and Jev cross-checks

- Reviewer skill revision `f93f1a18` added diff-size/risk depth calibration, tool-call hygiene, and clean-review output budget; revision `cbe5f8e6` is final and live.
- Final behavior: one `jev_classify` over the change summary routes `quick` / `standard` / `deep`; risk overrides routing, with security, money, or data-integrity hunks forced to `deep`; escalation is allowed, de-escalation is not. Advisory Jev cross-checks use one findings `jev_ask` for SEV/MED reports or standard/deep reports with findings; quick + NIT-only skips it. Jev unreachable means manual routing.
- OpenCode caches skills server-side. After any skill edit, run `opencode reload` or new sessions may execute the stale cached copy; this silently invalidated two eval iterations.
- Validation: reviewer 7-case eval suite passed 32/32 on final revision.
- Files: `config/opencode/CONFIGURATION.md`, `docs/configuration-changelog.md`.

## 2026-09-25 — plugin bun tests wired into validation

- `scripts/validate.sh` now runs the scoped `gh`, `opencode-go-limit`, and `opencode-subagents` bun suites as one check. Missing bun SKIPs; test failures FAIL. Closes researcher-speedup follow-up left open after PR #10.

## 2026-09-25 — opencode-go-limit poll cadence

- `opencode-go-limit` footer poll cadence changed from 60s to 5min. `session.idle` refresh trigger retained.

## 2026-09-24 — wired upstream tracking: --report + hardened --wired

- `scripts/skills-sync.sh --wired --report` (new): shallow-clones each wired upstream, compares against the committed copy (ignoring `.openskills.json`, normalizing the `hidden: true` strip) and prints a per-skill drift table (`same | behind | local-mods | missing-upstream`) with upstream sha/date. Read-only; never npx; exit 0. `--report` without `--wired` exits 2.
- `--wired` writer hardened: skips `local-mods` skills unless `--force`; strips `.openskills.json` after copy; records `upstream_sha` + `upstream_imported` on the source entry after a refresh. Usage header updated. `config/skills/frontend-design/.openskills.json` removed (install artifact).
- First live report: same=7, behind=3 (finishing-a-development-branch, systematic-debugging, test-driven-development), local-mods=16, missing-upstream=0. Conservative default: upstream rewordings since import count as local-mods, so all refreshes stay review-gated.
- Verified: `bash scripts/validate.sh` + `bash scripts/validate-skills.sh --manifest config/skills/sources.json` exit 0 (48 skills). No commit.

## 2026-09-24 — dropped extract-design-system

- Removed `config/skills/extract-design-system` on user request (unused; wired copy from arvindrk/extract-design-system, upstream idle since 2026-06-19). `sources.json`: source re-scoped `wired` → `dropped` with a reinstall note; `keep` 45→44; `updated` bumped. CONFIGURATION.md inventory 44 dirs (18 local, 26 wired); designer routing row removed; stale `~/.agents/skills/extract-design-system` symlink removed.
- Verified: `bash scripts/validate.sh` + `bash scripts/validate-skills.sh --manifest config/skills/sources.json` exit 0 (48 skills). No commit.

## 2026-09-24 — design-graph folded back into design-thinking

- Merged per Jev review (`docs/reviews/skills-review-2026-09-24.md`; `jev_ask` A_fold 0.62, merge flagged by both triage passes). `design-graph` was promoted to a standalone skill on 2026-09-08 for independent auto-discovery; 48h usage was 0 invocations / 0 direct reads and the promotion rationale no longer held (0.26).
- `references/design-graph.md` (138 lines) moved under `config/skills/design-thinking/`; design-thinking's router gains the interface row and its description absorbs the UI triggers (screens/components/layouts/user flows, Surface<C,V,N>, Indonesian UI phrases); `call-graph` stays standalone.
- Dependents updated: `designer` (+evals README), `brainstorm-studio`, `goal`, `call-graph` description, `orchestration` note, `sources.json` keep (46→45), CONFIGURATION.md inventory (45 dirs; 18 local, 27 wired; 2 r17x). Stale `~/.agents/skills/design-graph` symlink removed.
- Verified: `bash scripts/validate-skills.sh --manifest config/skills/sources.json` exit 0 (49 skills). No commit.

## 2026-09-24 — jev as the background triage layer (scripts/tools + subagent waves)

- `AGENTS.md` § Jev gains a background-work block: (1) *dispatch* — prefer one `jev_ask` over a proposed background wave with the Parallel Execution Checklist as checks (disjoint files, independent outputs, self-contained prompts; non-interactive + safe-unattended for scripts/tools); a failing check is a signal to fix/serialize/foreground, never a block; (2) *script/tool output* — redirect background runs to `.tmp/<name>.log`, then `jev_triage` the log as a `path` item (`failed` / `needs_action`) on completion or mid-run to decide wait/intervene/kill, pulling only the flagged tail into context; (3) *subagent reports* — write-capable background children write the full report to `.tmp/<name>.md` and reply with only path + one-line status; the parent triages the report before reading it (read-only children keep the inline report; § Caveman Mode exceptions apply). § Parallel Execution Checklist now names the checklist as the default `jev_ask` pack for a wave.
- `orchestration/references/jev-layer.md`: fourth point — background wave triage at dispatch + return (lanes/children); triage paragraph: artifacts must sit below the server's allowed root (worktree + `.worktrees/` sibling qualify; `/tmp` refused).
- **Live probe:** `jev_triage` with 3 `path` items — `/tmp/opencode/*.log` → `file_access` errors ("Path is outside the allowed roots"); repo file served; response `file_roots: ["/home/yohanes/projects/dotfiles"]` (server cwd = workspace). The 150-line doc item cost 13.9k input tokens, none entering main context. Model `jev-1.13.0`. Hence the workspace-relative `.tmp/` rule.
- Jev on the draft: `jev_check` 0.63 uncertain → diagnostic `jev_ask` pack located the flaw (hard-dependency implication 0.70); revised text → advisory 0.15, caveman-conflict 0.19, over-trigger 0.36, dispatch-scope 0.82 (control test pinned `noul` = P(yes): 0.96/0.02).
- **Optimality follow-up (jev review of the landed change):** `jev_score` 2.05/3 "sound with gaps" (action `review`); `jev_ask` pack flagged stale summary 0.69, unbounded artifact 0.64, coverage 0.74, overhead 0.47. Fixed: `orchestration/SKILL.md:179` summary now lists four points (gate, background dispatch/return, review, pre-merge); long artifacts must be bounded before triage (`tail` — jev reads the file whole; oversized items fail rather than truncate, `JEV_MAX_STATE_CHARS` default 200k chars); dispatch + checklist scope broadened to parallel waves "background or issued together" (file-conflict risk is not background-specific). Block stays in AGENTS.md (overhead 0.47 — not disproportionate).
- **Reviewer pass (pre-commit):** APPROVE WITH NITS, no SEV — 4 MEDs fixed: `file_roots` is reported by `jev_triage` only (not every call); the redirect needs `mkdir -p .tmp` first (`.tmp/` absent in the repo); the unsourced "64k request context" replaced by the installed-surface cap (`JEV_MAX_STATE_CHARS` 200k chars/item, fail-not-truncate); jev-layer return triage now matches `lane-wait.ts` printing the last ~4000 chars before triage. NITs: dispatch split (wave `jev_ask` pack vs single risky command `jev_check`); caveman exceptions noted for read-only children; lane-artifact rule rephrased to "below the allowed root" (`.worktrees/` sibling qualifies).
- Diff also carries a pre-existing newest-first reorder of two prior 2026-09-24 entries (content unchanged).
- **Verified:** `bash scripts/validate.sh` pass (38 pass / 0 fail / 4 skip) both rounds; `bash scripts/hm-switch.sh` exit 0 both rounds; live `~/.config/opencode/AGENTS.md` shows the new text (`default triage path` ×1, `file_roots` ×2, `Bound long logs first` ×1, `parallel wave (background or issued together)` ×2 — dispatch + checklist). Committed in one commit on `main`; pushed to `origin/main`.
- Files: `config/opencode/AGENTS.md`, `config/opencode/CONFIGURATION.md`, `config/skills/orchestration/{SKILL.md,references/jev-layer.md}`, this file.

## 2026-09-24 — compressed thinking: steward + explore #low (bunny)

- `space-bunny-free` (reasoning-capable per catalog) gains a custom `low` reasoning-effort variant in `opencode.jsonc` (`providers.opencode-go.models.space-bunny-free.variants`; array form). `none` was tried first and is **rejected upstream** (`invalid_request_error`) — not defined.
- Pins: `steward` → `opencode-go/space-bunny-free#low`; built-in `explore` → `opencode-go/space-bunny-free#low` (via `agents.explore.model`). `researcher` stays on the default variant — extended thinking kept by request; all other agent pins unchanged.
- Smoke (`opencode run --standalone`, fresh config): `#none` → upstream `invalid_request_error`; `#low` → clean `OK`. Identical trivial prompt: default variant 221 reasoning tokens vs `#low` 7; prior live `explore` children on the default variant burned 26-30k reasoning tokens each — the compression target.
- Real-task `explore` smoke post-switch (`#low`, steps 12): repo-wide grep task returned 6/6 hits matching an independent grep, `tokens_reasoning` 14.
- Why: user request — speed for the mechanical/search agents; reasoning tokens add TTFT with no quality need.
- Files: `config/opencode/{opencode.jsonc,agents/steward.md,CONFIGURATION.md}`, this file.

## 2026-09-24 — researcher/explore depth + speed pass (nested fan-out)

- `researcher`: `steps` 40 → 16; answer-first budget added (stop at the first evidence-complete answer; no broad sweeps, no re-verification, no extra context). Fan-out tightened: ≤2 independent codebase lookups stay inline; `explore` children only for ≥3 independent lookups, cap 3 → 2 children per run, one wave only (incomplete children become reported gaps, never a second wave); child prompts carry a quick-pass budget (answer exactly this question, ≤~6 tool calls, stop at the first complete answer, terse `path:line` report).
- Built-in `explore` (config `agents.explore`): `steps: 12` added — hard cap for nested children. `subagent_depth` stays 3: depth 2 would reject `explore` itself (`depth >= limit`; top-level session 0, child 1, `explore` 2) and 3 already blocks depth-3 spawns.
- `AGENTS.md`: delegation caps updated (≤2 `explore` children per fan-out, ≥3-lookup fan-out threshold, quick-pass child budget, one-wave rule); codebase-exploration prompt template gains the depth budget.
- Why: user request — researcher/explore nested sessions too slow/too deep. Model pins unchanged (`opencode-go/space-bunny-free`).
- Files: `config/opencode/agents/researcher.md`, `config/opencode/opencode.jsonc`, `config/opencode/AGENTS.md`, `config/opencode/CONFIGURATION.md`, this file.
- Applied via `scripts/hm-switch.sh` (exit 0); live symlinks verified (`researcher` steps 16, `explore` steps 12). Takes effect on new subagent sessions.

## 2026-09-24 — fastfetch: logo top aligned with first text row

- `logo.padding.top` 1 → 3 so the kitty image's first row lands on the `user@host` title row (the module list starts with three blank rows).
- Verified with a numbered text-logo substitution: logo row 1 == title row.


## 2026-09-24 — fastfetch: colors forced with `display.pipe: false`

- Output showed black-and-white when `NO_COLOR` was set or stdout was not a TTY (fastfetch auto-enables pipe mode). Added `display.pipe: false` so the Catppuccin palette and kitty logo are always emitted.
- Verified: piped runs and `NO_COLOR=1` runs now carry the full truecolor palette (OS `#F38BA8`, WM `#A6E3A1`, PC `#F9E2AF`, values `#CDD6F4`); Ghostty render unchanged (image + palette).

## 2026-09-24 — fastfetch: separator, info expansion, Catppuccin Mocha palette

- Replaced the chevron separator with two-space spacing (`display.separator`).
- Added the title and system-state rows (Uptime, Load avg, Processes, Init), Graphics and Network sub-groups (OpenGL/Vulkan/OpenCL; Local IP/DNS), Wallpaper, TPM, CPU cache, BTRFS, and Brightness, plus footer Date/Locale/Fastfetch/Palette.
- Replaced ANSI 31/32/33/36 with the Catppuccin Mocha truecolor palette: OS `#F38BA8`, WM `#A6E3A1`, PC `#F9E2AF`, footer labels `#6C7086`, and values `#CDD6F4`. Deployed and live-verified: truecolor escapes confirmed; kitty logo intact.

## 2026-09-24 — fastfetch: icon+label keys, Cores row, user-readable RAPL

- Changed all module rows to icon+label keys; `display.key.width: 18` keeps values aligned.
- Added per-core `Cores` Thermal row.
- Added `scripts/rapl-user-access.sh` and applied its `/etc/udev/rules.d/99-rapl-readable.rules`; `CPU W` now shows live package watts.
- GPU rows remain hidden pending an NVML fix: kernel module `610.57.04` mismatches library `615.71` until reboot/driver sync.

## 2026-09-24 — question policy + one-level fan-out

- `AGENTS.md`: prefer proceeding over blocking `question` calls (reversible choices → recommended default + stated assumption; `question` reserved for irreversible/ambiguous forks); one-level fan-out (`explore` children are leaves, no child spawns); dedupe research branches before spawning.
- `researcher.md`: child prompts must state leaf-only; skip questions already covered in-run or by siblings.
- Why: browser-use session forensics — one `question` call idled 4h12m (80.5% of session wall-clock); 8 depth-3 spawn failures; 1,361 external calls with 1,055 in `explore`.

## 2026-09-24 — fastfetch: Thermal sub-group

- Added Thermal before Power: board, chipset, and NVMe/SSD temperatures via hwmon, plus self-hiding fan RPM and GPU temp rows (live-verified).
- `gpupower` is now power-only (`nvidia-smi --query-gpu=power.draw`); temperature moved to Thermal.
- Machine limits: no readable RAM/DIMM temperature or power sensor (only SPD EEPROM `ee1004`); motherboard temperatures are available, but motherboard power is not software-readable (no Super I/O rails); CPU RAPL `energy_uj` is root-only, so `cpupower` hides when unreadable.
- NVIDIA kernel module `610.57.04` vs NVML library `615.71` mismatch keeps GPU rows hidden until reboot/driver sync.

## 2026-09-24 — fastfetch: power sub-group last + CPU temp + guarded power rows

- Moved Power to the bottom of the PC group, after Display.
- CPU row now appends `{temperature}` from coretemp hwmon.
- Added self-hiding `command` rows: `gpuusage` in Compute; `cpupower` and `gpupower` in Power; `case` guards filter broken `nvidia-smi` text.
- RAPL `energy_uj` is root-only on this desktop, so `cpupower` hides when unreadable. Current `nvidia-smi` NVML mismatch (`Driver/library version mismatch`, library 615.71) keeps GPU rows hidden until driver sync/reboot resolves it.

## 2026-09-24 — fastfetch groups preset: nested sub-groups

- Introduced nested sub-group headings (`custom` rows, bold group color, no separator) and nested tree rails (`│ ├`/`│ └`).
- WM group nests Session/Theme/Terminal.
- PC group nests Firmware/Compute/Memory/Storage/I/O/Media/Power/Display.
- Power/camera rows stay silent on hardware without them.
- Deployed and verified live (kitty logo intact).

## 2026-09-24 — fan-out caps + explorer fast paths

- Delegation caps: ≤3 parallel `researcher` spawns and ≤3 `explore` children per fan-out; excess questions batch into those children (`AGENTS.md`, `researcher.md`). Fan-out is the most expensive pattern — use the fewest agents that cover the work; check the usage footer before heavy fan-out.
- `explorer` skill gains retrieval fast paths: `gh`/raw-URL ladder for GitHub source, batched raw-preferring web fetches (children no longer scrape rendered HTML).

## 2026-09-24 — fastfetch groups preset: IO/audio/capability rows

- PC group += `bootmgr`, `netio`, `diskio`, `sound`, `codec`, `camera`.
- Verified live: camera silent; no camera hardware.
- Logo, palette, separator unchanged.

## 2026-09-24 — fastfetch groups preset expanded with device info

- PC group += `chassis`/`bios`/`board`/`cpuusage`/`physicaldisk`/`battery`/`poweradapter`.
- WM group += `de`/`lm`.
- New rows use fastfetch `{icon}` substitutions.
- Logo, palette, separator, and existing keys otherwise unchanged.

## 2026-09-24 — fastfetch config → LierB groups preset

- Switched active preset to LierB groups (OS/WM/PC color groups).
- Adapted deprecated numeric format placeholders for fastfetch 2.68.1 (`{pacman}`, `{name}`, `{cores-logical}`, `{freq-max}`).
- Added penrose-sky kitty image logo (600x600, resized from upstream 1080x1080).
- Preserved full-info as `full-info.jsonc`.

## 2026-09-24 — fastfetch config → LierB full-info preset

- Switched module layout to LierB/fastfetch full-info (all modules, upstream order).
- Kept the kitty image logo.
- Pinned `$schema` to 2.68.1.
- Preserved the adapted HyprFlux theme as `config/fastfetch/hyprflux.jsonc` for switching back.

## 2026-09-24 — jev usable frequently: nested `jev-mcp_*` allows + key-file hardening + AGENTS.md cadence

- **Root cause (live-audited):** nested MCP calls are gated twice — outer `execute` (Code Mode) **and** a per-tool allow named `<server>_<tool>`. No custom agent allowed `jev-mcp_*`, so the wildcard deny blocked jev in every subagent even where `execute` was allowed; only the primary session (global `permission: "allow"`) could call it. Plain `jev_*` / `jev_check` actions do not match server `jev-mcp`.
- **Permissions:** added `- action: jev-mcp_*` to `architect`, `researcher`, `reviewer`, `swe` (after the wildcard deny, alongside `codegraph_*`). `designer` / `steward` / `vision` deliberately excluded (they also lack `execute`).
- **Key-file hardening:** `home/modules/env` gains `writeTypeSafeKey` — extracts `TYPESAFE_API_KEY` from `.env.toml`, writes `~/.config/typesafe/key` (0600, cmp-guarded) on every switch. The `opencode.jsonc` jev-mcp entry drops its `environment` block: the daemonized service can start with an empty `TYPESAFE_API_KEY`, an empty string is not nullish, and jev-mcp's precedence (`TYPESAFE_API_KEY ?? JEV_API_KEY ?? key file`) means it would win over the file and poison every judgment with an auth error. Browser-use now uses the equivalent file-based path: `home/modules/env` writes `~/.config/browser-use/key` (0600) and `browser-use-mcp` injects it into the child, so no process-environment key is required.
- **Cadence:** new AGENTS.md § Jev — frequent cheap typed judgments (`jev_check` one yes/no; `jev_ask` ≤64 questions over ONE shared state in a single request — the batch lever; `jev_triage` ≤50 items, `path` items read server-side, one request per item), triggers (ambiguous decisions, plan/design sanity, pre-commit self-check, diff pre-filter, borderline classification), advisory-only contract (never a completion signal; never replaces reviewer/CI/evidence; skip on error/abstain). `jev-layer.md` gains `jev_models` in the tool list + the subagent-permission note.
- **Cost/limits** (docs.typesafe.ai, fetched 2026-09-24): $42/B input tokens, output free; 1,200 req/min, 250k tok/s; 64k request context (32k state side); official bench: 13 questions batched = 12.2x cheaper / 10x faster than singles — prefer `jev_ask`.
- **Verified:** `bash scripts/validate.sh` exit 0 (46 pass / 0 fail / 4 skip); after the switch, a `researcher` subagent called `tools["jev-mcp"].jev_models()` successfully (previously permission-denied); `~/.config/typesafe/key` written 0600 by the activation; primary-session jev OK.
- Files: `config/opencode/agents/{architect,researcher,reviewer,swe}.md`, `config/opencode/opencode.jsonc`, `config/opencode/{AGENTS.md,CONFIGURATION.md}`, `config/skills/orchestration/references/jev-layer.md`, `home/modules/env/default.nix`, this file.

## 2026-09-24 — fastfetch theme → adapted HyprFlux

- Replaced the initial hand-rolled config with an adapted HyprFlux theme (910★, MIT, pinned `$schema` 2.68.1).
- Added `config/fastfetch/logo.png` (Kitty-protocol image logo) and linked it via `home/modules/fastfetch/default.nix`.
- Adapted named ANSI colors to Tokyo Night truecolor hexes, added the KDE `de` row, removed a duplicate `display` row, and fixed the palette footer and trailing commas.

## 2026-09-24 — browser-use MCP added

- Added pinned `browser-use[cli]==0.13.10` stdio MCP through the Home Manager `browser-use-mcp` wrapper (`uvx --from 'browser-use[cli]==0.13.10' browser-use --mcp`) for user-requested LLM-driven autonomous browser tasks; the pin prevents silent `uvx` upgrades, while upstream CLI/API changes remain a degradation risk.
- Routes LLM calls through localhost `http://127.0.0.1:49381/v1` via the `browser-use-llm-proxy` systemd user service, which forwards `/v1/*` to OpenCode Go `https://opencode.ai/zen/go/v1/*`, injects a per-process UUID `x-opencode-session` header required for external clients, strips hop-by-hop headers, and streams responses. The wrapper still reads `~/.config/browser-use/key` and exports it to the MCP child as `OPENAI_API_KEY`; `opencode.jsonc` keeps only the proxy base URL and model environment values, with no `OPENAI_API_KEY` mapping. Dedicated source key: `OPENCODE_BROWSER_USE_API_KEY`; `BROWSER_USE_API_KEY` belongs to Browser Use Cloud.
- Final model: `mimo-v2.6-flash`, the cheapest Go model passing browser-use's strict `json_schema` structured-output check. `deepseek-v4.1-flash` fails that check, so the earlier DeepSeek/Kimi routing and fallback are no longer the final wiring.
- **File-based key fix:** `home/modules/env` gains `writeBrowserUseKey`, which extracts `OPENCODE_BROWSER_USE_API_KEY` from `.env.toml` and writes `~/.config/browser-use/key` (0600, cmp-guarded) on every switch. The `browser-use-mcp` wrapper consumes that file, mirroring `writeTypeSafeKey` for jev. Reason: a TUI-spawned daemonized service ignores systemd user environment, and `service set env` is ignored by the respawn path; env interpolation therefore caused empty/missing credentials. The file-based wrapper removes that daemon-environment footgun.
- **Final browser attachment:** browser-use now attaches to the user's running **Google Chrome** via CDP, not a copied or isolated profile. Repo-managed `config/browseruse/config.json` sets the default `browser_profile` to `{ "id": "0638303e-…", "default": true, "cdp_url": "http://127.0.0.1:9223" }` for the local `Dev` profile (`--profile-directory="Profile 2"`).
- **Declarative conversion:** Added `home/modules/browser-use/default.nix`, imported from `home/common.nix`, to provision `config/browseruse/config.json` to `~/.config/browseruse/config.json` with `browserUseSyncConfig` (cmp-guarded copy) and render Chrome desktop overrides with `browserUseChromeDesktop` (cmp-guarded `sed` output from `/usr/share/applications/*.desktop`, followed by `update-desktop-database`) on every switch. The config is copied, not symlinked from `/nix/store`, because browser-use rewrites `config.json`/tool state; dotfiles source wins on the next switch. Desktop files are regenerated from system launchers so distro updates are picked up.
- **Chrome/CDP setup:** Chrome runs with `--remote-debugging-port=9223 --user-data-dir=/home/yohanes/.config/google-chrome --profile-directory="Profile 2"`. Rendered overrides at `~/.local/share/applications/google-chrome.desktop` and `~/.local/share/applications/com.google.Chrome.desktop` add `--remote-debugging-port=9223 --user-data-dir=/home/yohanes/.config/google-chrome` to every `Exec` line. Why this shape: use the real profile without a copy; Chrome 154's default-data-dir restriction accepts the port only when explicit `--user-data-dir` is present (switch presence satisfies the restriction).
- **Run requirement and caveats:** Chrome must be running from an overridden launcher or browser tools fail. The port is localhost-only, but local processes can control the browser. The agent acts on real profile tabs two-way; `browser_close_all` closes real tabs. The Vivaldi route is abandoned and its desktop override was reverted; a live Vivaldi instance may hold port 9222 until restart (harmless).
- **Verified live (2026-09-24):** `browser_navigate` opened a new tab in the user's Chrome and `browser_extract_content` returned the page heading.
- Uses `mimo-v2.6-flash` for tool calls and vision via the localhost proxy. Free Go/Zen models such as `space-bunny-free` are OpenCode-client-only, so external agents require a paid key. Grants browser + filesystem access, so use for scoped autonomous tasks only.
- Survey chose `browser-use/browser-use` (116k stars, active) as complement to `agent-browser`; rejected `ChromeDevTools/chrome-devtools-mcp` and `microsoft/playwright-mcp` as redundant with built-in browser tools, `BrowserMCP/mcp` as stale with one contributor, and `browserbase/mcp-server-browserbase` as archived. Repo: https://github.com/browser-use/browser-use.

## 2026-09-24 — opencode-subagents overflow popup table

- Added a host dialog for hidden subagents with a deterministic two-line table: agent, title, status, elapsed time, tokens, and cost on line one; model on line two.
- Session time now uses each session's own duration, with running work taking precedence over stale resume idle data.
- Added scrollbar-reservation alignment handling, a render-based alignment guard, and stable running-before-done/error ordering.

## 2026-09-24 — fastfetch configuration added

- Added `config/fastfetch/config.jsonc` with the CachyOS built-in logo, Nerd Font icons, an inline truecolor `{##RRGGBB}` palette, custom bar characters, and grouped system/session/hardware/network modules ending in the terminal color palette.
- Added `home/modules/fastfetch/default.nix` to deploy the config declaratively; imported it from `home/common.nix`.
- Added `fastfetch` to the pacman package list in `home/modules/pacman/default.nix`.

## 2026-09-24 — icm extraction cadence tuned

- `EXTRACT_EVERY` 3 → 6: raw tool output is enqueued every 6th call; `DRAIN_EVERY` stays 10, so detached `icm extract-pending` runs about every 60 tool calls.
- `icm extract-pending --limit` 30 → 10: each drain processes 10 items, with roughly half the previous extraction volume.
- Why: each drain cold-loads its ONNX model (~31s, ~400% CPU, ~2.1GB RSS); rarer, smaller bursts reduce fan noise. Live plugin copy already synced; service reload required for effect.

## 2026-09-24 — researcher GitHub tools + inline external research

- New `config/opencode/plugins/gh.ts` registers six read-only GitHub tools (`gh_search_code`, `gh_search_repos`, `gh_search_issues`, `gh_repo`, `gh_file`, `gh_api`) wrapping the authenticated `gh` CLI via `execFile` — fixed read-only subcommands, validated args, 20 s timeout, 40 KB output cap; unit tests in `config/opencode/plugins/gh.test.ts`.
- `researcher` gains `action: gh / resource: "*" / effect: allow` plus inline external-research rules (independent `webfetch`/`websearch`/`gh_*` calls in one parallel step; `explore` children only for codebase fan-out) and fetch hygiene (raw/API over HTML, batched fetches, avoid slow proxy endpoints, no identical retry).
- `librarian` skill gains a retrieval fast-paths section (gh tools / `shell` / raw-URL ladder for GitHub; batched raw-preferring web fetches).
- `home/modules/opencode/default.nix` gains a store-sourced copy activation (`opencodeSyncGhPlugin`) so the plugin deploys from any checkout/worktree.

## 2026-09-24 — icm MCP → plugin tools + icm-http warm daemon

- Removed the `icm` MCP entry; `config/opencode/plugins/icm.ts` now registers 31 tools under the `icm` namespace with unchanged exposed ids.
- Added the `icm-http` systemd user service (`icm serve --http 127.0.0.1:11435`) and split heavy semantic work over HTTP from cheap CLI work. One warm embedding model replaces duplicate per-client models, reducing repeated model loads and CPU use.
- Files: `config/opencode/{opencode.jsonc,plugins/icm.ts,AGENTS.md,CONFIGURATION.md}`, `home/modules/opencode/default.nix`, this file.
- Verified: service active; `/health` reports `{"status":"ok","has_embedder":true}`; scratch smoke passed all 6 endpoints; live plugin calls returned 1,987 memories and 15 topics.
- Restart OpenCode to unload the removed MCP entry; live `~/.config/opencode/opencode.jsonc` already matches the repo.

> 2026-09-24 — **Vision agent moved to `opencode-go/mimo-v2.6-flash` (default variant), user preference.** Flash is vision-capable per catalog and stronger than the free bunny; the original vision breakage was the `#none` variant (indefinite hang), not the model. Pin deliberately has **no variant** — `#none` must never be used on flash; `#low`/`#medium` are valid if latency matters. Smoke: same generated invoice image, exact transcription incl. `INVOICE #A-4217` + tallest-bar right. Fallback unchanged: `deepseek-v4-flash-vision-exp`. Files: `config/opencode/agents/vision.md`, `config/opencode/CONFIGURATION.md`, this file.

> 2026-09-24 — **Vision agent fixed: `mimo-v2.6-flash#none` (hangs) → `opencode-go/space-bunny-free`.** All three prior vision pins on flash were either broken (`#none` never returns) or unverified. Candidate scan from models.dev: 30 opencode-go models accept image input; picked bunny for free tier + consistency with the other cheap agents. Smoke test (generated invoice image: header `INVOICE #A-4217`, three line items incl. `Total due $137.50`, 3-bar chart): bunny transcribed every string exactly and identified the tallest bar correctly. Fallback stays `deepseek-v4-flash-vision-exp` ($0.15/$0.60, purpose-built, also vision-capable per catalog). Files: `config/opencode/agents/vision.md`, `config/opencode/CONFIGURATION.md`, this file. Note: `providers.opencode-go.models.mimo-v2.6-flash.variants` (`none`/`low`/`medium`) now has zero consumers — kept for now, removal is a separate call.

> 2026-09-24 — **Cheap-agent model switch to `opencode-go/space-bunny-free` after benchmark + reliability findings (user-approved).** Direct-HTTP benchmark (zen/go, identical prompt): `mimo-v2.6-flash` 150-174 gen t/s but TTFT 1.8-29.4s, intermittent `400 Upstream request failed: Model is unavailable` + read timeouts — jev reliability judgment **0.90 yes (unreliable)**; `mimo-v2.5` stable but slow (50-63 total t/s); `space-bunny-free` 167-184 total t/s, TTFT 1.3-1.6s, and passed live tool-call + subagent-delegation smoke tests (cost 0); `muse-spark-1.3-contributor` ~160 total t/s but Contributor tier **trains on prompts/completions**, region-limited, heavy hidden reasoning (226-1760 tok) — rejected for private repos. **Bug:** `mimo-v2.6-flash#none` never returns (indefinite hang, reproduced via direct API and CLI; `#low`/`#medium` fine) — `explore` was pinned to exactly that variant. Chunk-gap analysis ruled out local CPU/network as the latency source (p50 0-277ms, max ≤850ms; variance lives in provider-side TTFT). Switched `explore` + `researcher` + `steward` to `space-bunny-free`; `vision` left on `mimo-v2.6-flash#none` (broken, needs a vision-capable replacement). Go usage at test time: monthly 86% (resets 2026-09-26). Files: `config/opencode/{opencode.jsonc,AGENTS.md,CONFIGURATION.md}`, `config/opencode/agents/{researcher,steward}.md`, this file. Takes effect at next hm-switch.

> 2026-09-24 — **Dead config weight + full engram removal (user-approved).** Deleted dead weight: `config/opencode/skills/` (empty dir, never mapped — nix can't materialize empty dirs), stock `config/nvim/lua/plugins/example.lua`, unused `config/nvim/.neoconf.json` (no neoconf consumer plugin). Purged engram integration entirely: `config/engram/` (config.json), `home/modules/engram/` + its `home/common.nix` import, go-install block in `home/modules/manual/default.nix` (module now a no-op stub) and `scripts/install-manual.sh`, engram MCP entries in `config/omp/mcp.json` + `config/opencode/opencode.jsonc` (3 MCPs left: icm, codegraph, jev-mcp), live docs (`CONFIGURATION.md` MCP table/tree/sample/key note, `README.md` layout, `home/modules/{packages,omp,pacman}` comments, `config/zsh/path.zsh` PATH comment, `config/skills/swe/SKILL.md` layering note). System: `~/.local/bin/engram` removed; `~/.engram/engram.db` (20M user data) kept. Files: those above + `docs/research/engram-replacement.md` (status note), this file.

> 2026-09-24 — jev review follow-up (F3/F4): designer's unscoped `edit` allow documented as prompt/skill-enforced (design-artifact boundary binding; a project may narrow the envelope in its own config); architect's `execute` allow documented as Code Mode-only (no fs/process; codegraph MCP) so the read-only claim holds. No permission semantics changed — clarity only. Jev pre-fix: designer gap 0.72 yes; architect execute 0.78 yes. Files: `config/opencode/agents/{designer,architect}.md`, this file.

> 2026-09-23 — jev config review applied (F1/F2/F5): swe/steward permission envelopes swapped dead `engram_mem_*` allows (engram MCP disabled) for `icm_memory_*`/`icm_wake_up`/`icm_feedback_*` — restores icm memory for both agents, matching this file's agents table; MCP Servers table now lists jev-mcp (4); AGENTS.md `opencode.json` → `opencode.jsonc`. Jev findings before fix: dead refs 0.96 yes, icm reachability 0.20 no; health 1.53/3 (risky band). Deferred: designer edit-scope enforcement gap (F3, jev 0.92), architect execute note (F4, informational). Files: `config/opencode/agents/{swe,steward}.md`, `config/opencode/AGENTS.md`, this file.

> 2026-09-23 — **Final review of the skill refactor (independent `reviewer`): approve with nits — ship; all findings applied.** The reviewer confirmed the split is lossless vs the 565-line pre-split monolith and re-verified the pinned forms against luvus 0.14.2 / opencode v2.0.15. Fixes: (MED) `goal/SKILL.md` Phase 3's leftover in-loop/DONE writer instruction removed (pointer to `orchestration` § Plan close-out) — closes the last double-writer seam; (MED) the lane runner now persists `rc=` into `<slug>-return.md` (the file's appearance = runner finished, not success) with the docs/lane-wait/SKILL reworded + a new "lane return with rc≠0" break point; (LOW) CONFIGURATION tracked-claim + stale `/design-thinking` tree line, `work-plans` § Validate wording, `lane-layout.ts` anchor-workspace guard + strict `/^[0-9]+$/` anchor; (NIT) `plan-check.sh` whitespace-collapse + plan-name validation (`[a-z0-9-]`), dependency-entry `mem_save` ref, reproduce note; (pre-existing) `lane-dispatch.md` researcher fan-out wording (foreground, per AGENTS.md) + `plan-template.md` table separator. Re-verified: core smoke suite 26/0, fix suite 11/0, validate-skills exit 0 (50 skills, 7 warnings), `orchestration/SKILL.md` 484 lines. Files: `config/skills/{goal,orchestration,work-plans}/**`, `config/opencode/CONFIGURATION.md`, `docs/smoke/skill-pipeline-2026-09-23.md`, this file.

> 2026-09-23 — **Smoke test of the goal/orchestration/work-plans pipeline — 26 pass / 2 fail, 10 edge cases.** Report kept at `docs/smoke/skill-pipeline-2026-09-23.md` (under `docs/`; `status/` is gitignored — the file is untracked until committed). Validated live: `plan-check.sh` GREEN on the real DONE plan + 6 failure fixtures; `lane-wait.ts` argv/timeout/present/late-file; `lane-layout.ts --dry-run` N=1/3/9 + arg rejection (`--max-per-tab 0`, `--master-ratio 2`, missing `--lanes`); dependency edges acyclic; all 14 skill-relative refs resolve; MCP reachability icm/jev/codegraph OK. Fixed during the run: `goal/SKILL.md` now points at `~/.agents/skills/work-plans/assets/plan-template.md` (was an unresolvable `assets/…` ref). Open findings: `lane-layout.ts` rejects N=0 vs the SKILL's N=0 claim, invalid-JSON exits 1 not 2, `--anchor` unvalidated, duplicate lane names accepted; `plan-check.sh` misses FAILED-without-report, state-enum validation, and miscounts a 3-line status.md without a trailing newline (`wc -l`). **Fix pass (same day):** E1–E7 fixed and re-verified — `lane-layout.ts` now usage-validates empty lanes / invalid JSON / non-numeric anchor / duplicate lane names; `plan-check.sh` enforces FAILED-has-report, validates the state enum, and counts records (`awk 'END{print NR}'`) not newlines; `orchestration/SKILL.md` N=0 claim corrected. Re-run: core suite 25/0, fix suite 11/0, real `steward-agent` plan still GREEN. **Closeout (E8 + E10):** `bash scripts/hm-switch.sh` (hostname `homestation`→`desktop`) exit 0, `/orchestrate` live. **Nix gotcha:** untracked files are invisible to the flake — the hm-managed command needed `git add config/opencode/commands/orchestrate.md` + a re-switch; skills are unaffected (their activation symlinks the repo path). `Edge cases` extracted to `orchestration/references/edge-cases.md` (SKILL 499→480 lines); core suite re-run 26/0. Pre-existing drift surfaced (not from this session): `skills-sync.sh --global --check` reports 33 externalized skills missing (network-dependent, non-fatal). Files: `docs/smoke/skill-pipeline-2026-09-23.md`, `config/skills/goal/SKILL.md`, `config/skills/orchestration/{SKILL.md,scripts/lane-layout.ts,references/edge-cases.md}`, `config/skills/work-plans/scripts/plan-check.sh`, `config/opencode/commands/orchestrate.md`, this file.

> 2026-09-23 — **Tool/MCP audit of the goal/orchestration/work-plans skills — dead engram memory calls replaced with icm.** The skills' memory references pointed at the DISABLED `engram` MCP (`engram.enabled: false` in `opencode.jsonc`): `mem_save` / `mem_context` / `mem_current_project` in `goal/SKILL.md` (181/184/213), `orchestration/SKILL.md` (guard/close-out/compaction-recovery memory calls), `orchestration/references/lane-dispatch.md:109`, `work-plans/SKILL.md` (106/135), and the bundled `work-plans/assets/plan-template.md` (25/31). All replaced with the active `icm` tools: `mem_save` → `icm_memory_store`, `mem_context`/`mem_current_project` → `icm_wake_up` + `icm_memory_recall`. `orchestration` Runtime now names both MCP namespaces reached through `execute` (`tools["jev-mcp"].*` advisory judgments, `tools["icm"].*` memory). Everything else audited valid: `subagent`/`question` tools, `execute` Code Mode, `luvus`/`opencode run`/`bun`/`plan-check.sh` shell calls; no `herdr`/`opencode2`/`task()`/`delegate()`. Post-fix jev tool-ref check: goal **0.84**, orchestration **0.86**, work-plans **0.87** — all yes. Also aligned `work-plans/assets/plan-template.md:4` state enum to `PLAN | WAIT | WORKING | DONE | FAILED` (matched the skill's definition; it had listed only `PLAN | WORKING | DONE`). Files: `config/skills/{goal,orchestration,work-plans}/**`, this file.

> 2026-09-23 — **Skill dependency model made explicit (design-thinking + jev-judged): `goal → {orchestration, work-plans}`, `orchestration → work-plans`, `work-plans` standalone leaf.** Each skill declares its edges in frontmatter `metadata.requires` + a body `## Requires` section: `goal` requires `orchestration` + `work-plans`; `orchestration` requires `work-plans`; `work-plans` declares `requires: []` + a § Standalone leaf statement (its `/goal` example removed). Single-writer resolved per jev (close-out ownership: orchestration 1.00, action `act`): `goal` writes the OPEN only (plan.md / status.md PLAN / TIMELINE / acceptance freeze) and its Close-out is now a pointer; `orchestration` § Plan close-out is the sole owner of the final flip (`plan-check.sh` + jev closure judgment + `report.md`/`status.md` DONE|FAILED/TIMELINE/`icm_memory_store`). `goal` Phase 3 drops the pre-DONE plan-check. Jev: revised design soundness **0.90 yes** (initial design **0.20 no** — it still embedded the double writer); gap-vs-model after edits: goal 0.42→**0.77 yes**, orchestration 0.45→**0.73 yes**, work-plans leaf **0.96 yes**. Files: `config/skills/{goal,orchestration,work-plans}/SKILL.md`, this file.

> 2026-09-23 — **work-plans gains an advisory jev judgment at both ends of a plan.** `config/skills/work-plans/SKILL.md` § Jev judgment: at open, `jev_triage` on `plan.md` (path item, read server-side) checks `scope_bounded` / `acceptance_verifiable` / `graph_valid` / `no_placeholders`; before flipping DONE/FAILED, `jev_check` on the frozen acceptance + `report.md` + `status.md` checks that every criterion has matching evidence and the artifacts agree. Advisory only — `plan-check.sh` + the artifact rules stay authoritative; jev never opens, blocks, or closes a plan. Wired into the pipeline: `goal` Phase 3 runs the open judgment before the execution gate; `orchestration` runs the closure judgment before DONE/FAILED; `orchestration/references/jev-layer.md` cross-references it. Demo on the historical `status/steward-agent/plan.md`: scope_bounded yes, no_placeholders yes, acceptance_verifiable **no**, graph_valid uncertain. Files: `config/skills/work-plans/SKILL.md`, `config/skills/goal/SKILL.md`, `config/skills/orchestration/{SKILL.md,references/jev-layer.md}`, this file.

> 2026-09-23 — **`orchestration` skill gains an advisory jev judgment layer; `/goal` command names the handoff.** Wired `jev-mcp` into `config/skills/orchestration/SKILL.md` as an ADVISORY pre-filter (never replaces the human gate, the `reviewer` subagent, CI, or the evidence rule; never a completion signal): `jev_check` pre-checks the frozen plan at the execution gate; `jev_triage` pre-filters each lane's `git diff` (passed as a `path` item → read server-side, diff never enters orchestrator context) with scope/acceptance/secrets/offscript checks before the `reviewer` runs; `jev_check` on the PR pre-merge. New break point: jev unavailable/abstain → skip + fall back to the reviewer path. Runtime surfaces note MCP tools arrive via `execute` (`tools["jev-mcp"].*`). `config/opencode/commands/goal.md` rewritten to name the goal→orchestration handoff (one-off `jev_triage` over the 6 changed docs gave no herdr/opencode2 and no dangling refs; the `goal.md` coherence signal drove the rewrite). Files: `config/skills/orchestration/SKILL.md`, `config/opencode/commands/goal.md`, this file.

> 2026-09-23 — **`goal` skill split: orchestration extracted to a standalone `orchestration` skill + `/orchestrate` command.** `goal` is now the goal *lifecycle* only (intake → classify → design → protocol → track → handoff → close-out); the execution plane moved into the new `orchestration` skill (`config/skills/orchestration/SKILL.md`): main-session guard, simple/complex routing, execution gate, Phase 4 (isolate/dispatch/return), Phase 5 (verify/loop/review/merge + hardened gate + plan close-out), break points, edge cases, standing guardrails. Moved with it: `references/lane-dispatch.md`, `references/cli-reference.md`, `scripts/lane-layout.ts`, `scripts/lane-wait.ts` (now `~/.agents/skills/orchestration/...`; internal cross-refs re-pointed). `goal` keeps Phase 0–3 + a Handoff section + goal-side guardrails; `status/<plan>/plan.md` stays the single plan of record. New command `config/opencode/commands/orchestrate.md` loads `orchestration` directly for an already-frozen plan. The canonical `goal` skill already runs on luvus (herdr→luvus port, working tree, uncommitted at time of write); no `herdr` remains in `config/skills/` or `config/opencode/commands/`. `sources.json` `keep` gains `orchestration`. Files: `config/skills/{goal/SKILL.md,orchestration/**}`, `config/opencode/commands/orchestrate.md`, `config/skills/sources.json`, this file.

> 2026-09-23 — **researcher tool-boundary fix (no `shell`) — aborted with no report.** Session `ses_f3140fcf5ffevQdXmgSWaQTo7b` (researcher, "Audit custom opencode plugins V2 health") ended `finish=error` / `error.type=aborted` at seq 281 with no merged report. Cause: the task required system-level checks (`which opencode`, `opencode version`, nix-store plugin-loader path), but `researcher` has **no `shell` permission** while the injected `config/opencode/AGENTS.md:19` advertises `shell` as a built-in tool — so the model passed shell commands to `execute`. `execute` is the V2 **JS Code Mode sandbox** (no `child_process`/`require`/fs) — all 15 calls failed `Unexpected token` (seq 114–281), it looped, ignored its own successful `explore` child (built-in `explore` **has** `shell`; 68 shell calls, returned `opencode v2.0.15` + binary/loader paths), and was interrupted. Fix: `config/opencode/agents/researcher.md` body now states the boundary — you have NO `shell`; never pass shell commands to `execute` (MCP tools only: `tools.codegraph.*`/`tools.icm.*`/`tools.browser.*`); delegate every system-level command (binary discovery, `which`/`readlink`, version checks, `ls`/`find`, nix-store paths, build/tooling state) to an `explore` child; never re-verify a child's system findings inline. Permissions unchanged (still read-only). Files: `config/opencode/agents/researcher.md`, this file. Takes effect at next hm-switch (agents are nix-store symlinks).

> 2026-09-23 — **`TYPESAFE_API_KEY` verified live; env-restart footgun recorded; jev-mcp 0.5.0 exposes a different tool set than its README.** The key lives only in `~/projects/dotfiles/.env.toml` (top-level, `apikey_…` — `.env.toml.example` placeholder corrected from `ts-…`); there is no `~/.env.toml`. Two consumers, both verified: new interactive zsh gets it from `config/zsh/extra.zsh`, and `home/modules/env` imports it into the systemd user env on every `hm switch` (`systemctl --user show-environment` → present). **Footgun:** the opencode background service is daemonized and inherits the environment of whatever launched it, *not* the systemd user env — `opencode service restart` from a shell that predates the key leaves `{env:TYPESAFE_API_KEY}` empty for the `jev-mcp` child (observed: service env had 0 `TYPESAFE` lines after a restart from a stale shell, 1 after restarting from a key-bearing shell). Restart the service from a shell that has the key (or after `hm`), and relaunch long-running agent TUIs, because MCP env is resolved once at process start. Live proof of the credential: `jev_models` (called over MCP stdio with the key) returned `active_model: jev-latest` + the model catalog. **Tool-set mismatch:** `jev-mcp@0.5.0` publishes 6 generic question-pack tools — `jev_classify`, `jev_score`, `jev_check`, `jev_ask`, `jev_triage`, `jev_models` — not the `jev_review` / `jev_verify` / `jev_assess_change_risk` / `jev_check_requirement` set documented in its README, so the advertised diff-review gate is not available from this build; use `jev_ask`/`jev_check` packs or omp-jev (which has its own planner/dispatcher/decide surface) instead.

> 2026-09-23 — **herdr replaced by luvus; omp config added to dotfiles; jev installed for both harnesses.** (1) Multiplexer cutover: `home/modules/upstream/default.nix` + `scripts/install-manual.sh` install `luvus` (`LUVUS_INSTALL_DIR=~/.local/bin`, v0.14.2) instead of herdr; new `home/modules/luvus` deletes the herdr leftovers (`~/.local/bin/herdr`, `~/.config/herdr`, `~/.omp/agent/extensions/herdr-omp-agent-state.ts`, `~/.agents/skills/herdr`) and runs `luvus integration install omp|opencode` + `luvus skill enable` (bundled release-matched skill → `~/.agents/skills/luvus`, `~/.config/opencode/skills/luvus`, `~/.omp/agent/skills/luvus`). `config/skills/herdr/` deleted; the `/goal` lane dispatch is ported (`config/skills/goal/`): `lane-layout.ts` rewritten for luvus (`pane split --auto`, `pane run`, one atomic UHP `layout.apply` per tab) and verified for both the single-tab master+grid and the overflow-tab path. (2) **`cli.json` is no longer a nix-store symlink**: `luvus integration install opencode` rewrites it (adds `"plugins": ["./luvus-v2"]`) and replaced the link with a real file, so it is now cmp-guarded-copied by `opencodeSyncCliJson` with the repo copy carrying the plugin entry. (3) New MCP **`jev-mcp`** (TypeSafe Jev typed decision layer, `bun install -g --trust jev-mcp`, bin `jev-mcp`) — live judgments require `TYPESAFE_API_KEY` (`.env.toml.example`). (4) omp config is now declarative: `config/omp/{config.yml,mcp.json,models.yml,agents/*.md}` copied to `~/.omp/agent` by `home/modules/omp` (copy, not symlink — omp persists settings into config.yml at runtime) plus `omp install omp-jev` on every switch (omp-jev judgments stay disabled until `/jev enable`).

> 2026-09-23 — **Headroom proxy removed; `opencode-go` "Invalid API key" root-caused to a bad auth *account*, not the proxy; MCPs + plugin/tool sync disabled; CLI reinstalled clean.** Root cause chain: `opencode auth login opencode` (the **"OpenCode Console account" device-OAuth** method) stores an OAuth credential on integration `opencode` that (a) outranks the OpenCode Go API-key account for `opencode-go/*` calls and (b) is **rejected by zen/go**. Verified upstream: `st_…` OAuth → `/zen/v1/models` **200** but `/zen/go/v1/usage` **401 `Unauthorized`**; `sk-…` API key → 200 on both. No OAuth token works for Go (4 tested, incl. the 2026-09-05 "Personal" one); the Console OAuth path is a trap. Controlled repro, single variable: OAuth account present → `Failed to drain Session: AI.Error: Invalid API key` (10:04:03/25/48, right after the 10:03:41 login); account deleted → 3 clean `opencode run` passes (`mimo-v2.5`, `deepseek-v4.1-flash#max`, `mimo-v2.6-flash-free`). Correct connect path: `opencode auth login opencode-go --method key` (or `/connect` → OpenCode Go → API key) — **never** the Console account. Headroom was exonerated, then removed anyway per request: a bogus bearer returns the upstream's **byte-identical** `401 AuthError: Invalid API key.` direct *and* through :8787 (both `/v1/chat/completions` and `/v1/responses`); no header → upstream `Missing API key.`; a valid key → **200 through the proxy**. Headroom holds no key of its own (`~/.headroom/` had only beacon locks + `ccr_store.db`), and `headroom/providers/opencode/runtime.py` states it "reuses the user's own API keys (env / `opencode auth`)"; its only credential feature is `headroom copilot-auth` (GitHub Copilot device flow, `wrap opencode --copilot-subscription`) — **no OpenCode Console/zen auth support exists in 0.37/0.38**. Removed: 3 systemd user units (`headroom-opencode-go`/`-opencode`/`-openrouter`) stopped+disabled+deleted, `uv tool uninstall headroom-ai` (drops `headroom`, `headroom-cache-ttl`), `~/.headroom` (38 MB); plus dead CLI baggage — 242 MB stale `~/.opencode/bin/opencode2`, `~/.opencode` (57 MB), ~1.5 GB bun cache, beta profile ×4, 6.5 GB old session DB, `~/.cache/yay/opencode-bin` (disk 50 → 71 GB free). Resulting config: `opencode.jsonc` drops all three `providers.*.settings.baseURL` overrides (catalog endpoints used directly — only the `mimo-v2.5` variants block remains) and all 3 MCPs are `enabled: false`; `home/modules/opencode/default.nix` has `opencodeSyncPlugins`/`opencodeSyncIcmPlugin`/`opencodeSyncTools` inside a `/* DISABLED … */` block so `~/.config/opencode/{plugins,tools}` stay absent. Re-enable MCPs/plugins by restoring `enabled: true` and deleting those comment markers. **Same day (resolved):** once the user connected their own console API key and `opencode run --model opencode-go/deepseek-v4.1-flash#max "say OK"` returned `OK`, the diagnostic was lifted — MCPs `codegraph` + `icm` back to `enabled: true` (engram stays `false`, as before) and the three plugin/tool sync activations un-commented, then `hm switch` re-copied `~/.config/opencode/{plugins,tools}`. Files: `config/opencode/opencode.jsonc`, `home/modules/opencode/default.nix`, this file.

> 2026-09-13 — **rtk MCP removed (third-party, redundant)**. The `rtk-mcp` MCP server (`ousamabenyounes/rtk-mcp` v0.1.0) had a hardcoded command allowlist (no `opencode`, pipes, redirects), no shell semantics, and was unmaintained. The V2 `rtk` plugin (`config/opencode/plugins/rtk.ts`) now auto-rewrites every `shell` command through `rtk rewrite` — no allowlist needed, handles `&&`/`;`/`|`. The MCP was strictly redundant. Reverted the `rtk_*` agent permission rules (commit d0560e4) from all 6 agents. Removed binary `~/.local/bin/rtk-mcp`. Kept the plugin; kept `icm`, `engram`, `codegraph` MCPs. Files: `config/opencode/opencode.jsonc`, `config/opencode/AGENTS.md`, `config/opencode/agents/{researcher,swe,reviewer,architect,steward,designer}.md`, `home/modules/upstream/default.nix`, this file.

> 2026-09-13 — **rtk MCP tool (`rtk_run_command`) allowed for custom subagents**. Every deny-by-default agent (`researcher`/`swe`/`reviewer`/`architect`/`steward`/`designer`) now carries `- action: rtk_* / resource: "*" / effect: allow` alongside `codegraph_*` and `execute`/`shell`, fixing `Unknown tool 'rtk.run_command'` when subagents call `tools.rtk.run_command(...)`. `vision` skipped (no `shell`/`execute`, purely image analysis). Verified: `grep -l 'rtk_*' ~/.config/opencode/agents/*.md` lists all 6 edited files. Files: `config/opencode/agents/{researcher,swe,reviewer,architect,steward,designer}.md`, this file.

> 2026-09-13 — **ICM OpenCode plugin ported to the V2 plugin API**. `config/opencode/plugins/icm.ts` rewritten from V1 (`import type { Plugin } from "@opencode-ai/plugin"` + named-export `Plugin = async ({ $, directory }) => ({ ...hooks })`) to the v2.0.2 shape `export default { id: "icm", async setup(ctx) { … } }`. Findings from the installed v2.0.2 binary (196 MB, not stripped): there is **no server-side `@opencode/plugin` module** — only `@opencode/plugin/tui` is host-registered (see 2026-09-08 subagents banner) — and **no `Plugin.define`**; the loader validates the default export against `{ id, effect | setup }` and rejects V1 with `Plugin must export a default definition with an id and an effect or setup function.` So the file imports nothing and uses the global `Bun` (same zero-import pattern as `rtk.ts`; a bare `@opencode/plugin` import cannot resolve server-side). Hook mapping: `tool.execute.after` → `ctx.tool.hook("execute.after", event)`, event `= { tool, sessionID, agent, messageID, id, input, status, result | error }`, `result = { output, content, metadata }`; `experimental.session.compacting` → `ctx.session.hook("compaction", event)` with `event.messages`; `experimental.chat.system.transform` → `ctx.session.hook("context", event)` with `event.system` (parts `{ type:"text", text }`, awaited per model request → deduped per `event.sessionID`). `session.created` (log-only) dropped — no direct V2 equivalent. Behavior preserved: every 3rd tool call enqueues `icm extract --enqueue -p <project>` (cap 8000; text from `result.content`), every 10th enqueue forks detached `icm extract-pending --limit 30`; compaction enqueues the last 20 assistant messages (cap 4000) + drain; `wake-up --project` + `recall-project --limit 5` injected once per session. Sync unchanged (`home.activation.opencodeSyncIcmPlugin` still copies the single file — no `package.json`/`node_modules` needed). Verified: `bun build --target=node` bundles clean; behavior smoke test (Node + fake global `Bun`) covers 3rd-call enqueue, 8000 cap, 10-enqueue detached drain, compaction slice/drain, per-session dedupe, and missing-binary disable. Files: `config/opencode/plugins/icm.ts`, this file.

> 2026-09-13 — **ICM OpenCode plugin added declaratively** (replaces imperative `icm init --mode hook`). New `config/opencode/plugins/icm.ts` — the `rtk-ai/icm` project's OpenCode plugin that wires four hook layers: (0) `tool.execute.after` — extracts facts from tool output every N calls (enqueue-only with batched drain to avoid per-call fastembed model reloads, see issue #239); (1) `experimental.session.compacting` — extracts from the last 20 assistant messages before compaction; (2) `session.created` — logs session start; (3) `experimental.chat.system.transform` — injects the project's wake-up pack and top-N recalled memories into the system prompt once per session (keyed by sessionID). Synced as a real mutable file (not a nix-store symlink) via new `home.activation.opencodeSyncIcmPlugin` in `home/modules/opencode/default.nix`, matching the existing pattern for `opencodeSyncPlugins` and `rtk.ts`. Files: `config/opencode/plugins/icm.ts`, `home/modules/opencode/default.nix`, this file.

> 2026-09-13 — **rtk auto-rewrite ported to the V2 plugin API (working)**. opencode v2.0.2 dropped the V1 server-side `tool.execute.before` hook; `rtk init -g --opencode` (rtk v0.49.0) emits a V1 named-export plugin (no `default`) that the v2.0.2 loader rejects: `Plugin must export a default definition with an id and an effect or setup function`. Correct V2 shape: `export default { id, setup(ctx) }`, where `ctx` exposes domains incl. `tool` (`{reload, transform, hook}`). Port: `ctx.tool.hook("execute.before", cb)`; `cb` payload is `{ tool, sessionID, agent, messageID, id, input }` and may mutate `input.command` before execution. `config/opencode/plugins/rtk.ts` does that for `shell`/`bash` via sync `Bun.spawnSync(["rtk","rewrite",cmd])`, swapping the command when the rewrite differs. Verified live: raw `git status` → rtk-compact output; payload shape confirmed with a throwaway probe. Files: `config/opencode/plugins/rtk.ts`, `home/modules/opencode/default.nix` (`opencodeSyncPlugins` copies it as a real file), this file. Same day: removed ~3.8 GB of dead `@opencode-ai/*` beta/v1 global packages + bun cache (superseded by `@opencode/cli@2.0.2`; `opencode2` is now an alias of `@opencode/cli`).

> 2026-09-13 — **Code Mode requires an explicit `execute` permission** (codegraph was unreachable for subagents until fixed). The agent permission envelope `* deny` + `codegraph_*` allow was NOT enough: the model's `execute` call failed with `No tool named "execute" is currently available`, so no MCP/Code Mode tool could be called (root cause of `researcher` replying it had no codegraph access). Fix: added `- action: execute / resource: "*" / effect: allow` to `researcher`/`swe`/`reviewer`/`architect` (built-in `explore` already had it). Verified: `researcher` and `swe` now call `tools.codegraph.codegraph_explore(...)` → DONE. Also confirmed no stale `tools["codebase-memory-mcp"]` remains in `config/skills` or `~/.agents/skills` (0 hits; only `CONFIGURATION.md:37` historical banner and stale `instruction_blob` cache rows in `~/.local/share/opencode/opencode.db`, which are not injected). Files: `config/opencode/agents/{researcher,swe,reviewer,architect}.md`, this file.

> 2026-09-13 — **codegraph replaces codebase-memory-mcp (hard cutover)**. `codebase-memory-mcp` is removed entirely — MCP server entry, all agent permission rules, installer blocks, and the live-only artifacts (`~/.config/opencode/agents/codebase-memory*.md`, `~/.config/opencode/skills/codebase-memory/`, `~/.config/opencode/plugins/cbm-augment.ts`); the `codebase-memory-mcp` binary + cache were uninstalled (~321M freed). New MCP: `codegraph` (`"command": ["codegraph", "serve", "--mcp"]`, `CODEGRAPH_TELEMETRY=0`), v1.6.0 via `bun install -g --trust @colbymchenry/codegraph`; the default server exposes **one** tool, `codegraph_explore` (Read-equivalent — verbatim source + call paths + blast radius in one call); the other 7 tools stay disabled unless `CODEGRAPH_MCP_TOOLS` allowlists them. No account-wide store: **every project needs its own index** — run `codegraph init` in the project root; no `.codegraph/` directory means the server is inactive (fall back to grep). `.codegraph/` is gitignored. Code Mode namespace: `tools.codegraph.codegraph_explore(...)`; OpenCode permission action `codegraph_*` (wildcard, mirrors the old `codebase_memory_mcp_*` convention). `researcher`/`swe`/`reviewer`/`architect` each carry a single `codegraph_*` allow; `researcher` fan-out is now `explore` only (`codebase-memory-scout` gone). Subagents don't see MCP initialize guidance — prompts must name `codegraph_explore` (or the `codegraph explore` CLI). Installers (`home/modules/upstream/default.nix`, `scripts/install-manual.sh`) now bun-install codegraph with the existing guard/warn style. Files: `config/opencode/opencode.jsonc`, `config/opencode/AGENTS.md`, `config/opencode/agents/{researcher,swe,reviewer,architect}.md`, `config/skills/{explorer,swe,reviewer,architect,goal}/SKILL.md`, `home/modules/upstream/default.nix`, `home/modules/{packages,manual/default}.nix`, `scripts/install-manual.sh`, `.gitignore`, `README.md`, this file. Per-project ergonomics: zsh helpers `cgi` (init-or-sync the cwd/nearest-ancestor index, then print `status`) and `cgs` (`codegraph status "$@"`) added to `config/zsh/extra.zsh`; both forward an optional path.

> 2026-09-12 — **reasoning-effort variants wired for the mimo subagents** (speedup request). OpenCode v2 model variants live under `providers.<id>.models.<model>.variants` and are an **ARRAY** of `{ id, settings?, headers?, body? }` — NOT a record. A record is rejected (`configuration normalization diagnostic … skipped malformed recognized value`) and drops the **whole provider block** (baseURL included). Added to `config/opencode/opencode.jsonc`: `providers.opencode-go.models."mimo-v2.5".variants` = `[{id:"none",settings:{reasoningEffort:"none"}},{id:"low",…"low"},{id:"medium",…"medium"}]`. Selection is the model `#variant` suffix: `researcher` → `mimo-v2.5#medium` (coordinator — keeps reasoning for fan-out/merge), `steward` → `mimo-v2.5#low` (mechanical), `vision` → `mimo-v2.5#none`; built-in `explore` pinned explicitly via `agents.explore.model = "opencode-go/mimo-v2.5#none"` so scouts don't inherit the researcher's medium. Verified via `session_v2`: the `model` column carries the variant, and `tokens_reasoning` is >0 for medium/low and 0 for none. Files: `config/opencode/opencode.jsonc`, `config/opencode/agents/{researcher,steward,vision}.md`, this file.

> 2026-09-12 — **steward delegation trigger strengthened** (routing smoke test). Natural `opencode run` prompts (no agent names, no "delegate" wording) showed `researcher` routed correctly for exploration asks, but `steward` was NOT used — the primary ran repo status / validation / doc-drift checks inline, ignoring the "every upkeep chore MUST route to `steward`" mandate. Fix: (1) `config/opencode/agents/steward.md` description rewritten trigger-rich and imperative ("Use PROACTIVELY and ALWAYS for any repo status/health check … delegate even a single trivial-looking check"), because the subagent tool surfaces that description to the primary; (2) `config/opencode/AGENTS.md` Tool-Selection bullet + Agent-Selection table now state that read-only/trivial checks (a bare `git status`, "is it clean", "do checks pass", docs drift) MUST still be delegated — never run inline. Re-test with the same natural prompts: upkeep → `steward`; combined health-check → `researcher` + `steward` (both verified via `session_v2` parent_id). Files: `config/opencode/agents/steward.md`, `config/opencode/AGENTS.md`, this file.

> 2026-09-12 — gate hardening + docs sync + `mode: subagent` limitation recorded. `scripts/validate.sh` Check 1b fixed: `nix fmt` now redirects stdin (`</dev/null`, fixes the bare-`nixfmt` empty-stdin abort) and the dead legacy `nixpkgs-fmt` fallback was removed; the deadnix check now probes `nix run nixpkgs#deadnix -- --version` and SKIPs when the tool cannot be provided, instead of failing a healthy repo for environmental reasons. Surfacing the previously-masked real issues then required cleaning `home/modules/skills/default.nix`: removed the unused `home` let-binding (and the now-orphaned `config` module arg) and ran `nix fmt` on it. `validate.sh` now **33 PASS / 0 FAIL / 4 SKIP**, exit 0. Docs synced: the embedded `opencode.jsonc` sample regains `"experimental": { "subagent_depth": 3 }`, and the Stack Overview no longer calls `AGENTS.md` "manual sync" (it is a Nix symlink, `home/modules/opencode/default.nix:9`). **Separate but important — `mode: subagent` is NOT a hard primary gate**: the subagent TOOL only rejects children with `mode === "primary"`; `opencode run --agent <subagent-only>` resolves the name directly and bypasses the TUI's `mode !== "subagent"` filter, so `researcher`/`steward`/`vision` CAN be launched as primary. OpenCode v2.0.2 offers no config to block this (`experimental.policies` supports only the `provider.use` action; `default_agent` validation is a separate code path). A CLI PATH-shadowing guard wrapper was prototyped and **rejected as too hacky**; a real fix needs an upstream `agent.use` policy action or a `mode` check inside `Agent.resolve`. Files: `scripts/validate.sh`, `home/modules/skills/default.nix`, `config/opencode/CONFIGURATION.md`.

> 2026-09-12 — **nested subagents enabled**: added `"experimental": { "subagent_depth": 3 }` to `config/opencode/opencode.jsonc`. Root cause (opencode v2.0.2 runtime): the subagent tool reads `entries.experimental?.subagent_depth ?? 1` and errors `Subagent depth limit reached` when `depth >= limit`; depth counts ancestors — top-level session = 0, a `subagent` child = 1, its children = 2. The default `1` silently blocked EVERY configured fan-out at runtime: `researcher` → `explore`/`codebase-memory-scout` (this file, 2026-09-12 fan-out entry) and `reviewer` → async per-lane reviewers. Set to `3` (user request: headroom beyond the currently-needed one level of leaf children; recursion is still bounded by the per-agent `subagent` permission rules — `researcher` denies all but `explore`/`codebase-memory-scout` — and by `steps` caps, so depth only widens what nested fan-out can chain, it does not enable unbounded recursion). SDK type gotcha: `types.gen.d.ts:1566` lists a top-level `subagent_depth`, but the runtime only reads the nested `experimental` key — use nested. Verified at depth 2: a hard 5-thread `researcher` task spawned 5 `explore` children (SQLite `session_v2` parent_id) and merged all 5. Files: `config/opencode/opencode.jsonc`, this file.

> 2026-09-12 — **supersedes the two 2026-09-12 entries below**: `researcher` + `steward` are now **subagent-only** (`mode: subagent`) and `/goal`'s subagent plane is no longer read-only-only. `steward` (non-behavior upkeep) runs as a **mutating subagent** in the control checkout — no worktree isolation — with a **hardened gate** (`goal/SKILL.md` Phase 5: serialize one at a time; node owns named files; never touch `status/<plan>/**` or a lane's files; no commit/push; orchestrator runs the frozen gate + `git diff` scope check vs the delegated subgraph and reverts out-of-scope/gate-fail). Application-behavior mutation stays on worktree-isolated herdr lanes (`swe`/`designer`); `steward` is removed from lane roles (`lane-dispatch.md` step 4, `cli-reference.md` runner `ROLE`). Read-only subagents unchanged (`architect`/`researcher`/`reviewer`). Tradeoff (accepted by user): a mutating subagent has no worktree isolation; the hardened gate verifies but cannot prevent concurrent-write races, so mutating subagents are serialized and scope-bound. Files: `config/opencode/agents/{researcher,steward}.md`, `config/opencode/AGENTS.md`, `config/skills/goal/{SKILL.md,references/lane-dispatch.md,references/cli-reference.md}`, this file.

> 2026-09-12 — researcher/steward maximized for token savings (user request; both run on `opencode-go/mimo-v2.5`). `researcher` (`config/opencode/agents/researcher.md`): `subagent` is now `deny *` + `allow explore` + `allow codebase-memory-scout` (leaf-only, no recursion), so it can fan out read-only children; body gains a mandatory fan-out rule (≥2 independent lookups → parallel children foreground, one per question, cap = question count, terse merge; no `background: true` — a background child returns only a session id and the run can end before merge); description enriched with trace/flow triggers so the parent selects it more often. `config/opencode/AGENTS.md`: researcher delegation promoted from "by default" to mandatory (primary MUST delegate; parallel `researcher` allowed only for disjoint scopes — overlap forbidden), and steward routing made explicit — one Agent-Selection row per chore class (git lifecycle / docs sync / hygiene / release / deps / gates) plus a Tool-Selection mandate "route every routine upkeep chore to `steward`, not `swe`". Enforcement is prompt-level only (no hard permission gate); no `steps`/model change. Nested subagents are V2-supported (a child uses its own `subagent` permissions); recursion is prevented by denying `researcher`/`architect`/`swe`/`general` as children. Caveat: fan-out cuts cost/quota per token, not total tokens — the cap is the independent-question count; `mimo-v2.5` quota is 30.1k req/5h. Files: `config/opencode/agents/researcher.md`, `config/opencode/AGENTS.md`, `config/skills/goal/SKILL.md`, `config/skills/goal/references/lane-dispatch.md`, this file. Takes effect at next hm-switch (nix-store symlinks; the goal skill live-links from dotfiles).

> 2026-09-12 — removed the last two orphans: `sqlite-database-expert` and `ui-toolkit-web` (no upstream, no license, referenced by nothing). `git rm`; dropped from keep. Committed set 48 → **46 dirs** (19 local + 27 wired); validator 50 SKILL.md / 8 warnings, 0 errors. Orphan cleanup complete — 5 removed in total: `cc-design`, `react-doctor`, `loop-engineering`, `sqlite-database-expert`, `ui-toolkit-web`.

> 2026-09-12 — audit fixes applied + `loop-engineering` dropped: (1) removed the non-standard `hidden: true` from `agent-browser/SKILL.md:5` and added a strip step to `skills-sync.sh --wired` so upstream re-imports stay clean; (2) `sources.json` now records `JuliusBrussee/caveman` as a wired source (7 skills) — the refresh overwrites customizations, so diff first; (3) killed the silent-sync failure: `skills-sync.sh` uses `mktemp -d` instead of a hardcoded `/tmp/opencode`, and the hm-switch activation runs `--global --check` and prints a WARNING when skills are still missing. `loop-engineering` removed (30-line orphan API contract for a runtime not in the repo). Committed set 49 → **48 dirs** (21 local + 27 wired); validator 52 SKILL.md / 11 warnings (`hidden` warning gone). Remaining orphan candidates for decision: `sqlite-database-expert`, `ui-toolkit-web`.

> 2026-09-12 — dropped `react-doctor` from the committed set: React-specific, so it belongs to React projects, not the global root. `git rm -r config/skills/react-doctor`; removed from `sources.json` keep; committed set 50 → **49 dirs** (29 local + 20 wired). Nix manages global only — no project scope was added to the manifest; `nix`/hm-switch will not provision stack-specific skills. Upstream (for projects that want it): `millionco/react-doctor` ships `skills/react-doctor`. Validator 53 SKILL.md, 0 errors. Still under review: `loop-engineering`, `sqlite-database-expert`, `ui-toolkit-web` (same orphan/no-source profile).

> 2026-09-12 — dropped `cc-design` from the committed set: orphaned (no agent/command/skill referenced it), no recorded upstream or license. `git rm -r config/skills/cc-design`; removed from `sources.json` keep; committed set 51 → **50 dirs** (30 local + 20 wired). Validator 54 SKILL.md, 0 errors. Still under review: `loop-engineering`, `react-doctor`, `sqlite-database-expert`, `ui-toolkit-web` (same orphan/no-source profile).

> 2026-09-12 — reviewer reports now human-friendly by contract: new `config/skills/reviewer/references/human-friendly-reports.md` owns report writing + design — 10-second verdict test, plain-language rules (verdict first, verb-first fixes, ≤3-line paragraphs, bullets over prose, no pasted audit prose), Problem → Fix → Why card shape, page recipe, diagram/table rules, anti-patterns, pre-flight checklist, and a worked before/after. `reviewer/SKILL.md` routes to it in both the text output format and the HTML section; `assets/review-report.html` gains a verdict lede line, verb-first fix bullets, table CSS, and commented optional blocks (top fixes, all-findings table). Origin: the first HTML audit report scored 7/10 on design but its cards still contained the raw audit prose — design without rewriting still fails. HTML stays strictly on explicit user request; automation (goal lanes, subagent reviews) keeps the cheap text format.

> 2026-09-12 — skills vendoring overhaul (aggressive split): `config/skills/` commits only **51** skills (31 local-authored + 20 wired upstream exceptions); **124** third-party dirs removed from git. Provenance lives in committed `config/skills/sources.json`; externalized skills install **globally on every hm-switch** via new `scripts/skills-sync.sh --global` (`npx skills add … -a universal --copy` from `$HOME` → `~/.agents/skills/`), or per project on demand. `~/.agents/skills` changed from a whole-dir symlink to a **real directory**: committed skills are per-skill out-of-store symlinks, externalized skills are npx-installed siblings — so a global install never mutates the repo. Retires `npx openskills` + the untracked `~/.agents/.skill-lock.json` as provenance. Repo skills 28 MB → 1.6 MB (1519 tracked files deleted); committed set 189 → 55 SKILL.md (externalized re-added at switch). Validator gains `--manifest` (asserts committed keep/wired skills exist); `validate.sh` Check 7 wires it; `check-secrets.sh` exclusion list dropped. Docs synced (`README.md`, `AGENTS.md` load fallback, `reviewer.md`, `swe` skill discovery line). Backup refs: branch/tag `skills-full-20260912`.

> 2026-09-12 — standardized on `opencode` (v2): the `opencode2` alias is no longer needed. `@opencode/cli` ships both `opencode` and `opencode2` bins (same binary), and v2 is now the `latest` dist-tag (`2.0.1`); the `beta` tag moved back to the old v1 prerelease line (`0.0.0-beta-19507`). Install target fixed `@opencode/cli@beta` → `@opencode/cli@latest` in `home/modules/opencode/default.nix` (`opencodeBunInstall`) + `scripts/install-manual.sh` — the old target would have downgraded the live 2.0.1 to v1 beta on the next switch. Renamed every operational `opencode2` reference to `opencode` in `config/skills/goal/{SKILL.md,references/cli-reference.md,references/lane-dispatch.md}` + `config/skills/brainstorm-studio/visual-companion.md`, and refreshed the pin in `cli-reference.md` (`v0.0.0-beta-19425` → `2.0.1`). Also refreshed this file's current-state drift (stack overview, agent/plugin lists, main-config sample). Changelog history keeps the old name.

> 2026-09-12 — `goal` skill: `steward` added as a **mutation lane role** (lane roles now `swe`/`designer`/`steward`), scoped to non-behavior upkeep (deps, docs sync, hygiene, release chores, gate runs) so small mechanical mutation nodes run on the cheap `mimo-v2.5` instead of burning `swe`. Decision (design-thinking/graph-protocol): steward **mutates**, so it belongs on the goal mutation plane (herdr lane), never the read-only `subagent` plane (`lane-dispatch.md` — subagent never mutates; a mutating subagent would edit the shared control checkout and break isolation + the orchestrator guard). Cheapness comes from the role/model, not from the subagent tool; task size never waives isolation. New E break point: steward lane meets an application-behavior change → WAIT + re-dispatch to `swe`/`designer`; steward never absorbs behavior changes. Edits: `config/skills/goal/SKILL.md` (delegation lane-role list, §4.2 discovery roles, standing guardrail, Break points) + `config/skills/goal/references/lane-dispatch.md` (step 4 role list) + `config/skills/goal/references/cli-reference.md` (runner `ROLE="<swe|designer|steward>"`). Outside `/goal`, steward stays a normal delegated agent/subagent for small upkeep.

> 2026-09-12 — `goal` lane panes now close at plan close-out (user request, reverses the 2026-09-12 persistent-pane entry below): panes persist *through* the loop (visible progress, scrollback for inspection, same-pane follow-up, `opencode2 --session` resume of a lane dead before DONE) and are closed only when the plan reaches DONE/FAILED. New "Plan close-out (goal reached)" step in `SKILL.md` §5 + `lane-dispatch.md` step 8: the orchestrator closes every lane pane it created (`herdr pane close <pane-id>`, only its own panes) once all lanes are closed out (PRs merged, or terminally parked/reported) or the plan closes FAILED, then removes merged worktree/branch and finalizes tracking; a pane-close failure is non-fatal (report + continue); the plan is not DONE until its panes are closed. Per-lane mid-loop closing stays forbidden (resume/inspection would break). Runner `exec`s the shell as before — it never closes its own pane; `cli-reference.md` runner comment + "Drive a lane" line updated. Files: `config/skills/goal/{SKILL.md,references/lane-dispatch.md,references/cli-reference.md}`.

> 2026-09-12 — new `steward` agent + repo-authored `steward` skill for routine repo upkeep, keeping expensive implementer tokens for `swe`. `config/opencode/agents/steward.md`: thin envelope, `mode: all`, model `opencode-go/mimo-v2.5` (same cheap class as `researcher`), `steps: 40`, deny-by-default permissions — read/glob/grep/list/edit/shell/external_directory/skill + engram `mem_*` (4) allow, webfetch/websearch/question/subagent deny (codebase-memory omitted — not needed, saves tokens). `config/skills/steward/SKILL.md`: chore router (git status/stage/commit/branch/worktree/stash, docs sync, repo hygiene, release, dependency bumps, gate runs) with conservative gates — commits only when explicitly asked, never pushes/tags/rewrites history unprompted, destructive needs confirmation, `.env`/secrets refused, behavior changes handed to `swe`; defers all git mutation to `git-workflow`. Also updated `config/opencode/AGENTS.md` (Agent Selection Rules + one steward row) and `config/opencode/CONFIGURATION.md` (this banner, Agents table row, model-pin line, repo-authored exceptions, routing boundary). No `opencode.jsonc`/`default.nix`/MCP change — `agents/` and `config/skills` are whole-dir symlinks, so files are auto-discovered at the next hm-switch.

> 2026-09-12 — `config/opencode/AGENTS.md` tool calls migrated to OpenCode V2 (source: V2 docs `docs/tools` + `docs/agents` + `docs/mcp-servers`). New "Tool Calling (V2)" section: subagent delegation is the `subagent` tool — `subagent(agent, description, prompt, background?)` — not V1 `task()`/`delegate()` (all 4 call-sites fixed: caveman subagent line, parallel research, tool failures, parallel checklist); MCP + browser tools are Code Mode namespaces reached through `execute` (`tools.engram.*`, `tools["codebase-memory-mcp"].*`, `tools.rtk.*`, `tools.browser.*`), not direct tools; rtk shell guidance now `rtk <cmd>` prefix in the `shell` tool or `tools.rtk.run_command(...)` via `execute`. Codebase-memory section intro notes the Code Mode namespace. Files: `config/opencode/AGENTS.md` + `CONFIGURATION.md`. Live `~/.config/opencode/AGENTS.md` is a nix-store symlink — takes effect at next hm-switch.

> 2026-09-12 — `goal` CLI dispatch is now deterministic — kills the repeated `--help` probing observed during `/goal` runs (`opencode2 run --help`, `herdr pane run --help`, `herdr agent --help`). Root cause: `references/lane-dispatch.md` gave partial herdr syntax, no canonical `opencode2 run` invocation or runner template, and contradicted itself (`herdr agent start/prompt` vs "no opencode2 kind — use `pane run`"); nested herdr `--help` prints only the top-level help, so every probe was a wasted nondeterministic step. New `config/skills/goal/references/cli-reference.md` pins exact signatures (herdr 0.9.0: `pane layout/split/run/read/close`, `tab create`, `agent …`; opencode2: `run --auto --model --agent` with positional message, no `--prompt`) plus a canonical lane-runner template (`opencode2 run … | tee tmp`, atomic `mv` to `<slug>-return.md`, `exec` shell), and states plainly: do NOT probe `--help`. `SKILL.md` runtime + §4.2 and `lane-dispatch.md` intro + steps 4/5 rewritten to point at it and drop the `agent start/prompt` lane path. Files: `config/skills/goal/{SKILL.md,references/lane-dispatch.md,references/cli-reference.md}`.

> 2026-09-12 — `brainstorm-studio` spec review gate now offers an explicit "just approve" path: at the user review gate the user picks one of three — **just approve** (spec is final; stop, no plan or implementation), **approve + plan** (invoke writing-plans), or **changes** (revise + re-run self-review). Replaces the old two-step "review spec" then separate "want a plan?" prompt. Process-flow graph collapses the `User wants a plan?` diamond into labeled edges from `User reviews spec?`; checklist item 8/9 and the Implementation section rewritten; `spec-document-reviewer-prompt.md` purpose says "ready to finalize or hand to planning". Files: `config/skills/brainstorm-studio/{SKILL.md,spec-document-reviewer-prompt.md}`.

> 2026-09-12 — `goal` lane panes are now persistent + visible (user request): a lane runs foreground in its own herdr pane so progress is watchable live — never detached or backgrounded — and the pane is NOT closed at DONE; the runner returns it to its shell so scrollback stays for inspection and the pane is reusable (same-pane follow-up, or `opencode2 --session` resume of a lane that died before done). Completion is still the durable `<slug>-return.md` file-sentinel (`lane-wait.ts` behavior unchanged), not scrollback. Updated `config/skills/goal/SKILL.md` (graph lane lifecycle, delegation bullets, layout reflow line, §4.2 dispatch, §4.3 return + lane lifecycle, lane-dead break point, graph Boundary) and `config/skills/goal/references/lane-dispatch.md` (steps 3/4/5/7) + `config/skills/goal/scripts/lane-wait.ts` docstring. Read-only nodes unchanged: `architect`/`researcher` stay inline `subagent`, `reviewer` stays async `subagent`.

> 2026-09-12 — `brainstorm-studio`/`brainstorming`/`writing-plans`: the writing-plans handoff is now optional — the approved spec is a valid terminal state. Flow gains a "User wants a plan?" decision before invoking writing-plans; checklist/implementation sections ask first instead of mandating it. Specs and plans are local-only artifacts: never committed or pushed by any skill, left unstaged for the user and gitignored (studio dir fully ignored; spec/plan dirs gitignored if tracked). `architect` routes to writing-plans only when a plan is requested. Files: `config/skills/{brainstorm-studio,brainstorming,writing-plans,architect}`.

> 2026-09-12 — researcher-first delegation rule in `config/opencode/AGENTS.md` (design-thinking graph-protocol). Applied the graph-protocol to the delegation policy itself: node = build/primary session, A = delegate(`researcher`) for exploration/research, E = primary hand-explores instead of delegating (the break being closed) + MCP-absent grep fallback + web-down fetch chain, R = subgraph (project/exact question/known qnames/evidence contract/WHY) in every researcher prompt, boundary = prompt subgraph in / findings graph out. Tool Selection now states **delegate to `researcher` by default** for multi-file exploration and all web research; inline only cheap single-file lookups. Added codebase-exploration and web-research prompt contracts (evidence: `path:line`+snippet; versioned sources; never invent APIs); parallel research → background `task()` to `researcher`. Agent Selection table now marks researcher "default — always delegate" for API/library research and codebase exploration. Takes effect at next hm-switch (AGENTS.md is a nix store symlink).

> 2026-09-12 — `goal` lane layout redesigned with design-graph (variant C, master + grid): the orchestrator keeps a fixed left master column (full height, ~34%), lanes tile a balanced grid to the right instead of repeated `--direction right` splits into skinny columns. New `config/skills/goal/scripts/lane-layout.ts` (`--anchor <pane> --lanes '<json>' [--master-ratio --min-w --min-h --dry-run]`) computes columns/rows (target tile aspect ~2:1, min 60x16 cells), splits the grid deterministically (verified herdr `--ratio` semantics: original pane keeps r, new pane gets 1−r), sets each pane cwd = its worktree, and overflows N beyond one tab's capacity to extra lane-only tabs. Wired into `references/lane-dispatch.md` step 3 (layout once per wave, after all worktrees) + `SKILL.md` §4.2. Tested live in a scratch tab: N=1 (master+lane), N=2 (cwd map /tmp + /home), N=3 ([2,1] L-grid, master 78), N=9 (overflow → 8-lane tab + 1-lane tab).

> 2026-09-12 — `goal` skill updated graph-first (design-thinking) to match two runtime changes: (1) herdr lane panes are now short-lived — the runner writes the lane report/return atomically to `<slug>-return.md` (temp + `mv`) as the LAST step, then `herdr pane close "$HERDR_PANE_ID"`; pane scrollback is gone at DONE, so the return file is the record. `scripts/lane-wait.ts` rewritten from `herdr pane wait-output` to a file-sentinel watch (`<return-file>`, 200ms bounded poll + Effect timeout, exit 0/1/2), and `lane-dispatch.md` step 4/5/7 + SKILL §4.2/§4.3 updated (dead-before-done lane still resumes via opencode2 `--session`). (2) `reviewer` subagents may now fan out background/async: the former "single foreground; background/parallel fan-out banned" rule is lifted for `reviewer` only (one per lane, read-only → collision-free, stable reviewer↔lane map, findings return to own lane). Phase 5 review is now an async per-lane wave; close-out is per-lane (a lane commits/pushes/PRs as soon as its own reviewer is green — lanes are edge-independent), `report.md`/DONE stay wave-level. New break points: lane closed before return persisted (WAIT + re-dispatch, never read scrollback); reviewer timeout/failure ≠ green.

> 2026-09-11 — exported global skills: `goal` (goal loop), `work-plans` (status/ tracking; plan-check root via `git rev-parse`), `git-workflow` (generic git discipline). Lexa keeps a project-local `git-workflow` override (git-only, self-contained). OpenCode `commands/` is now nix-managed from `config/opencode/commands/` (`/goal`).

> 2026-09-11 — researcher graph-first fix (design-thinking): drew the routing graph, closed its broken edges. `researcher` gained codebase-memory read tools (11: search_graph/trace_path/get_code_snippet/query_graph/get_architecture/search_code/get_graph_schema/list_projects/index_status/detect_changes/check_index_coverage) — the `explorer` skill referenced graph tools the permission envelope denied; added a `call-graph` route for trace/how-it-works questions (was funneled into pattern search). `explorer` rewritten as the locate subgraph: trigger-rich description, graph-first structural routing with grep for literals, fallback when MCP absent/index stale/denied, evidence contract (`path:line` + quoted snippet), explicit zero-hit reporting ("not found in <scope>" + searches run), scope-bounding (skip node_modules/dist/build/.git/generated), parallel searches, cap + truncation note. `librarian` rewritten as the external subgraph: version discipline (read manifest/lockfile first, target the pinned version, state mismatch), source chain (versioned official docs → repo source@tag incl. tests → releases/issues → community), fetch fallback chain (webfetch → websearch raw/mirror → user paste + mark unverified), evidence contract (claim + URL + version + snippet; never invent APIs; conflicts shown), output format. Both skill descriptions now carry trigger lists. Skills live-link from dotfiles; `researcher` agent takes effect at next hm-switch.

> 2026-09-11 — dropped the `playwright` MCP (`bun x @playwright/mcp`): browser automation is the `agent-browser` CLI skill (0.27.0, `~/.local/bin/agent-browser`), already the AGENTS.md-mandated workflow (snapshot-first, no vision). Removes the stray `.playwright-mcp/` browser-state dir from workspaces; `.gitignore` guards it anyway. `extract-design-system` keeps its own Node `npx playwright install chromium` — unaffected. Live `opencode.jsonc` takes effect at next hm-switch (nix store symlink).

> 2026-09-11 — designer skill rewritten graph-first (design-thinking method): two modes (Produce/Review) with explicit break points (no authority → ask; gate fails → no handoff; artifact vs project system → project wins; implementation better → update artifact), Project authority section (project-declared system/paths/gate win), Produce pipeline (authority → design-graph for flows/void states → tokens → exact-value artifact → gate → handoff), artifact anatomy (tokens, surfaces + Surface<C,V,N> void states, state matrix, layout, motion, a11y, copy), and a Handoff contract making the artifact the thing swe implements verbatim; specialist routing (design-graph / frontend-design / design-system-patterns / extract-design-system) replaces the duplicated frontend-design aesthetics prose; Review mode with severity+evidence grading and drift-routes-back-to-design rule; description now carries the trigger list ("Load before touching any design artifact or reviewing UI"). Agent deduped to a single skill pointer (removed the redundant workflow/build-gate line and the dead skill-load-fallback clause). Eval suite persisted at `config/skills/designer/evals/` (2 prompts, 8 assertions; smoke + no-hint runs 8/8 new vs 5/8 old — void states, handoff contract, graph routing the discriminators; authority discovery non-discriminating).

> 2026-09-11 — reviewer hardened: `reviewer` skill now enforces CONFIRMED/SUSPECTED evidence, no-diff handling (never invent findings on an empty change), change-vs-pre-existing scope split, explicit verdict criteria, and severity calibration by impact; permissions add `external_directory *` (reads outside the workspace, incl. /tmp) plus `cd *` and read-only git expansion (grep/ls-files/rev-parse/rev-list/merge-base/cat-file/describe/shortlog/stash list+show/worktree list/remote -v+show/branch --show-current+--list); skill `*` allow so a project-local review skill can load, and a Project authority section makes project-declared review rules win over the skill's defaults; reviewer is now caveman-exempt (full-prose output; `caveman` skill denied) so findings keep their nuance; on-request-only HTML report mode (bundled `assets/review-report.html`; sole permitted writes are `.reviews/*` (repos) and `~/.local/share/opencode/reviews/*` (non-repos), dirs created via allowlisted `mkdir -p`). Eval suite persisted at `config/skills/reviewer/evals/` (7 fixtures; iteration 2 separated revised vs old skill 92% vs 81%).

> 2026-09-11 — exported the architect process to the repo-authored, harness-agnostic `architect` skill (harness contract, stage-by-artifact router, ADR status-graph lifecycle, wrap-up format). The opencode `architect` agent is now a thin envelope (identity + permissions + skill pointer); other harnesses wire the same skill into their own agent. Re-added `architect` to the repo-authored exceptions.

> 2026-09-11 — dropped the `architect`/`planner` wrapper skills: `brainstorm-studio` already owns the design stage and `writing-plans` the plan. The `architect` agent is now a read-only single-stage router over vendored processes: `brainstorm-studio` (text-only) / `system-design` + `architecture` (lasting decision → ADR) / `writing-plans`; parent persists each artifact. Added `skill *` allow to `architect`, `designer`, `researcher` — routing was permission-blocked (only `swe`/`reviewer` had it). ADR management moved into the architect prompt: status vocabulary (proposed/accepted/deprecated/superseded/obsolete/rejected), scan-classify with evidence (scope exists/code agrees/premise holds/still recommended), stale-vs-irrelevant rules, explicit audit mode returning `## ADR status changes`, `last-reviewed` anti-rot, parent persists/commits + `manage_adr` registration. Architect gained codebase-memory read tools (search_graph/detect_changes/get_code_snippet/check_index_coverage) as optional enrichment — relevance checks are graph-grounded when the MCP is installed/indexed, and fall back to read/grep/glob + `git log` otherwise; never blocking. Default ADR dir `.agents/adr/`, project-declared location wins.

> 2026-09-11 — removed stale `brainstormer` role skill; `brainstorm-studio` is now the brainstorming entry point and adopts the `design-thinking` graph-first paradigm (draw the design as a graph; route by material to `design-thinking` / `design-graph` / graph-protocol / `call-graph`; carry the graph into the spec). Added a read-only/headless note to `brainstorm-studio` so the read-only `architect` agent can still use it text-only. Updated architect agent routing, architect/planner spec-source refs, and the repo-authored exceptions list.

> 2026-09-11 — renamed repo-authored role skills, dropped the `agents-` prefix: `agents-architect`→`architect`, `agents-brainstormer`→`brainstormer`, `agents-designer`→`designer`, `agents-explorer`→`explorer`, `agents-librarian`→`librarian`, `agents-planner`→`planner`, `agents-reviewer`→`reviewer`, `agents-swe`→`swe` (`agents-sdk` kept — vendored upstream). Updated frontmatter `name`, agent routing refs (`config/opencode/agents/*.md`), `.gitignore` comment, reviewer `evals/`+`assets/` self-refs, and the two-tier memory paths (`~/.agents/memory/swe.md`, `<repo>/.agents/memory/swe.md`).

> 2026-09-11 — `swe` memory is two-tier: project `<repo>/.agents/memory/swe.md` (gitignored) + skill-owned `~/.agents/memory/swe.md` (cross-project, machine-local). Read both project-first; write project by default, promote repo-independent lessons. Plus conditional MCP layer (engram `mem_*` + codebase-memory read tools) only when both installed; `swe` permissions allow them (engram action names inferred from the `codebase_memory_mcp_*` convention — verify after hm-switch).

> 2026-09-11 — stack conventions moved to project-local skills: removed default `frontend`/`backend`/`cli` + all stack variants (`tanstack-*`, `backend-effect-bun`, `cli-bun-effect`, `bun-runtime`, `effect-ts`, `effect-v3-to-v4`, `tailwind-4-docs`, `tailwind-design-system`, `tiptap`). Dropped `swe/available-skills.toml` — agent discovers skills itself. Global keeps agent roles, quality/workflow, general skills.

> 2026-09-11 — Agent Skills standard (agentskills.io): fixed `physics-3d-collision` invalid YAML + 6 `ckm:` names (→ dir name); added `scripts/validate-skills.sh` wired into `validate.sh` Check 7 + CI. Validator recognizes Claude Code extensions (`argument-hint`/`user-invocable`/`disable-model-invocation`); leftover 23 warnings = 13 vendor-only-key skills + 9 long bodies — accepted as-is (no vendored-frontmatter edits)

> 2026-09-11 — agents genericized (Option A): global agents no longer hardcode project structure (`app/`/`server/`/`shared/`/`cli/`, wireframes submodule, TanStack/Effect stack pins). `swe` is now a general SWE; `designer` defers design paths/build gates to the project's `AGENTS.md`/`.opencode`. Project-specific rules stay in the owning repo (lexa). Option C (split global vs per-project roster) deferred — memory topic `opencode/agent-genericization`

> 2026-09-11 — model pins (quality-first): architect/reviewer `opencode-go/deepseek-v4.1-flash#max`, swe/designer `#high`; researcher/vision `opencode-go/mimo-v2.5`

> 2026-09-11 — agent consolidation: explorer+librarian→`researcher`; architect+brainstormer+planner→`architect`; `designer` design-only (no app code); `swe` sole implementer

> 2026-09-11 — agent IDs renamed: `designer`, `explorer`, `librarian` (dropped `-jr` suffix); agent files + AGENTS.md + goal skill refs updated

> 2026-09-10 — cbm-augment V2 fix (default export id + setup/setup, V1 server kept)

> 2026-09-08 — subagents TUI crash fix (prop-drilled context, `@opencode/plugin/tui` specifier, dropped `@opencode-ai/plugin` dep)

> 2026-09-07 — no pinned `model` (session follows TUI selection, subagents inherit); cli.json syncs `tabs.layout: vertical`

> 2026-09-06 — v2 cleanup (v1 archived, plugins removed except herdr, rtk MCP added, agents V2-native)


## Historical sections (moved 2026-09-24)

## DCP (`dcp.jsonc` — archived 2026-09-06)

Removed with the plugin purge. Upstream DCP slowed (focus moved to Sleev), V1-only (V2 breaks all V1 plugins), and our copy referenced stale V1 tool names. V2 native compaction (`buffer: 10000` in opencode.jsonc) covers the basics. File archived at `~/.config/opencode-archive-v1-20260906/dcp.jsonc`; mapping dropped from default.nix. Revisit if a V2-compatible DCP/Sleev integration appears.


## Removed 2026-09-07

- **CommandCode (CC)** — full removal: pacman `command-code` pkg (`/usr/bin/commandcode`), `cc-proxy.service` user unit (npx commandcode-api-proxy :8787, held CC_API_KEY), `~/.commandcode/` data, `~/.local/bin/cc-key`. `/usr/bin/cc` untouched (gcc symlink, separate pkg). opencode-go/zen gateway unaffected — direct auth verified post-removal.
- **gmicloud provider** — dropped per user request (3 providers remain: opencode-go, opencode, openrouter); auth entry removed from `auth.json`.


## Headroom compression proxy (2026-09-07 → **removed 2026-09-23**) — historical

**Removed 2026-09-23** per user request (see top entry): units `headroom-opencode-go`/`-opencode`/`-openrouter` stopped, disabled and deleted; `uv tool uninstall headroom-ai`; `~/.headroom` deleted; `opencode.jsonc` baseURL overrides dropped. Ports 8787-8789 are free. Setup below is historical, kept for reference.

69k★ `headroomlabs-ai/headroom` v0.37.0, installed via `uv tool install "headroom-ai[all]"`. Three systemd user units, one per upstream (native `--openai-api-url` routing):

| Unit | Port | Upstream | Kompress ML |
|---|---|---|---|
| `headroom-opencode-go.service` | 8787 | https://opencode.ai/zen/go | on (primary) |
| `headroom-opencode.service` | 8788 | https://opencode.ai/zen | off |
| `headroom-openrouter.service` | 8789 | https://openrouter.ai/api | off |

opencode.jsonc `providers.<id>.settings.baseURL` used to point at `http://127.0.0.1:87xx/v1` (dropped 2026-09-23). Beacons off, rate-limit off, default `coding` profile (cache mode, prefix-safe, file reads never lossy).

**Gotchas learned**: (1) `x-headroom-base-url` header routing (shim-style) 502s silently in 0.37.0 — use native `--openai-api-url` per upstream instead; one instance per upstream. (2) auth.json zen tokens go stale; live tokens ride per-request from opencode. (3) `--port` omitted = default 8787, collides. (4) **Auth is pure passthrough** (measured 2026-09-23): bogus bearer → the upstream's byte-identical `401 AuthError: Invalid API key.` direct *and* through the proxy (both `/v1/chat/completions` and `/v1/responses`); missing header → upstream `Missing API key.`; the proxy holds no credential, so a client-side auth fault can never be a headroom fault. (5) No OpenCode Console/zen OAuth support exists (0.37/0.38) — the only credential feature is `headroom copilot-auth` (GitHub Copilot device flow).


## V1 Archive (`~/.config/opencode-archive-v1-20260906/`)

Archived 2026-09-06 during opencode2 migration:

| Path | Content |
|------|---------|
| `opencode.json` / `.bak` / `.pre-cmd-removal` | v1 main config (presets gmicloud/opencode-go, provider gmicloud MiniMax M3/M2.7, plugins omo-slim+dcp, remote MCPs) |
| `oh-my-opencode-slim/` | prompt overrides (`opencode-go/*_append.md`) |
| `.oh-my-opencode-slim/` `.ocx/` `.opencode/` | plugin caches |
| `oh-my-opencode-slim.json.backup` + `.managed-copy` | OMO-slim preset config |
| `live-v1-more/` | round 2: `commands/design.md` (dead `cc-design` ref), `service.json` (v1 service password), `tools/image.ts` (v1 SDK import), `skills/codemap` + `skills/simplify` (omo-bundled) |
| `dotfiles-more/` | dotfiles-side round 2: `tools/image.ts`, `skills/codemap/`, `skills/simplify/` |
| `dotfiles/` | dotfiles-side v1: opencode.json, oh-my-opencode-slim.json, tui.json (omo TUI plugin), package.json, skills/oh-my-opencode-slim |
| `skills-opencode-final/` | round 3: `clonedeps/deepwork/verification-planning/worktrees` (dotfiles-side omo-era dupes) + `live/` (live copies incl. `reflect`, moved to canonical `config/skills/`) |
| `live-v1-more/skills-backup/` | `*.backup` leftovers from live skills dirs |
| `dotfiles-dot-opencode/` | `~/projects/dotfiles/.opencode/` project-local v1 (opencode.json + `plugin: ["list"]`, package manifests; 62M node_modules deleted, dir removed) |
| `engram-config.json.backup` | stale `~/.engram/config.json` backup |
| `beta/` | beta profile: `opencode/` (o2 config) + `o2` wrapper script |
| `tui.json.managed-copy`, `tui.json.backup`, `tui.json.bak` | v1 TUI configs |
| `*.backup` / `*.bak` | all other backups (agents, cli, dcp, CONFIGURATION) |

Removed from dotfiles (git deletions, uncommitted): `config/opencode/opencode.json`, `config/opencode/oh-my-opencode-slim.json`, `config/opencode/tui.json`, `config/opencode/package.json`, `config/opencode/skills/` (entire dir: oh-my-opencode-slim, codemap, simplify, clonedeps, deepwork, reflect→moved to `config/skills/`, verification-planning, worktrees), `config/opencode/tools/image.ts`, `config/opencode/plugins/*`. Removed from `home/modules/opencode/default.nix`: `tui.json` + `oh-my-opencode-slim.json` + `skills` mappings; activations rewritten (`opencodeBunInstall` targets `@opencode-ai/cli@beta`, `opencodeFixPlugins` replaced by `opencodeSyncTools`).
Deleted (not in dotfiles, not archived — regenerable/quit): live `node_modules/` (87M).
Beta profile deleted: `~/.config/opencode-beta/opencode/`, `~/.local/bin/o2` (use `opencode2` + main profile now; `google-chrome/` + data dirs under opencode-beta left untouched).


## Design Decisions (recent; full history in git)

- 2026-09-09: deleted 7 omo-era skills (codemap, clonedeps, worktrees, deepwork, simplify, reflect, verification-planning); dropped `simplify` from AGENTS.md refactor template, removed dead slim Check 4 from validate.sh, debranded SOUL.md. Lane isolation covered by `using-git-worktrees`; no live cross-refs remain.

- 2026-09-06: v2 migration — archived v1 (opencode.json, omo-slim, gmicloud preset/provider, remote MCPs), removed plugins (herdr-agent-state restored from beta profile), deleted beta profile + `o2` wrapper, main profile minimal + shell/lsp/compaction/playwright. Custom agents migrated to native V2 (temperature + V1 permission blocks dropped, model-agnostic). Skills back to single root (`config/skills/` canonical, incl. rescued `reflect`). rtk MCP added (`run_command`; auto-rewrite plugin deferred). engram 1.15.7→1.20.0. default.nix activations rewritten for `@opencode-ai/cli@beta`. Compaction migrated to native V2 (`buffer`, dropped ignored `reserved`/`prune`).
- Removed 2026-09-05: `lexa-swarm` skill (user request; source `config/skills/lexa-swarm` deleted, backup kept at `~/.agents/skills.backup/`)
- Fixed 2026-09-08: opencode2 stale-version bug — `opencodeBunInstall` + `install-manual.sh` updated deprecated `@opencode-ai/cli@beta` (stalled 19271) while live `opencode2` bin actually comes from `@opencode/cli@beta` (19296). Targets switched to `bun install -g --trust @opencode/cli@beta`, so every `home-manager switch` re-resolves `@beta` → latest.
- Added 2026-09-05: `design-thinking` skill (SKILL.md router + refs/design-thinking.md, design-graph.md, graph-protocol.md, output-format.md; source r17x gist). Single ID; no AGENTS.md rule needed (auto-discovery).
- Updated 2026-09-08: `design-thinking` reframed as graph-first paradigm (umbrella: program A/E/R + orchestration delegation). Promoted its two materials into standalone skills for independent auto-discovery: `call-graph` (how-it-works/caller/trace answers, ts-fence call graph; refs/output-format.md moved out) and `design-graph` (interface Surface<C,V,N>; refs/design-graph.md moved out). All three cross-link as one r17x paradigm. Refs verified in sync with gist revision 06f999d (local = condensed paraphrase, same sections; output-format.md superset of gist's ECALL file).
- Added 2026-09-05: `/design-thinking` command (`~/.config/opencode/commands/design-thinking.md`, mirrors `design.md` pattern; loads skill, routes $ARGUMENTS). Global commands dir unmanaged by home-manager — file lives only in ~/.config.
- Chose engram over opencode-mem (no API key)
- Agent family + routing skills (2026-08-13): thin agents, thick skills, deny-by-default
- Nested skill dirs: opencode uses dir basename as ID — collisions displace (tested); variants keep unique names
- DB folded into backend (no separate skill); system design → architect, design artifacts → designer
- Skills installed globally only; never vendored in repos (gitignore `.agents/`)
- Removed 2026-08-13: Cloudflare MCP×6, Postgres MCP, lexa MCP, commandcode Go-proxy, cloudflared
