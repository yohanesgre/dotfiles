import { expect, test } from "bun:test";
import { WatcherCore, type Settings } from "../src/watcher.ts";
import type { LuvusPane, MappedPane, ShellInfo } from "../src/types.ts";

const settings: Settings = { source: "opencode/depth", ttlS: 900, maxRows: 16, bar: false, title: false };

const pane: LuvusPane = {
  pane_id: "30",
  agent: "opencode",
  agent_session: "ses_root",
  cwd: "/repo",
  kind: "terminal",
  focused: true,
  root_process: null,
  agent_authority: null,
  agent_status: null,
};

const created = (id: string, sessionID: string, directory = "/repo") => ({
  type: "shell.created",
  location: { directory },
  data: { info: { id, status: "running", metadata: { sessionID } } },
});

const exited = (id: string) => ({ type: "shell.exited", data: { id, exit: 0, status: "exited" } });

function core(): WatcherCore {
  const instance = new WatcherCore(settings, () => 1_000_000);
  instance.setSessions([{ id: "ses_root", parentID: null }]);
  instance.setPanes([pane]);
  instance.map();
  return instance;
}

function stateOf(instance: WatcherCore): string {
  return instance.stateFor(instance.mappedPanes[0] as MappedPane).state;
}

test("a live shell keeps a terminal session working until the shell exits", () => {
  const instance = core();
  instance.applyEvent({ type: "session.execution.succeeded", data: { sessionID: "ses_root" } });
  expect(stateOf(instance)).toBe("done");

  instance.applyEvent(created("sh_1", "ses_root"));
  expect(stateOf(instance)).toBe("working");

  instance.applyEvent(exited("sh_1"));
  expect(stateOf(instance)).toBe("done");
});

test("a duplicate shell.created is idempotent and one exit clears it", () => {
  const instance = core();
  instance.applyEvent(created("sh_1", "ses_root"));
  instance.applyEvent(created("sh_1", "ses_root"));
  expect(instance.signals().liveShells.get("ses_root")?.size).toBe(1);
  instance.applyEvent(exited("sh_1"));
  expect(instance.signals().liveShells.get("ses_root")).toBeUndefined();
});

test("an unknown shell.exited id is a no-op", () => {
  const instance = core();
  instance.applyEvent(created("sh_1", "ses_root"));
  instance.applyEvent(exited("sh_unknown"));
  expect(instance.signals().liveShells.get("ses_root")?.size).toBe(1);
});

test("shell.deleted is ignored (ids are stale)", () => {
  const instance = core();
  instance.applyEvent(created("sh_1", "ses_root"));
  instance.applyEvent({ type: "shell.deleted", data: { id: "sh_1" } });
  expect(instance.signals().liveShells.get("ses_root")?.size).toBe(1);
});

test("shell.created without a session or id is ignored", () => {
  const instance = core();
  instance.applyEvent({ type: "shell.created", data: { info: { id: "sh_1", status: "running", metadata: {} } } });
  instance.applyEvent({ type: "shell.created", data: { info: { status: "running", metadata: { sessionID: "ses_root" } } } });
  expect(instance.signals().liveShells.size).toBe(0);
});

test("reconcileShells keeps only running shells that carry a session id", () => {
  const instance = core();
  instance.applyEvent(created("sh_phantom", "ses_root"));
  const version = instance.shellVersion;
  instance.reconcileShells(
    [
      { id: "sh_a", status: "running", sessionID: "ses_root" },
      { id: "sh_b", status: "exited", sessionID: "ses_root" },
      { id: "sh_c", status: "timeout", sessionID: "ses_root" },
      { id: "sh_d", status: "killed", sessionID: "ses_root" },
      { id: "sh_e", status: "running" },
    ],
    version,
  );
  const shells = instance.signals().liveShells.get("ses_root");
  expect(shells ? [...shells] : []).toEqual(["sh_a"]);
});

test("reconcileShells drops a shell the exit event never removed", () => {
  const instance = core();
  instance.applyEvent(created("sh_1", "ses_root"));
  expect(stateOf(instance)).toBe("working");
  instance.reconcileShells([], instance.shellVersion);
  expect(stateOf(instance)).toBe("idle");
});

