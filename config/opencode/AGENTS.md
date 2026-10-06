# Agent Rules

<skills_system priority="1">

## Available Skills

Skills are auto-discovered by the harness from `~/.agents/skills/`, `~/.config/opencode/skills/`, and project `.agents/skills/` (SKILL.md format). Only use skills listed in the skill tool's `<available_skills>`.

Invoke: native `skill` tool first (use skill ID from `<available_skills>`). Fallback: read `~/.agents/skills/<name>/SKILL.md` directly; for an externalized skill not installed in the project, `npx skills use <owner/repo>@<skill>`. Base directory provided in output resolves bundled resources (references/, scripts/, assets/). Do not invoke a skill already loaded in context.

</skills_system>

## Tool Calling (V2)

Built-in tools: `read`, `glob`, `grep`, `edit`, `write`, `shell`, `webfetch`, `websearch`, `question`, `skill`, `subagent`, `execute`.

- **Subagent delegation uses the `subagent` tool** — `subagent(agent, description, prompt, background?)`. Set `background: true` for async; pass the returned `sessionID` to continue that child. V2 has no `task()` or `delegate()`.
- **MCP, plugin, and browser tools are Code Mode namespaces** — reach them through `execute`: `tools.engram.<tool>(...)`, `tools.codegraph.<tool>(...)`, `tools["jev-mcp"].<tool>(...)`, `tools.browser.<tool>(...)`. They are not directly callable tools.
- **Shell runs through the `shell` tool** — set `workdir` instead of `cd`; prefer the `rtk` token-optimized prefix.

## Caveman Mode — Output Compression

Active on every response. Drops filler, keeps substance. Saves ~65% output tokens.

**Drop:** articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). No tool-call narration, no decorative tables/emoji, no dumping long raw error logs unless asked — quote shortest decisive line. Standard tech acronyms OK (DB/API/HTTP); never invent new abbreviations (cfg/impl/req/res/fn) — tokenizer splits them same as full word: zero token saved. No causal arrows (→) — own token, save nothing. Technical terms exact. Code blocks unchanged. Errors quoted exact.

**Structure — layout for every reply:**
- Conflict rule: caveman rules govern words; this section governs layout.
- Reply shape: answer, detail, code, next — include only non-empty blocks.
- Line 1 = direct answer. No preamble, no restating the question.
- One fact per line. Two unrelated facts on one line = the failure mode; split it.
- Blank line between topics. Same-topic lines stay together.
- Headers only when 3+ topics. Short answer = answer + one detail line; no bullets, no headers.
- Code, commands, `file:line`: own line or fenced block. Caveats: one line, `Note:`. Tables only for real comparisons.
- Send check: re-scan for 3-fact lines and split before sending.

Preserve user's dominant language. User writes Portuguese → reply Portuguese caveman. Compress the style, never translate.

No self-reference. Never name or announce the style. No "caveman mode on", "me caveman think", no third-person caveman tags. No normal answer plus "Caveman:" recap.

**Pattern:** `[thing] [action] [reason]. [next step].`

**Auto-Clarity:** Drop caveman for security warnings, irreversible action confirmations, multi-step sequences where fragments risk misread, or when compression creates technical ambiguity. Resume after clear part done.

**Off:** "stop caveman" or "normal mode" reverts to normal speech.

**Subagents inherit this mandate.** Most custom agents (`~/.config/opencode/agents/*.md`) carry caveman output rules in their prompts — exceptions: `reviewer` (full prose, because compression drops the nuance findings need; `caveman` skill denied on that agent) and `vision` (compressed prose that keeps transcriptions verbatim — never truncates UI labels, chart values, or requested text). When delegating via `subagent`, include in the prompt: "Reply caveman-compressed: findings only, no filler, no process narration" — except when delegating to `reviewer` or `vision`. Subagent reports enter main context — a yappy subagent costs twice (its output + your reading of it); reviewer is the deliberate exception.

