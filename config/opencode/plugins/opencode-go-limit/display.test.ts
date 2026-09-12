import { describe, expect, test } from "bun:test";
import type { DisplayState } from "./display";
import {
  chipText,
  footerText,
  formatCountdown,
  levelFor,
  rollingResetLabel,
  shortError,
  windowChips,
} from "./display";
import { decodeUsage, type GoUsage, type UsageError, type WindowUsage } from "./usage";

const PAYLOAD = {
  usage: {
    rolling: { status: "ok", percent: 0, resetsAt: "2026-09-13T00:21:07.261Z" },
    weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-09-14T00:00:00.261Z" },
    monthly: { status: "ok", percent: 80, resetsAt: "2026-09-26T16:04:38.261Z" },
  },
};

const usage = decodeUsage(PAYLOAD) as GoUsage;

function win(partial: Partial<WindowUsage>): WindowUsage {
  return { status: "ok", percent: 0, resetsAt: "2026-01-01T00:00:00.000Z", ...partial };
}

describe("levelFor", () => {
  test("boundaries on used percent: 0/69 ok, 70/89 warn, 90/100 danger", () => {
    expect(levelFor(win({ percent: 0 }))).toBe("ok");
    expect(levelFor(win({ percent: 69 }))).toBe("ok");
    expect(levelFor(win({ percent: 70 }))).toBe("warn");
    expect(levelFor(win({ percent: 89 }))).toBe("warn");
    expect(levelFor(win({ percent: 90 }))).toBe("danger");
    expect(levelFor(win({ percent: 100 }))).toBe("danger");
  });

  test("rate-limited is danger regardless of usage", () => {
    expect(levelFor(win({ status: "rate-limited", percent: 50 }))).toBe("danger");
    expect(levelFor(win({ status: "rate-limited", percent: 0 }))).toBe("danger");
  });

  test("unknown status uses used thresholds", () => {
    expect(levelFor(win({ status: "weird", percent: 0 }))).toBe("ok");
    expect(levelFor(win({ status: "weird", percent: 80 }))).toBe("warn");
    expect(levelFor(win({ status: "weird", percent: 95 }))).toBe("danger");
  });
});

describe("windowChips", () => {
  test("maps the captured payload to labelled usage levels", () => {
    expect(windowChips(usage)).toEqual([
      { window: "rolling", label: "5h", usage: 0, level: "ok" },
      { window: "weekly", label: "wk", usage: 100, level: "danger" },
      { window: "monthly", label: "mo", usage: 80, level: "warn" },
    ]);
  });
});

describe("chipText", () => {
  test("renders label and used percent", () => {
    expect(chipText({ window: "rolling", label: "5h", usage: 0, level: "ok" })).toBe("5h 0%");
    expect(chipText({ window: "weekly", label: "wk", usage: 100, level: "danger" })).toBe("wk 100%");
    expect(chipText({ window: "monthly", label: "mo", usage: 80, level: "warn" })).toBe("mo 80%");
  });
});

describe("footerText", () => {
  test("loading", () => {
    expect(footerText({ kind: "loading" })).toBe("Go …");
  });

  test("ready", () => {
    const state: DisplayState = { kind: "ready", usage, fetchedAt: 1 };
    expect(footerText(state)).toBe("Go 5h 0% wk 100% mo 80%");
  });

  test("stale is prefixed with ~", () => {
    const state: DisplayState = {
      kind: "stale",
      usage,
      error: { kind: "Network" },
      fetchedAt: 1,
    };
    expect(footerText(state)).toBe("~Go 5h 0% wk 100% mo 80%");
  });

  test("each error kind maps to its short form", () => {
    expect(footerText({ kind: "error", error: { kind: "NoAuth" } })).toBe("Go —");
    expect(footerText({ kind: "error", error: { kind: "AuthError" } })).toBe("Go key!");
    expect(footerText({ kind: "error", error: { kind: "Entitlement" } })).toBe("Go none");
    expect(footerText({ kind: "error", error: { kind: "Network" } })).toBe("Go ?");
    expect(footerText({ kind: "error", error: { kind: "BadSchema" } })).toBe("Go ?");
    expect(footerText({ kind: "error", error: { kind: "RateLimited" } })).toBe("Go ?");
  });
});

describe("shortError", () => {
  test("returns deterministic strings for every kind", () => {
    const kinds: UsageError[] = [
      { kind: "NoAuth" },
      { kind: "AuthError" },
      { kind: "Entitlement" },
      { kind: "Network" },
      { kind: "BadSchema" },
      { kind: "RateLimited", retryAfterMs: 1000 },
    ];
    expect(kinds.map(shortError)).toEqual(["Go —", "Go key!", "Go none", "Go ?", "Go ?", "Go ?"]);
  });
});

describe("formatCountdown", () => {
  test("boundaries across days, hours, minutes", () => {
    expect(formatCountdown(0)).toBe("<1m");
    expect(formatCountdown(-5_000)).toBe("<1m");
    expect(formatCountdown(59_000)).toBe("<1m");
    expect(formatCountdown(60_000)).toBe("1m");
    expect(formatCountdown(3_600_000)).toBe("1h");
    expect(formatCountdown(3_660_000)).toBe("1h1m");
    expect(formatCountdown(86_400_000)).toBe("1d");
    expect(formatCountdown(108_000_000)).toBe("1d6h");
    expect(formatCountdown(2_203_200_000)).toBe("25d12h");
  });
});

describe("rollingResetLabel", () => {
  test("valid ISO reset produces a ↻-prefixed countdown", () => {
    const base = Date.parse("2026-09-13T00:21:07.261Z");
    expect(rollingResetLabel(usage, base - 9_900_000)).toBe("↻2h45m");
  });

  test("invalid or missing reset returns an empty label", () => {
    const invalid: GoUsage = { ...usage, rolling: win({ resetsAt: "not-a-date" }) };
    expect(rollingResetLabel(invalid, Date.now())).toBe("");
    const missing: GoUsage = { ...usage, rolling: win({ resetsAt: "" }) };
    expect(rollingResetLabel(missing, Date.now())).toBe("");
  });
});
