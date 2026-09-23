/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, Index, onCleanup } from "solid-js";
import { MoreDialog } from "./MoreDialog";
import { SubagentRow } from "./SubagentRow";
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
  dialog?: any;
}) {
  const p = () => v.palette(props.theme);
  const sub = useSubagents(props.sessionID, { data: props.data, client: props.client });
  const [now, setNow] = createSignal(Date.now());
  const [collapsed, setCollapsed] = createSignal(false);
  const tick = setInterval(() => setNow(Date.now()), 1000);

  // Dialog lifecycle state lives at component scope so a sidebar unmount while
  // the popup is open cannot leak the interval or stick the flag. Idempotent:
  // used as the host onClose callback and again from onCleanup. Never call
  // dialog.clear() here — that clears the whole host dialog stack.
  const [dialogNow, setDialogNow] = createSignal(Date.now());
  let dialogTick: ReturnType<typeof setInterval> | undefined;
  let dialogOpen = false;
  const closeDialogState = () => {
    dialogOpen = false;
    if (dialogTick !== undefined) {
      clearInterval(dialogTick);
      dialogTick = undefined;
    }
  };
  onCleanup(() => {
    clearInterval(tick);
    closeDialogState();
  });

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

  // S2: clicking the "+N more" line opens a popup with the hidden rows. The
  // dialog is created fresh per open (dynamic rows are allowed on that mount
  // path) and closed on ESC/backdrop via the host onClose callback.
  const openMore = () => {
    if (dialogOpen) return;
    if (collapsed()) return;
    if (frame().moreText === "") return;
    if (typeof props.dialog?.show !== "function") return;
    const overflow = v.windowChildren(sub.state.children).overflow;
    if (overflow.length === 0) return;
    dialogOpen = true;
    setDialogNow(Date.now());
    dialogTick = setInterval(() => setDialogNow(Date.now()), 1000);
    try {
      props.dialog.show(
        () => (
          <MoreDialog
            theme={props.theme}
            now={dialogNow}
            children={() => v.windowChildren(sub.state.children).overflow}
          />
        ),
        closeDialogState,
      );
      if (typeof props.dialog.set === "function") {
        props.dialog.set({ size: "large", centered: true });
      }
    } catch {
      closeDialogState();
    }
  };

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
        {(slot) => <SubagentRow slot={slot} p={p} />}
      </Index>
      {/* Open on mouseUp, not mouseDown: on a normal click the same click's
          mouseUp would otherwise land on the freshly-shown dialog backdrop,
          which the host dismisses on mouseUp (open+instant close). The host's
          own sidebar MCP section opens its dialog on onMouseUp for this reason. */}
      <box flexDirection="row" onMouseUp={openMore}>
        <text fg={moreFg()}>{frame().moreText}</text>
      </box>
    </box>
  );
}