## Memory
- At session start: `mem_current_project` to resolve the project, then `mem_context` to load recent session history and project context. Use `mem_search` for recall across sessions (`mem_timeline`/`mem_get_observation` for full content).
- Save durable knowledge with `mem_save` (title/type/content) after completing bug fixes, making architecture decisions, or discovering non-obvious codebase patterns.
- When a `mem_save` reports `judgment_required` conflicts, resolve them via `mem_judge`.
- Register session lifecycle with `mem_session_start`; call `mem_session_summary` before session end to preserve state for the next session.
- Topic convention: stable `topic_key`s (e.g. `architecture/auth-model`, `decision/dotfiles`); use `mem_suggest_topic_key` when unsure. (`mem_save_prompt` records structured knowledge with references.)
- **ALWAYS update `~/.config/opencode/CONFIGURATION.md` after any configuration change** (opencode.jsonc, agent files, MCP servers, plugins, AGENTS.md, etc.). Keep it in sync with the current state, and append a dated entry (newest first) to `~/projects/dotfiles/docs/configuration-changelog.md` — dated entries do not go into CONFIGURATION.md. Verify changed configs parse (JSON/YAML validation).
- **AFTER updating local config, compare with `~/projects/dotfiles/`** — sync changes to the dotfiles repo so they don't drift. Key files: `config/opencode/opencode.jsonc`, `config/opencode/agents/`, `config/opencode/AGENTS.md`, `config/opencode/CONFIGURATION.md`.

## Tool Selection
- For shell output, prefer token-optimized form: `rtk <cmd>` prefix in the `shell` tool. The V2 `rtk` plugin auto-rewrites `shell` commands through `rtk rewrite` (no MCP/run_command needed). Raw shell only when rtk lacks the command.
- **ALWAYS check community support before installing new tools or MCP servers**: minimum 100+ GitHub stars, active maintenance (updated within 3 months), multiple contributors. Skip tools with weak community support unless explicitly requested by user.
- **Delegation to the `researcher` subagent is mandatory for exploration and research** — primary/build sessions MUST NOT hand-explore multi-file code or run web searches inline; only a single cheap lookup (one read/grep acted on immediately) may stay inline. `researcher` owns the codegraph index, the `explorer`/`design-thinking` routing, and `librarian` web research. Delegate anything spanning files, callers, impact, or the web.
- **Spawn `researcher` subagents with disjoint scopes.** Partition research into non-overlapping workstreams (no shared files/dirs/symbols/questions/sources); overlap wastes work and yields conflicting merges. Multiple parallel `researcher` subagents are correct when their scopes are disjoint — foreground calls issued together, or `background: true` only when the session continues and joins them. A single workstream gets exactly one researcher, and that researcher fans out read-only `explore` children foreground (never background), one wave only, and merges before reporting (leaf-only; no recursion); split a workstream only when it exceeds one researcher's context/step budget. Research is answer-first: the researcher inlines ≤2 independent codebase lookups; fan out `explore` children only for ≥3 independent lookups. Cap parallel `researcher` spawns at 3 per wave and `explore` children at 2 per fan-out; batch excess questions into those children instead of adding agents, and every child prompt carries a quick-pass budget (≤~6 tool calls, stop at the first complete answer, no broad sweeps). Fan-out is the most expensive pattern — use the fewest agents that cover the work, and check the usage footer before heavy fan-out (batch when it is high). One level only: `explore` children are leaves — never instruct a child to spawn agents (depth-3 spawns fail and waste calls). Dedupe before spawning: skip questions already covered in this run or by a sibling session. A single cheap lookup stays inline; strictly dependent lookups stay inside one researcher.
- Codebase-exploration prompt: name the project, the exact question, known `qualified_name`s/paths, the evidence expected (`path:line` + snippet), and the depth budget (quick pass — stop at the first evidence-complete answer). researcher routes internally: locate → `explorer`, trace → `design-thinking`, structure/impact → codegraph.
- Web-research prompt: state the library + pinned version, the exact question, and the source expectation (versioned official docs first). researcher fetches; never invent APIs.
- **Prefer proceeding over blocking questions.** Use the `question` tool only for irreversible/destructive actions or genuinely ambiguous forks (and at human-gated planning steps). For reversible choices, pick the recommended default, state the assumption in one line, and continue — a blocked question can idle a session for hours.
- **Every routine upkeep chore MUST route to `steward` — never `swe`.** Git lifecycle (status/stage/commit/branch/worktree/stash), docs sync (README/CONFIGURATION.md/AGENTS.md drift), repo hygiene (format, .gitignore, temp cleanup), release chores (changelog/version/tag), dependency bumps, and gate runs (lint/test/build) all go to `steward` on the cheap `mimo-v2.5`; only application-behavior changes go to `swe`/`designer`. **This includes read-only and trivial-looking checks**: a bare `git status`, "is the tree clean", "do the checks pass", "any docs drifted" MUST be delegated to `steward` — never run git/validate/docs-scan inline in the primary, even when the answer is one line.
- **Implementation code changes MUST be dispatched to `swe`** — via the `subagent` tool, or via the project's orchestration lane when one exists that runs `swe`. The primary lands docs, tracking, and non-behavior upkeep directly; it does not land implementation edits itself. Comments, formatting, and single-literal fixes may stay inline. A project's own `AGENTS.md` may override this rule (project rules win; see the `swe` agent md).
- **Settle the brief before dispatching `swe`** — decision ref (or "no contract surface"), exact files, acceptance criteria, and test commands; `swe` denies `question`/`subagent` and cannot clarify mid-task.
- For planning a feature or refactor before implementation, use `architect` agent.
- For UI/styling work, delegate to `designer` agent.
- When interacting with Cloudflare, use the `cf` CLI unless the project has a Wrangler configuration file.

