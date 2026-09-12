# Engram MCP — Replacement Research

- **Date:** 2026-09-13
- **Worktree:** `/home/yohanes/projects/dotfiles-worktrees/engram-replacement`
- **Branch:** `research/engram-replacement` (base `041096f8454415aa8e33a8122457b507ef269ba4`, main == origin/main)
- **Status:** research only — no config changes, not committed

## Question

Is there a better MCP server to replace `engram` for persistent cross-session
memory in a local-first OpenCode setup?

## Current: Engram

| Property | Value |
|---|---|
| Repo | `https://github.com/Gentleman-Programming/engram` |
| Stars | 6,551 |
| Language / license | Go / MIT |
| Storage | SQLite + FTS5 |
| Transport | stdio MCP, single binary, no external runtime |
| Last push | 2026-09-12 (active) |
| Contributors | Alan-TheGentleman 468, dnlrsls 243, + others |
| Open issues | 92 |
| API keys | none |
| Key features | sessions, FTS search, topic keys, conflict resolution (`mem_judge`/`mem_compare`), timeline, pin, multi-project, passive capture, export/import, TUI |

**Data above verified via the GitHub API on 2026-09-13.**

## Shortlist (ranked by fit)

1. **AgentMemory** — closest feature parity, adds hybrid BM25 + vector + graph search.
2. **basic-memory** — human-readable Markdown + semantic search, simple.
3. **Graphiti (Zep)** — temporal knowledge graph, heavy infrastructure.
4. **Letta** — full agent runtime, not a drop-in memory plugin.
5. **Official `@modelcontextprotocol/server-memory`** — too basic to be a replacement.
6. **mem0 / OpenMemory MCP** — MCP server sunset / repo archived.

## Comparison

| Candidate | Stars | Lang | License | Storage | MCP | Local-first | API keys | Sessions | Conflict res | Semantic search | Multi-project |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **engram** (current) | 6,551 | Go | MIT | SQLite+FTS5 | stdio | yes | no | yes | yes | no (FTS only) | yes |
| **AgentMemory** (`rohitg00/agentmemory`) | 28,374 | TS | Apache-2.0 | SQLite + iii engine | stdio | yes | optional | yes (hooks) | no | yes (hybrid) | yes |
| **basic-memory** (`basicmachines-co/basic-memory`) | 3,943 | Python | AGPL-3.0 | Markdown + SQLite | stdio | yes | no | no | no | yes (FTS+vector) | yes |
| **Graphiti** (`getzep/graphiti`) | 30,831 | Python | Apache-2.0 | Neo4j / FalkorDB | http/stdio | yes | LLM key required | no | no | yes (hybrid graph) | yes |
| **Letta** (`letta-ai/letta`) | ~22k | Python | Apache-2.0 | Postgres/SQLite | sidecar | yes | LLM key required | yes | no | yes | yes |
| **Official server-memory** | — | TS | MIT | JSONL | stdio | yes | no | no | no | no (substring) | no |
| **mem0 / OpenMemory** | — | — | — | — | — | — | — | — | — | — | sunset/archived |

Stars/activity for engram, AgentMemory, basic-memory, Graphiti verified via GitHub API.
Letta and the official server figures are not independently re-verified here (mark as lower confidence).

## Per-candidate notes

### AgentMemory — `rohitg00/agentmemory`
- 28,374 stars, Apache-2.0, TypeScript; created 2026-02-25, last push 2026-09-07; 2,456 forks, 584 open issues.
- Contributors: `rohitg00` 400 contributions, then ~30 others with 1–10 each — multiple contributors but one dominant.
- Closest overlap with engram: session hooks, hybrid BM25 + vector + graph search (RRF fusion), auto-capture, OpenCode support.
- **Risks:** wraps a pinned external `iii` engine binary under `~/.agentmemory/bin` (conflict risk with other iii installs); reportedly 54 MCP tools vs engram's ~15 (context cost); no `mem_judge` conflict-resolution equivalent; young project.
- Config sketch (unverified):
  ```jsonc
  { "mcp": { "agentmemory": { "command": "npx", "args": ["-y", "@agentmemory/agentmemory@latest"], "enabled": true } } }
  ```

### basic-memory — `basicmachines-co/basic-memory`
- 3,943 stars, AGPL-3.0, Python; created 2024-12-02, last push 2026-09-10.
- Memory is plain Markdown files you own; hybrid FTS + vector search; project isolation.
- **Gaps:** no session management, no conflict resolution, no topic keys, no timeline. AGPL may matter for commercial use.
- Config sketch (unverified):
  ```jsonc
  { "mcp": { "basic-memory": { "command": "uvx", "args": ["--prerelease=allow", "basic-memory", "mcp"], "enabled": true } } }
  ```

