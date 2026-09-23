import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SubagentSummary, SubagentsState } from "./types";
import { subagentStatus } from "./types";
import {
  AGG_W,
  cellWidth,
  CONTENT_W,
  displayWidth,
  fmtCost,
  fmtElapsed,
  frameSlots,
  indentFor,
  MAX_RIGHT_W,
  MAX_UNITS,
  padLeft,
  palette,
  STATUS_W,
  statusGlyph,
  statusStyle,
  summaryLine,
  voidKind,
  windowChildren,
} from "./variants";

const summary: SubagentSummary = {
  sessionID: "ses_child",
  depth: 0,
  agent: "explore",
  title: "map the call graph",
  model: "anthropic/claude-sonnet-4",
  status: "done",
  tokens: { input: 1000, output: 400, reasoning: 50, cacheRead: 0, cacheWrite: 0 },
  cost: 0.1234,
  created: 0,
  updated: 0,
};

function makeSummary(over: Partial<SubagentSummary> = {}): SubagentSummary {
  return { ...summary, ...over };
}

const baseState: SubagentsState = {
  children: [],
  hydrated: true,
  failedCount: 0,
  error: undefined,
  lastUpdated: 0,
};

// Legacy theme shape (the pre-refactor assumption): colors at `text.default`/
// `text.subdued`/`text.action`, a `text.status.*` group, and `feedback.*` groups
// keyed `default`. Kept so the palette still resolves an older host theme.
const RGBA = (r: number, g: number, b: number, a = 1) => ({ buffer: { r, g, b, a } });

const mockTheme = {
  text: {
    default: RGBA(0.9, 0.9, 0.9),
    action: RGBA(0.8, 0.8, 0.8),
    subdued: RGBA(0.5, 0.5, 0.5),
    status: {
      running: RGBA(0.1, 0.2, 1),
      done: RGBA(0.2, 1, 0.2),
      error: RGBA(1, 0.1, 0.1),
      warning: RGBA(1, 0.7, 0.1),
    },
    feedback: {
      success: { default: RGBA(0, 1, 0), subdued: RGBA(0, 0.5, 0) },
      error: { default: RGBA(1, 0, 0), subdued: RGBA(0.5, 0, 0) },
      warning: { default: RGBA(1, 0.6, 0), subdued: RGBA(0.5, 0.3, 0) },
    },
  },
};

// Current host theme shape (v2.0.15, binary-verified): `text.base`/`text.muted`,
// `text.feedback.*.base` groups, `text.action` as a group, and running from
// `hue.interactive[200]`.
const realTheme = {
  hue: { interactive: { 200: RGBA(0.3, 0.5, 1) } },
  text: {
    base: RGBA(0.9, 0.9, 0.9),
    muted: RGBA(0.5, 0.5, 0.5),
    action: {
      primary: { base: RGBA(0.85, 0.85, 0.85), focused: RGBA(0.8, 0.8, 0.8) },
      secondary: { base: RGBA(0.5, 0.5, 0.5) },
    },
    feedback: {
      success: { base: RGBA(0, 1, 0) },
      error: { base: RGBA(1, 0, 0) },
      warning: { base: RGBA(1, 0.6, 0) },
      info: { base: RGBA(0, 1, 1) },
    },
  },
};

