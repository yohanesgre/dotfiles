/** @jsxImportSource @opentui/solid */
import * as v from "./variants";

// Fixed 3-line block: L1 identity (3 text nodes: accent glyph + agent +
// right-aligned status), then two 2-column grid lines (2 nodes each). Grid
// col A carries the indent (elapsed is L2 col B); the trailing cell is
// truncated only. Shared by the sidebar frame (S1) and the overflow dialog (S2).
export function SubagentRow(props: {
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