## Codebase Knowledge Graph (codegraph)

Query the codegraph index instead of re-grepping/re-reading files. Structural questions belong here. `codegraph_explore` is Code Mode — call it via `execute` as `tools.codegraph.codegraph_explore(...)`. The default server exposes only this one tool (Read-equivalent): one call returns verbatim source + call paths + blast radius. Extra tools (`node`/`search`/`callers`/`callees`/`impact`/`files`/`status`) stay disabled unless `CODEGRAPH_MCP_TOOLS` allowlists them.

**Index:** every project needs its own index — no `.codegraph/` directory means the server is inactive. Build/refresh with `codegraph init` in the project root. If the index is missing, fall back to grep/glob and say so.

**Grep still wins:** string literals, error messages, config values, non-code files, raw-content regex, or when codegraph returns nothing.

**Delegation:** subagents don't see MCP initialize guidance — tell them to call `codegraph_explore` (or the `codegraph explore` CLI). Include the project name and known `file:line`/symbols so they skip re-discovery.

## Behavior search (`jg` — jevgrep)

Natural-language code search: `jg "where is auth token validated"` returns relevant files plus source excerpts. First-choice step before blind `grep`/`glob` for "where does X live / who implements X / how is X handled" behavior questions. Binary `jg` 0.4.2 at `~/.local/bin/jg` (Node 22+), skill `jevgrep` installed globally at `~/.agents/skills/jevgrep` (source `dzhng/jevgrep`, recorded in `config/skills/sources.json`).

**Setup / auth:** `jg` is installed per-user and requires a per-user credential. If `command -v jg` fails, the binary is missing. If `jg doctor` reports `Run jg auth or use jg auth --provider NAME --stdin.`, ask the user to authenticate themselves — never run `jg auth` for them and never handle the secret: `jg auth --provider opencode` (or the `--stdin` form). Agents must fall back cleanly while auth is pending.

**Routing matrix:**