describe("palette", () => {
  test("resolves the current host tokens (base/muted/feedback.base/hue.interactive)", () => {
    const p = palette(realTheme);
    expect(p.primary).toBe(realTheme.hue.interactive[200]);
    expect(p.success).toBe(realTheme.text.feedback.success.base);
    expect(p.error).toBe(realTheme.text.feedback.error.base);
    expect(p.warning).toBe(realTheme.text.feedback.warning.base);
    expect(p.textDefault).toBe(realTheme.text.base);
    expect(p.textMuted).toBe(realTheme.text.muted);
  });

  test("never returns a color group as fg (current shape)", () => {
    const p = palette(realTheme);
    for (const v of [p.primary, p.success, p.error, p.warning, p.textDefault, p.textMuted]) {
      expect(isColorValueForTest(v)).toBe(true);
    }
    expect(p.success).not.toBe(realTheme.text.feedback.success);
    expect(p.primary).not.toBe(realTheme.text.action.primary);
  });

  test("still resolves the legacy shape", () => {
    const p = palette(mockTheme);
    expect(p.primary).toBe(mockTheme.text.status.running);
    expect(p.success).toBe(mockTheme.text.feedback.success.default);
    expect(p.error).toBe(mockTheme.text.feedback.error.default);
    expect(p.warning).toBe(mockTheme.text.feedback.warning.default);
    expect(p.textDefault).toBe(mockTheme.text.default);
    expect(p.textMuted).toBe(mockTheme.text.subdued);
  });

  test("reads the member of each feedback color group, never the group", () => {
    const p = palette(mockTheme);
    expect(p.success).toBe(mockTheme.text.feedback.success.default);
    expect(p.success).not.toBe(mockTheme.text.feedback.success);
    expect(p.error).toBe(mockTheme.text.feedback.error.default);
    expect(p.error).not.toBe(mockTheme.text.feedback.error);
    expect(p.warning).toBe(mockTheme.text.feedback.warning.default);
    expect(p.warning).not.toBe(mockTheme.text.feedback.warning);
  });

  test("passes the raw RGBA value through unchanged (no string coercion)", () => {
    const p = palette(realTheme);
    expect(typeof p.primary).toBe("object");
    expect(p.primary).toBe(realTheme.hue.interactive[200]);
  });

  test("degrades through candidates, never to a hex string", () => {
    const sparse = { text: { action: RGBA(0.3, 0.3, 0.3) } };
    const p = palette(sparse);
    expect(p.primary).toBe(sparse.text.action);
    expect(p.success).toBe(sparse.text.action);
    expect(p.textMuted).toBe(sparse.text.action);
    expect(p.textDefault).toBeUndefined();
    expect(p.error).toBeUndefined();
    expect(p.warning).toBeUndefined();
  });

  test("an absent theme resolves every entry to undefined", () => {
    const p = palette(undefined);
    for (const v of Object.values(p)) expect(v).toBeUndefined();
  });
});

// Mirrors variants' internal color check for assertions on resolved values.
function isColorValueForTest(v: unknown): boolean {
  if (typeof v === "string") return v.length > 0;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return "buffer" in o || "intent" in o || "rgb" in o || ("r" in o && "g" in o && "b" in o);
  }
  return false;
}

describe("cellWidth", () => {
  test("cellWidth halves the content minus indent", () => {
    expect(cellWidth(0)).toBe(18);
    expect(cellWidth(1)).toBe(18);
    expect(cellWidth(4)).toBe(17);
  });
});

describe("indentFor", () => {
  test("is flush-left through depth 1 and one step from depth 2", () => {
    expect(indentFor(0)).toBe("");
    expect(indentFor(1)).toBe("");
    expect(indentFor(2)).toBe("  ");
    expect(indentFor(4)).toBe("  ");
  });
});

describe("statusGlyph", () => {
  test("maps each status to a single glyph", () => {
    expect(statusGlyph("running")).toBe("●");
    expect(statusGlyph("done")).toBe("✓");
    expect(statusGlyph("error")).toBe("✕");
    expect(statusGlyph("interrupted")).toBe("◐");
    expect(statusGlyph("idle")).toBe("○");
  });
});

