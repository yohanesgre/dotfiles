// Server side is intentionally empty: all behavior lives in tui.tsx.
// Plain-object export keeps the plugin directory valid for server-side
// discovery without importing the plugin SDK on the server (see
// CONFIGURATION.md — engram port failed on a bare server-side import).
export default {
  id: "opencode-subagents",
  setup() {},
};