| Caller | Access | Order |
|--------|--------|-------|
| `swe` | `shell: *` (unchanged) | jg when `command -v jg` succeeds and it is authenticated → else codegraph → `grep`/`glob` |
| `build` | blanket allow (global `permission: allow`; no agent envelope) | jg when `command -v jg` succeeds and it is authenticated → else codegraph → `grep`/`glob` |
| `researcher` | `shell` allowed for `jg *` + `command -v jg` ONLY; every other shell command stays denied | jg → codegraph → `grep`/`glob` |
| `architect` | `shell` allowed for `jg *` + `command -v jg` ONLY (new — previously no shell at all); every other shell command stays denied | jg → codegraph → `grep`/`glob` |
| `reviewer` | `shell: *` ask, but `jg *` + `command -v jg` explicitly allowed (frictionless, no prompt) | jg → codegraph → `grep`/`glob` |
| `steward` | `shell: *` allow (jg already available, now documented); no codegraph grant | jg when authed → `grep`/`glob` (no codegraph permission) |
| `designer` | `shell: *` ask, but `jg *` + `command -v jg` explicitly allowed (frictionless, no prompt); `execute` + `codegraph_*` allow (Code Mode) | jg → codegraph → `grep`/`glob` |
| `vision` | no jg grant (image-only, no shell) | not applicable |

**Fallback order (universal):** `jg` (only if installed AND authenticated) → codegraph `codegraph_explore` (only if `.codegraph/` exists) → `grep`/`glob` → delegate to `researcher` (for the `researcher` itself, stop at `grep`/`glob` — there is no delegate rung). Always state which rung produced the answer. Grep still wins for string literals, error messages, config values, non-code files, and raw-content regex.

**Exit codes — gate on them, never on the output sentinel.** `jg` ends almost every run with `End context.`, including a truncated SIGINT abort, so that line is NOT a completeness signal. Always capture the exit code: `0` complete, `2` incomplete (partial context — treat missing as unknown, re-query or fall through), `1` failed (1-line message, no `End context.`), `130` interrupted (output partial, discard it). `2` is rarely observed; never infer it from missing text. A pipe truncated by EPIPE (e.g. `| head`) can still yield rc 0 — an rc 0 truncated stream still needs the locations-only / excerpt check below.

**Errors print to stdout, not stderr.** Validation/usage failures (`--concurrency 0`, bad flag, bad root) print their message on **stdout** with empty stderr, so a stdout-only parser can mistake an error line for context. Gate on the exit code before trusting any output.

**rc 0 with locations-only output is not an answer.** On a config-shaped question in a large prose repo `jg` returned 23 correct file leads and **0 source excerpts** ("locations only") — no line numbers, no code, no token win over grep. If the result lists files but no excerpts, skip straight to `grep`/`glob` (or codegraph) instead of re-reading every lead.

**codegraph is blind to JSONC/Markdown config.** Its symbol index has no entries for `opencode.jsonc` or `*.md` agent files, so `codegraph_explore` returns unrelated TS (plugins/rows) for a config question. Config-shaped questions (opencode.jsonc, agent MD, CONFIGURATION.md) go to `grep` directly; codegraph stays for real code.

## Jev — Typed Decisions

`jev-mcp` is the typed decision layer, reached through `execute` (Code Mode): `tools["jev-mcp"].*`. Agents allowed to call it directly: `architect`, `researcher`, `reviewer`, `swe` (nested `jev-mcp_*` allow in their permission envelopes), plus the built-in `build` (blanket `permission: allow` — no envelope; the primary session likewise allows all tools). Use it often — cheap and fast — but ADVISORY only: never a completion signal, never a replacement for `reviewer`, CI, tests, or pasted evidence, never a blocker. Unreachable / error / `abstain` → skip and fall back.

