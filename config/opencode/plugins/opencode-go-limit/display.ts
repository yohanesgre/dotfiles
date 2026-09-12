import {
  WINDOWS,
  type GoUsage,
  type UsageError,
  type Window,
  type WindowUsage,
} from "./usage";

export type DisplayState =
  | { kind: "loading" }
  | { kind: "ready"; usage: GoUsage; fetchedAt: number }
  | { kind: "stale"; usage: GoUsage; error: UsageError; fetchedAt: number }
  | { kind: "error"; error: UsageError };

export type Level = "ok" | "warn" | "danger" | "muted";

export interface WindowChip {
  window: Window;
  label: string;
  usage: number;
  level: Level;
}

export const WINDOW_LABELS: Record<Window, string> = {
  rolling: "5h",
  weekly: "wk",
  monthly: "mo",
};

export function levelFor(w: WindowUsage): Level {
  if (w.status === "rate-limited") return "danger";
  if (w.percent >= 90) return "danger";
  if (w.percent >= 70) return "warn";
  return "ok";
}

export function windowChips(usage: GoUsage): WindowChip[] {
  return WINDOWS.map((window) => ({
    window,
    label: WINDOW_LABELS[window],
    usage: usage[window].percent,
    level: levelFor(usage[window]),
  }));
}

export function chipText(chip: WindowChip): string {
  return `${chip.label} ${chip.usage}%`;
}

export function footerText(state: DisplayState): string {
  switch (state.kind) {
    case "loading":
      return "Go …";
    case "ready":
      return `Go ${windowChips(state.usage).map(chipText).join(" ")}`;
    case "stale":
      return `~Go ${windowChips(state.usage).map(chipText).join(" ")}`;
    case "error":
      return shortError(state.error);
  }
}

// Compact countdown to a reset, e.g. 9900000 -> "2h45m", 86400000 -> "1d", 60000 -> "1m", <=0 -> "<1m"
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "<1m";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "<1m";
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days >= 1) return hours > 0 ? `${days}d${hours}h` : `${days}d`;
  if (hours >= 1) return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

// e.g. "↻2h45m" from usage.rolling.resetsAt relative to `now`; clamped at 0.
export function rollingResetLabel(usage: GoUsage, now: number): string {
  const resetsAt = Date.parse(usage.rolling.resetsAt);
  if (!Number.isFinite(resetsAt)) return "";
  return `↻${formatCountdown(resetsAt - now)}`;
}

export function shortError(error: UsageError): string {
  switch (error.kind) {
    case "NoAuth":
      return "Go —";
    case "AuthError":
      return "Go key!";
    case "Entitlement":
      return "Go none";
    default:
      return "Go ?";
  }
}