describe("frameSlots", () => {
  const p = palette(undefined);
  const worst = (depth: number): SubagentSummary =>
    makeSummary({
      sessionID: `d${depth}`,
      depth,
      agent: "a".repeat(200),
      model: "provider/model-with-a-very-long-variant-name".repeat(3),
      title: "t".repeat(200),
      tokens: {
        input: 9_999_999,
        output: 9_999_999,
        reasoning: 9_999_999,
        cacheRead: 9_999_999,
        cacheWrite: 9_999_999,
      },
      cost: 999999.99,
      created: 0,
      updated: 0,
    });

  test("every slot is within CONTENT_W at depths 0..4 worst case", () => {
    const now = 1_000_000_000;
    for (let depth = 0; depth <= 4; depth++) {
      const child = worst(depth);
      const indentW = displayWidth(indentFor(depth));
      const frame = frameSlots(
        { ...baseState, children: [child] },
        now,
        p,
        windowChildren([child]),
      );
      const slot = frame.slots[0];
      expect(slot).toBeDefined();
      // L1 always fills the full content width.
      expect(
        displayWidth(slot!.glyph) + displayWidth(slot!.agent) + displayWidth(slot!.status),
      ).toBe(CONTENT_W);
      // L2/L3: col B is right-sized to its content (clamped to MAX_RIGHT_W),
      // col A grows to the remainder minus the one-space gap.
      const elapsedW = Math.min(displayWidth(fmtElapsed(now - child.created)), MAX_RIGHT_W);
      const costW = Math.min(displayWidth(fmtCost(child.cost)), MAX_RIGHT_W);
      const modelLeftW = CONTENT_W - indentW - elapsedW - 1;
      const tokensLeftW = CONTENT_W - indentW - costW - 1;
      expect(displayWidth(slot!.elapsed)).toBe(elapsedW);
      expect(displayWidth(slot!.cost)).toBe(costW);
      expect(displayWidth(slot!.model) - indentW).toBe(modelLeftW);
      expect(displayWidth(slot!.tokens) - indentW).toBe(tokensLeftW);
      // Col B is the trailing cell: its right edge stays at the content edge.
      expect(displayWidth(slot!.model) + displayWidth(slot!.elapsed)).toBe(CONTENT_W - 1);
      expect(displayWidth(slot!.tokens) + displayWidth(slot!.cost)).toBe(CONTENT_W - 1);
    }
  });

  test("every line stays within CONTENT_W for long and short right values", () => {
    const now = 1_000_000_000;
    const long = worst(0);
    const short = makeSummary({ cost: 0.01, created: now - 60_000 });
    for (let depth = 0; depth <= 4; depth++) {
      for (const base of [long, short]) {
        const child = { ...base, depth };
        const frame = frameSlots(
          { ...baseState, children: [child] },
          now,
          p,
          windowChildren([child]),
        );
        const slot = frame.slots[0]!;
        expect(
          displayWidth(slot.glyph) + displayWidth(slot.agent) + displayWidth(slot.status),
        ).toBeLessThanOrEqual(CONTENT_W);
        expect(displayWidth(slot.model) + displayWidth(slot.elapsed)).toBeLessThanOrEqual(CONTENT_W);
        expect(displayWidth(slot.tokens) + displayWidth(slot.cost)).toBeLessThanOrEqual(CONTENT_W);
      }
    }
  });

  test("worst-case col A keeps at least one space before col B at depths 0..4", () => {
    const now = 1_000_000_000;
    for (let depth = 0; depth <= 4; depth++) {
      const child = worst(depth);
      const frame = frameSlots(
        { ...baseState, children: [child] },
        now,
        p,
        windowChildren([child]),
      );
      const slot = frame.slots[0]!;
      // Max-length left values must be truncated short of the cell edge so the
      // final column is padding: a guaranteed gap before the right-aligned
      // col B. L1 agent and L2/L3 model/tokens all reserve one space.
      expect(slot.agent.endsWith(" ")).toBe(true);
      expect(slot.model.endsWith(" ")).toBe(true);
      expect(slot.tokens.endsWith(" ")).toBe(true);
      // Every line stays within CONTENT_W.
      expect(
        displayWidth(slot.glyph) + displayWidth(slot.agent) + displayWidth(slot.status),
      ).toBeLessThanOrEqual(CONTENT_W);
      expect(displayWidth(slot.model) + displayWidth(slot.elapsed)).toBeLessThanOrEqual(CONTENT_W);
      expect(displayWidth(slot.tokens) + displayWidth(slot.cost)).toBeLessThanOrEqual(CONTENT_W);
    }
  });

  test("a short right value widens the left cell; col B stays at the edge", () => {
    for (let depth = 0; depth <= 4; depth++) {
      const indentW = displayWidth(indentFor(depth));
      const child = makeSummary({ sessionID: `r${depth}`, depth, status: "done", cost: 0.5 });
      const frame = frameSlots(
        { ...baseState, children: [child] },
        60_000,
        p,
        windowChildren([child]),
      );
      const slot = frame.slots[0]!;
      // "1m" and "$0.50" are both shorter than MAX_RIGHT_W: col B shrinks.
      const elapsedW = displayWidth("1m");
      const costW = displayWidth("$0.50");
      expect(slot.elapsed).toBe(padLeft("1m", elapsedW));
      expect(slot.cost).toBe(padLeft("$0.50", costW));
      expect(displayWidth(slot.elapsed)).toBe(elapsedW);
      expect(displayWidth(slot.cost)).toBe(costW);
      // Col A takes CONTENT_W - indentW - rightW - 1 (grows past the old half).
      expect(displayWidth(slot.model) - indentW).toBe(CONTENT_W - indentW - elapsedW - 1);
      expect(displayWidth(slot.tokens) - indentW).toBe(CONTENT_W - indentW - costW - 1);
      expect(displayWidth(slot.model)).toBeGreaterThan(cellWidth(depth));
      // Right edge flush: col B's right edge stays at the content edge.
      expect(displayWidth(slot.model) + displayWidth(slot.elapsed)).toBe(CONTENT_W - 1);
      expect(displayWidth(slot.tokens) + displayWidth(slot.cost)).toBe(CONTENT_W - 1);
    }
  });

  test("L1 fills the content width with status right-sized to its label", () => {
    const cases: Array<[SubagentSummary["status"], string]> = [
      ["running", "running"],
      ["done", "done"],
      ["error", "error"],
      ["interrupted", "interrupted"],
      ["idle", "idle"],
    ];
    for (const [status, label] of cases) {
      const child = makeSummary({ sessionID: `s-${status}`, agent: "explore", status });
      const frame = frameSlots({ ...baseState, children: [child] }, 0, p, windowChildren([child]));
      const slot = frame.slots[0]!;
      // The status cell shrinks to the label (clamped), handing the spare width
      // to the agent cell so L1 still fills CONTENT_W exactly.
      const statusW = Math.min(displayWidth(label), STATUS_W);
      const agentW = CONTENT_W - 2 - statusW;
      expect(displayWidth(slot.status)).toBe(statusW);
      expect(slot.status.endsWith(label)).toBe(true);
      expect(displayWidth(slot.agent)).toBe(1 + agentW);
      expect(
        displayWidth(slot.glyph) + displayWidth(slot.agent) + displayWidth(slot.status),
      ).toBe(CONTENT_W);
    }
  });

  test("L2 leads with model then elapsed; L3 is tokens then cost", () => {
    const child = makeSummary({ depth: 0, model: "anthropic/claude-sonnet-4", created: 0 });
    const frame = frameSlots(
      { ...baseState, children: [child] },
      60_000,
      p,
      windowChildren([child]),
    );
    const slot = frame.slots[0]!;
    expect(slot.model).toContain("anthropic");
    expect(slot.elapsed).toBe(padLeft("1m", displayWidth("1m")));
    expect(slot.tokens).toContain("tok");
    expect(slot.cost).toBe(padLeft("$0.12", displayWidth("$0.12")));
  });

  test("always returns exactly MAX_UNITS slots", () => {
    const states: SubagentsState[] = [
      { ...baseState, hydrated: false },
      baseState,
      { ...baseState, error: "boom" },
      { ...baseState, children: [makeSummary()] },
      { ...baseState, children: [makeSummary()], failedCount: 1 },
    ];
    for (const st of states) {
      const frame = frameSlots(st, 0, p, windowChildren(st.children));
      expect(frame.slots.length).toBe(MAX_UNITS);
    }
    const collapsed = frameSlots(baseState, 0, p, windowChildren([]), true);
    expect(collapsed.slots.length).toBe(MAX_UNITS);
  });

  test("running units occupy the earliest slots", () => {
    const children = [
      makeSummary({ sessionID: "a", agent: "idle-a", status: "idle", created: 5, updated: 5 }),
      makeSummary({ sessionID: "b", agent: "idle-b", status: "idle", created: 2, updated: 2 }),
      makeSummary({ sessionID: "c", agent: "run-c", status: "running", created: 3, updated: 3 }),
    ];
    const frame = frameSlots(
      { ...baseState, children },
      0,
      p,
      windowChildren(children),
    );
    expect(frame.slots[0]?.agent).toContain("run-c");
    expect(frame.slots[1]?.agent).toContain("idle-a");
  });

  test("identity exposes the status glyph, agent name and accent color", () => {
    const pTheme = palette(mockTheme);
    const children = [
      makeSummary({ sessionID: "r", agent: "explore", status: "running" }),
      makeSummary({ sessionID: "d", agent: "build", status: "done" }),
      makeSummary({ sessionID: "e", agent: "oops", status: "error" }),
      makeSummary({ sessionID: "i", agent: "wait", status: "interrupted" }),
    ];
    const frame = frameSlots({ ...baseState, children }, 0, pTheme, windowChildren(children));
    expect(frame.slots.map((s) => s?.glyph)).toEqual(["●", "✓", "✕", "◐"]);
    expect(frame.slots[0]?.agent).toContain("explore");
    expect(frame.slots[0]?.glyphFg).toBe(pTheme.primary);
    expect(frame.slots[1]?.glyphFg).toBe(pTheme.success);
    expect(frame.slots[2]?.glyphFg).toBe(pTheme.error);
    expect(frame.slots[3]?.glyphFg).toBe(pTheme.warning);
  });

  test("collapsed blanks every body text", () => {
    const children = [makeSummary({ status: "running" })];
    const st = { ...baseState, children };
    const frame = frameSlots(st, 0, p, windowChildren(children), true);
    expect(frame.moreText).toBe("");
    expect(frame.slots.every((s) => s === undefined)).toBe(true);
    expect(frame.headerRight).toContain("1 run");
  });

  test("rows put the aggregate in headerRight, not a void sentence", () => {
    const children = [makeSummary({ status: "running", cost: 1 })];
    const st = { ...baseState, children };
    const frame = frameSlots(st, 0, p, windowChildren(children));
    expect(frame.headerRight).toBe(padLeft(summaryLine(st), AGG_W));
  });

  test("loading, empty and error set headerRight and blank the slots", () => {
    const cases: Array<[SubagentsState, string]> = [
      [{ ...baseState, hydrated: false }, "loading subagents…"],
      [baseState, "no subagents"],
      [{ ...baseState, error: "boom" }, "sync failed — boom"],
    ];
    for (const [st, text] of cases) {
      const frame = frameSlots(st, 0, p, windowChildren(st.children));
      expect(frame.headerRight).toBe(text);
      expect(frame.slots.every((s) => s === undefined)).toBe(true);
      expect(frame.moreText).toBe("");
    }
  });

  test("partial shows rows with the sync-failed footer and an aggregate header", () => {
    const children = [makeSummary(), makeSummary({ sessionID: "s2" })];
    const st = { ...baseState, children, failedCount: 2 };
    const frame = frameSlots(st, 0, p, windowChildren(children));
    expect(frame.headerRight).toBe(padLeft(summaryLine(st), AGG_W));
    expect(frame.slots[0]).toBeDefined();
    expect(frame.moreText).toContain("2 sync failed");
  });

  test("overflow puts +K more on the more line", () => {
    const many = Array.from({ length: MAX_UNITS + 2 }, (_, i) =>
      makeSummary({ sessionID: `s${i}`, status: "idle" }),
    );
    const frame = frameSlots({ ...baseState, children: many }, 0, p, windowChildren(many));
    expect(frame.moreText).toContain("+2 more");
  });

  test("agg counts every running descendant, not just the visible window", () => {
    const n = MAX_UNITS + 1;
    const children = Array.from({ length: n }, (_, i) =>
      makeSummary({ sessionID: `run${i}`, status: "running", cost: 1 }),
    );
    const frame = frameSlots({ ...baseState, children }, 0, p, windowChildren(children));
    expect(windowChildren(children).visible.length).toBe(MAX_UNITS);
    expect(frame.headerRight).toContain(`${n} run`);
    expect(frame.headerRight).toContain(`$${n}.00`);
  });

  test("label reflects the collapsed flag and the descendant count", () => {
    const children = [makeSummary({ status: "running" })];
    const expanded = frameSlots({ ...baseState, children }, 0, p, windowChildren(children));
    const collapsed = frameSlots(
      { ...baseState, children },
      0,
      p,
      windowChildren(children),
      true,
    );
    expect(expanded.label).toContain("▼ SUBAGENTS");
    expect(expanded.label).not.toContain("(1)");
    expect(collapsed.label).toContain("▶ SUBAGENTS (1)");
  });
});

