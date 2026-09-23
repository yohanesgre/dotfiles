// ICM auto-extraction + auto-recall plugin for OpenCode V2.
//
// Ported from the V1 plugin API (named `Plugin` export + hook object) to the
// V2 plugin API shipped by opencode v2.0.2. The v2.0.2 loader requires:
//
//     export default { id, setup(ctx) }      // or an `effect` function
//
// and rejects the V1 shape with:
//     "Plugin must export a default definition with an id and an effect or setup function."
//
// v2.0.2 exposes NO server-side `@opencode/plugin` module (only
// `@opencode/plugin/tui` for TUI plugins), so this file imports nothing and
// uses the global `Bun` — the same zero-import pattern as `rtk.ts`. Importing
// a bare `@opencode/plugin` specifier makes the loader fail to resolve it.
//
// Layers:
//   0. ctx.tool.hook("execute.after", event)   -> extract facts from tool output
//   1. ctx.session.hook("compaction", event)   -> extract from conversation before compaction
//   2. ctx.session.hook("context", event)      -> inject recalled context into the system prompt
//
// The V1 `session.created` handler only logged; it has no direct V2
// equivalent and was dropped.
//
// Issue #169: the previous plugin only logged on session.created and never
// actually injected anything into the conversation. V2's `session.hook("context")`
// is the correct place to deliver recalled context into the agent's context window.
//
// The `context` hook fires before EVERY model request (including tool
// continuations), so injection is de-duplicated per `event.sessionID`.
//
// Tool layer (2026-09-24): the `icm` MCP server was replaced by this plugin's
// own tool registration plus a systemd user service (`icm-http`) running
// `icm serve --http 127.0.0.1:11435`. Heavy semantic ops (store/recall/
// consolidate/stats/topics/health) route to the warm HTTP daemon (one loaded
// embedding model, no per-call reload); cheap/occasional ops shell out to the
// `icm` CLI. Tools are registered under namespace `icm` with short names so
// their exposed names stay identical to the old MCP tools (`icm_memory_store`,
// `icm_wake_up`, `icm_feedback_record`, ...).

// Capture tool output every N tool calls...
const EXTRACT_EVERY = 3
// ...but only drain the extraction queue (the step that loads the
// fastembed model) once per N enqueues. Issue #239: running a full
// `icm extract` on every 3rd tool call reloaded the embedding model
// from scratch each time (~3.7s CPU + a few hundred MB RAM), so
// reading many files produced visible CPU/RAM spikes. Enqueuing is
// cheap (~50ms, no model); the heavy work is batched into one
// detached drain.
const DRAIN_EVERY = 10
let toolCallCount = 0
let enqueueCount = 0

/// Base URL of the shared `icm serve --http` warm daemon (systemd user
/// service `icm-http`, see home/modules/opencode/default.nix).
const ICM_HTTP = "http://127.0.0.1:11435"

/// The global Bun runtime (host-provided; no runtime imports).
function bun(): any {
  return (globalThis as any).Bun
}

/// Absolute path to the upstream-installed `icm` binary, with a bare `icm`
/// fallback for PATH resolution. Kept import-free (no `node:path`).
function icmBin(): string {
  const home = String((globalThis as any)?.process?.env?.HOME ?? "")
  return home ? `${home}/.local/bin/icm` : "icm"
}

