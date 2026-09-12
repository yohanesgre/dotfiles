# Agent Rules

<skills_system priority="1">

## Available Skills

Skills are auto-discovered by the harness from `~/.agents/skills/`, `~/.config/opencode/skills/`, and project `.agents/skills/` (SKILL.md format). Only use skills listed in the skill tool's `<available_skills>`.

Invoke: native `skill` tool first (use skill ID from `<available_skills>`). Fallback: read `~/.agents/skills/<name>/SKILL.md` directly; for an externalized skill not installed in the project, `npx skills use <owner/repo>@<skill>`. Base directory provided in output resolves bundled resources (references/, scripts/, assets/). Do not invoke a skill already loaded in context.

</skills_system>

## Tool Calling (V2)

Built-in tools: `read`, `glob`, `grep`, `edit`, `write`, `shell`, `webfetch`, `websearch`, `question`, `skill`, `subagent`, `execute`.

- **Subagent delegation uses the `subagent` tool** — `subagent(agent, description, prompt, background?)`. Set `background: true` for async; pass the returned `sessionID` to continue that child. V2 has no `task()` or `delegate()`.
- **MCP and browser tools are Code Mode namespaces** — reach them through `execute`: `tools.engram.<tool>(...)`, `tools["codebase-memory-mcp"].<tool>(...)`, `tools.rtk.<tool>(...)`, `tools.browser.<tool>(...)`. They are not directly callable tools.
- **Shell runs through the `shell` tool** — set `workdir` instead of `cd`; prefer the `rtk` token-optimized prefix.

## Caveman Mode — Output Compression

Active on every response. Drops filler, keeps substance. Saves ~65% output tokens.

**Drop:** articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). No tool-call narration, no decorative tables/emoji, no dumping long raw error logs unless asked — quote shortest decisive line. Standard tech acronyms OK (DB/API/HTTP); never invent new abbreviations (cfg/impl/req/res/fn) — tokenizer splits them same as full word: zero token saved. No causal arrows (→) — own token, save nothing. Technical terms exact. Code blocks unchanged. Errors quoted exact.

Preserve user's dominant language. User writes Portuguese → reply Portuguese caveman. Compress the style, never translate.

No self-reference. Never name or announce the style. No "caveman mode on", "me caveman think", no third-person caveman tags. No normal answer plus "Caveman:" recap.

**Pattern:** `[thing] [action] [reason]. [next step].`

**Auto-Clarity:** Drop caveman for security warnings, irreversible action confirmations, multi-step sequences where fragments risk misread, or when compression creates technical ambiguity. Resume after clear part done.

**Off:** "stop caveman" or "normal mode" reverts to normal speech.

**Subagents inherit this mandate.** Most custom agents (`~/.config/opencode/agents/*.md`) carry caveman output rules in their prompts — exception: `reviewer`, which runs full prose because compression drops the nuance findings need (`caveman` skill denied on that agent). When delegating via `subagent`, include in the prompt: "Reply caveman-compressed: findings only, no filler, no process narration" — except when delegating to `reviewer`. Subagent reports enter main context — a yappy subagent costs twice (its output + your reading of it); reviewer is the deliberate exception.

## Memory
- At session start: `mem_current_project` to detect the project, then `mem_context` for recent session history. Use `mem_search` for topic lookups across sessions.
- Use `mem_save` after completing bug fixes, making architecture decisions, or discovering non-obvious codebase patterns.
- After `mem_save`, check the response for `judgment_required` conflict candidates — resolve them via `mem_judge` (ask the user when confidence is low or the relation is supersedes/conflicts_with).
- Use `mem_session_start` / `mem_session_end` to register session lifecycle; `mem_session_summary` before session end to preserve state for the next session.
- **ALWAYS update `~/.config/opencode/CONFIGURATION.md` after any configuration change** (opencode.json, slim agents, MCP servers, plugins, AGENTS.md, etc.). Keep it in sync with the current state. Verify changed configs parse (JSON/YAML validation).
- **AFTER updating local config, compare with `~/projects/dotfiles/`** — sync changes to the dotfiles repo so they don't drift. Key files: `config/opencode/opencode.jsonc`, `config/opencode/agents/`, `config/opencode/AGENTS.md`, `config/opencode/CONFIGURATION.md`.

