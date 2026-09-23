// V channel: state styling, void-state content, row layout, formatting helpers.
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

// Host theme colors are RGBA objects (e.g. { buffer: { r, g, b, a } } with
// 0..1 floats), not strings — the host ignores hex `fg` strings. The plugin
// passes the raw value through unchanged.
export type ThemeColor = unknown;

export interface Palette {
  primary: ThemeColor;
  success: ThemeColor;
  error: ThemeColor;
  warning: ThemeColor;
  textDefault: ThemeColor;
  textMuted: ThemeColor;
}

// Host theme shape (binary-verified, v2.0.15). The host's own TUI renders with
// `text.base`, `text.muted`, `text.feedback.{success,error,warning}.base`, and
// `hue.interactive[200]` for a running indicator; there is no `text.status.*`
// group, no `text.default`/`text.subdued`, and `text.action` is a group
// (`{primary,secondary,destructive}`), not a color. Legacy `.default` groups are
// still accepted so an older theme does not resolve to nothing. Colors are RGBA
// objects (or strings); groups are `{ base | default }`. Never pass a group as
// `fg` — the renderer would fall back to white.
export function palette(theme: unknown): Palette {
  const t = (theme ?? {}) as any;
  const text = t.text ?? {};
  const feedback = text.feedback ?? {};
  const hue = t.hue ?? {};
  const first = (...c: unknown[]) => c.find((v) => v != null);
  return {
    // Running accent: hue.interactive[200] (the host's running color), else the
    // running status token (legacy), else info, else the primary action group.
    primary: first(
      resolveColor(hue.interactive?.[200]),
      resolveColor(text.status?.running),
      resolveColor(feedback.info),
      resolveColor(text.action?.primary),
      resolveColor(text.action),
      resolveColor(text.base),
    ),
    success: first(
      resolveColor(feedback.success),
      resolveColor(text.status?.done),
      resolveColor(text.status?.success),
      resolveColor(text.action),
      resolveColor(text.base),
    ),
    error: first(resolveColor(feedback.error), resolveColor(text.status?.error)),
    warning: first(resolveColor(feedback.warning), resolveColor(text.status?.warning)),
    textDefault: first(resolveColor(text.base), resolveColor(text.default)),
    textMuted: first(
      resolveColor(text.muted),
      resolveColor(text.subdued),
      resolveColor(text.action),
      resolveColor(text.base),
    ),
  };
}

// A theme color value is returned as-is; a color group is unwrapped to its
// usable fg (`base` for current themes, `default` for legacy ones). Anything
// that is neither a color nor a group resolves to undefined.
function resolveColor(value: unknown): unknown {
  if (value == null) return undefined;
  if (isColorValue(value)) return value;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return resolveColor(o.base ?? o.default);
  }
  return undefined;
}

function isColorValue(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    return "buffer" in o || "intent" in o || "rgb" in o || ("r" in o && "g" in o && "b" in o);
  }
  return false;
}

export interface StatusStyle {
  fg: ThemeColor;
  label: string;
}

export function statusStyle(status: SubagentStatus, p: Palette): StatusStyle {
  switch (status) {
    case "running":
      return { fg: p.primary, label: "running" };
    case "error":
      return { fg: p.error, label: "error" };
    case "interrupted":
      return { fg: p.warning, label: "interrupted" };
    case "done":
      return { fg: p.success, label: "done" };
    default:
      return { fg: p.textMuted, label: "idle" };
  }
}

// Single accent glyph per row, one char; color comes from `statusStyle`.
export function statusGlyph(status: SubagentStatus): string {
  switch (status) {
    case "running":
      return "●";
    case "done":
      return "✓";
    case "error":
      return "✕";
    case "interrupted":
      return "◐";
    default:
      return "○";
  }
}

