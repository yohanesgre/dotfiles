import { expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Log } from "../src/log.ts";
import { runWatcher } from "../src/watcher.ts";
import type { OpenCodeClient } from "../src/client.ts";
import type { ServiceDiscovery, ServiceState } from "../src/discover.ts";
import type { SnapshotReader } from "../src/snapshot.ts";
import type { Publisher, UiPublisher } from "../src/publish.ts";
import type { LuvusPane, OpenCodeSession } from "../src/types.ts";

const silent = new Log(() => {});

const sessions: OpenCodeSession[] = [{ id: "ses_root", parentID: null, agent: "opencode", title: "root", location: { directory: "/repo" } }];

const pane: LuvusPane = {
  pane_id: "30",
  agent: "opencode",
  agent_session: "ses_root",
  cwd: "/repo",
  kind: "terminal",
  focused: true,
  root_process: null,
  agent_authority: null,
  agent_status: "idle",
};

function idleStream(signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      signal.addEventListener("abort", () => controller.close(), { once: true });
    },
  });
}

/** An SSE stream that emits each payload as a `data:` frame after its delay. */
function sseStream(signal: AbortSignal, frames: Array<{ at: number; payload: unknown }>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const timers = frames.map((frame) =>
        setTimeout(() => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame.payload)}\n\n`)), frame.at),
      );
      signal.addEventListener(
        "abort",
        () => {
          for (const timer of timers) clearTimeout(timer);
          controller.close();
        },
        { once: true },
      );
    },
  });
}

function client(overrides: Partial<OpenCodeClient>): OpenCodeClient {
  const base = {
    listSessions: async () => sessions,
    activeSessions: async () => new Set<string>(),
    pendingPermissions: async () => [],
    listShells: async () => [],
    listShellsWithLocation: async () => ({ location: null, shells: [] }),
    openEventStream: async (signal: AbortSignal) => idleStream(signal),
    sessionPermissions: async () => [],
    replyPermission: async () => {},
    openSessionLog: async (signal: AbortSignal) => idleStream(signal),
  };
  return { ...base, ...overrides } as unknown as OpenCodeClient;
}

function harness() {
  const stateDir = mkdtempSync(join(tmpdir(), "depth-core-"));
  const reports: string[] = [];
  const states: string[] = [];
  const publisher = {
    reportWithRecovery: (paneId: string, state: string) => {
      reports.push(paneId);
      states.push(state);
      return "ok" as const;
    },
    release: () => true,
    releaseAll: () => {},
  } as unknown as Publisher;
  const ui = {
    pushDock: () => true,
    clearDock: () => true,
    pushBar: () => true,
    removeBar: () => true,
    pushTitles: () => true,
    clearTitles: () => true,
  } as unknown as UiPublisher;
  const snapshotReader = { read: async () => [pane] } as unknown as SnapshotReader;
  const env = { LUVUS_MODULE_STATE_DIR: stateDir, LUVUS_SETTING_BAR: "false", LUVUS_SETTING_TITLE: "false" } as NodeJS.ProcessEnv;
  return { reports, states, publisher, ui, snapshotReader, env, stateDir };
}

async function until(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("re-discovers after a client failure and reports on the new service", async () => {
  const { reports, publisher, ui, snapshotReader, env } = harness();
  const services: ServiceState[] = [
    { path: "", url: "http://svc1", password: "p1", version: "1" },
    { path: "", url: "http://svc2", password: "p2", version: "1" },
  ];
  let discoveries = 0;
  const discovery = {
    discover: async () => {
      discoveries += 1;
      return services[Math.min(discoveries - 1, services.length - 1)] as ServiceState;
    },
  } as unknown as ServiceDiscovery;
  const clients: Record<string, OpenCodeClient> = {
    "http://svc1": client({ listSessions: async () => Promise.reject(new Error("service down")) }),
    "http://svc2": client({}),
  };
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: (service) => clients[service.url] as OpenCodeClient,
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 20,
    signal: controller.signal,
  });
  await until(() => reports.length > 0);
  controller.abort();
  await done;
  expect(discoveries).toBeGreaterThanOrEqual(2);
  expect(reports).toContain("30");
});

test("an abort during an in-flight refresh prevents a late report", async () => {
  const { reports, publisher, ui, snapshotReader, env } = harness();
  const discovery = {
    discover: async () => ({ path: "", url: "http://svc", password: "p", version: "1" }) as ServiceState,
  } as unknown as ServiceDiscovery;
  const slow = client({
    listSessions: () => new Promise<OpenCodeSession[]>((resolve) => setTimeout(() => resolve(sessions), 200)),
  });
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: () => slow,
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 20,
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort();
  await done;
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(reports).toEqual([]);
});

test("an abort during discovery prevents client creation", async () => {
  const { reports, publisher, ui, snapshotReader, env } = harness();
  let factories = 0;
  const discovery = {
    discover: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { path: "", url: "http://svc", password: "p", version: "1" } as ServiceState;
    },
  } as unknown as ServiceDiscovery;
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: () => {
      factories += 1;
      return client({});
    },
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 20,
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  await done;
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(factories).toBe(0);
  expect(reports).toEqual([]);
});

test("refresh backfills a running shell and reports working", async () => {
  const { reports, states, publisher, ui, snapshotReader, env } = harness();
  const discovery = {
    discover: async () => ({ path: "", url: "http://svc", password: "p", version: "1" }) as ServiceState,
  } as unknown as ServiceDiscovery;
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: () => client({ listShells: async () => [{ id: "sh_1", status: "running", sessionID: "ses_root" }] }),
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 20,
    signal: controller.signal,
  });
  await until(() => reports.includes("30"));
  controller.abort();
  await done;
  expect(states).toContain("working");
});

test("a failing /api/shell keeps the tracked shells instead of degrading to idle", async () => {
  const { reports, states, publisher, ui, snapshotReader, env } = harness();
  const discovery = {
    discover: async () => ({ path: "", url: "http://svc", password: "p", version: "1" }) as ServiceState,
  } as unknown as ServiceDiscovery;
  let calls = 0;
  const flaky = client({
    listShells: async () => {
      calls += 1;
      if (calls === 1) return [{ id: "sh_1", status: "running", sessionID: "ses_root" }];
      throw new Error("shell endpoint down");
    },
  });
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: () => flaky,
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 20,
    signal: controller.signal,
  });
  await until(() => calls >= 3);
  controller.abort();
  await done;
  expect(states).toContain("working");
  expect(states).not.toContain("idle");
});

test("an SSE shell.exited landing during an in-flight listShells is not resurrected", async () => {
  const { states, publisher, ui, snapshotReader, env } = harness();
  const discovery = {
    discover: async () => ({ path: "", url: "http://svc", password: "p", version: "1" }) as ServiceState,
  } as unknown as ServiceDiscovery;
  let shellCalls = 0;
  const racing = client({
    // The first fetch is the one in flight when the SSE exit lands: 150 ms later
    // it still reports the shell as running (a stale snapshot). Later fetches are
    // accurate, so the test cannot pass merely via a later refresh.
    listShells: async () => {
      shellCalls += 1;
      if (shellCalls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return [{ id: "sh_1", status: "running", sessionID: "ses_root" }];
      }
      return [];
    },
    openEventStream: async (signal: AbortSignal) =>
      sseStream(signal, [
        { at: 20, payload: { type: "shell.created", data: { info: { id: "sh_1", status: "running", metadata: { sessionID: "ses_root" } } } } },
        { at: 40, payload: { type: "shell.exited", data: { id: "sh_1", exit: 0, status: "exited" } } },
      ]),
  });
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: () => racing,
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 60_000,
    signal: controller.signal,
  });
  await until(() => shellCalls >= 2, 2000);
  controller.abort();
  await done;
  expect(states).not.toContain("working");
});

test("refresh queries each known directory and merges its shells", async () => {
  const { reports, states, publisher, ui, env } = harness();
  const sessionsTwo: OpenCodeSession[] = [
    { id: "ses_a", parentID: null, location: { directory: "/alpha" } },
    { id: "ses_b", parentID: null, location: { directory: "/beta" } },
  ];
  const panes: LuvusPane[] = [
    { ...pane, pane_id: "30", agent_session: "ses_a", cwd: "/alpha" },
    { ...pane, pane_id: "31", agent_session: "ses_b", cwd: "/beta" },
  ];
  const snapshotReader = { read: async () => panes } as unknown as SnapshotReader;
  const discovery = {
    discover: async () => ({ path: "", url: "http://svc", password: "p", version: "1" }) as ServiceState,
  } as unknown as ServiceDiscovery;
  const seen: string[] = [];
  const multi = client({
    listSessions: async () => sessionsTwo,
    listShells: async (location?: { directory: string }) => {
      seen.push(location?.directory ?? "");
      if (location?.directory === "/alpha") return [{ id: "sh_a", status: "running", sessionID: "ses_a" }];
      if (location?.directory === "/beta") return [{ id: "sh_b", status: "running", sessionID: "ses_b" }];
      return [];
    },
  });
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: () => multi,
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 20,
    signal: controller.signal,
  });
  await until(() => reports.includes("30") && reports.includes("31") && states.filter((state) => state === "working").length >= 2);
  controller.abort();
  await done;
  expect(new Set(seen)).toEqual(new Set(["/alpha", "/beta"]));
});

test("a failing directory query preserves that directory's shells", async () => {
  const { states, publisher, ui, env } = harness();
  const sessionsOne: OpenCodeSession[] = [{ id: "ses_a", parentID: null, location: { directory: "/alpha" } }];
  const panes: LuvusPane[] = [{ ...pane, pane_id: "30", agent_session: "ses_a", cwd: "/alpha" }];
  const snapshotReader = { read: async () => panes } as unknown as SnapshotReader;
  const discovery = {
    discover: async () => ({ path: "", url: "http://svc", password: "p", version: "1" }) as ServiceState,
  } as unknown as ServiceDiscovery;
  const seen: string[] = [];
  const failing = client({
    listSessions: async () => sessionsOne,
    listShells: async (location?: { directory: string }) => {
      seen.push(location?.directory ?? "");
      throw new Error("alpha shell endpoint down");
    },
    openEventStream: async (signal: AbortSignal) =>
      sseStream(signal, [
        {
          at: 20,
          payload: { type: "shell.created", location: { directory: "/alpha" }, data: { info: { id: "sh_a", status: "running", metadata: { sessionID: "ses_a" } } } },
        },
      ]),
  });
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: () => failing,
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 30,
    signal: controller.signal,
  });
  await until(() => states.includes("working"), 2000);
  // Let several more refreshes run: every one fails for /alpha, so the shell
  // must survive and the pane must not fall back to idle.
  await new Promise((resolve) => setTimeout(resolve, 200));
  controller.abort();
  await done;
  expect(seen).toContain("/alpha");
  expect(states.slice(states.indexOf("working"))).toEqual(["working"]);
});

test("an unscoped fallback tags its shells with the envelope location so a later empty response drops them", async () => {
  const { states, publisher, ui, snapshotReader, env } = harness();
  const discovery = {
    discover: async () => ({ path: "", url: "http://svc", password: "p", version: "1" }) as ServiceState,
  } as unknown as ServiceDiscovery;
  // No session location and no `shell.created`: the reconcile set is empty, so
  // the unscoped endpoint is the fallback. It reports a location, so the shells
  // must be tagged with it; once `/repo` is tracked, the next refresh queries it
  // scoped and an empty result drops the shell (a missed exit self-heals).
  const noLocation: OpenCodeSession[] = [{ id: "ses_root", parentID: null }];
  const seen: string[] = [];
  const tagged = client({
    listSessions: async () => noLocation,
    listShells: async (location?: { directory: string }) => {
      seen.push(location?.directory ?? "");
      return location ? [] : [{ id: "sh_1", status: "running", sessionID: "ses_root" }];
    },
    listShellsWithLocation: async () => ({
      location: "/repo",
      shells: [{ id: "sh_1", status: "running", sessionID: "ses_root" }],
    }),
  });
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: () => tagged,
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 20,
    signal: controller.signal,
  });
  await until(() => states.includes("working"), 2000);
  // The tagged shell must not linger once the scoped fetch for `/repo` is empty.
  await until(() => states.includes("idle"), 2000);
  controller.abort();
  await done;
  expect(states).toContain("working");
  expect(states).toContain("idle");
  expect(states.indexOf("idle")).toBeGreaterThan(states.indexOf("working"));
  expect(seen).toContain("/repo");
});

test("an empty successful unscoped fallback does not wipe a directory-less shell", async () => {
  const { states, publisher, ui, snapshotReader, env } = harness();
  const discovery = {
    discover: async () => ({ path: "", url: "http://svc", password: "p", version: "1" }) as ServiceState,
  } as unknown as ServiceDiscovery;
  // No session location and no `shell.created` location: the reconcile set is
  // empty, so the unscoped endpoint is the fallback — and it returns no shells.
  const noLocation: OpenCodeSession[] = [{ id: "ses_root", parentID: null }];
  const directoryless = client({
    listSessions: async () => noLocation,
    listShells: async () => [],
    openEventStream: async (signal: AbortSignal) =>
      sseStream(signal, [
        { at: 10, payload: { type: "shell.created", data: { info: { id: "sh_1", status: "running", metadata: { sessionID: "ses_root" } } } } },
      ]),
  });
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: () => directoryless,
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 20,
    signal: controller.signal,
  });
  await until(() => states.includes("working"), 2000);
  // Let several more fallback refreshes run: the shell must survive all of them.
  await new Promise((resolve) => setTimeout(resolve, 200));
  controller.abort();
  await done;
  expect(states.slice(states.indexOf("working"))).toEqual(["working"]);
});

test("an event directory is still queried when session directories exceed the cap", async () => {
  const { publisher, ui, snapshotReader, env } = harness();
  const many: OpenCodeSession[] = Array.from({ length: 20 }, (_, index) => ({
    id: `ses_${index}`,
    parentID: null,
    location: { directory: `/sessions/${index}` },
  }));
  const discovery = {
    discover: async () => ({ path: "", url: "http://svc", password: "p", version: "1" }) as ServiceState,
  } as unknown as ServiceDiscovery;
  const seen: string[] = [];
  const capped = client({
    listSessions: async () => many,
    listShells: async (location?: { directory: string }) => {
      seen.push(location?.directory ?? "");
      return [];
    },
    openEventStream: async (signal: AbortSignal) =>
      sseStream(signal, [
        { at: 10, payload: { type: "shell.created", location: { directory: "/event/dir" }, data: { info: { id: "sh_e", status: "running", metadata: { sessionID: "ses_0" } } } } },
      ]),
  });
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: () => capped,
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 20,
    signal: controller.signal,
  });
  await until(() => seen.includes("/event/dir"), 2000);
  controller.abort();
  await done;
  expect(seen).toContain("/event/dir");
});

test("re-subscriptions do not accumulate abort listeners", async () => {
  const { publisher, ui, snapshotReader, env } = harness();
  const signals: AbortSignal[] = [];
  let generations = 0;
  const discovery = {
    discover: async () => {
      generations += 1;
      return { path: "", url: `http://svc${generations}`, password: "p", version: "1" } as ServiceState;
    },
  } as unknown as ServiceDiscovery;
  const controller = new AbortController();
  const done = runWatcher({
    discovery,
    clientFactory: () => client({ listSessions: async () => Promise.reject(new Error("down")) }),
    snapshotReader,
    publisher,
    ui,
    log: silent,
    env,
    pollMs: 5,
    signal: controller.signal,
    onAbortSignal: (signal) => signals.push(signal),
  });
  await until(() => generations >= 6, 3000);
  controller.abort();
  await done;
  expect(signals).toHaveLength(1);
  expect(getEventListeners(signals[0] as AbortSignal, "abort").length).toBeLessThanOrEqual(2);
});
