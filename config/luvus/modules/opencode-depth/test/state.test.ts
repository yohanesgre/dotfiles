import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PidFile, isWatcherProcess } from "../src/state.ts";
import { runStartup, runStop } from "../src/startup.ts";

const STATE_SRC = fileURLToPath(new URL("../src/state.ts", import.meta.url));
const STOP_SH = fileURLToPath(new URL("../scripts/stop.sh", import.meta.url));

function stateDir(): string {
  return mkdtempSync(join(tmpdir(), "depth-state-"));
}

function fakeWatcher(): ReturnType<typeof Bun.spawn> {
  // argv[0] is replaced so /proc/<pid>/cmdline names the watcher.
  return Bun.spawn(["bash", "-c", "exec -a watcher.ts sleep 30"], { stdout: "ignore", stderr: "ignore" });
}

async function alive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("two concurrent claims yield exactly one winner", async () => {
  const dir = stateDir();
  const child = join(dir, "claim-child.ts");
  writeFileSync(
    child,
    `import { PidFile } from ${JSON.stringify(STATE_SRC)};\n` +
      `const pf = new PidFile(process.env.STATE_DIR, { isWatcher: () => true });\n` +
      `process.stdout.write(JSON.stringify(pf.claim()));\n`,
  );
  const spawn = () =>
    Bun.spawn([process.execPath, child], {
      env: { ...process.env, STATE_DIR: dir },
      stdout: "pipe",
      stderr: "ignore",
    });
  const procs = [spawn(), spawn()];
  const results = await Promise.all(
    procs.map(async (proc) => {
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      return JSON.parse(text) as { claimed: boolean };
    }),
  );
  expect(results.filter((result) => result.claimed)).toHaveLength(1);
  expect(results.filter((result) => !result.claimed)).toHaveLength(1);
});

test("a stale pidfile with a dead pid is reclaimable", () => {
  const dir = stateDir();
  writeFileSync(join(dir, "opencode-depth.pid"), "999999\n");
  expect(new PidFile(dir).claim().claimed).toBe(true);
});

test("a live pid that is not the watcher is reclaimed, never signalled", async () => {
  const dir = stateDir();
  const sleep = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
  writeFileSync(join(dir, "opencode-depth.pid"), `${sleep.pid}\n`);
  const claim = new PidFile(dir).claim();
  expect(claim.claimed).toBe(true);
  expect(await alive(sleep.pid as number)).toBe(true);
  sleep.kill();
});

test("isWatcherProcess matches only a process whose cmdline names the watcher", async () => {
  const watcher = fakeWatcher();
  const other = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
  expect(isWatcherProcess(watcher.pid as number)).toBe(true);
  expect(isWatcherProcess(other.pid as number)).toBe(false);
  watcher.kill();
  other.kill();
});

test("startup no-ops when a live watcher exists", async () => {
  const dir = stateDir();
  const watcher = fakeWatcher();
  writeFileSync(join(dir, "opencode-depth.pid"), `${watcher.pid}\n`);
  const proc = Bun.spawn([process.execPath, "run", fileURLToPath(new URL("../src/startup.ts", import.meta.url))], {
    env: { ...process.env, LUVUS_MODULE_STATE_DIR: dir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  expect(code).toBe(0);
  expect(stderr).toContain("already running");
  expect(readFileSync(join(dir, "opencode-depth.pid"), "utf8").trim()).toBe(String(watcher.pid));
  watcher.kill();
});

test("startup forwards settings and module env to the detached watcher", async () => {
  const dir = stateDir();
  let captured: NodeJS.ProcessEnv | undefined;
  const code = await runStartup({
    env: { HOME: process.env.HOME, PATH: process.env.PATH, LUVUS_MODULE_STATE_DIR: dir, LUVUS_SETTING_TTL_S: "123" },
    spawnImpl: (_command, _args, options) => {
      captured = options?.env as NodeJS.ProcessEnv;
      return { pid: 4242, unref: () => {} };
    },
  });
  expect(code).toBe(0);
  expect(captured?.LUVUS_SETTING_TTL_S).toBe("123");
  expect(captured?.LUVUS_MODULE_STATE_DIR).toBe(dir);
});

test("runStop kills a verified watcher and clears the pidfile", async () => {
  const dir = stateDir();
  const watcher = fakeWatcher();
  writeFileSync(join(dir, "opencode-depth.pid"), `${watcher.pid}\n`);
  expect(runStop({ env: { LUVUS_MODULE_STATE_DIR: dir } as NodeJS.ProcessEnv, listWatchers: () => [watcher.pid as number] })).toBe(0);
  await watcher.exited;
  expect(await alive(watcher.pid as number)).toBe(false);
  expect(existsSync(join(dir, "opencode-depth.pid"))).toBe(false);
});

test("stop.sh refuses a mismatched pid and clears the stale pidfile", async () => {
  const dir = stateDir();
  const sleep = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
  const pidfile = join(dir, "opencode-depth.pid");
  writeFileSync(pidfile, `${sleep.pid}\n`);
  const proc = Bun.spawn(["bash", STOP_SH], {
    env: { ...process.env, LUVUS_MODULE_STATE_DIR: dir },
    stdout: "pipe",
    stderr: "ignore",
  });
  const code = await proc.exited;
  expect(code).toBe(0);
  expect(await alive(sleep.pid as number)).toBe(true);
  expect(existsSync(pidfile)).toBe(false);
  sleep.kill();
});