// While running the state cell may show one activity token instead of the
// status label (wired for Phase 3; falls back to the label when absent).
export function stateLabel(child: SubagentSummary, p: Palette): StatusStyle {
  const st = statusStyle(child.status, p);
  if (child.status === "running" && child.activity) {
    return { fg: st.fg, label: child.activity };
  }
  return st;
}

// Host item bullet is "•", not "●" (matches built-in MCP/LSP rows).
export const BULLET = "•";

// Display-width aware. Bun.stringWidth (when available) counts wide/CJK glyphs
// as 2 columns; the fallback counts code points, never UTF-16 units, so a
// surrogate pair is never split by truncation.
export function displayWidth(s: string): number {
  const sw = (globalThis as { Bun?: { stringWidth?: (s: string) => number } }).Bun?.stringWidth;
  if (typeof sw === "function") {
    try {
      const w = sw(s);
      if (Number.isFinite(w) && w >= 0) return w;
    } catch {
      // fall through to the code-point count
    }
  }
  return Array.from(s).length;
}

export function pad(s: string, w: number): string {
  const width = Math.max(0, Math.floor(w));
  const cur = displayWidth(s);
  if (cur >= width) return truncate(s, width);
  return s + " ".repeat(width - cur);
}

export function padLeft(s: string, w: number): string {
  const width = Math.max(0, Math.floor(w));
  const cur = displayWidth(s);
  if (cur >= width) return truncateLeft(s, width);
  return " ".repeat(width - cur) + s;
}

function truncateLeft(s: string, max: number): string {
  const w = Math.floor(max);
  if (!Number.isFinite(w) || w <= 0) return "";
  if (displayWidth(s) <= w) return s;
  if (w <= 1) return "…";
  const chars = Array.from(s);
  const keep: string[] = [];
  let used = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = displayWidth(chars[i]);
    if (used + cw > w - 1) break;
    keep.push(chars[i]);
    used += cw;
  }
  return `…${keep.reverse().join("")}`;
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

export const HEADER_W = 22;
export const AGG_W = 15;
// Ceiling for the right-sized L1 status cell: fits running/done/error/idle and
// the 11-char "interrupted" without truncation.
export const STATUS_W = 11;
// Right-sized L2/L3 col B is clamped to this so a long elapsed/cost value
// cannot eat the whole line.
export const MAX_RIGHT_W = 12;
// The left column never collapses below this, even on a tiny terminal.
export const MIN_LEFT_W = 8;
// Fixed frame: 4 row blocks / 3 lines per unit = 12 body lines.
export const MAX_UNITS = 4;

// Flush-left through depth 1; nesting (depth >= 2) adds exactly one step.
export function indentFor(depth: number): string {
  return depth >= 2 ? "  " : "";
}

export function headerLabel(count: number, collapsed: boolean): string {
  const base = collapsed ? "▶" : "▼";
  const label = collapsed ? `${base} SUBAGENTS (${count})` : `${base} SUBAGENTS`;
  return pad(label, HEADER_W);
}

export function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  const w = Math.floor(max);
  if (!Number.isFinite(w) || w <= 0) return "";
  if (displayWidth(one) <= w) return one;
  if (w <= 1) return "…";
  const chars = Array.from(one);
  let out = "";
  let used = 0;
  for (const ch of chars) {
    const cw = displayWidth(ch);
    if (used + cw > w - 1) break;
    out += ch;
    used += cw;
  }
  return `${out}…`;
}

export function totalTokens(t: SubagentSummary["tokens"]): number {
  return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite;
}

// Header right side aggregate: "<n> run · <cost>" over ALL descendants.
export function summaryLine(state: SubagentsState): string {
  let running = 0;
  let cost = 0;
  for (const c of state.children) {
    if (c.status === "running") running++;
    cost += c.cost;
  }
  // Keep the running count (the live signal) visible: compact it and clip the
  // cost tail first, rather than letting right-alignment slice off the count.
  const head = `${fmtTokens(running)} run`;
  const tail = ` · ${fmtCost(cost)}`;
  const room = AGG_W - displayWidth(head);
  if (displayWidth(tail) <= room) return head + tail;
  if (room <= 0) return truncate(head, AGG_W);
  return head + truncate(tail, room);
}

