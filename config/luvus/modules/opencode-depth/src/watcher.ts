import { basename } from "node:path";
import { Log } from "./log.ts";
import { OpenCodeClient } from "./client.ts";
import { SseReader } from "./client.ts";
import { ServiceDiscovery, type ServiceState } from "./discover.ts";
import { SnapshotReader, type CliRunner } from "./snapshot.ts";
import { buildIndex, mapPanesToSessions, subtree } from "./map.ts";
import { derivePaneSignals, deriveSessionState, worstState, type Signals } from "./derive.ts";
import { defaultRunner, Publisher, UiPublisher, type BarSegment, type DockRow, type ReportOutcome } from "./publish.ts";
import { SeqStore, PidFile, resolveStateDir, writeJsonAtomicSync } from "./state.ts";
import type { AgentState, LuvusPane, MapResult, MappedPane, OpenCodeEvent, OpenCodeSession, PendingPermission, ShellInfo } from "./types.ts";

export const DONE_WINDOW_MS = 120_000;
const DEBOUNCE_MS = 250;

export interface Settings {
  source: string;
  ttlS: number;
  maxRows: number;
  bar: boolean;
  title: boolean;
}

export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const num = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  };
  const bool = (value: string | undefined, fallback: boolean): boolean =>
    value === undefined ? fallback : value === "true" || value === "1";
  const source = env.LUVUS_SETTING_SOURCE;
  return {
    source: source && /^[A-Za-z][A-Za-z0-9._:/-]{0,63}$/.test(source) ? source : "opencode/depth",
    ttlS: Math.min(86400, Math.max(60, num(env.LUVUS_SETTING_TTL_S, 900))),
    maxRows: Math.min(64, Math.max(1, num(env.LUVUS_SETTING_MAX_ROWS, 16))),
    bar: bool(env.LUVUS_SETTING_BAR, true),
    title: bool(env.LUVUS_SETTING_TITLE, true),
  };
}

interface ReportState {
  status: AgentState;
  sessionId?: string;
  at: number;
}

interface ConflictState {
  until: number;
  attempts: number;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

/** Pure state + policy for the watcher; the live loop supplies I/O and timers. */
export class WatcherCore {
  private readonly sessions = new Map<string, OpenCodeSession>();
  private readonly activeIds = new Set<string>();
  private readonly execState = new Map<string, "working" | "terminal">();
  private readonly terminalAt = new Map<string, number>();
  /** sessionID -> live shell ids (a detached shell outlives its tool call). */
  private readonly liveShells = new Map<string, Set<string>>();
  /** shell id -> sessionID, so `shell.exited` (which carries no session) can be correlated. */
  private readonly shellOwner = new Map<string, string>();
  /** shell id -> its `location.directory`, so a directory-scoped refresh only touches that directory. */
  private readonly shellDirectory = new Map<string, string>();
  /** Directories seen on `shell.created` events; the union with session dirs is what `refresh` queries. */
  private readonly eventDirectories = new Set<string>();
  /**
   * Monotonic counter bumped by every shell add/remove. `refresh` captures it
   * before awaiting `listShells()`; a changed value means an SSE event landed
   * while the fetch was in flight, so the snapshot is stale and must not
   * clobber it (the next refresh backfills instead).
   */
  private shellVersionCounter = 0;
  private readonly permissionMap = new Map<string, PendingPermission>();
  private readonly reported = new Map<string, ReportState>();
  private readonly conflicts = new Map<string, ConflictState>();

  private panes: LuvusPane[] = [];
  private lastMap: MapResult = { mapped: [], skipped: [] };