### Graphiti — `getzep/graphiti`
- 30,831 stars, Apache-2.0, Python; last push 2026-09-11.
- Temporal knowledge graph with fact validity windows; hybrid retrieval.
- **Gaps:** requires Neo4j or FalkorDB (Docker) plus an LLM API key for entity extraction on every ingest; no sessions/conflict resolution; MCP server labeled experimental. Heavy for a "memory server".

### Letta
- Full agent runtime with core/archival/recall memory tiers. A platform to adopt, not a plugin.
- Requires Postgres + LLM API keys; framework lock-in. Not an engram drop-in.

### Official `@modelcontextprotocol/server-memory`
- Reference implementation; entity-relation graph in a single JSONL file; 9 tools.
- Keyword/substring search only, no sessions/conflict resolution; their own README calls it "a basic implementation". Not a replacement.

### mem0 / OpenMemory
- Standalone mem0 MCP repo archived; OpenMemory MCP sunset with a notice pointing to a self-hosted server requiring Docker + Postgres + Qdrant. Not a stdio drop-in.

## Recommendation

**Keep engram as the baseline.** It is actively maintained and already covers the
features that matter here (sessions, `mem_judge` conflict resolution, topic keys,
timeline, multi-project) with zero external runtime.

The only genuine capability gap is **semantic / vector search** (engram is FTS5
keyword-only). If that matters:
- **Primary trial:** AgentMemory — closest parity plus hybrid search, but accept the `iii` engine dependency, larger tool surface, younger codebase.
- **Runner-up:** basic-memory — simplest and human-readable Markdown, but loses sessions, conflict resolution, and timeline.

No candidate is an unambiguous "better replacement".

## Migration notes

- Engram exposes `export` / `import` (JSON).
- Neither AgentMemory nor basic-memory documents a direct engram import; a converter would be required to preserve existing memories.
- For an OpenCode swap, only the `mcp` server block in the OpenCode config changes (plus any AGENTS.md workflow rules that reference engram tool names).

## Caveats / unverified

- Feature lists for AgentMemory (tool count, `iii` behavior, hooks) and basic-memory (embedding latency) are from documentation, not code-level verification.
- Star / activity / contributor data is verified via GitHub API on 2026-09-13 and will drift.
- Benchmarks are self-reported; do not compare across projects by stars alone.

## Addendum — agent-first re-evaluation (2026-09-13)

Criterion change: the memory tool is consumed by an **agent**, not a human, so
human-readable storage is irrelevant. This removes basic-memory's main advantage.

### Confirmed findings

- **engram semantic gap is real and unscheduled.** Issue #233 ("Add semantic
  search layer on top of FTS5 to improve mem_search recall") is open, created
  2026-04-25, label `status:needs-review`, with reproducible evidence that
  natural-language queries with disjoint tokens return 0 hits. Issue #168 (five-layer
  proposal incl. hybrid search) was **closed as `not_planned`** on 2026-05-27.
  So engram may not ship semantic search soon.
- `doobidoo/mcp-memory-service`: 1,940 stars, Apache-2.0, Python, pushed 2026-09-12,
  315 forks, 41 open issues. SQLite + sqlite-vec, hybrid search, knowledge graph,
  autonomous consolidation, multi-project, REST + MCP. Built for agent pipelines.
- `corporatepiyush/mcp-memory` (Rust, single binary + usearch HNSW): only **7 stars**,
  1 contributor, last push 2026-07-14 — fails the maintenance/community bar.

### Re-ranked for agent consumption

| Rank | Tool | Fast | Simple | Powerful | Agent-native |
|---|---|---|---|---|---|
| 1 | doobidoo/mcp-memory-service | 3 | 3 | 5 | high (agent pipelines) |
| 2 | AgentMemory | 3 | 2 | 5 | highest (hooks/auto-capture) |
| 3 | engram (current) | 5 | 5 | 3 | high (sessions/conflicts) |
| 4 | basic-memory | 4 | 5 | 4 | low |

### Honest headline

No mature tool is simultaneously **single-binary/simple AND semantic**. The choice is:

- **engram** — fastest/simplest, best agent session lifecycle + conflict resolution, but keyword-only recall (gap real, not being fixed soon).
- **doobidoo/mcp-memory-service** — semantic + KG + consolidation, `pip install`, but a Python service with an embedding model dependency.
- **AgentMemory** — most agent-native (hooks, auto-capture), hybrid search, but more moving parts; the reported external `iii` engine dependency is **unverified**.

