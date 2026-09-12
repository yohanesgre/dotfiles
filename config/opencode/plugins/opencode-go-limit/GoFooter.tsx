/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js";
import type { DisplayState, Level } from "./display";
import { footerText, rollingResetLabel, windowChips } from "./display";
import { useGoUsage, type GoUsageContext } from "./useGoUsage";
import type { GoUsage } from "./usage";

interface Palette {
  success: string;
  warning: string;
  error: string;
  textDefault: string;
  textMuted: string;
}

function pick(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function palette(theme: unknown): Palette {
  const t = theme as Record<string, any> | undefined;
  return {
    success: pick(t?.success, "#7fd88f"),
    warning: pick(t?.warning, "#e0af68"),
    error: pick(t?.error, "#f7768e"),
    textDefault: pick(t?.text?.default, "#eeeeee"),
    textMuted: pick(t?.text?.muted, "#808080"),
  };
}

function levelColor(level: Level, p: Palette): string {
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

function fallbackColor(state: DisplayState, p: Palette): string {
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
      <text fg={() => (state().kind === "stale" ? p().textMuted : p().textDefault)}>
        {usage() ? (state().kind === "stale" ? "~Go" : "Go") : ""}
      </text>
      <For each={chips() ?? []}>
        {(chip) => (
          <>
            <text fg={() => levelColor(chip.level, p())}>
              {` ${chip.label} ${chip.usage}%`}
            </text>
            <Show when={chip.window === "rolling" && resetLabel() !== ""}>
              <text fg={() => p().textMuted}>{` ${resetLabel()}`}</text>
            </Show>
          </>
        )}
      </For>
      <Show when={!chips()}>
        <text fg={() => fallbackColor(state(), p())}>{footerText(state())}</text>
      </Show>
    </box>
  );
}
