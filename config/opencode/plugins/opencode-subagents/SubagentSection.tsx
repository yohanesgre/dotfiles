/** @jsxImportSource @opentui/solid */
import { createSignal, For, onCleanup, Show } from "solid-js";
import { usePlugin } from "@opencode-ai/plugin/tui";
import { useSubagents } from "./useSubagents";
import * as v from "./variants";
import type { SubagentSummary } from "./types";

// Visual language copied from the host sidebar sections (MCP/LSP):
// "▾ LABEL" bold text.default at pane inset 2, "• name" rows with muted
// right-aligned meta, blank line between sections, "•" bullets.
// Constraint: box border/title inside a TUI slot freezes the renderer, and
// flex spacers collapse in slot content — lines are single padded strings.
export function SubagentSection(props: { sessionID: string }) {
  const ctx = usePlugin();
  const p = () => v.palette(ctx.theme);
  const sub = useSubagents(props.sessionID, { data: ctx.data });
  const [now, setNow] = createSignal(Date.now());
  const [collapsed, setCollapsed] = createSignal(false);
  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));

  return (
    <Show
      when={v.voidKind(sub.state) === "rows"}
      fallback={
        <Show when={v.voidKind(sub.state) === "error"}>
          <box flexDirection="row">
            <text fg={() => p().textDefault} attributes={v.BOLD}>
              {v.pad("▾ SUBAGENTS", v.HEADER_W)}
            </text>
            <text fg={() => p().error}>{v.errorLine(sub.state.error ?? "")}</text>
          </box>
        </Show>
      }
    >
      <box flexDirection="column">
        <box flexDirection="row" onMouseDown={() => setCollapsed((c) => !c)}>
          <text fg={() => p().textDefault} attributes={v.BOLD}>
            {v.headerLabel(sub.state.children.length, collapsed())}
          </text>
          <text fg={() => p().textMuted}>{v.padLeft(v.summaryLine(sub.state), v.AGG_W)}</text>
        </box>
        <Show when={!collapsed()}>
          <For each={v.sortChildren(sub.state.children)}>
            {(child) => <SubagentRow child={child} now={now()} p={p()} />}
          </For>
        </Show>
      </box>
    </Show>
  );
}

function SubagentRow(props: { child: SubagentSummary; now: number; p: v.Palette }) {
  const child = props.child;
  const seg = () => v.row1(child, props.now, props.p);
  const stFg = () => v.statusStyle(child.status, props.p).fg;
  return (
    <>
      <box flexDirection="row">
        <text fg={stFg} attributes={v.BOLD}>
          {seg().bold.slice(0, 2)}
        </text>
        <text fg={() => props.p.textDefault} attributes={v.BOLD}>
          {seg().bold.slice(2)}
        </text>
        <text fg={stFg}>{seg().status}</text>
        <text fg={() => props.p.textMuted}>{seg().meta}</text>
      </box>
      <text fg={() => props.p.textMuted}>{v.row2(child)}</text>
    </>
  );
}