describe("windowChildren", () => {
  const group = (statuses: Array<"running" | "idle">): SubagentSummary[] =>
    statuses.map((status, i) =>
      makeSummary({ sessionID: `s${i}`, status, created: i, updated: i }),
    );

  test("orders running units first under the cap", () => {
    const children = group(["idle", "running"]);
    const res = windowChildren(children);
    expect(res.visible.map((c) => c.sessionID)).toEqual(["s1", "s0"]);
    expect(res.hidden).toBe(0);
    expect(res.hiddenRunning).toBe(0);
  });

  test("keeps a running child beyond the cap in an early slot", () => {
    const children = group(["idle", "idle", "idle", "idle", "idle", "running"]);
    const res = windowChildren(children);
    expect(res.visible.map((c) => c.sessionID)).toEqual(["s5", "s4", "s3", "s2"]);
    expect(res.hidden).toBe(2);
    expect(res.hiddenRunning).toBe(0);
  });

  test("counts running children dropped past a full running cap", () => {
    const children = group(["running", "running", "running", "running", "running"]);
    const res = windowChildren(children);
    expect(res.visible.map((c) => c.sessionID)).toEqual(["s4", "s3", "s2", "s1"]);
    expect(res.visible.length).toBe(MAX_UNITS);
    expect(res.hidden).toBe(1);
    expect(res.hiddenRunning).toBe(1);
  });

  test("a more recently updated done unit precedes an older done unit", () => {
    const children = [
      makeSummary({ sessionID: "old", status: "done", created: 1, updated: 10 }),
      makeSummary({ sessionID: "new", status: "done", created: 2, updated: 20 }),
    ];
    const res = windowChildren(children);
    expect(res.visible.map((c) => c.sessionID)).toEqual(["new", "old"]);
  });

  test("running outranks a done unit with a newer updated", () => {
    const children = [
      makeSummary({ sessionID: "done", status: "done", created: 1, updated: 100 }),
      makeSummary({ sessionID: "run", status: "running", created: 2, updated: 5 }),
    ];
    const res = windowChildren(children);
    expect(res.visible.map((c) => c.sessionID)).toEqual(["run", "done"]);
  });

  test("breaks updated ties by created descending", () => {
    const children = [
      makeSummary({ sessionID: "older", status: "done", created: 1, updated: 7 }),
      makeSummary({ sessionID: "newer", status: "done", created: 2, updated: 7 }),
    ];
    const res = windowChildren(children);
    expect(res.visible.map((c) => c.sessionID)).toEqual(["newer", "older"]);
  });

  test("weight outranks recency inside the running group", () => {
    const children = [
      makeSummary({ sessionID: "rev", agent: "reviewer", status: "running", created: 1, updated: 1 }),
      makeSummary({ sessionID: "st0", agent: "steward", status: "running", created: 2, updated: 100 }),
      makeSummary({ sessionID: "st1", agent: "steward", status: "running", created: 3, updated: 101 }),
      makeSummary({ sessionID: "st2", agent: "steward", status: "running", created: 4, updated: 102 }),
      makeSummary({ sessionID: "st3", agent: "steward", status: "running", created: 5, updated: 103 }),
    ];
    const res = windowChildren(children);
    expect(res.visible.map((c) => c.sessionID)).toEqual(["rev", "st3", "st2", "st1"]);
    expect(res.visible[0].sessionID).toBe("rev");
    expect(res.hiddenRunning).toBe(1);
  });

  test("recency tie-breaks running units of equal weight", () => {
    const children = [
      makeSummary({ sessionID: "old", agent: "steward", status: "running", created: 1, updated: 5 }),
      makeSummary({ sessionID: "new", agent: "steward", status: "running", created: 2, updated: 10 }),
    ];
    const res = windowChildren(children);
    expect(res.visible.map((c) => c.sessionID)).toEqual(["new", "old"]);
  });

  test("unknown running kind ranks after a known kind but stays visible", () => {
    const children = [
      makeSummary({ sessionID: "gen", agent: "general", status: "running", created: 1, updated: 100 }),
      makeSummary({ sessionID: "stew", agent: "steward", status: "running", created: 2, updated: 5 }),
    ];
    const res = windowChildren(children);
    expect(res.visible.map((c) => c.sessionID)).toEqual(["stew", "gen"]);
    expect(res.visible.length).toBe(2);
  });

  test("with no running units the rest group keeps recency order", () => {
    const children = [
      makeSummary({ sessionID: "idle", status: "idle", created: 1, updated: 5 }),
      makeSummary({ sessionID: "done", status: "done", created: 2, updated: 20 }),
    ];
    const res = windowChildren(children);
    expect(res.visible.map((c) => c.sessionID)).toEqual(["done", "idle"]);
    expect(res.hiddenRunning).toBe(0);
  });
});