- `jev_check` — one yes/no over a state (diff, artifact, plan, decision). Always pass `yes_means`/`no_means`; keep `state` structured and small.
- `jev_ask` — several typed questions over ONE shared state in one request (≤64): the batch lever — far cheaper and faster than N calls. Prefer it whenever one state answers several questions.
- `jev_triage` — pre-filter many items (≤50); `path` items are read server-side and never enter your context (use for diffs, logs, reports), `text` items are inline. Paths must sit below `file_roots` (reported by `jev_triage`; default = the server's working directory — the workspace; paths outside it, e.g. `/tmp`, are refused). One upstream request per item.
- `jev_classify` / `jev_score` — quick typed routing/scoring. `jev_models` — key/model sanity check.
- Triggers: ambiguous yes/no calls; design/plan sanity before executing; self-check before claiming done; pre-filtering a diff before `reviewer`; classifying borderline findings. Skip for deterministic facts, arithmetic, formatting, and anything a test decides.
- **Background work — jev is the default triage path for scripts, tools, and subagent waves (advisory; unavailable/abstain → fall back to the manual checklist):**
  - *Dispatch*: before dispatching a parallel wave (background or issued together), prefer one `jev_ask` over the proposed batch with the Parallel Execution Checklist as checks (disjoint files? independent outputs? self-contained prompts?) plus "non-interactive and safe unattended?" for script/tool members; for a single command whose safety/interactivity is unclear, one `jev_check` on the command. A failing check is a signal to fix, serialize, or keep foreground; it never blocks the wave by itself.
  - *Script/tool output*: redirect a background run to a gitignored log in the workspace (`mkdir -p .tmp && <cmd> > .tmp/<name>.log 2>&1`; `/tmp` sits outside the workspace root and is refused). On completion — or mid-run to decide wait/intervene/kill — `jev_triage` the log as a `path` item (`failed` / `needs_action`) and pull only the flagged tail into context. Bound long logs first (`tail -n 200` into a second file): jev reads the whole file, and an oversized item fails rather than truncates (`JEV_MAX_STATE_CHARS`, default 200k chars). Skip when the output is short or you must read it anyway.
  - *Subagent reports*: background prompts for write-capable agents write the full report to `.tmp/<name>.md` and reply with only the path + one-line status; `jev_triage` that report before reading it. Read-only agents keep the inline report (§ Caveman Mode exceptions apply).
- Key: `~/.config/typesafe/key` (0600, written from `.env.toml` by the `home/modules/env` activation). Never put the key back into the MCP `environment` block — an empty `{env:...}` value wins over the key file.

## Code Style
- Follow existing conventions in the codebase. Do not reformat or restyle unrelated code.
- No comments unless functionality is genuinely non-obvious.
- Keep output concise — prefer code over explanation.

## Error Recovery

### Compaction Survival
- After context compaction, always call `mem_session_summary` then `mem_context` to recover session state
- If you lose track of what you were doing, search memory with `mem_search` for recent actions
- Never assume file state after compaction — re-read affected files before continuing

### Tool Failures
- If MCP tool fails, try fallback (e.g., `grep` if codegraph returns nothing)
- If `subagent` fails, retry once with a more detailed prompt before escalating
- If a subagent was killed by usage limits, suggest a cheaper model to the user (agents can't switch their own model)

### Dead-End Recovery
- If an approach fails twice, stop and try a different strategy
- Call `mem_search` to check if this problem was solved before; use `mem_timeline`/`mem_get_observation` for full content of truncated hits
- If stuck, escalate to `reviewer` for a fresh look or `architect` for approach alternatives

## Quality Gates

### Agent Selection Rules
| Scenario | Agent | Reason |
|----------|-------|--------|
| Bounded implementation (feature/bugfix) | `swe` | Bash-first, test-driven minimal fixes |
| Repo status/health check (even a single `git status` / "is it clean" / "do checks pass" / docs drift) | `steward` | Trivial-looking checks still delegate; primary never runs git/validate/docs-scan inline |
| Git lifecycle (status/stage/commit/branch/worktree/stash) | `steward` | Cheap `mimo-v2.5`; keeps implementer tokens for `swe` |
| Docs sync (README/CONFIGURATION.md/AGENTS.md drift) | `steward` | Cheap `mimo-v2.5`; non-behavior |
| Repo hygiene (format, .gitignore, temp cleanup) | `steward` | Cheap `mimo-v2.5`; non-behavior |
| Release chores (changelog/version/tag) | `steward` | Cheap `mimo-v2.5`; commits only when asked |
| Dependency bumps | `steward` | Cheap `mimo-v2.5`; non-behavior |
| Gate runs (lint/test/build) | `steward` | Cheap `mimo-v2.5`; no behavior change |
| Multi-file bug / complex debugging | `swe` + `architect` | Plan first, then execute |
| Vague idea / concept | `architect` | Structured exploration before code |
| Feature planning / refactor >50 lines | `architect` | Phased plans with verify gates |
| Architecture design / ADR / missing design | `architect` | Wraps system-design + architecture skills; owns design + ADR |
| API/library research | `researcher` (default — always delegate) | webfetch/websearch; versioned sources; never invent APIs |
| Codebase exploration (build/primary) | `researcher` (default — always delegate; parallel only for disjoint scopes) | Owns codegraph index + `explorer`/`design-thinking` routing; primary keeps only cheap single-file lookups inline; fans out `explore` children |
| UI/styling changes | `designer` | Specialized in frontend |
| Design artifacts | `designer` | Owns the project's declared design artifacts (wireframes, design system); swe implements from them |
| Code review before merge | `reviewer` | Adversarial, severity-graded findings |

### Parallel Execution Checklist
Before using `subagent` for a parallel wave (background or issued together), verify (the default pack for one `jev_ask` over the proposed wave — § Jev; jev unavailable → verify manually):
1. Subtasks don't share files (no write conflicts)
2. Subtasks don't depend on each other's output
3. Each prompt is self-contained with full context

## Prompt Templates

- **Bug fix**: reproduce → `mem_search` similar → root cause → minimal fix → regression test → `mem_save`(bugfix)
- **Feature**: clarify → check patterns → design (`architect` for brainstorm/design/ADR/plan; `designer` first if the project declares design artifacts) → `swe` → `reviewer` → verify → `mem_save`(decision)
- **Refactor**: read tests first → small verifiable changes → test after each → behavior unchanged

## Commit Rules
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Scope when applicable: `feat(auth): add OAuth login`
- Body explains WHY, not WHAT (code shows what)
- Never commit without running tests first
- **NEVER commit changes unless the user explicitly asks you to**
- **Never push, publish, or modify remote state without explicit user request**

## Safety
- Never modify `.env` files or files containing credentials.
- Never commit secrets, API keys, or tokens.
- Never print secrets, tokens, or keys in output/logs — redact before showing, unless the user explicitly requested them.
- Use worktree-isolated sessions for experimental changes when available.
- Destructive commands (`rm -rf`, DROP/TRUNCATE, `git reset --hard`, force-push) → confirm with user first, unless the user explicitly requested the operation.

## Tool Installation Automation
- After installing any new tool or MCP server, automatically star its GitHub repository using `gh api -X PUT /user/starred/<owner>/<repo>` (requires `gh` CLI authenticated).
- If `gh` is not available, remind the user to star the repo manually.

## Agent-Browser: Snapshot-First Debugging (No Vision Required)

Use the `agent-browser` skill for browser automation (load it before browser work). Core rules:

- **Never default to `screenshot` when the model lacks vision** — use `snapshot -i` (accessibility tree) instead; it's the text-based debug loop.
- Loop: snapshot → interact (semantic locators: `find role|text ... click --name "..."`) → re-snapshot → check console via `eval`/`console`.
- Close overlays before continuing; screenshots only for vision-capable models.

### Vision Delegation (Text-Only Models)

When an image MUST be read (screenshot, diagram, chart, mockup) and the active model has no vision: delegate to the `vision` agent (native omni-modal; pins `opencode-go/mimo-v2.5`). Pass the image path in the prompt; consume the text description it returns. Never send images directly to a text-only model.