test("shell.exited on one session leaves another session's shells intact", () => {
  const instance = new WatcherCore(settings, () => 1_000_000);
  instance.applyEvent(created("sh_a", "ses_x"));
  instance.applyEvent(created("sh_b", "ses_y"));
  instance.applyEvent(exited("sh_a"));
  const shells = instance.signals().liveShells;
  expect([...(shells.get("ses_x") ?? [])]).toEqual([]);
  expect([...(shells.get("ses_y") ?? [])]).toEqual(["sh_b"]);
});

test("reconcileShells is a no-op when the shell version changed during the fetch", () => {
  const instance = core();
  const stale = instance.shellVersion;
  // A `shell.exited` landing mid-fetch bumps the version, so the stale snapshot
  // must not resurrect the exited shell.
  instance.applyEvent(created("sh_1", "ses_root"));
  instance.applyEvent(exited("sh_1"));
  instance.reconcileShells([{ id: "sh_1", status: "running", sessionID: "ses_root" }], stale);
  expect(instance.signals().liveShells.get("ses_root")).toBeUndefined();
});

test("shell.created records its location directory as a query source", () => {
  const instance = core();
  instance.applyEvent(created("sh_1", "ses_root", "/projects/alpha"));
  instance.applyEvent(created("sh_2", "ses_root", "/projects/beta"));
  instance.applyEvent({ type: "shell.created", data: { info: { id: "sh_3", status: "running", metadata: { sessionID: "ses_root" } } } });
  expect([...instance.shellEventDirectories].sort()).toEqual(["/projects/alpha", "/projects/beta"]);
});

test("reconcileShellsByDirectory merges running shells from several directories", () => {
  const instance = core();
  const version = instance.shellVersion;
  instance.reconcileShellsByDirectory(
    new Map<string, ShellInfo[]>([
      ["/projects/alpha", [{ id: "sh_a", status: "running", sessionID: "ses_a" }]],
      ["/projects/beta", [{ id: "sh_b", status: "running", sessionID: "ses_b" }]],
    ]),
    version,
  );
  const shells = instance.signals().liveShells;
  expect([...(shells.get("ses_a") ?? [])]).toEqual(["sh_a"]);
  expect([...(shells.get("ses_b") ?? [])]).toEqual(["sh_b"]);
});

test("a failed directory preserves its shells while another directory's exit drops its own", () => {
  const instance = core();
  instance.applyEvent(created("sh_a", "ses_a", "/projects/alpha"));
  instance.applyEvent(created("sh_b", "ses_b", "/projects/beta"));
  const version = instance.shellVersion;
  // alpha's fetch failed (null -> preserve), beta succeeded with no shells (drop).
  instance.reconcileShellsByDirectory(
    new Map<string, ShellInfo[] | null>([
      ["/projects/alpha", null],
      ["/projects/beta", []],
    ]),
    version,
  );
  const shells = instance.signals().liveShells;
  expect([...(shells.get("ses_a") ?? [])]).toEqual(["sh_a"]);
  expect(shells.get("ses_b")).toBeUndefined();
});

test("an empty successful directory drops only that directory's shells", () => {
  const instance = core();
  instance.applyEvent(created("sh_a", "ses_a", "/projects/alpha"));
  instance.applyEvent(created("sh_b", "ses_b", "/projects/beta"));
  const version = instance.shellVersion;
  instance.reconcileShellsByDirectory(
    new Map<string, ShellInfo[] | null>([
      ["/projects/alpha", []],
      ["/projects/beta", [{ id: "sh_b", status: "running", sessionID: "ses_b" }]],
    ]),
    version,
  );
  const shells = instance.signals().liveShells;
  expect(shells.get("ses_a")).toBeUndefined();
  expect([...(shells.get("ses_b") ?? [])]).toEqual(["sh_b"]);
});

test("reconcileShellsByDirectory is a no-op when the shell version changed during the fetch", () => {
  const instance = core();
  const stale = instance.shellVersion;
  instance.applyEvent(created("sh_1", "ses_root", "/projects/alpha"));
  instance.applyEvent(exited("sh_1"));
  instance.reconcileShellsByDirectory(new Map<string, ShellInfo[]>([["/projects/alpha", [{ id: "sh_1", status: "running", sessionID: "ses_root" }]]]), stale);
  expect(instance.signals().liveShells.get("ses_root")).toBeUndefined();
});