  constructor(
    readonly settings: Settings,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get mappedPanes(): MappedPane[] {
    return this.lastMap.mapped;
  }

  get skippedPanes(): Array<{ paneId: string; reason: string }> {
    return this.lastMap.skipped;
  }

  get reportedPanes(): string[] {
    return [...this.reported.keys()];
  }

  applyEvent(event: OpenCodeEvent): void {
    const data = event.data ?? {};
    const sessionId = text(data.sessionID);
    switch (event.type) {
      case "session.created": {
        if (!sessionId) return;
        const session: OpenCodeSession = { id: sessionId };
        // The real payload carries no `parentID`; parent links come from the
        // session-list API. Absent is expected and leaves the root unflagged.
        const parent = text(data.parentID);
        session.parentID = parent.length > 0 ? parent : null;
        const agent = text(data.agent);
        if (agent) session.agent = agent;
        const title = text(data.title);
        if (title) session.title = title;
        if (typeof data.location === "object" && data.location !== null) {
          session.location = data.location as { directory?: string };
        }
        session.time = { created: event.created ?? this.now() };
        this.sessions.set(sessionId, session);
        return;
      }
      case "session.execution.started":
        if (sessionId) {
          this.execState.set(sessionId, "working");
          this.terminalAt.delete(sessionId);
        }
        return;
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        if (sessionId) {
          this.execState.set(sessionId, "terminal");
          this.terminalAt.set(sessionId, this.now());
        }
        return;
      case "permission.asked": {
        const permission = readPermission(data);
        if (permission) this.permissionMap.set(permission.id, permission);
        return;
      }
      case "permission.replied": {
        for (const key of permissionKeys(data)) this.permissionMap.delete(key);
        return;
      }
      case "shell.created": {
        const directory = text(event.location?.directory);
        if (directory) this.eventDirectories.add(directory);
        const shell = readShellCreated(data);
        if (shell) this.addShell(shell.sessionID, shell.id, directory.length > 0 ? directory : undefined);
        return;
      }
      case "shell.exited": {
        const shellId = text(data.id);
        if (shellId) this.removeShell(shellId);
        return;
      }
      // `shell.deleted` carries stale ids and is intentionally ignored.
      default:
        return;
    }
  }

  setSessions(sessions: OpenCodeSession[]): void {
    for (const session of sessions) {
      const existing = this.sessions.get(session.id);
      this.sessions.set(session.id, existing ? { ...existing, ...session } : session);
    }
  }

  setActive(active: Set<string>): void {
    this.activeIds.clear();
    for (const id of active) this.activeIds.add(id);
  }

  setPermissions(permissions: PendingPermission[]): void {
    this.permissionMap.clear();
    for (const permission of permissions) this.permissionMap.set(permission.id, permission);
  }

  private addShell(sessionID: string, shellID: string, directory?: string): void {
    let shells = this.liveShells.get(sessionID);
    if (!shells) {
      shells = new Set();
      this.liveShells.set(sessionID, shells);
    }
    shells.add(shellID);
    this.shellOwner.set(shellID, sessionID);
    if (directory !== undefined) this.shellDirectory.set(shellID, directory);
    this.shellVersionCounter += 1;
  }

  private removeShell(shellID: string): void {
    const sessionID = this.shellOwner.get(shellID);
    if (sessionID === undefined) return;
    const shells = this.liveShells.get(sessionID);
    if (shells) {
      shells.delete(shellID);
      if (shells.size === 0) this.liveShells.delete(sessionID);
    }
    this.shellOwner.delete(shellID);
    this.shellDirectory.delete(shellID);
    this.shellVersionCounter += 1;
  }

  /** Directories observed on `shell.created` events (in addition to session locations). */
  get shellEventDirectories(): ReadonlySet<string> {
    return this.eventDirectories;
  }

  /** Snapshot of the shell-state version; pass it to `reconcileShells`. */
  get shellVersion(): number {
    return this.shellVersionCounter;
  }

  /**
   * Replaces the shell map with `GET /api/shell`'s running set: backfills shells
   * created before attach/restart and drops phantoms left by a crash or a missed
   * `shell.exited`. Never call with a failed fetch — the caller keeps state.
   * `version` must be the counter captured *before* the fetch: if it changed, an
   * SSE event (e.g. `shell.exited`) arrived mid-flight and the snapshot is stale,
   * so this is a no-op and the next refresh backfills.
   */
  reconcileShells(shells: ShellInfo[], version: number): void {
    if (this.shellVersionCounter !== version) return;
    this.liveShells.clear();
    this.shellOwner.clear();
    this.shellDirectory.clear();
    for (const shell of shells) {
      if (shell.status !== "running") continue;
      const sessionID = shell.sessionID;
      if (!sessionID) continue;
      this.addShell(sessionID, shell.id);
    }
  }

  /**
   * Merges per-directory `GET /api/shell` results. A directory mapped to
   * `null` failed to fetch, so its tracked shells are preserved; a successful
   * result (including empty) replaces just that directory's shells. Directories
   * absent from `results` and shells with no known directory are untouched.
   * The `version` guard matches `reconcileShells`: a changed counter means an
   * SSE shell event landed mid-flight, so the whole merge is abandoned.
   */
  reconcileShellsByDirectory(results: ReadonlyMap<string, ShellInfo[] | null>, version: number): void {
    if (this.shellVersionCounter !== version) return;
    for (const [directory, shells] of results) {
      if (shells === null) continue;
      this.dropDirectory(directory);
      for (const shell of shells) {
        if (shell.status !== "running") continue;
        if (!shell.sessionID) continue;
        this.addShell(shell.sessionID, shell.id, directory);
      }
    }
  }

  private dropDirectory(directory: string): void {
    for (const [shellID, owner] of [...this.shellDirectory]) {
      if (owner === directory) this.removeShell(shellID);
    }
  }

  setPanes(panes: LuvusPane[]): void {
    this.panes = panes;
  }

  map(): MapResult {
    this.lastMap = mapPanesToSessions(this.panes, [...this.sessions.values()], this.activeIds);
    return this.lastMap;
  }

  signals(): Signals {
    return {
      active: this.activeIds,
      execState: this.execState,
      terminalAt: this.terminalAt,
      liveShells: this.liveShells,
      permissions: [...this.permissionMap.values()],
      now: this.now(),
      doneWindowMs: DONE_WINDOW_MS,
    };
  }

  stateFor(pane: MappedPane): { state: AgentState; message: string } {
    return derivePaneSignals(pane.tree, this.signals());
  }

  /** Panes that need a report now: status changed, first report, or TTL renewal. */
  planReports(now: number): Array<{ pane: MappedPane; state: AgentState; message: string }> {
    const renewMs = Math.max(5_000, Math.floor((this.settings.ttlS * 1000) / 3));
    const out: Array<{ pane: MappedPane; state: AgentState; message: string }> = [];
    for (const pane of this.lastMap.mapped) {
      const conflict = this.conflicts.get(pane.paneId);
      if (conflict && now < conflict.until) continue;
      const previous = this.reported.get(pane.paneId);
      const derived = this.stateFor(pane);
      const sessionChanged = previous !== undefined && previous.sessionId !== pane.root.id;
      const due = previous === undefined || now - previous.at >= renewMs;
      if (previous === undefined || previous.status !== derived.state || sessionChanged || due) {
        out.push({ pane, state: derived.state, message: derived.message });
      }
    }
    return out;
  }

  markReported(paneId: string, status: AgentState, sessionId: string | undefined, now: number): void {
    this.reported.set(paneId, { status, sessionId, at: now });
    this.conflicts.delete(paneId);
  }

  markReleased(paneId: string): void {
    this.reported.delete(paneId);
  }

  markConflict(paneId: string, now: number): void {
    const previous = this.conflicts.get(paneId);
    const attempts = (previous?.attempts ?? 0) + 1;
    const backoff = Math.min(300_000, 30_000 * attempts);
    this.conflicts.set(paneId, { until: now + backoff, attempts });
    this.reported.delete(paneId);
  }

  /** Panes we still lease but that are no longer mapped. */
  planReleases(): string[] {
    const mapped = new Set(this.lastMap.mapped.map((pane) => pane.paneId));
    return [...this.reported.keys()].filter((paneId) => !mapped.has(paneId));
  }

  /** Clears a conflict once the pane disappears or its authority is no longer
   * an integration report. The entry is deliberately kept while another
   * integration owns the pane, so `attempts` accumulates and the backoff grows
   * instead of resetting to the first step on every cycle. */
  clearResolvedConflicts(panes: LuvusPane[]): void {
    for (const paneId of [...this.conflicts.keys()]) {
      const pane = panes.find((candidate) => candidate.pane_id === paneId);
      if (!pane || pane.agent_authority !== "integration_report") this.conflicts.delete(paneId);
    }
  }

  /** Headless root lanes with no mapped pane, so they still show in the dock. */
  private unmappedRoots(now: number): OpenCodeSession[] {
    const index = buildIndex([...this.sessions.values()]);
    const used = new Set(this.lastMap.mapped.map((pane) => pane.root.id));
    return index.roots.filter((root) => {
      if (used.has(root.id)) return false;
      if (this.activeIds.has(root.id)) return true;
      const at = this.terminalAt.get(root.id);
      if (at !== undefined && now - at <= DONE_WINDOW_MS) return true;
      return false;
    });
  }

  private childrenOf(pane: MappedPane): OpenCodeSession[] {
    return pane.tree.filter((session) => session.id !== pane.root.id);
  }

  buildRows(now: number, degraded: boolean): DockRow[] {
    if (degraded) return [{ text: "opencode unreachable", tone: "error" }];
    const signals = this.signals();
    const ranked: Array<{ row: DockRow; rank: number; order: number }> = [];
    let order = 0;
    for (const pane of this.lastMap.mapped) {
      for (const child of this.childrenOf(pane)) {
        const derived = deriveSessionState(pane.tree, child, signals);
        ranked.push({
          row: {
            text: truncate(`${child.agent ?? "agent"} · ${child.title ?? child.id}`, 48),
            dot: derived.state,
            action: "focus-pane",
            value: pane.paneId,
          },
          rank: stateRank(derived.state),
          order: order++,
        });
      }
      if (pane.lane) {
        const derived = this.stateFor(pane);
        ranked.push({
          row: {
            text: truncate(`${basename(pane.root.location?.directory ?? pane.root.id)} · ${pane.root.title ?? pane.root.id}`, 48),
            dot: derived.state,
            action: "focus-pane",
            value: pane.paneId,
          },
          rank: stateRank(derived.state),
          order: order++,
        });
      }
    }
    for (const root of this.unmappedRoots(now)) {
      const derived = deriveSessionState(subtree(buildIndex([...this.sessions.values()]), root), root, signals);
      ranked.push({
        row: {
          text: truncate(`${basename(root.location?.directory ?? root.id)} · ${root.title ?? root.id}`, 48),
          dot: derived.state,
          tone: "muted",
        },
        rank: stateRank(derived.state),
        order: order++,
      });
    }
    ranked.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const rows = ranked.map((entry) => entry.row);
    if (rows.length === 0) return [{ text: "no active children", tone: "muted" }];
    if (rows.length > this.settings.maxRows) {
      const visible = rows.slice(0, this.settings.maxRows - 1);
      visible.push({ text: `… +${rows.length - (this.settings.maxRows - 1)}`, tone: "muted" });
      return visible;
    }
    return rows;
  }

  buildBar(now: number, degraded: boolean): BarSegment[] {
    if (degraded) return [{ type: "text", text: "OC !", tone: "error" }];
    const states: AgentState[] = this.lastMap.mapped.map((pane) => this.stateFor(pane).state);
    if (states.length === 0) return [];
    const blocked = states.filter((state) => state === "blocked").length;
    const done = states.filter((state) => state === "done").length;
    const segments: BarSegment[] = [
      { type: "text", text: "OpenCode" },
      { type: "state", state: worstState(states) },
      { type: "badge", text: `${done}/${states.length}` },
    ];
    if (blocked > 0) segments.push({ type: "badge", text: `${blocked} blocked` });
    return segments;
  }

  buildTitles(): Array<{ pane: string; title: string }> {
    const signals = this.signals();
    const titles: Array<{ pane: string; title: string }> = [];
    for (const pane of this.lastMap.mapped) {
      const children = this.childrenOf(pane);
      if (children.length === 0) continue;
      const blocked = children.filter((child) => deriveSessionState(pane.tree, child, signals).state === "blocked").length;
      titles.push({
        pane: pane.paneId,
        title: `${children.length} subagent${children.length === 1 ? "" : "s"}${blocked > 0 ? ` · ${blocked} blocked` : ""}`.slice(0, 256),
      });
    }
    return titles;
  }

  monitorState(connected: boolean, error: string | null): Record<string, unknown> {
    const now = this.now();
    const signals = this.signals();
    return {
      updatedAt: now,
      connected,
      error,
      skipped: this.lastMap.skipped,
      lanes: this.unmappedRoots(now).map((root) => {
        const state = deriveSessionState(subtree(buildIndex([...this.sessions.values()]), root), root, signals);
        return { id: root.id, agent: root.agent ?? null, title: root.title ?? null, directory: root.location?.directory ?? null, state: state.state };
      }),
      panes: this.lastMap.mapped.map((pane) => {
        const derived = this.stateFor(pane);
        return {
          paneId: pane.paneId,
          lane: pane.lane,
          root: pane.root.id,
          directory: pane.root.location?.directory ?? null,
          title: pane.root.title ?? null,
          state: derived.state,
          message: derived.message,
          reported: this.reported.has(pane.paneId),
          children: this.childrenOf(pane).map((child) => {
            const childState = deriveSessionState(pane.tree, child, signals);
            return { id: child.id, agent: child.agent ?? null, title: child.title ?? null, state: childState.state };
          }),
        };
      }),
    };
  }

  hasReported(paneId: string): boolean {
    return this.reported.has(paneId);
  }
}

function stateRank(state: AgentState): number {
  return state === "blocked" ? 3 : state === "working" ? 2 : state === "done" ? 1 : 0;
}

/** Upper bound on per-refresh shell queries; extra directories are preserved, not dropped. */
export const MAX_SHELL_DIRECTORIES = 16;

/**
 * The bounded, deduped set of directories whose shells matter this cycle: the
 * session list's locations plus directories seen on `shell.created` events
 * (a detached shell can outlive the session that is no longer listed).
 */
export function shellDirectories(
  sessions: OpenCodeSession[],
  eventDirectories: ReadonlySet<string>,
): string[] {
  const directories = new Set<string>();
  for (const session of sessions) {
    const directory = session.location?.directory;
    if (directory) directories.add(directory);
  }
  for (const directory of eventDirectories) directories.add(directory);
  return [...directories].slice(0, MAX_SHELL_DIRECTORIES);
}

/**
 * Queries `/api/shell` once per directory. A failed directory maps to `null`
 * (its tracked shells are preserved); a successful one maps to its shells
 * (empty means that directory has none).
 */
async function queryShellDirectories(
  client: OpenCodeClient,
  directories: string[],
  log: Log,
): Promise<Map<string, ShellInfo[] | null>> {
  const results = new Map<string, ShellInfo[] | null>();
  await Promise.all(
    directories.map(async (directory) => {
      try {
        results.set(directory, await client.listShells({ directory }));
      } catch (error) {
        log.warn(`GET /api/shell failed for ${directory}; keeping its shell state: ${String(error)}`);
        results.set(directory, null);
      }
    }),
  );
  return results;
}

/**
 * A cycle counts as a renewal only when no due report failed. `conflict` is
 * another integration's intentional backoff, not our failure.
 */
export function shouldAdvanceRenewal(outcomes: ReportOutcome[]): boolean {
  return outcomes.every((outcome) => outcome === "ok" || outcome === "conflict");
}

function readPermission(data: Record<string, unknown>): PendingPermission | null {
  const id = text(data.requestID) || text(data.id) || text(data.permissionID);
  const sessionID = text(data.sessionID) || text((data.session as Record<string, unknown> | undefined)?.id);
  if (!id || !sessionID) return null;
  const action = text(data.action) || text(data.tool) || text(data.name) || "unknown";
  const permission: PendingPermission = { id, sessionID, action };
  const message = text(data.message);
  if (message) permission.message = message;
  return permission;
}

function permissionKeys(data: Record<string, unknown>): string[] {
  return [text(data.requestID), text(data.id), text(data.permissionID)].filter((key) => key.length > 0);
}

/** `shell.created` nests the id and session under `data.info` / `data.info.metadata`. */
function readShellCreated(data: Record<string, unknown>): { id: string; sessionID: string } | null {
  const info = data.info;
  if (typeof info !== "object" || info === null) return null;
  const obj = info as Record<string, unknown>;
  const id = text(obj.id);
  const metadata = typeof obj.metadata === "object" && obj.metadata !== null ? (obj.metadata as Record<string, unknown>) : {};
  const sessionID = text(metadata.sessionID);
  if (!id || !sessionID) return null;
  return { id, sessionID };
}

export interface WatcherDeps {
  client?: OpenCodeClient;
  /** Builds a client for a discovered service; lets tests swap generations. */
  clientFactory?: (service: ServiceState) => OpenCodeClient;
  discovery?: ServiceDiscovery;
  snapshotReader?: SnapshotReader;
  publisher?: Publisher;
  ui?: UiPublisher;
  log?: Log;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  pollMs?: number;
  /** External abort, for tests. */
  signal?: AbortSignal;
  /** Test seam: receives the watcher's internal abort signal. */
  onAbortSignal?: (signal: AbortSignal) => void;
}

/** Long-lived watcher: discover -> snapshot -> map -> subscribe -> derive -> publish. */
export async function runWatcher(deps: WatcherDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const settings = readSettings(env);
  const stateDir = resolveStateDir(env);
  const log = deps.log ?? new Log();
  log.addSecret(env.LUVUS_MODULE_TOKEN);

  const pidFile = new PidFile(stateDir);
  const claim = pidFile.claim();
  if (!claim.claimed) {
    log.info(`another watcher is already running (pid ${claim.holder}); exiting`);
    return 0;
  }

  writeJsonAtomicSync(`${stateDir}/opencode-depth.settings.json`, settings);
  const seq = new SeqStore(stateDir);
  const publisher = deps.publisher ?? new Publisher({ source: settings.source, ttlS: settings.ttlS, seq, log });
  const ui = deps.ui ?? new UiPublisher(defaultRunner as CliRunner, log);
  const discovery = deps.discovery ?? new ServiceDiscovery();
  const snapshotReader =
    deps.snapshotReader ?? new SnapshotReader({ socketPath: env.LUVUS_SOCKET_PATH ?? undefined });
  const core = new WatcherCore(settings, now);
  const pollMs = deps.pollMs ?? 5000;

  const abort = new AbortController();
  if (deps.signal) {
    if (deps.signal.aborted) abort.abort();
    else deps.signal.addEventListener("abort", () => abort.abort(), { once: true });
  }
  let exitCode = 0;
  let activeClient: OpenCodeClient | null = deps.client ?? null;
  let clientGeneration = 0;
  let sseReader: SseReader | null = null;
  let sseAbort: AbortController | null = null;
  let sseGeneration = -1;
  let busy = false;
  let passScheduled = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  // One abort bridge for the watcher's lifetime. Each new SSE subscription
  // reuses it (via `sseAbort`) instead of registering its own listener, which
  // otherwise leaked one listener per client generation.
  abort.signal.addEventListener(
    "abort",
    () => {
      if (sseAbort) sseAbort.abort();
    },
    { once: true },
  );
  deps.onAbortSignal?.(abort.signal);

  let degraded = false;
  let degradedError: string | null = null;
  let lastRenewAt = now();

  const renewMs = Math.max(5_000, Math.floor((settings.ttlS * 1000) / 3));
  const watchdogMs = Math.max(30_000, Math.floor(settings.ttlS * 1000 * 0.6));
  const watchdog = setInterval(() => {
    if (now() - lastRenewAt > watchdogMs) {
      log.error(`watchdog: no renewal in ${Math.round((now() - lastRenewAt) / 1000)}s; exiting`);
      exitCode = 1;
      abort.abort();
    }
    const pid = pidFile.readPid();
    if (pid === null || pid !== process.pid) {
      log.warn("watchdog: pidfile no longer owned; exiting");
      exitCode = 1;
      abort.abort();
    }
  }, Math.max(5_000, Math.floor(renewMs / 2)));

  const clearUi = () => {
    ui.clearDock("depth");
    ui.removeBar("status");
    ui.clearTitles();
  };

  const shutdown = (signal: string) => {
    if (abort.signal.aborted) return;
    log.info(`received ${signal}; releasing leases and clearing module UI`);
    clearInterval(watchdog);
    if (pollTimer) clearInterval(pollTimer);
    publisher.releaseAll(core.reportedPanes);
    clearUi();
    pidFile.removeIfOwned();
    abort.abort();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  const writeMonitor = () => {
    writeJsonAtomicSync(`${stateDir}/opencode-depth.monitor.json`, core.monitorState(!degraded, degradedError));
  };

  const ensureSubscription = (client: OpenCodeClient): void => {
    if (sseReader && sseGeneration === clientGeneration) return;
    if (sseAbort) sseAbort.abort();
    const controller = new AbortController();
    sseAbort = controller;
    sseGeneration = clientGeneration;
    sseReader = new SseReader({
      open: (signal) => client.openEventStream(signal),
      onEvent: (event) => {
        core.applyEvent(event);
        schedulePass();
      },
      onReconnect: () => {
        degraded = false;
        schedulePass();
      },
      onError: (error) => log.warn(`sse error: ${String(error)}`),
    });
    void sseReader.run(controller.signal);
  };

  const dropClient = (): void => {
    activeClient = null;
    if (sseAbort) sseAbort.abort();
    sseAbort = null;
    sseReader = null;
    sseGeneration = -1;
  };

  const pass = async (): Promise<void> => {
    if (busy || abort.signal.aborted) return;
    busy = true;
    try {
      let client = activeClient;
      if (!client) {
        const service = await discovery.discover(abort.signal);
        if (!service || abort.signal.aborted) return;
        client = deps.clientFactory
          ? deps.clientFactory(service)
          : new OpenCodeClient({ url: service.url, password: service.password });
        log.addSecret(service.password);
        activeClient = client;
        clientGeneration += 1;
      }
      ensureSubscription(client);
      await refresh(client);
      degraded = false;
      degradedError = null;
    } catch (error) {
      degraded = true;
      degradedError = String(error);
      log.warn(`opencode unreachable: ${String(error)}`);
      // Drop the client + subscription so the next pass re-reads service.json:
      // the service may have restarted on a new port or password.
      dropClient();
      publishNow();
    } finally {
      busy = false;
      writeMonitor();
    }
  };

  const schedulePass = () => {
    if (passScheduled) return;
    passScheduled = true;
    setTimeout(() => {
      passScheduled = false;
      void pass();
    }, DEBOUNCE_MS);
  };

  const pollTimerInit = setInterval(() => {
    void pass();
  }, pollMs);
  pollTimer = pollTimerInit;

  async function refresh(client: OpenCodeClient): Promise<void> {
    if (abort.signal.aborted) return;
    activeClient = client;
    // Capture the shell version before awaiting: `shell.exited` can land while
    // `listShells()` is in flight, and its SSE update must not be clobbered by
    // the stale snapshot. A changed counter makes `reconcileShells` a no-op.
    const shellVersion = core.shellVersion;
    // Shell backfill is location-scoped, so query the union of directories that
    // matter this cycle. A per-directory failure must not degrade the watcher or
    // clear shells already tracked for that directory.
    const [sessions, active, permissions, panes] = await Promise.all([
      client.listSessions(),
      client.activeSessions(),
      client.pendingPermissions(),
      snapshotReader.read(),
    ]);
    if (abort.signal.aborted) return;
    const directories = shellDirectories(sessions, core.shellEventDirectories);
    // No known location yet: fall back to the unscoped endpoint (old behavior)
    // and only replace state when it succeeds.
    let fallbackShells: ShellInfo[] | null = null;
    let shellsByDirectory: Map<string, ShellInfo[] | null> | null = null;
    if (directories.length === 0) {
      try {
        fallbackShells = await client.listShells();
      } catch (error) {
        log.warn(`GET /api/shell failed; keeping current shell state: ${String(error)}`);
      }
    } else {
      shellsByDirectory = await queryShellDirectories(client, directories, log);
    }
    // A shutdown may have landed while these were in flight; never re-acquire a
    // lease that shutdown already released.
    if (abort.signal.aborted) return;
    core.setSessions(sessions);
    core.setActive(active);
    core.setPermissions(permissions);
    core.setPanes(panes);
    if (shellsByDirectory) core.reconcileShellsByDirectory(shellsByDirectory, shellVersion);
    else if (fallbackShells) core.reconcileShells(fallbackShells, shellVersion);
    core.map();
    core.clearResolvedConflicts(panes);
    publishNow();
  }

  function publishNow(): void {
    if (abort.signal.aborted) return;
    const timestamp = now();
    const outcomes: ReportOutcome[] = [];
    for (const plan of core.planReports(timestamp)) {
      const outcome = publisher.reportWithRecovery(plan.pane.paneId, plan.state, plan.message, plan.pane.root.id);
      outcomes.push(outcome);
      if (outcome === "ok") {
        core.markReported(plan.pane.paneId, plan.state, plan.pane.root.id, timestamp);
        log.info(
          `report pane ${plan.pane.paneId} ${plan.state}${plan.message ? ` (${plan.message})` : ""} session=${plan.pane.root.id}`,
        );
      } else if (outcome === "conflict") {
        core.markConflict(plan.pane.paneId, timestamp);
        log.warn(`authority_conflict on pane ${plan.pane.paneId}; backing off`);
      }
    }
    for (const paneId of core.planReleases()) {
      if (publisher.release(paneId)) core.markReleased(paneId);
    }
    const rows = core.buildRows(timestamp, degraded);
    ui.pushDock("depth", "OPENCODE", rows);
    if (settings.bar) {
      const bar = core.buildBar(timestamp, degraded);
      if (bar.length === 0) ui.removeBar("status");
      else ui.pushBar("status", "top-right", bar);
    }
    if (settings.title) {
      const titles = core.buildTitles();
      if (titles.length === 0) ui.clearTitles();
      else ui.pushTitles(titles);
    }
    // Only a cycle whose due reports all succeeded counts as a renewal. A
    // persistent report failure stalls this clock and the watchdog exits 1.
    if (shouldAdvanceRenewal(outcomes)) lastRenewAt = now();
  }

  await pass();
  writeMonitor();

  await new Promise<void>((resolve) => {
    if (abort.signal.aborted) resolve();
    else abort.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  clearInterval(watchdog);
  clearInterval(pollTimer);
  return exitCode;
}

if (import.meta.main) {
  runWatcher()
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`opencode.depth watcher failed: ${String(error)}\n`);
      process.exit(1);
    });
}

