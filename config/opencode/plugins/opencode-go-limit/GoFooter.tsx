/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js";
import type { DisplayState, Level } from "./display";
import { footerText, rollingResetLabel, windowChips } from "./display";
import { useGoUsage, type GoUsageContext } from "./useGoUsage";
import type { GoUsage } from "./usage";

type ThemeColor = unknown;

interface Palette {
  success: ThemeColor;
  warning: ThemeColor;
  error: ThemeColor;
  textDefault: ThemeColor;
  textMuted: ThemeColor;
}

// Host theme shape (binary-verified, v2.0.15): colors live at `text.base` /
// `text.muted` and `text.feedback.{success,error,warning}.base`. `text.action`
// is a group, not a color. A color value is passed through; a group is unwrapped
// to its usable fg. Never pass a function or a hex literal as `fg` — the host
// falls back to white.
function palette(theme: unknown): Palette {
  const t = (theme ?? {}) as any;
  const text = t.text ?? {};
  const feedback = text.feedback ?? {};
  return {
    success: resolveColor(feedback.success) ?? resolveColor(text.base),
    warning: resolveColor(feedback.warning) ?? resolveColor(text.base),
    error: resolveColor(feedback.error) ?? resolveColor(text.base),
    textDefault: resolveColor(text.base) ?? resolveColor(text.default),
    textMuted:
      resolveColor(text.muted) ?? resolveColor(text.subdued) ?? resolveColor(text.base),
  };
}

function resolveColor(value: unknown): ThemeColor | undefined {
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

function levelColor(level: Level, p: Palette): ThemeColor {
  switch (level) {
    case "ok":
      return p.success;
    case "warn":
      return p.warning;
    case "danger":
      return p.error;
    case "muted":
      return p.textMuted;
  }
}

function usageOf(state: DisplayState): GoUsage | undefined {
  return state.kind === "ready" || state.kind === "stale" ? state.usage : undefined;
}

function fallbackColor(state: DisplayState, p: Palette): ThemeColor {
  return state.kind === "loading" ? p.textMuted : p.error;
}

export function GoFooter(props: { context: GoUsageContext }) {
  const { state, now } = useGoUsage(props.context);
  const p = () => palette(props.context.theme);
  const usage = () => usageOf(state());
  const chips = () => {
    const current = usage();
    return current ? windowChips(current) : undefined;
  };
  const resetLabel = () => {
    const current = usage();
    return current ? rollingResetLabel(current, now()) : "";
  };

  return (
    <box flexDirection="row">
      <text fg={state().kind === "stale" ? p().textMuted : p().textDefault}>
        {usage() ? (state().kind === "stale" ? "~Go" : "Go") : ""}
      </text>
      <For each={chips() ?? []}>
        {(chip) => (
          <>
            <text fg={levelColor(chip.level, p())}>
              {` ${chip.label} ${chip.usage}%`}
            </text>
            <Show when={chip.window === "rolling" && resetLabel() !== ""}>
              <text fg={p().textMuted}>{` ${resetLabel()}`}</text>
            </Show>
          </>
        )}
      </For>
      <Show when={!chips()}>
        <text fg={fallbackColor(state(), p())}>{footerText(state())}</text>
      </Show>
    </box>
  );
}