// Cell width for one of the two grid columns: half the content minus indent.
export function cellWidth(depth: number): number {
  return Math.floor((CONTENT_W - displayWidth(indentFor(depth))) / 2);
}

export interface WindowResult {
  visible: SubagentSummary[];
  hidden: number;
  hiddenRunning: number;
}

// Agent-kind importance inside the running group. Lower = more important;
// unknown kinds rank last. Edit this map to change the order.
export const AGENT_WEIGHT: Record<string, number> = {
  reviewer: 0,
  swe: 1,
  researcher: 2,
  steward: 3,
};
export function agentWeight(agent: string): number {
  return AGENT_WEIGHT[agent] ?? 100;
}

// Running units occupy the earliest slots and are never dropped while a slot
// is free. Within the running group the ordering is agent weight first (see
// AGENT_WEIGHT), then recency: most recently updated first, tie-broken by most
// recently created. The rest (done/idle) group keeps plain recency ordering.
// A resumed `done` -> `running` session is both running and freshly updated, so
// it leads; once it finishes it stays near the top until something else runs or
// updates, instead of dropping back to its original DFS position.
export function windowChildren(children: SubagentSummary[]): WindowResult {
  const running: SubagentSummary[] = [];
  const rest: SubagentSummary[] = [];
  for (const child of children) {
    (child.status === "running" ? running : rest).push(child);
  }
  const byRecency = (a: SubagentSummary, b: SubagentSummary): number =>
    b.updated - a.updated || b.created - a.created;
  running.sort(
    (a, b) =>
      agentWeight(a.agent) - agentWeight(b.agent) ||
      b.updated - a.updated ||
      b.created - a.created,
  );
  rest.sort(byRecency);
  const visible = running.slice(0, MAX_UNITS);
  for (const child of rest) {
    if (visible.length >= MAX_UNITS) break;
    visible.push(child);
  }
  let visibleRunning = 0;
  for (const child of visible) {
    if (child.status === "running") visibleRunning++;
  }
  return {
    visible,
    hidden: children.length - visible.length,
    hiddenRunning: running.length - visibleRunning,
  };
}

export function moreLine(hidden: number, hiddenRunning: number): string {
  return hiddenRunning > 0 ? `+${hidden} more · ${hiddenRunning} running` : `+${hidden} more`;
}

// One row block in the fixed S1 frame. Every field is a pre-padded cell string;
// an absent slot is `undefined`, which the renderer shows as empty text without
// adding or removing nodes.
export interface FrameSlot {
  glyph: string;
  agent: string;
  glyphFg: ThemeColor;
  status: string;
  statusFg: ThemeColor;
  elapsed: string;
  model: string;
  tokens: string;
  cost: string;
}

export interface Frame {
  headerRight: string;
  slots: Array<FrameSlot | undefined>;
  moreText: string;
  // Header cells, rendered as function children so they stay reactive.
  label: string;
}

