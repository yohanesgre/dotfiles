import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Log } from "./log.ts";
import {
  PidFile,
  WATCHER_MARKER,
  ensureDir,
  isWatcherProcess,
  readProcessEnv,
  resolveStateDir,
} from "./state.ts";

export function watcherEntrypoint(): string {
  return fileURLToPath(new URL("./watcher.ts", import.meta.url));
}

export interface StartupDeps {
  env?: NodeJS.ProcessEnv;
  entrypoint?: string;
  spawnImpl?: (command: string, args: string[], options: Parameters<typeof spawn>[2]) => Pick<ChildProcess, "pid" | "unref">;
}

/** Env the watcher reads; forwarded explicitly so a manual launch honours settings. */
function watcherEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const forwarded: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.startsWith("LUVUS_") || key.startsWith("OPENCODE_") || key === "HOME" || key === "PATH") forwarded[key] = value;
  }
  return forwarded;
}

/**
 * One-shot launcher referenced by `[[startup]]` and the pane event hooks.
 * Starts a single detached watcher and exits immediately. Identity-aware: if a
 * live watcher is already running it does nothing.
 */
export async function runStartup(deps: StartupDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const stateDir = resolveStateDir(env);
  const log = new Log((line) => process.stderr.write(line + "\n"));
  log.addSecret(env.LUVUS_MODULE_TOKEN);

  const pidFile = new PidFile(stateDir);
  if (pidFile.isHeldByOther()) {
    log.info(`watcher already running (pid ${pidFile.readPid()}); not starting another`);
    return 0;
  }

  ensureDir(stateDir);
  const logFd = openSync(join(stateDir, "opencode-depth.watcher.log"), "a");
  const entrypoint = deps.entrypoint ?? watcherEntrypoint();
  const spawnImpl = deps.spawnImpl ?? spawn;
  const child = spawnImpl(process.execPath, [entrypoint], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: watcherEnv(env),
  });
  child.unref();
  log.info(`watcher started (pid ${child.pid ?? "unknown"})`);
  return 0;
}

/** Bounded list of live processes whose command line names the watcher. */
export function listWatcherPids(): number[] {
  const out = new Set<number>();
  const pgrep = spawnSync("pgrep", ["-f", WATCHER_MARKER], { encoding: "utf8", timeout: 2000 });
  for (const line of (pgrep.stdout ?? "").split("\n")) {
    const pid = Number.parseInt(line.trim(), 10);
    if (Number.isInteger(pid) && pid > 0) out.add(pid);
  }
  if (out.size === 0) {
    const ps = spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8", timeout: 2000 });
    for (const line of (ps.stdout ?? "").split("\n")) {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (match && match[2]?.includes(WATCHER_MARKER)) out.add(Number.parseInt(match[1] as string, 10));
    }
  }
  return [...out].slice(0, 32);
}

function ownedByStateDir(pid: number, stateDir: string): boolean {
  return readProcessEnv(pid).LUVUS_MODULE_STATE_DIR === stateDir;
}

/**
 * Stops every verified watcher that belongs to this state dir: the pidfile pid
 * (when its cmdline names the watcher) plus a bounded scan of strays whose
 * inherited env points at the same state dir. Never signals a recycled pid.
 */
export function runStop(deps: { env?: NodeJS.ProcessEnv; listWatchers?: () => number[] } = {}): number {
  const env = deps.env ?? process.env;
  const stateDir = resolveStateDir(env);
  const pidFile = new PidFile(stateDir);
  const log = new Log((line) => process.stderr.write(line + "\n"));
  const killed = new Set<number>();

  const candidates = new Set<number>(deps.listWatchers ? deps.listWatchers() : listWatcherPids());
  const fromPidFile = pidFile.readPid();
  if (fromPidFile !== null) candidates.add(fromPidFile);

  for (const pid of candidates) {
    if (pid === process.pid) continue;
    if (!isWatcherProcess(pid)) continue;
    if (pid !== fromPidFile && !ownedByStateDir(pid, stateDir)) continue;
    try {
      process.kill(pid, "SIGTERM");
      killed.add(pid);
      log.info(`sent SIGTERM to watcher pid ${pid}`);
    } catch {
      log.warn(`could not signal watcher pid ${pid}`);
    }
  }

  const remaining = pidFile.readPid();
  if (remaining === null || killed.has(remaining) || !isWatcherProcess(remaining)) pidFile.remove();
  return 0;
}

if (import.meta.main) {
  const command = process.argv[2];
  const run = command === "stop" ? Promise.resolve(runStop()) : runStartup();
  run
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`opencode.depth ${command === "stop" ? "stop" : "startup"} failed: ${String(error)}\n`);
      process.exit(1);
    });
}