/// Enqueue raw text for deferred extraction. `icm extract --enqueue`
/// only writes a queue row — it never loads the embedding model.
function icmEnqueue(project: string, input: string): void {
  try {
    const B = bun()
    if (!B?.spawnSync) return
    B.spawnSync({
      cmd: ["icm", "extract", "--enqueue", "-p", project],
      stdin: new TextEncoder().encode(input),
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch {
    // silent — extraction is best-effort
  }
}

/// Drain the pending-extraction queue in a detached background process.
/// Fire-and-forget: the chat turn never waits on it, and the heavy
/// fastembed model load happens at most once per drain.
function icmDrainDetached(): void {
  try {
    const B = bun()
    if (!B?.spawn) return
    const child = B.spawn(["icm", "extract-pending", "--limit", "30"], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    })
    child?.unref?.()
  } catch {
    // silent — extraction is best-effort
  }
}

/// Capture stdout of `icm <args>` synchronously. Returns the empty string on
/// any failure so a missing/old binary or empty memory store can never break
/// a chat turn.
function icmCapture(args: string[]): string {
  try {
    const B = bun()
    if (!B?.spawnSync) return ""
    const proc = B.spawnSync({
      cmd: ["icm", ...args],
      stdout: "pipe",
      stderr: "pipe",
    })
    if (proc?.exitCode !== 0) return ""
    return String(proc?.stdout ?? "").trim()
  } catch {
    return ""
  }
}

/// Run `icm <args>` for the tool layer, preferring the absolute upstream
/// binary and falling back to PATH. Returns stdout on success, or
/// `{ ok: false, err }` with the captured stderr.
function icmRun(args: string[]): { ok: boolean; out: string; err: string } {
  try {
    const B = bun()
    if (!B?.spawnSync) return { ok: false, out: "", err: "Bun runtime unavailable" }
    const attempt = (bin: string) =>
      B.spawnSync({ cmd: [bin, ...args], stdout: "pipe", stderr: "pipe" })
    let proc = attempt(icmBin())
    if (proc == null || proc.exitCode == null) proc = attempt("icm")
    const out = String(proc?.stdout ?? "").trim()
    const err = String(proc?.stderr ?? "").trim()
    if (proc?.exitCode !== 0) {
      return { ok: false, out, err: err || `icm exited with ${proc?.exitCode}` }
    }
    return { ok: true, out, err }
  } catch (e: any) {
    return { ok: false, out: "", err: e instanceof Error ? e.message : String(e) }
  }
}

/// Flatten one message's content into text. V2 message content is an array
/// of parts (`{ type: "text", text }`); a plain string is still handled.
function messageText(message: any): string {
  if (typeof message?.content === "string") return message.content
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part: any) => part?.type === "text")
      .map((part: any) => String(part?.text ?? ""))
      .join("\n")
  }
  return ""
}

/// Flatten a V2 tool-execute result into text. `result.content` holds the
/// rendered tool output (string or `{ type: "text", text }[]`); `result.output`
/// is the structured value. Either may be absent.
function toolOutput(result: any): string {
  if (result == null) return ""
  if (typeof result === "string") return result

  const content = result.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === "string" ? part : String(part?.text ?? "")))
      .filter(Boolean)
      .join("\n")
  }

  const output = result.output
  if (typeof output === "string") return output
  if (output !== undefined) {
    try {
      return JSON.stringify(output)
    } catch {
      return ""
    }
  }
  return ""
}

