/** @jsxImportSource @opentui/solid */
import { createMemo, For, Show } from "solid-js";
import type { SubagentSummary } from "./types";
import { DialogHeader, DialogRow, DialogTitle } from "./DialogRow";
import * as v from "./variants";

// S2 — overflow popup (REDESIGN §1b, revision 7). A flexbox table with two-line
// blocks, one per subagent, and symmetric 2-col padding via box props (never
// terminal-width math): the title row carries the hidden-set aggregate, the
// header row renders once above the scrollbox, and the body scrolls. The shared
// 1s tick drives elapsed, so the popup stays live.
export function MoreDialog(props: {
  theme: unknown;
  now: () => number;
  children: () => SubagentSummary[];
}) {
  const p = () => v.palette(props.theme);
  const rows = createMemo(() => props.children());
  // One data-driven grid for the whole hidden set: identical rows always yield
  // identical column widths, and the header + every row share it.
  const grid = createMemo(() => v.dialogGrid(rows(), props.now()));
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2}>
      <DialogTitle rows={rows()} p={p} />
      <Show
        when={rows().length > 0}
        fallback={
          <text fg={p().textMuted} wrapMode="none">
            {"no hidden subagents"}
          </text>
        }
      >
        <DialogHeader p={p} grid={grid} />
        <scrollbox maxHeight={v.DIALOG_MAX_ROWS_H} scrollbarOptions={{ visible: false }}>
          <For each={rows()}>
            {(child) => <DialogRow child={child} now={props.now} p={p} grid={grid} />}
          </For>
        </scrollbox>
      </Show>
    </box>
  );
}
