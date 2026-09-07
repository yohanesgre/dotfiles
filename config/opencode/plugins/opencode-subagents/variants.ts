// V channel: state styling, void-state content, formatting helpers.
// No component tree here — SubagentSection.tsx consumes these values.
import type { SubagentStatus, SubagentSummary, SubagentsState } from "./types";

// TextAttributes.BOLD (verified: @opencode-ai bundled @opentui/core — BOLD = 1 << 0).
export const BOLD = 1;

// Host sidebar geometry (measured from ANSI frames, 80-col terminal):
// pane starts col 39, content col 41 (2-space inset), status right-aligned
// ending col 76 (≈4-space right inset), blank line between sections.
// Plugin slot content is laid out sequentially (flex spacers collapse to
// zero in slot content), so every line is one padded string per text node.
export const CONTENT_W = 37;

export interface Palette {
  primary: string;
  success: string;
  error: string;
  warning: string;
  textDefault: string;
  textMuted: string;
}

export function palette(theme: unknown): Palette {
  const t = theme as Record<string, any> | undefined;
  const pick = (v: unknown, fb: string): string =>
    typeof v === "string" && v.length > 0 ? v : fb;
  return {
    primary: pick(t?.primary, "#7aa2f7"),
    success: pick(t?.success, "#7fd88f"),
    error: pick(t?.error, "#f7768e"),
    warning: pick(t?.warning, "#e0af68"),
    textDefault: pick(t?.text?.default, "#eeeeee"),
    textMuted: pick(t?.text?.muted, "#808080"),
  };
}

export interface StatusStyle {
  fg: string;
  label: string;
}

export function statusStyle(status: SubagentStatus, p: Palette): StatusStyle {
  switch (status) {
    case "running":
      return { fg: p.primary, label: "running" };
    case "error":
      return { fg: p.error, label: "error" };
    case "done":
      return { fg: p.success, label: "done" };
    default:
      return { fg: p.textMuted, label: "idle" };
  }
}

// Host item bullet is "•", not "●" (matches built-in MCP/LSP rows).
export const BULLET = "•";

export function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

export function padLeft(s: string, w: number): string {
  return s.length >= w ? s.slice(-w) : " ".repeat(w - s.length) + s;
}

export function fmtTokens(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "0";
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return `${trim1(v / 1_000)}k`;
  return `${trim1(v / 1_000_000)}m`;
}

function trim1(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function fmtCost(cost: number): string {
  const v = Number(cost);
  return `$${(Number.isFinite(v) && v >= 0 ? v : 0).toFixed(2)}`;
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}m`;
}

export const KIND_W = 9;
export const STATUS_W = 8;
export const MODEL_W = 24;
export const HEADER_W = 22;
export const AGG_W = 15;

export function headerLabel(count: number, collapsed: boolean): string {
  const base = collapsed ? "▸" : "▾";
  const label = collapsed ? `${base} SUBAGENTS (${count})` : `${base} SUBAGENTS`;
  return pad(label, HEADER_W);
}

export function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return max <= 1 ? "…" : `${one.slice(0, max - 1)}…`;
}

export function totalTokens(t: SubagentSummary["tokens"]): number {
  return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite;
}

// Header right side aggregate: "<n> run · <cost>".
export function summaryLine(state: SubagentsState): string {
  let running = 0;
  let cost = 0;
  for (const c of state.children) {
    if (c.status === "running") running++;
    cost += c.cost;
  }
  return `${running} run · ${fmtCost(cost)}`;
}

// Row 1 segments: [bold] "• kind" | [status] "status" | [muted] elapsed · tok
export function row1(
  child: SubagentSummary,
  now: number,
  p: Palette,
): { bold: string; status: string; meta: string } {
  return {
    bold: `${BULLET} ${pad(child.agent, KIND_W)}`,
    status: pad(statusStyle(child.status, p).label, STATUS_W),
    meta: `${fmtElapsed(now - child.created)} · ${fmtTokens(totalTokens(child.tokens))} tok`,
  };
}

// Row 2 (single muted line): "  <model padded> <tok right> <cost right>" — total CONTENT_W
export function row2(child: SubagentSummary): string {
  const t = fmtTokens(totalTokens(child.tokens));
  return `  ${pad(truncate(child.model, MODEL_W), MODEL_W)}${padLeft(`${t} ${fmtCost(child.cost)}`, CONTENT_W - 2 - MODEL_W)}`;
}

// Running first, then by creation order.
export function sortChildren(children: SubagentSummary[]): SubagentSummary[] {
  return [...children].sort((a, b) => {
    const ar = a.status === "running" ? 0 : 1;
    const br = b.status === "running" ? 0 : 1;
    if (ar !== br) return ar - br;
    return a.created - b.created;
  });
}

// Void states ----------------------------------------------------------

export type VoidKind = "loading" | "empty" | "error" | "rows";

export function voidKind(state: SubagentsState): VoidKind {
  if (state.loading) return "loading";
  if (state.error) return "error";
  if (state.children.length === 0) return "empty";
  return "rows";
}

export function errorLine(error: string): string {
  return `sync failed — ${truncate(error, 24)}`;
}
