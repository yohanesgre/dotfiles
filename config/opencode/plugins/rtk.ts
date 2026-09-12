// RTK OpenCode plugin — rewrites shell commands to use rtk for token savings.
// Requires: rtk >= 0.23.0 in PATH.
//
// OpenCode V2 plugin shape: `export default { id, setup(ctx) }`. The V2
// `ctx.tool.hook("execute.before", cb)` replaces the V1 `tool.execute.before`
// hook; `cb` gets `{ tool, sessionID, agent, messageID, id, input }` and may
// mutate `input.command` before execution.
//
// All rewrite logic lives in `rtk rewrite` (single source of truth); this file
// only shells out to it.

const rewrite = (command: string): string => {
  try {
    const Bun = (globalThis as any).Bun
    if (!Bun?.spawnSync) return ""
    const proc = Bun.spawnSync({
      cmd: ["rtk", "rewrite", command],
      stdout: "pipe",
      stderr: "ignore",
    })
    const out = proc?.stdout?.toString?.() ?? ""
    return out.trim()
  } catch {
    return ""
  }
}

export default {
  id: "rtk",
  async setup(ctx: any) {
    await ctx.tool.hook("execute.before", (payload: any) => {
      const tool = String(payload?.tool ?? "").toLowerCase()
      if (tool !== "shell" && tool !== "bash") return

      const args = payload?.input
      if (!args || typeof args !== "object") return
      const command = args.command
      if (typeof command !== "string" || !command) return

      const rewritten = rewrite(command)
      if (rewritten && rewritten !== command) args.command = rewritten
    })
  },
}
