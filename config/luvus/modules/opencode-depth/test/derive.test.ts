import { expect, test } from "bun:test";
import { derivePaneSignals, deriveSessionState, worstState } from "../src/derive.ts";
import type { Signals } from "../src/derive.ts";
import type { OpenCodeSession } from "../src/types.ts";

function signals(overrides: Partial<Signals> = {}): Signals {
  return {
    active: new Set<string>(),
    execState: new Map(),
    terminalAt: new Map(),
    liveShells: new Map(),
    permissions: [],
    now: 10_000,
    doneWindowMs: 120_000,
    ...overrides,
  };
}

const root: OpenCodeSession = { id: "ses_root", parentID: null, title: "root" };
const child: OpenCodeSession = { id: "ses_child", parentID: "ses_root", title: "child" };
const tree = [root, child];

test("a pending permission blocks the tree and names the request and action", () => {
  const result = derivePaneSignals(
    tree,
    signals({ permissions: [{ id: "per_123", sessionID: "ses_child", action: "bash" }] }),
  );
  expect(result.state).toBe("blocked");
  expect(result.message).toContain("per_123");
  expect(result.message).toContain("bash");
});

test("an active child makes the pane working", () => {
  expect(derivePaneSignals(tree, signals({ active: new Set(["ses_child"]) })).state).toBe("working");
});

test("a terminal execution event overrides a lingering active entry", () => {
  const result = derivePaneSignals(
    tree,
    signals({
      active: new Set(["ses_child"]),
      execState: new Map([["ses_child", "terminal"]]),
      terminalAt: new Map([["ses_child", 9_500]]),
    }),
  );
  expect(result.state).toBe("done");
});

test("a live shell keeps the tree working after the execution went terminal", () => {
  const result = derivePaneSignals(
    tree,
    signals({
      execState: new Map([["ses_child", "terminal"]]),
      terminalAt: new Map([["ses_child", 9_500]]),
      liveShells: new Map([["ses_child", new Set(["sh_1"])]]),
    }),
  );
  expect(result.state).toBe("working");
});

test("a live shell in another session does not affect this pane", () => {
  const result = derivePaneSignals(tree, signals({ liveShells: new Map([["ses_other", new Set(["sh_1"])]]) }));
  expect(result.state).toBe("idle");
});

test("a pane with no signals is idle", () => {
  expect(derivePaneSignals(tree, signals()).state).toBe("idle");
});

test("per-child derivation ignores a sibling's activity", () => {
  const result = deriveSessionState(tree, child, signals({ active: new Set(["ses_root"]) }));
  expect(result.state).toBe("idle");
});

test("worstState ranks blocked above working above done above idle", () => {
  expect(worstState(["idle", "done", "working", "blocked"])).toBe("blocked");
  expect(worstState(["idle", "done"])).toBe("done");
});