function slotFor(child: SubagentSummary, now: number, p: Palette): FrameSlot {
  const indent = indentFor(child.depth);
  const indentW = displayWidth(indent);
  const st = stateLabel(child, p);
  // L1 budget: glyph(1) + space(1) + agent(agentW) + status(statusW) = CONTENT_W.
  // The status cell is right-sized to its label (clamped to STATUS_W), so a
  // short label hands its spare width to the agent name; L1 stays flush-left.
  const statusW = Math.max(0, Math.min(displayWidth(st.label), STATUS_W));
  const agentW = Math.max(0, CONTENT_W - 2 - statusW);
  // L2/L3: col B is right-sized to its value (clamped to MAX_RIGHT_W); col A
  // takes the remainder minus a one-space gap and carries the nesting indent.
  // When the minimum left width would overflow, the right cell shrinks instead.
  const twoCol = (left: string, right: string): [string, string] => {
    let rightW = Math.max(0, Math.min(displayWidth(right), MAX_RIGHT_W));
    let leftW = CONTENT_W - indentW - rightW - 1;
    if (leftW < MIN_LEFT_W) {
      leftW = MIN_LEFT_W;
      rightW = Math.max(0, CONTENT_W - indentW - leftW - 1);
    }
    return [
      // Pad the content first, then prepend the indent: `pad` falls through to
      // `truncate` (which trims) when the cell is full, so indenting first would
      // strip the nesting indent on a full col A line.
      // Reserve one space (truncate to leftW - 1) so a full col A never abuts
      // the right-aligned col B.
      indent + pad(truncate(left, leftW - 1), leftW),
      padLeft(truncate(right, rightW), rightW),
    ];
  };
  const [model, elapsed] = twoCol(child.model, fmtElapsed(now - child.created));
  const [tokens, cost] = twoCol(`${fmtTokens(totalTokens(child.tokens))} tok`, fmtCost(child.cost));
  return {
    glyph: statusGlyph(child.status),
    // The glyph text node leads; the agent node carries the space + agent name.
    // Reserve one space (truncate to agentW - 1) so a full agent never abuts
    // the right-aligned status cell.
    agent: ` ${pad(truncate(child.agent, agentW - 1), agentW)}`,
    glyphFg: st.fg,
    // Status moves off the grid onto L1, right-sized against the content edge.
    status: padLeft(truncate(st.label, statusW), statusW),
    statusFg: st.fg,
    model,
    elapsed,
    tokens,
    cost,
  };
}

// Fixed-frame slot contents: always exactly MAX_UNITS slots. Every void state
// is expressed as text; `collapsed` blanks the body without removing nodes.
// Slot i is `windowed.visible[i]` (which already orders running units first).
export function frameSlots(
  state: SubagentsState,
  now: number,
  p: Palette,
  windowed: WindowResult,
  collapsed = false,
): Frame {
  const slots: Array<FrameSlot | undefined> = new Array(MAX_UNITS).fill(undefined);
  const label = headerLabel(state.children.length, collapsed);
  const agg = padLeft(summaryLine(state), AGG_W);
  if (collapsed) return { headerRight: agg, slots, moreText: "", label };
  const kind = voidKind(state);
  if (kind === "loading" || kind === "empty" || kind === "error") {
    const headerRight =
      kind === "loading"
        ? loadingLine()
        : kind === "empty"
          ? emptyLine()
          : errorLine(state.error ?? "");
    return { headerRight, slots, moreText: "", label };
  }
  for (let i = 0; i < MAX_UNITS && i < windowed.visible.length; i++) {
    slots[i] = slotFor(windowed.visible[i], now, p);
  }
  const parts: string[] = [];
  if (windowed.hidden > 0) parts.push(moreLine(windowed.hidden, windowed.hiddenRunning));
  if (kind === "partial") parts.push(partialLine(state.failedCount));
  return { headerRight: agg, slots, moreText: truncate(parts.join(" · "), CONTENT_W), label };
}

// Void states ----------------------------------------------------------

export type VoidKind = "loading" | "empty" | "error" | "partial" | "rows";

export function voidKind(state: SubagentsState): VoidKind {
  if (state.error) return "error";
  if (!state.hydrated) return "loading";
  if (state.children.length === 0) return "empty";
  if (state.failedCount > 0) return "partial";
  return "rows";
}

export function loadingLine(): string {
  return "loading subagents…";
}

export function emptyLine(): string {
  return "no subagents";
}

export function errorLine(error: string): string {
  return truncate(`sync failed — ${error}`, CONTENT_W);
}

export function partialLine(count: number): string {
  return `! ${count} sync failed`;
}
