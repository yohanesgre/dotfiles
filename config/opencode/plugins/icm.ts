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

/// The global Bun runtime (host-provided; no runtime imports).
function bun(): any {
  return (globalThis as any).Bun
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
  },
}
