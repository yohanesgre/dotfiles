import { expect, test } from "bun:test";
import { mapPanesToSessions } from "../src/map.ts";
import type { LuvusPane, OpenCodeSession } from "../src/types.ts";

function pane(overrides: Partial<LuvusPane>): LuvusPane {
  return {
    pane_id: "1",
    agent: "opencode",
    agent_session: null,
    cwd: null,
    kind: "terminal",
    focused: false,
    root_process: { pid: 1, start_marker: "x" },
    agent_authority: null,
    agent_status: "idle",
    ...overrides,
  };
}

function session(overrides: Partial<OpenCodeSession> & { id: string }): OpenCodeSession {
  return { parentID: null, agent: "opencode", title: overrides.id, location: { directory: "/repo" }, ...overrides };
}

test("exact agent_session wins and the tree includes children by parentID", () => {
  const sessions = [
    session({ id: "ses_root", location: { directory: "/repo" } }),
    session({ id: "ses_child", parentID: "ses_root", location: { directory: "/repo" } }),
    session({ id: "ses_grand", parentID: "ses_child", location: { directory: "/repo" } }),
  ];
  const result = mapPanesToSessions([pane({ pane_id: "30", agent_session: "ses_root" })], sessions, new Set(["ses_root"]));
  expect(result.mapped).toHaveLength(1);
  expect(result.mapped[0]?.root.id).toBe("ses_root");
  expect(result.mapped[0]?.tree.map((s) => s.id)).toEqual(["ses_root", "ses_child", "ses_grand"]);
  expect(result.mapped[0]?.lane).toBe(false);
});

test("headless pane resolves through cwd, newest active drain first", () => {
  const sessions = [
    session({ id: "ses_old", location: { directory: "/lane" }, time: { updated: 1 } }),
    session({ id: "ses_new", location: { directory: "/lane" }, time: { updated: 2 } }),
  ];
  const result = mapPanesToSessions([pane({ pane_id: "38", cwd: "/lane" })], sessions, new Set(["ses_old", "ses_new"]));
  expect(result.mapped).toHaveLength(1);
  expect(result.mapped[0]?.root.id).toBe("ses_new");
  expect(result.mapped[0]?.lane).toBe(true);
});

test("duplicate cwd with no active drain is skipped, never guessed", () => {
  const sessions = [
    session({ id: "ses_a", location: { directory: "/dup" }, time: { updated: 1 } }),
    session({ id: "ses_b", location: { directory: "/dup" }, time: { updated: 2 } }),
  ];
  const result = mapPanesToSessions([pane({ pane_id: "4", cwd: "/dup" })], sessions, new Set());
  expect(result.mapped).toHaveLength(0);
  expect(result.skipped[0]?.reason).toContain("ambiguous cwd");
});

test("a session is never mapped to two panes", () => {
  const sessions = [session({ id: "ses_root", location: { directory: "/repo" } })];
  const result = mapPanesToSessions(
    [pane({ pane_id: "4", agent_session: "ses_root" }), pane({ pane_id: "30", agent_session: "ses_root" })],
    sessions,
    new Set(["ses_root"]),
  );
  expect(result.mapped).toHaveLength(1);
  expect(result.skipped.some((skip) => skip.reason.includes("already mapped"))).toBe(true);
});
