/** @jsxImportSource @opentui/solid */
import type { SubagentSummary } from "./types";
import * as v from "./variants";

// S2 wide table (REDESIGN §1b, revision 7). Each hidden subagent is a two-line
// column block: L1 is the full seven-column row (glyph/agent/title/status/time/
// tokens/cost), L2 is the model alone, spanning from the title column to the
// content edge. All cells are sized/aligned by native layout, so the block
// clamps to the dialog's real content width and can never overflow it. The
// glyph and status word carry the status colour, the agent stays bold, and L2
// is muted. Cell strings are built in variants.ts (raw value + constant
// separator) so the layout props here stay declarative. The fixed-column node
// widths come from the shared `grid` (variants.dialogGrid), computed once over
// the whole hidden set so every row and the header align on the same columns.
export function DialogRow(props: {
  child: SubagentSummary;
  now: () => number;
  p: () => v.Palette;
  grid: () => v.DialogGrid;
}) {
  const c = () => v.dialogRowLines(props.child, props.now(), props.p());
  return (
    <box flexDirection="column" width="100%">
      <box flexDirection="row" width="100%">
        <text
          fg={c().glyphFg ?? props.p().textMuted}
          attributes={v.BOLD}
          width={v.DIALOG_GLYPH_W}
          wrapMode="none"
        >
          {c().line1.glyph}
        </text>
        <text
          fg={props.p().textDefault}
          attributes={v.BOLD}
          width={props.grid().agent}
          wrapMode="none"
          truncate
        >
          {c().line1.agent}
        </text>
        <text fg={props.p().textDefault} flexGrow={1} minWidth={0} wrapMode="none" truncate>
          {c().line1.flex}
        </text>
        <text
          fg={c().statusFg ?? props.p().textMuted}
          attributes={v.BOLD}
          width={props.grid().status}
          textAlign="right"
          wrapMode="none"
        >
          {c().line1.status}
        </text>
        <text
          fg={props.p().textMuted}
          width={props.grid().time}
          textAlign="right"
          wrapMode="none"
        >
          {c().line1.time}
        </text>
        <text
          fg={props.p().textMuted}
          width={props.grid().tokens}
          textAlign="right"
          wrapMode="none"
        >
          {c().line1.tokens}
        </text>
        <text
          fg={props.p().textMuted}
          width={props.grid().cost}
          textAlign="right"
          wrapMode="none"
        >
          {c().line1.cost}
        </text>
      </box>
      <box flexDirection="row" width="100%">
        <text fg={props.p().textMuted} width={v.DIALOG_GLYPH_W} wrapMode="none">
          {""}
        </text>
        <text
          fg={props.p().textMuted}
          width={props.grid().agent}
          wrapMode="none"
          truncate
        >
          {""}
        </text>
        <text fg={props.p().textMuted} flexGrow={1} minWidth={0} wrapMode="none" truncate>
          {c().model}
        </text>
      </box>
    </box>
  );
}

// Rendered once above the scrollbox, outside it so it does not scroll away.
// Shares the same `grid` as the data rows, so the labels sit over the columns
// they name.
export function DialogHeader(props: { p: () => v.Palette; grid: () => v.DialogGrid }) {
  const h = () => v.dialogHeaderCells();
  return (
    <box flexDirection="row" width="100%">
      <text fg={props.p().textMuted} width={v.DIALOG_GLYPH_W} wrapMode="none">
        {h().glyph}
      </text>
      <text fg={props.p().textMuted} width={props.grid().agent} wrapMode="none">
        {h().agent}
      </text>
      <text fg={props.p().textMuted} flexGrow={1} minWidth={0} wrapMode="none">
        {h().title}
      </text>
      <text
        fg={props.p().textMuted}
        width={props.grid().status}
        textAlign="right"
        wrapMode="none"
      >
        {h().status}
      </text>
      <text fg={props.p().textMuted} width={props.grid().time} textAlign="right" wrapMode="none">
        {h().time}
      </text>
      <text
        fg={props.p().textMuted}
        width={props.grid().tokens}
        textAlign="right"
        wrapMode="none"
      >
        {h().tokens}
      </text>
      <text
        fg={props.p().textMuted}
        width={props.grid().cost}
        textAlign="right"
        wrapMode="none"
      >
        {h().cost}
      </text>
    </box>
  );
}

// Title row: bold "SUBAGENTS" + right-aligned hidden-set aggregate. The two
// texts share the row via `space-between`, so the aggregate ends at the right
// inset without any width math.
export function DialogTitle(props: { rows: SubagentSummary[]; p: () => v.Palette }) {
  const agg = () => v.dialogAggregate(props.rows);
  return (
    <box flexDirection="row" width="100%" justifyContent="space-between">
      <text fg={props.p().textDefault} attributes={v.BOLD}>
        {"SUBAGENTS"}
      </text>
      <text fg={props.p().textMuted} wrapMode="none" truncate>
        {agg()}
      </text>
    </box>
  );
}