### Pick

1. **Default: doobidoo/mcp-memory-service** — best balance of agent-oriented + powerful + local embedded.
2. **Runner-up: AgentMemory** — most agent-native, accept extra complexity.
3. **Keep engram** only if zero-dependency single-binary matters more than semantic recall.

`corporatepiyush/mcp-memory` and `Yarlan1503/mcp-memory` are rejected (unmaintained / too few stars).

## Addendum 2 — Broader agent-memory landscape (2026-09-13)

Widened beyond engram-style MCP memory DBs, grouped by paradigm. Star counts
marked ✅ were re-verified via GitHub API on 2026-09-13; others are from research
and not independently re-verified.

### 1. Session / transcript memory (a different layer — captures raw sessions)

| Tool | Stars | Details |
|---|---|---|
| **claude-mem** (`thedotmack/claude-mem`) | **93,729 ✅** | Apache-2.0, TypeScript, pushed daily. Hooks + MCP; captures everything an agent does, AI-compresses it, injects relevant context into future sessions. Explicitly works with Claude Code, Codex, Gemini, Hermes, Copilot, **OpenCode**. Local SQLite + Chroma. |

This is the single biggest "different from engram" find. It complements a
knowledge DB: engram stores curated knowledge; claude-mem captures raw session history.

### 2. Context / docs injection

| Tool | Stars | Details |
|---|---|---|
| **Context7** (`upstash/context7`) | **61,924 ✅** | MIT, TypeScript, pushed 2026-09-11. MCP/CLI. Version-specific up-to-date library docs into context; kills hallucinated APIs. |
| DeepWiki MCP (Cognition) | n/a (hosted) | Free remote MCP. AI docs Q&A for any public GitHub repo. |

### 3. Codebase memory / code intelligence

| Tool | Stars | Details |
|---|---|---|
| **Serena** (`oraios/serena`) | **29,222 ✅** | MIT, Python, pushed daily. LSP-backed semantic retrieval + editing/refactoring MCP. 20+ languages. |
| ast-grep MCP | ecosystem | MIT. Structural AST search (not grep). |
| codegraph / codebase-memory-mcp | — | already in use. |

### 4. Graph / RAG memory engines

| Tool | Stars | Details |
|---|---|---|
| **LightRAG** (`HKUDS/LightRAG`) | **39,593 ✅** | MIT, Python, pushed daily. Graph + vector, incremental indexing, local storage option, 4 query modes. |
| Graphiti (Zep) | 30,831 ✅ | Temporal knowledge graph, built-in MCP (see main report). |
| Microsoft GraphRAG | ~35k (unverified) | MIT. Community detection + map-reduce global search; heavy LLM indexing cost. |
| txtai | ~13k (unverified) | Apache-2.0. Embeddings DB + SQL + graph + pipelines, runs fully local. |
| RAGFlow | ~90k (unverified) | Apache-2.0. Excellent parsing but needs Docker + ES + MySQL + Redis + MinIO → not laptop-simple. |

### 5. Memory "OS" / framework-native memory

| Tool | Stars | Details |
|---|---|---|
| **MemOS** (`MemTensor/MemOS`) | **11,295 ✅** | Apache-2.0, TS, pushed 2026-09-09. "Self-evolving memory OS", hybrid retrieval, cross-task skill reuse, MCP; claims 35% token savings. Full deploy needs Neo4j+Qdrant; local plugin exists. |
| **ReMe / MemoryScope** (`agentscope-ai/ReMe`) | **3,448 ✅** | Apache-2.0, Python, pushed 2026-09-11. File-first markdown memory kit, keyless BM25, MCP + CLI + HTTP. |
| HippoRAG | ~4k (unverified) | MIT. KG + Personalized PageRank multi-hop retrieval. |
| CrewAI Memory | 57.9k repo (unverified) | Extractable cognitive memory (`remember`/`recall`/`forget`), LanceDB, needs LLM key. |
| Letta / MemGPT, LangMem, LlamaIndex memory | — | framework-locked (see Addendum 1 notes). |

### 6. Compaction / reflection

| Tool | Details |
|---|---|
| Anthropic Memory + compaction tools (`memory_20250818`, `compact_20260112`) | API-only. Client-implemented storage. 84% token savings claim. |

### Rejected (fails bar / abandoned)