/// POST JSON to the warm HTTP daemon and return the text body.
async function httpPost(path: string, body: unknown, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${ICM_HTTP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  const text = (await res.text()).trim()
  if (!res.ok) throw new Error(`icm-http ${res.status}: ${text || res.statusText}`)
  return text || "(ok)"
}

/// GET from the warm HTTP daemon and return the text body.
async function httpGet(path: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${ICM_HTTP}${path}`, { signal })
  const text = (await res.text()).trim()
  if (!res.ok) throw new Error(`icm-http ${res.status}: ${text || res.statusText}`)
  return text || "(ok)"
}

/// Run an async tool body and normalise failures into an `ERROR:` content
/// string instead of throwing (a thrown error aborts the whole tool call).
async function toolResult(fn: () => Promise<string>): Promise<{ content: string }> {
  try {
    return { content: (await fn()) || "(no output)" }
  } catch (e: any) {
    return { content: `ERROR: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/// Build an `icm` argv for a CLI-backed tool and return its stdout.
function cliArgs(parts: Array<string | undefined>): string[] {
  return parts.filter((p): p is string => p !== undefined)
}

export default {
  id: "icm",
  async setup(ctx: any) {
    const project = String(ctx?.location?.directory ?? "").split("/").pop() || "project"

    // Verify icm binary is available.
    const version = icmCapture(["--version"])
    if (!version) {
      console.warn("[icm] icm binary not found in PATH — plugin disabled")
      return
    }
    console.error(`[icm] plugin loaded (${version})`)

    // De-duplicate per-session to avoid re-injecting the same wake-up pack
    // on every model turn. The context hook fires per model request; we only
    // want context once at the start of each session.
    const injectedSessions = new Set<string>()

    // Layer 0: extract facts from tool output every N calls.
    await ctx.tool.hook("execute.after", (event: any) => {
      const tool = String(event?.tool ?? "")
      if (!tool || tool.startsWith("icm") || tool.startsWith("mcp__icm__")) return

      // Count every tool call (like V1), then only extract on the N-th.
      toolCallCount++
      if (toolCallCount < EXTRACT_EVERY) return
      toolCallCount = 0

      if (event?.status !== "completed") return
      const output = toolOutput(event?.result)
      if (!output || output.length < 20) return

      // Enqueue only (cheap, no model load), then drain once per
      // DRAIN_EVERY enqueues in a detached process — see issue #239.
      icmEnqueue(project, output.slice(0, 8000))
      enqueueCount++
      if (enqueueCount >= DRAIN_EVERY) {
        enqueueCount = 0
        icmDrainDetached()
      }
    })

    // Layer 1: extract from conversation before compaction.
    await ctx.session.hook("compaction", async (event: any) => {
      const messages = event?.messages
      if (!messages || !Array.isArray(messages)) return

      const text = messages
        .filter((m: any) => m?.role === "assistant")
        .slice(-20)
        .map(messageText)
        .join("\n")
        .slice(-4000)

      if (text.length < 50) return

      // Compaction is a natural flush point: enqueue the conversation
      // slice and drain the whole queue once in a detached process.
      icmEnqueue(project, text)
      enqueueCount = 0
      icmDrainDetached()
    })

    // Layer 2: inject recalled context into the system prompt, once per
    // session (keyed by sessionID).
    await ctx.session.hook("context", (event: any) => {
      const sessionID = event?.sessionID ?? "no-session"
      if (injectedSessions.has(sessionID)) return
      injectedSessions.add(sessionID)

      const system = event?.system
      if (!Array.isArray(system)) return

      // Wake-up pack: critical/high-importance facts + preferences.
      const wakeUp = icmCapture(["wake-up", "--project", project])
      if (wakeUp) system.push({ type: "text", text: wakeUp })

      // Project-scoped recall: top-N relevant memories for this project.
      const recall = icmCapture(["recall-project", "--limit", "5"])
      if (recall) {
        system.push({ type: "text", text: recall })
        console.error(
          `[icm] injected ${recall.split("\n").length} lines of project context into system prompt`,
        )
      }
    })

    // Tool layer: register the ICM tool surface under the `icm` namespace.
    // Effective names are `${namespace}_${name}` (opencode V2 `Tool` editor),
    // so short names keep the legacy `icm_memory_*` / `icm_wake_up` / ... ids.
    await ctx.tool.transform((editor: any) => {
      editor.namespace({
        name: "icm",
        description:
          "ICM long-term memory (local SQLite + hybrid semantic recall over a warm HTTP daemon)",
      })

      const add = (name: string, description: string, input: any, execute: any) => {
        editor.add({
          name,
          description,
          input,
          options: { namespace: "icm", codemode: true },
          execute,
        })
      }

      add(
        "memory_store",
        "Store important information in ICM long-term memory. Use to save decisions, preferences, project context, resolved errors — anything that should persist between sessions.",
        {
          type: "object",
          properties: {
            topic: { type: "string", description: "Category/namespace. Use the canonical topics: 'decisions-{project}', 'preferences', 'errors-resolved', 'context-{project}'." },
            content: { type: "string", description: "Information to memorize — be concise but complete" },
            importance: { type: "string", enum: ["critical", "high", "medium", "low"], default: "medium", description: "critical=never forgotten, high=slow decay, medium=normal, low=fast decay" },
            keywords: { type: "array", items: { type: "string" }, description: "Keywords to improve search" },
            raw_excerpt: { type: "string", description: "Optional verbatim (code, exact error message, etc.)" },
          },
          required: ["topic", "content"],
        },
        (input: any, context: any) =>
          toolResult(() => httpPost("/store", input, context?.signal)),
      )

      add(
        "memory_recall",
        "Search ICM long-term memory. Use to find past decisions, project context, preferences, or solutions to previously encountered problems.",
        {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural language search query" },
            topic: { type: "string", description: "Filter by specific topic (optional)" },
            limit: { type: "integer", default: 5, minimum: 1, maximum: 20, description: "Max number of results" },
            keyword: { type: "string", description: "Filter results by keyword (exact match on memory keywords)" },
            project: { type: "string", description: "Project filter (segment-aware). Defaults to the current workspace directory name. Pass an empty string to disable the filter and search across all projects." },
          },
          required: ["query"],
        },
        (input: any, context: any) =>
          toolResult(() => {
            const body: any = {
              query: input.query,
              limit: input.limit,
              keyword: input.keyword,
              topic: input.topic,
            }
            // Default the project filter to this workspace; "" opts out.
            body.project = input.project === undefined ? project : input.project
            return httpPost("/recall", body, context?.signal)
          }),
      )

      add(
        "memory_stats",
        "Get global ICM memory statistics.",
        { type: "object", properties: {} },
        (_input: any, context: any) => toolResult(() => httpGet("/stats", context?.signal)),
      )

      add(
        "memory_list_topics",
        "List all available topics in memory with their counts.",
        { type: "object", properties: {} },
        (_input: any, context: any) => toolResult(() => httpGet("/topics", context?.signal)),
      )

      add(
        "memory_health",
        "Get health stats for all topics: entry count, staleness, consolidation needs. Use to audit memory hygiene.",
        {
          type: "object",
          properties: {
            topic: { type: "string", description: "Check a specific topic (optional — checks all if omitted)" },
          },
        },
        (input: any, context: any) =>
          toolResult(() =>
            httpGet(
              input.topic ? `/health?topic=${encodeURIComponent(input.topic)}` : "/health",
              context?.signal,
            ),
          ),
      )

      add(
        "memory_consolidate",
        "Consolidate all memories of a topic into a single summary. Useful when a topic accumulates too many entries.",
        {
          type: "object",
          properties: {
            topic: { type: "string", description: "Topic to consolidate" },
            summary: { type: "string", description: "Consolidated summary to replace all memories in the topic" },
          },
          required: ["topic", "summary"],
        },
        (input: any, context: any) =>
          toolResult(() => httpPost("/consolidate", { topic: input.topic, summary: input.summary }, context?.signal)),
      )

      add(
        "wake_up",
        "Build a compact critical-facts pack for LLM system-prompt injection. Selects critical/high memories (and preferences) optionally scoped by project, ranked by importance × recency × weight.",
        {
          type: "object",
          properties: {
            project: { type: "string", description: "Project name filter (substring match against topic). Preferences/identity memories are always included." },
            max_tokens: { type: "integer", default: 200, minimum: 20, maximum: 4000, description: "Approximate token budget (1 token ≈ 4 characters)" },
            format: { type: "string", enum: ["markdown", "plain"], default: "markdown", description: "Output format" },
            include_preferences: { type: "boolean", default: true, description: "Include global preferences/identity memories regardless of the project filter" },
          },
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "wake-up",
                input.project !== undefined ? "-p" : undefined,
                input.project,
                input.max_tokens !== undefined ? "-t" : undefined,
                input.max_tokens !== undefined ? String(input.max_tokens) : undefined,
                input.format !== undefined ? "-f" : undefined,
                input.format,
                input.include_preferences === false ? "--no-preferences" : undefined,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "learn",
        "Scan a project directory and create a Memoir knowledge graph with its structure, dependencies, modules, and config files.",
        {
          type: "object",
          properties: {
            directory: { type: "string", description: "Project directory to scan (default: current working directory)" },
            name: { type: "string", description: "Memoir name (default: directory name)" },
          },
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "learn",
                input.directory !== undefined ? "-d" : undefined,
                input.directory,
                input.name !== undefined ? "-n" : undefined,
                input.name,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memory_update",
        "Update an existing memory in-place. Use to correct, refresh, or extend a memory without creating a duplicate.",
        {
          type: "object",
          properties: {
            id: { type: "string", description: "Memory ID to update" },
            content: { type: "string", description: "New content (replaces existing summary)" },
            importance: { type: "string", enum: ["critical", "high", "medium", "low"], description: "New importance level (optional, keeps existing if not set)" },
            keywords: { type: "array", items: { type: "string" }, description: "New keywords (optional, keeps existing if not set)" },
          },
          required: ["id", "content"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "update",
                input.id,
                "-c",
                input.content,
                input.importance !== undefined ? "-i" : undefined,
                input.importance,
                input.keywords !== undefined ? "-k" : undefined,
                input.keywords !== undefined ? input.keywords.join(",") : undefined,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memory_forget",
        "Delete a specific memory by its ID. Use when information is obsolete or incorrect.",
        {
          type: "object",
          properties: { id: { type: "string", description: "Memory ID to delete" } },
          required: ["id"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(["forget", input.id])
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memory_forget_topic",
        "Delete ALL memories in a topic. Use to clear an entire topic at once.",
        {
          type: "object",
          properties: { topic: { type: "string", description: "Topic whose memories should all be deleted" } },
          required: ["topic"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(["forget", "--topic", input.topic])
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memory_embed_all",
        "Generate embeddings for all memories that don't have one yet. Use this to backfill vector search capability.",
        {
          type: "object",
          properties: {
            topic: { type: "string", description: "Only embed memories in this topic (optional)" },
          },
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs(["embed", input.topic !== undefined ? "-t" : undefined, input.topic]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memory_extract_patterns",
        "Detect recurring patterns in a topic by keyword similarity. Optionally create concepts in a memoir from detected patterns.",
        {
          type: "object",
          properties: {
            topic: { type: "string", description: "Topic to analyze for patterns" },
            memoir: { type: "string", description: "Memoir name — if provided, creates concepts from detected patterns" },
            min_cluster_size: { type: "integer", default: 3, minimum: 2, description: "Minimum number of similar memories to form a pattern (default: 3)" },
          },
          required: ["topic"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "extract-patterns",
                "-t",
                input.topic,
                input.memoir !== undefined ? "-m" : undefined,
                input.memoir,
                input.min_cluster_size !== undefined ? "--min-cluster-size" : undefined,
                input.min_cluster_size !== undefined ? String(input.min_cluster_size) : undefined,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "feedback_record",
        "Record a correction/feedback when an AI prediction was wrong. Helps improve future predictions by learning from mistakes.",
        {
          type: "object",
          properties: {
            topic: { type: "string", description: "Category/namespace for this feedback" },
            context: { type: "string", description: "What was the situation / input that led to the prediction" },
            predicted: { type: "string", description: "What the AI predicted or did" },
            corrected: { type: "string", description: "What the correct answer/action should have been" },
            reason: { type: "string", description: "Why the correction was made (optional)" },
            source: { type: "string", description: "Which tool/pipeline generated the prediction (optional)" },
          },
          required: ["topic", "context", "predicted", "corrected"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "feedback",
                "record",
                "-t",
                input.topic,
                "-c",
                input.context,
                "-p",
                input.predicted,
                "--corrected",
                input.corrected,
                input.reason !== undefined ? "-r" : undefined,
                input.reason,
                input.source !== undefined ? "-s" : undefined,
                input.source,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "feedback_search",
        "Search past feedback/corrections to inform current predictions. Use before making predictions to learn from past mistakes.",
        {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query to find relevant past corrections" },
            topic: { type: "string", description: "Filter by topic (optional)" },
            limit: { type: "integer", default: 5, minimum: 1, maximum: 20, description: "Max number of results" },
          },
          required: ["query"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "feedback",
                "search",
                input.query,
                input.topic !== undefined ? "-t" : undefined,
                input.topic,
                input.limit !== undefined ? "-l" : undefined,
                input.limit !== undefined ? String(input.limit) : undefined,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "feedback_stats",
        "Get feedback statistics: total count, breakdown by topic, most applied corrections.",
        { type: "object", properties: {} },
        () =>
          toolResult(async () => {
            const r = icmRun(["feedback", "stats"])
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memoir_create",
        "Create a new memoir — a permanent knowledge container. Memoirs hold concepts that never decay.",
        {
          type: "object",
          properties: {
            name: { type: "string", description: "Unique human-readable name for the memoir" },
            description: { type: "string", description: "Description of what this memoir is for" },
          },
          required: ["name"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "memoir",
                "create",
                "-n",
                input.name,
                input.description !== undefined ? "-d" : undefined,
                input.description,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memoir_list",
        "List all memoirs with their concept counts.",
        { type: "object", properties: {} },
        () =>
          toolResult(async () => {
            const r = icmRun(["memoir", "list"])
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memoir_show",
        "Show a memoir's stats, labels, and all its concepts.",
        {
          type: "object",
          properties: { name: { type: "string", description: "Memoir name" } },
          required: ["name"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(["memoir", "show", input.name])
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memoir_add_concept",
        "Add a permanent concept to a memoir. Concepts are knowledge nodes that get refined, never decayed.",
        {
          type: "object",
          properties: {
            memoir: { type: "string", description: "Memoir name" },
            name: { type: "string", description: "Concept name (unique within memoir)" },
            definition: { type: "string", description: "Dense description of the concept" },
            labels: { type: "string", description: "Comma-separated labels (namespace:value or plain tag). E.g. 'domain:arch,type:decision'" },
          },
          required: ["memoir", "name", "definition"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "memoir",
                "add-concept",
                "-m",
                input.memoir,
                "-n",
                input.name,
                "-d",
                input.definition,
                input.labels !== undefined ? "-l" : undefined,
                input.labels,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memoir_refine",
        "Refine an existing concept with a new, improved definition. Bumps revision and boosts confidence.",
        {
          type: "object",
          properties: {
            memoir: { type: "string", description: "Memoir name" },
            name: { type: "string", description: "Concept name" },
            definition: { type: "string", description: "New, refined definition" },
          },
          required: ["memoir", "name", "definition"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun([
              "memoir",
              "refine",
              "-m",
              input.memoir,
              "-n",
              input.name,
              "-d",
              input.definition,
            ])
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memoir_link",
        "Create a directed, typed edge between two concepts in the same memoir.",
        {
          type: "object",
          properties: {
            memoir: { type: "string", description: "Memoir name" },
            from: { type: "string", description: "Source concept name" },
            to: { type: "string", description: "Target concept name" },
            relation: { type: "string", enum: ["part_of", "depends_on", "related_to", "contradicts", "refines", "alternative_to", "caused_by", "instance_of", "superseded_by"], description: "Relation type" },
          },
          required: ["memoir", "from", "to", "relation"],
        },
        (input: any) =>
          toolResult(async () => {
            // MCP uses snake_case relations; the CLI expects kebab-case.
            const relation = String(input.relation).replaceAll("_", "-")
            const r = icmRun([
              "memoir",
              "link",
              "-m",
              input.memoir,
              "--from",
              input.from,
              "--to",
              input.to,
              "-r",
              relation,
            ])
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memoir_inspect",
        "Inspect a concept and its graph neighborhood (BFS).",
        {
          type: "object",
          properties: {
            memoir: { type: "string", description: "Memoir name" },
            name: { type: "string", description: "Concept name" },
            depth: { type: "integer", default: 1, description: "BFS depth" },
          },
          required: ["memoir", "name"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "memoir",
                "inspect",
                "-m",
                input.memoir,
                input.depth !== undefined ? "-D" : undefined,
                input.depth !== undefined ? String(input.depth) : undefined,
                input.name,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memoir_search",
        "Full-text search concepts within a memoir.",
        {
          type: "object",
          properties: {
            memoir: { type: "string", description: "Memoir name" },
            query: { type: "string", description: "Search query" },
            label: { type: "string", description: "Filter by label (e.g. 'domain:tech')" },
            limit: { type: "integer", default: 10, description: "Max results" },
          },
          required: ["memoir", "query"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "memoir",
                "search",
                "-m",
                input.memoir,
                input.label !== undefined ? "-L" : undefined,
                input.label,
                input.limit !== undefined ? "-l" : undefined,
                input.limit !== undefined ? String(input.limit) : undefined,
                input.query,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memoir_search_all",
        "Full-text search concepts across all memoirs.",
        {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "integer", default: 10, description: "Max results" },
          },
          required: ["query"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "memoir",
                "search-all",
                input.limit !== undefined ? "-l" : undefined,
                input.limit !== undefined ? String(input.limit) : undefined,
                input.query,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "memoir_export",
        "Export a memoir's full concept graph. Formats: json (structured), dot (Graphviz), ascii (visual), ai (compact markdown for LLM context).",
        {
          type: "object",
          properties: {
            name: { type: "string", description: "Memoir name" },
            format: { type: "string", enum: ["json", "dot", "ascii", "ai"], default: "json", description: "Output format: json (structured), dot (Graphviz), ascii (visual graph), ai (compact markdown for LLM)" },
          },
          required: ["name"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "memoir",
                "export",
                "-m",
                input.name,
                input.format !== undefined ? "-f" : undefined,
                input.format,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "transcript_start_session",
        "Create a new transcript session for verbatim message capture. Returns the session_id used by subsequent icm_transcript_record calls.",
        {
          type: "object",
          properties: {
            agent: { type: "string", description: "Agent identifier (e.g. 'claude-code', 'cursor', 'gemini-cli'). Default: 'cli'." },
            project: { type: "string", description: "Project name (optional; usually cwd basename or repo slug)" },
            metadata: { type: "string", description: "Arbitrary JSON metadata (optional)" },
          },
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "transcript",
                "start-session",
                input.agent !== undefined ? "-a" : undefined,
                input.agent,
                input.project !== undefined ? "-p" : undefined,
                input.project,
                input.metadata !== undefined ? "-m" : undefined,
                input.metadata,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "transcript_record",
        "Append a verbatim message to a transcript session. Stores the raw content with no summarization.",
        {
          type: "object",
          properties: {
            session_id: { type: "string", description: "Session id from icm_transcript_start_session" },
            role: { type: "string", enum: ["user", "assistant", "system", "tool"], description: "Message role" },
            content: { type: "string", description: "Raw message content (stored verbatim)" },
            tool_name: { type: "string", description: "Tool name if role=tool (optional)" },
            tokens: { type: "integer", description: "Token count for billing / stats (optional)" },
            metadata: { type: "string", description: "Arbitrary JSON metadata (optional)" },
          },
          required: ["session_id", "role", "content"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "transcript",
                "record",
                "-s",
                input.session_id,
                "-r",
                input.role,
                "-c",
                input.content,
                input.tool_name !== undefined ? "-t" : undefined,
                input.tool_name,
                input.tokens !== undefined ? "--tokens" : undefined,
                input.tokens !== undefined ? String(input.tokens) : undefined,
                input.metadata !== undefined ? "-m" : undefined,
                input.metadata,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "transcript_search",
        "Full-text search across recorded transcript messages (FTS5 BM25). Supports boolean operators, phrase matches, and prefix queries.",
        {
          type: "object",
          properties: {
            query: { type: "string", description: "FTS5 query: 'postgres OR mysql', '\"exact phrase\"', 'auth*'" },
            session_id: { type: "string", description: "Restrict to one session (optional)" },
            project: { type: "string", description: "Restrict to one project (optional)" },
            limit: { type: "integer", default: 10, minimum: 1, maximum: 50 },
          },
          required: ["query"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "transcript",
                "search",
                input.session_id !== undefined ? "-s" : undefined,
                input.session_id,
                input.project !== undefined ? "-p" : undefined,
                input.project,
                input.limit !== undefined ? "-l" : undefined,
                input.limit !== undefined ? String(input.limit) : undefined,
                input.query,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "transcript_show",
        "Replay the full message thread of a transcript session, chronologically.",
        {
          type: "object",
          properties: {
            session_id: { type: "string" },
            limit: { type: "integer", default: 200, minimum: 1, maximum: 2000 },
          },
          required: ["session_id"],
        },
        (input: any) =>
          toolResult(async () => {
            const r = icmRun(
              cliArgs([
                "transcript",
                "show",
                input.limit !== undefined ? "-l" : undefined,
                input.limit !== undefined ? String(input.limit) : undefined,
                input.session_id,
              ]),
            )
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )

      add(
        "transcript_stats",
        "Global transcript statistics: session count, message count, total bytes, breakdown by role and agent, top sessions by message count.",
        { type: "object", properties: {} },
        () =>
          toolResult(async () => {
            const r = icmRun(["transcript", "stats"])
            if (!r.ok) throw new Error(r.err)
            return r.out
          }),
      )
    })
  },
}
