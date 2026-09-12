/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, Index, onCleanup } from "solid-js";
import { useSubagents } from "./useSubagents";
import * as v from "./variants";

// Visual language copied from the host sidebar sections (MCP/LSP):
// "▼ LABEL" bold text.default at pane inset 2, "• name" rows, blank line
// between sections. Constraint: box border/title inside a TUI slot freezes the
// renderer, and flex spacers collapse in slot content — lines are single
// padded strings. Data/client/theme arrive via props from the tui.tsx
// setup(context) closure — never usePlugin(): the bundled @opencode-ai/plugin
// copy ships its own solid context while the host provides @opencode/plugin/tui.
//
// Fixed frame: the host renderer does not add or move nodes after mount, so
// every possible node exists on frame one and later refreshes only rewrite
// text. MAX_UNITS row blocks are always rendered, even when empty.
//
// Colors: the host `<text>` takes `fg` as a plain option. Passing a function
// (`fg={() => X}`) hands the renderer a function object it cannot parse, so it
// falls back to white; pass the evaluated value and let the Solid compiler wrap
// `fg={X}` reactively.
export function SubagentSection(props: {
  sessionID: string;
  data: any;
  client?: any;
  theme: unknown;
}) {
  const p = () => v.palette(props.theme);
  const sub = useSubagents(props.sessionID, { data: props.data, client: props.client });
  const [now, setNow] = createSignal(Date.now());
  const [collapsed, setCollapsed] = createSignal(false);
  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));

  const kind = () => v.voidKind(sub.state);
  const frame = createMemo(() =>
    v.frameSlots(
      sub.state,
      now(),
      p(),
      v.windowChildren(sub.state.children),
      collapsed(),
    ),
  );

  const rightFg = () => (kind() === "error" ? p().error : p().textMuted);
  const moreFg = () => (kind() === "partial" ? p().warning : p().textMuted);

  return (
    <box flexDirection="column">
      {/* The whole header line is the collapse target, not just the glyph. */}
      <box flexDirection="row" onMouseDown={() => setCollapsed((c) => !c)}>
        <text fg={p().textDefault} attributes={v.BOLD}>
          {frame().label}
        </text>
        <text fg={rightFg()}>{frame().headerRight}</text>
      </box>
      <Index each={frame().slots}>
        {(slot) => <SubagentBlock slot={slot} p={p} />}
      </Index>
      <text fg={moreFg()}>{frame().moreText}</text>
    </box>
  );
}

// Fixed 3-line block: L1 identity (3 text nodes: accent glyph + agent +
// right-aligned status), then two 2-column grid lines (2 nodes each). Grid
// col A carries the indent (elapsed is L2 col B); the trailing cell is
// truncated only.
function SubagentBlock(props: {
  slot: () => v.FrameSlot | undefined;
  p: () => v.Palette;
}) {
  const s = () => props.slot();
  return (
    <>
      <box flexDirection="row">
        <text fg={s()?.glyphFg ?? props.p().textMuted} attributes={v.BOLD}>
          {s()?.glyph ?? ""}
        </text>
        <text fg={props.p().textDefault} attributes={v.BOLD}>
          {s()?.agent ?? ""}
        </text>
        <text fg={s()?.statusFg ?? props.p().textMuted} attributes={v.BOLD}>
          {s()?.status ?? ""}
        </text>
      </box>
      <box flexDirection="row">
        <text fg={props.p().textMuted}>{s()?.model ?? ""}</text>
        <text fg={props.p().textMuted}>{s()?.elapsed ?? ""}</text>
      </box>
      <box flexDirection="row">
        <text fg={props.p().textMuted}>{s()?.tokens ?? ""}</text>
        <text fg={props.p().textMuted}>{s()?.cost ?? ""}</text>
      </box>
    </>
  );
}