- **KuzuDB** — archived Oct 2025. **Verba** — archived Jun 2026. **Chroma MCP server** — abandoned since Sep 2025 with an unfixed SQL-injection vuln (use Chroma as a library instead).
- `corporatepiyush/mcp-memory` (7★), `lmaksym/agent-mem` (0★), `JoaquimLegal/mnemo` (3★) — too small.

### Recommended layered stack (agent memory, not one tool)

```
Layer 0  built-in agent memory (AGENTS.md / CLAUDE.md / auto-memory)
Layer 1  session capture      → claude-mem (93.7k★, OpenCode support)
Layer 2  code intelligence    → serena (29.2k★) + existing codegraph
Layer 3  docs freshness       → context7 (61.9k★)
Layer 4  curated knowledge DB → engram (or MemOS/ReMe/Graphiti as alternatives)
```

Best stand-alone "different" alternatives to engram: **MemOS** (memory OS + MCP) and **ReMe** (file-first + keyless BM25 + MCP). Best complements: **claude-mem** (session layer) and **serena** (code layer).

## Addendum 3 — Linux-native readiness (2026-09-13)

User constraint: mainly Linux, runs Nix, wants a memory tool native to Linux —
normal process, **no Docker / no cloud**, ideally a single binary, ideally
packaged in nixpkgs or shipping a flake.

### Reality check

"Native for Linux" filters hard. The Docker/desktop-heavy options (Graphiti,
MemOS full deploy, LightRAG service, RAGFlow) are out. No agent-memory tool was
found packaged in nixpkgs or shipping an official flake (reported, not fully
verified here). Single-binary options are almost all Go/Rust; semantic
single-binary options exist but are young.

### Linux-native readiness

| Candidate | Stars | Single binary | Docker | Runtime dep | Semantic | License |
|---|---|---|---|---|---|---|
| **engram** (current) | 6,551 ✅ | Go ✅ | no | none | no (FTS5) | MIT |
| **Vestige** (`samvallad33/vestige`) | **620 ✅** | Rust ✅ | no | ~130MB model first run | yes | AGPL-3.0 |
| **MemMesh** (`ThinkfleetAI/memmesh`) | **441 ✅** | Rust ✅ | no | local bge-small | yes | Apache-2.0 |
| **agent-memory-mcp** (`ipiton/agent-memory-mcp`) | **42 ✅** | Go ✅ | no | local | yes | MIT |
| **memory-mcp-1file** (`pomazanbohdan/memory-mcp-1file`) | **24 ✅** | Rust ✅ (ONNX embedded) | no | none | yes | MIT |
| **basic-memory** | 3,943 ✅ | no (uvx) | no | Python + FastEmbed | yes | AGPL-3.0 |
| **ReMe / MemoryScope** | 3,448 ✅ | no (pip) | no | Python | yes (BM25 keyless) | Apache-2.0 |
| **doobidoo/mcp-memory-service** | 1,940 ✅ | no (pip) | no | Python + sentence-transformers | yes | Apache-2.0 |
| claude-mem | 93,729 ✅ | no | no | Node/Bun + Chroma worker | yes | Apache-2.0 |
| serena / context7 | 29,222 / 61,924 ✅ | no | no | Python / Node | n/a (code/docs) | MIT |
| Graphiti, MemOS (full), LightRAG (server), RAGFlow | — | no | **yes** | graph DB / LLM key | yes | — |

### Verified caveats on the new Linux-native tools

- **Vestige** (620★, Rust, AGPL-3.0, pushed 2026-09-10, 67 forks, 17 issues):
  repo description is *"deterministic root-cause retrieval"* / agentic state-drift
  debugging — a **specialized root-cause tool**, not a general session-memory
  server. The earlier framing as "most complete Linux-native memory server" is
  overstated. Evaluate fit before adopting.
- **MemMesh** (441★, Rust, Apache-2.0, created 2026-06-21, pushed 2026-08-25,
  475 forks, 0 issues, **1 subscriber**, repo size 2.1MB): **forks > stars and a
  single watcher are red flags** for inflated/low-quality activity. Treat with
  caution until reviewed.
- `ipiton/agent-memory-mcp` (42★, Go, MIT) and `memory-mcp-1file` (24★, Rust, MIT)
  are real and active but too small to bet on.
- **No Docker is required** for engram, Vestige, MemMesh, the Go/Rust ones, or the
  Python `uvx`/`pip` options — "native" in the no-container sense is satisfied by
  many; a *single static binary* narrows it to the Go/Rust set.

### Nix

