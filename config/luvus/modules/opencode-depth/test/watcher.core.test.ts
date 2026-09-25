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

function client(overrides: Partial<OpenCodeClient>): OpenCodeClient {
  const base = {
    listSessions: async () => sessions,
    activeSessions: async () => new Set<string>(),
    pendingPermissions: async () => [],
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
  const publisher = {
    reportWithRecovery: (paneId: string) => {
      reports.push(paneId);
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
  return { reports, publisher, ui, snapshotReader, env, stateDir };
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