describe("voidKind precedence", () => {
  test("error beats every other state", () => {
    expect(
      voidKind({ ...baseState, error: "boom", hydrated: false, failedCount: 2 }),
    ).toBe("error");
    expect(voidKind({ ...baseState, error: "boom", children: [makeSummary()] })).toBe("error");
  });

  test("loading beats empty, partial and rows while unhydrated", () => {
    expect(voidKind({ ...baseState, hydrated: false })).toBe("loading");
    expect(
      voidKind({ ...baseState, hydrated: false, children: [makeSummary()], failedCount: 1 }),
    ).toBe("loading");
  });

  test("then empty, partial, rows in that order", () => {
    expect(voidKind(baseState)).toBe("empty");
    expect(voidKind({ ...baseState, children: [makeSummary()], failedCount: 1 })).toBe("partial");
    expect(voidKind({ ...baseState, children: [makeSummary()] })).toBe("rows");
  });
});

describe("subagentStatus", () => {
  test("maps outcome and live status, including interrupted", () => {
    expect(subagentStatus({ status: "running" })).toBe("running");
    expect(subagentStatus({ status: "idle" })).toBe("idle");
    expect(subagentStatus({ outcome: "succeeded", status: "idle" })).toBe("done");
    expect(subagentStatus({ outcome: "failed", status: "idle" })).toBe("error");
    expect(subagentStatus({ outcome: "interrupted", status: "idle" })).toBe("interrupted");
    expect(subagentStatus({ outcome: "failed", status: "running" })).toBe("running");
    expect(subagentStatus({ outcome: "succeeded", status: "running" })).toBe("running");
    expect(subagentStatus({ outcome: "interrupted", status: "running" })).toBe("running");
  });

  test("statusStyle colours interrupted with the warning token", () => {
    const p = palette(mockTheme);
    const style = statusStyle("interrupted", p);
    expect(style.label).toBe("interrupted");
    expect(style.fg).toBe(p.warning);
  });
});

describe("summaryLine", () => {
  test("keeps the running count when the cost tail is long", () => {
    const children = Array.from({ length: 5 }, (_, i) =>
      makeSummary({ sessionID: `s${i}`, status: i < 3 ? "running" : "idle", cost: 9_999_999 }),
    );
    const line = summaryLine({ ...baseState, children });
    expect(line).toContain("3 run");
    expect(line.length).toBeLessThanOrEqual(15);
  });
});

describe("syntax", () => {
  const dir = import.meta.dir;
  const sources = readdirSync(dir).filter(
    (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"),
  );

  test("every source transpiles", () => {
    for (const file of sources) {
      const loader = file.endsWith(".tsx") ? "tsx" : "ts";
      const code = readFileSync(join(dir, file), "utf8");
      expect(() => new Bun.Transpiler({ loader }).transformSync(code)).not.toThrow();
    }
  });
});