No candidate is in nixpkgs or ships a flake (reported, unverified). Packaging is
straightforward:
- Go: `buildGoModule` (engram, ipiton/agent-memory-mcp).
- Rust: `buildRustPackage` (Vestige, MemMesh, memory-mcp-1file).
Single-binary candidates also run as a systemd user service
(`ExecStart=%h/.local/bin/<tool> mcp`).

### Linux-native conclusion

- Only **mature** single-binary option is **engram** (already in use) — but it is
  FTS5-only.
- Linux-native **semantic** single-binary options are young/nichey: Vestige (620★,
  wrong niche), MemMesh (441★, red flags), ipiton (42★), memory-mcp-1file (24★).
- If "native" means "runs on Linux without Docker" rather than "single binary",
  then **ReMe** (keyless BM25, file-first) and **basic-memory** (uvx, hybrid
  search) are the strongest Python options; **doobidoo/mcp-memory-service** next.

## Addendum 4 — Semantic + SQLite + single binary (2026-09-13)

Final criteria: semantic (vector/hybrid) recall, SQLite storage, single static
native binary (Linux), Nix-friendly. A GitHub repo search for
`mcp memory sqlite-vec` / `memory mcp language:Rust` surfaced better fits than
the earlier shortlist.

### Winner: `rtk-ai/icm` (Infinite Context Memory)

| Property | Value |
|---|---|
| Repo | github.com/rtk-ai/icm |
| Stars | **562 ✅** |
| Language / license | Rust / Apache-2.0 |
| Activity | created 2026-02-02, pushed 2026-09-10, 55 forks, 5 open issues |
| Storage | **single SQLite file** — FTS5 + `sqlite-vec` |
| Search | **hybrid: BM25 30% + cosine 70%** (semantic via ONNX Runtime) |
| Binary | single Rust binary, zero external services |
| Embeddings | bundled ONNX in prebuilt/`install.sh`; Homebrew build downloads ~7 MB on first use. Default model `intfloat/multilingual-e5-base` (768d); configurable |
| Linux | x86_64 / aarch64 supported |
| **Nix** | **ships a flake**: `nix run github:rtk-ai/icm -- --version`, `nix profile install github:rtk-ai/icm` |
| **OpenCode** | `icm init` auto-configures OpenCode (JSON) + a TS plugin + hooks (session start, tool extract, compaction) |
| Features | episodic memories w/ access-aware decay, "memoirs" knowledge graph (typed relations), feedback/correction loop, verbatim transcripts, TUI dashboard, 31 MCP tools, local HTTP API |
| Caveat | **pre-1.0, marked experimental** — breaking changes possible; maintainer focus is on `rtk-ai/rtk`, ICM updates best-effort. Benchmarks are self-reported |

Notably, ICM's own README positions it directly against Engram/AgentMemory/Mem0,
and it is by the same org as the `rtk` tool already present in this setup.

### Runner-up: `eleboucher/memini`

- Go single binary, **sqlite-vec** (embedded default) or Postgres + VectorChord; hybrid vector+keyword with RRF; tiered memory (working/episodic/semantic/procedural); MCP stdio + HTTP + web UI; OpenCode plugin (`@eleboucher/opencode-memini`).
- 24★ ✅, AGPL-3.0, pushed 2026-09-12.
- **Caveat:** vector search requires an **external OpenAI-compatible embeddings endpoint** (you deploy the model) — not fully self-contained. Small community (24★).

### Other single-binary SQLite+vector options (checked, not recommended)

- `archit15singh/memori` — 25★ ✅, Rust, MIT, "SQLite + FTS5 + vector in a single file", but stale (last push 2026-07-18).
- `rtk-ai/icm` vs `Vestige` (620★, niche root-cause) and `MemMesh` (441★, red flags) — see Addendum 3.

### Conclusion

For semantic + SQLite + single-binary + Linux/Nix, **`rtk-ai/icm` is the clear
pick** — it is the only candidate that is a single native binary, SQLite-backed,
semantic (hybrid vector), Nix-flake-installable, and OpenCode-native. Budget for
its "experimental" status and best-effort maintenance cadence.

## Sources

- https://github.com/Gentleman-Programming/engram
- https://github.com/rohitg00/agentmemory
- https://github.com/basicmachines-co/basic-memory
- https://github.com/getzep/graphiti
- https://github.com/letta-ai/letta
- https://github.com/modelcontextprotocol/servers (memory server)
- GitHub REST API (`/repos/...`, `/contributors`) — verified 2026-09-13
