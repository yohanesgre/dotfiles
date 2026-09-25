import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const PIDFILE_NAME = "opencode-depth.pid";
export const WATCHER_MARKER = "watcher.ts";

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.LUVUS_MODULE_STATE_DIR;
  if (explicit && explicit.trim().length > 0) return explicit;
  return join(homedir(), ".luvus", "modules", "state", "opencode.depth");
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Resolves the luvus binary. `LUVUS_BIN_PATH` can carry a ` (deleted)` suffix
 * when the running server's own binary was replaced (e.g. an upgrade); the
 * literal string then fails to exec, so strip it and verify the path exists.
 */
export function resolveLuvusBin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.LUVUS_BIN_PATH ?? "").replace(/\s*\(deleted\)\s*$/, "").trim();
  if (raw.length > 0 && existsSync(raw)) return raw;
  const home = env.HOME && env.HOME.length > 0 ? env.HOME : homedir();
  const local = join(home, ".local", "bin", "luvus");
  if (existsSync(local)) return local;
  return "luvus";
}

export function writeJsonAtomicSync(path: string, value: unknown): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value), "utf8");
  renameSync(tmp, path);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

/** `/proc/<pid>/cmdline` (Linux), falling back to `ps -o args=` elsewhere. */
export function readProcessCmdline(pid: number): string {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    const joined = raw.split("\0").join(" ").trim();
    if (joined.length > 0) return joined;
  } catch {
    // fall through to ps
  }
  try {
    const result = spawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 });
    return (result.stdout ?? "").trim();
  } catch {
    return "";
  }
}

/** True only for a live process whose command line names the watcher. */
export function isWatcherProcess(pid: number): boolean {
  if (!isProcessAlive(pid)) return false;
  return readProcessCmdline(pid).includes(WATCHER_MARKER);
}

/** Reads a process's inherited env (Linux) to prove which state dir owns it. */
export function readProcessEnv(pid: number): Record<string, string> {
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, "utf8");
    const env: Record<string, string> = {};
    for (const entry of raw.split("\0")) {
      const eq = entry.indexOf("=");
      if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
    return env;
  } catch {
    return {};
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface PidFileOptions {
  /** Test seam; defaults to the real `/proc` + `ps` identity check. */
  isWatcher?: (pid: number) => boolean;
}

export class PidFile {
  readonly path: string;
  private readonly isWatcher: (pid: number) => boolean;

  constructor(
    private readonly stateDir: string,
    options: PidFileOptions = {},
  ) {
    this.path = join(stateDir, PIDFILE_NAME);
    this.isWatcher = options.isWatcher ?? isWatcherProcess;
  }

  readPid(): number | null {
    if (!existsSync(this.path)) return null;
    const raw = readFileSync(this.path, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isNaN(pid) ? null : pid;
  }

  private heldBy(pid: number | null): boolean {
    return pid !== null && pid !== process.pid && this.isWatcher(pid);
  }

  isHeldByOther(): boolean {
    return this.heldBy(this.readPid());
  }

  /**
   * Atomic claim. The pidfile is published with `linkSync`, which creates the
   * name only if it does not exist and carries the pid in the same step, so
   * concurrent starters yield exactly one winner and no empty-file window.
   * A stale file (dead pid, or a live pid that is not the watcher) is removed
   * and reclaimed.
   */
  claim(): { claimed: true } | { claimed: false; holder: number } {
    ensureDir(this.stateDir);
    const existing = this.readPid();
    if (this.heldBy(existing)) return { claimed: false, holder: existing as number };

    const tmp = `${this.path}.claim.${process.pid}.${Date.now()}`;
    try {
      writeFileSync(tmp, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          linkSync(tmp, this.path);
          return { claimed: true };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const other = this.readPid();
          if (this.heldBy(other)) return { claimed: false, holder: other as number };
          try {
            unlinkSync(this.path);
          } catch {
            // another racer removed it first
          }
          sleepSync(5);
        }
      }
      const other = this.readPid();
      return other !== null && this.heldBy(other)
        ? { claimed: false, holder: other }
        : { claimed: false, holder: process.pid };
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        // already gone
      }
    }
  }

  /** Removes the file only when it still names this process. */
  removeIfOwned(): void {
    const pid = this.readPid();
    if (pid === process.pid || pid === null) {
      this.remove();
    }
  }

  /** Unconditional removal; callers decide when that is safe. */
  remove(): void {
    try {
      unlinkSync(this.path);
    } catch {
      // already gone
    }
  }
}

export class SeqStore {
  private readonly path: string;
  private counter: number;

  constructor(stateDir: string) {
    ensureDir(stateDir);
    this.path = join(stateDir, "opencode-depth.seq.json");
    this.counter = this.load();
  }

  private load(): number {
    if (!existsSync(this.path)) return 0;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as { sequence?: number };
      return typeof parsed.sequence === "number" && parsed.sequence >= 0 ? parsed.sequence : 0;
    } catch {
      return 0;
    }
  }

  current(): number {
    return this.counter;
  }

  next(): number {
    this.counter += 1;
    writeJsonAtomicSync(this.path, { sequence: this.counter });
    return this.counter;
  }
}
