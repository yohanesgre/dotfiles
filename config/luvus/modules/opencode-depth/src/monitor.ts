import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveStateDir } from "./state.ts";

interface MonitorPane {
  paneId: string;
  lane: boolean;
  root: string;
  directory: string | null;
  title: string | null;
  state: string;
  message: string;
  reported: boolean;
  children: Array<{ id: string; agent: string | null; title: string | null; state: string }>;
}

interface MonitorState {
  updatedAt: number;
  connected: boolean;
  error: string | null;
  skipped: Array<{ paneId: string; reason: string }>;
  lanes: Array<{ id: string; agent: string | null; title: string | null; directory: string | null; state: string }>;
  panes: MonitorPane[];
}

const DOTS: Record<string, string> = {
  blocked: "\u25cf",
  working: "\u25cf",
  done: "\u2713",
  idle: "\u25cb",
};

function ago(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${seconds % 60}s`;
}

function render(state: MonitorState | null, error: string | null): string {
  const lines: string[] = ["\u001b[2J\u001b[H", "OpenCode Depth \u2014 monitor", ""];
  if (error) {
    lines.push(`  waiting: ${error}`, "");
    return lines.join("\n");
  }
  if (!state) {
    lines.push("  waiting for the watcher to publish state\u2026", "");
    return lines.join("\n");
  }
  const connection = state.connected ? "connected" : `degraded: ${state.error ?? "unknown"}`;
  lines.push(`  ${connection} \u00b7 updated ${ago(Date.now() - state.updatedAt)} ago`, "");
  if (state.panes.length === 0) {
    lines.push("  no opencode panes mapped", "");
  }
  for (const pane of state.panes) {
    const dot = DOTS[pane.state] ?? "?";
    const kind = pane.lane ? "lane" : "tui ";
    const reported = pane.reported ? "report" : "      ";
    lines.push(`  ${dot} [${kind}] pane ${pane.paneId} ${reported} ${pane.state.padEnd(7)} ${pane.directory ?? pane.root}`);
    if (pane.title) lines.push(`        ${pane.title}`);
    if (pane.message) lines.push(`        ${pane.message}`);
    for (const child of pane.children) {
      const childDot = DOTS[child.state] ?? "?";
      lines.push(`      ${childDot} ${(child.agent ?? "agent").padEnd(12)} ${child.state.padEnd(7)} ${child.title ?? child.id}`);
    }
  }
  for (const lane of state.lanes ?? []) {
    const dot = DOTS[lane.state] ?? "?";
    lines.push(`  ${dot} [lane] ---------- ------ ${lane.state.padEnd(7)} ${lane.directory ?? lane.id}`);
  }
  if (state.skipped.length > 0) {
    lines.push("");
    for (const skip of state.skipped) lines.push(`  skipped pane ${skip.paneId}: ${skip.reason}`);
  }
  lines.push("", "  Ctrl-C to close");
  return lines.join("\n");
}

export async function runMonitor(deps: { stateDir?: string } = {}): Promise<number> {
  const stateDir = deps.stateDir ?? resolveStateDir();
  const path = join(stateDir, "opencode-depth.monitor.json");
  let last = "";
  const tick = () => {
    let state: MonitorState | null = null;
    let error: string | null = null;
    try {
      state = JSON.parse(readFileSync(path, "utf8")) as MonitorState;
    } catch {
      error = `no state at ${path}`;
    }
    const frame = render(state, error);
    if (frame !== last) {
      last = frame;
      process.stdout.write(frame);
    }
  };
  tick();
  const timer = setInterval(tick, 1000);
  process.on("SIGINT", () => {
    clearInterval(timer);
    process.stdout.write("\n");
    process.exit(0);
  });
  await new Promise<void>(() => {});
  return 0;
}

if (import.meta.main) {
  runMonitor().catch(() => process.exit(1));
}