## Tool Selection
- For shell output, prefer token-optimized form: `rtk <cmd>` prefix in the `shell` tool, or `tools.rtk.run_command(...)` via `execute` (allowlisted cmds only). Raw shell only when rtk lacks the command.
- **ALWAYS check community support before installing new tools or MCP servers**: minimum 100+ GitHub stars, active maintenance (updated within 3 months), multiple contributors. Skip tools with weak community support unless explicitly requested by user.
- **Delegation to the `researcher` subagent is mandatory for exploration and research** — primary/build sessions MUST NOT hand-explore multi-file code or run web searches inline; only a single cheap lookup (one read/grep acted on immediately) may stay inline. `researcher` owns the codebase-memory-mcp graph, the `explorer`/`call-graph` routing, and `librarian` web research. Delegate anything spanning files, callers, impact, or the web.
- **Spawn `researcher` subagents with disjoint scopes.** Partition research into non-overlapping workstreams (no shared files/dirs/symbols/questions/sources); overlap wastes work and yields conflicting merges. Multiple parallel `researcher` subagents are correct when their scopes are disjoint — foreground calls issued together, or `background: true` only when the session continues and joins them. A single workstream gets exactly one researcher, and that researcher fans out read-only `explore`/`codebase-memory-scout` children foreground (never background) and merges before reporting (leaf-only; no recursion); split a workstream only when it exceeds one researcher's context/step budget. A single cheap lookup stays inline; strictly dependent lookups stay inside one researcher.
- Codebase-exploration prompt: name the project, the exact question, known `qualified_name`s/paths, and the evidence expected (`path:line` + snippet). researcher routes internally: locate → `explorer`, trace → `call-graph`, structure/impact → codebase-memory-mcp.
- Web-research prompt: state the library + pinned version, the exact question, and the source expectation (versioned official docs first). researcher fetches; never invent APIs.
- **Every routine upkeep chore MUST route to `steward` — never `swe`.** Git lifecycle (status/stage/commit/branch/worktree/stash), docs sync (README/CONFIGURATION.md/AGENTS.md drift), repo hygiene (format, .gitignore, temp cleanup), release chores (changelog/version/tag), dependency bumps, and gate runs (lint/test/build) all go to `steward` on the cheap `mimo-v2.5`; only application-behavior changes go to `swe`/`designer`. **This includes read-only and trivial-looking checks**: a bare `git status`, "is the tree clean", "do the checks pass", "any docs drifted" MUST be delegated to `steward` — never run git/validate/docs-scan inline in the primary, even when the answer is one line.
- For planning a feature or refactor before implementation, use `architect` agent.
- For UI/styling work, delegate to `designer` agent.

## Codebase Knowledge Graph (codebase-memory-mcp)

Query the indexed code graph instead of re-grepping/re-reading files. Structural questions belong here. These tools are Code Mode — call them via `execute` as `tools["codebase-memory-mcp"].<tool>(...)`.

**Session start:** `list_projects` → index current repo if missing; `index_repository(repo_path, mode="full")` refreshes stale graphs. Check `index_status` when unsure.

**Tool routing:**

| Question | Tool |
|----------|------|
| Find definition / natural-language search ("update settings") | `search_graph` (`query=` BM25, `name_pattern=` regex, `semantic_query=` keyword array) |
| Read source of located function/class | `get_code_snippet` (pass exact `qualified_name`) |
| Who calls this / blast radius | `trace_path(direction="inbound", risk_labels=true)` |
| Callees / value propagation with args | `trace_path(mode="data_flow")` |
| Frontend fetch → API route flows | `trace_path(mode="cross_service")` |
| Multi-hop patterns, aggregations | `query_graph` (Cypher) |
| Text search ranked by graph importance | `search_code` (grep + dedup into functions) |
| Impact since a ref/date | `detect_changes(since=...)` |
| Architecture overview / schema | `get_architecture`, `get_graph_schema` |

**Grep still wins:** string literals, error messages, config values, non-code files, raw-content regex, or when MCP returns nothing.

**Delegation:** include the project name and known `qualified_name`s in subagent prompts so they skip re-discovery.

## Code Style
- Follow existing conventions in the codebase. Do not reformat or restyle unrelated code.
- No comments unless functionality is genuinely non-obvious.
- Keep output concise — prefer code over explanation.

## Error Recovery

### Compaction Survival
- After context compaction, always call `mem_context` to recover session state
- If you lose track of what you were doing, check `mem_timeline` for recent actions
- Never assume file state after compaction — re-read affected files before continuing

### Tool Failures
- If MCP tool fails, try fallback (e.g., `grep` if `codebase-memory-mcp` returns nothing)
- If `subagent` fails, retry once with a more detailed prompt before escalating
- If a subagent was killed by usage limits, suggest a cheaper model to the user (agents can't switch their own model)

### Dead-End Recovery
- If an approach fails twice, stop and try a different strategy
- Call `mem_search` to check if this problem was solved before; use `mem_get_observation` for full content of truncated hits
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
| Codebase exploration (build/primary) | `researcher` (default — always delegate; parallel only for disjoint scopes) | Owns codebase-memory graph + `explorer`/`call-graph` routing; primary keeps only cheap single-file lookups inline; fans out `explore` children |
| UI/styling changes | `designer` | Specialized in frontend |
| Design artifacts | `designer` | Owns the project's declared design artifacts (wireframes, design system); swe implements from them |
| Code review before merge | `reviewer` | Adversarial, severity-graded findings |

### Parallel Execution Checklist
Before using `subagent` (background) for parallel subagents, verify:
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

When an image MUST be read (screenshot, diagram, chart, mockup) and the active model has no vision: delegate to the `vision` agent (native omni-modal, model-agnostic — inherits the session model). Pass the image path in the prompt; consume the text description it returns. Never send images directly to a text-only model.

<!-- codebase-memory-mcp:start -->
# Codebase Knowledge Graph (codebase-memory-mcp)

Prefer its tools over grep for code discovery. Fall back to grep/glob for: string literals, error messages, config values, non-code files, or when MCP returns nothing.
<!-- codebase-memory-mcp:end -->
