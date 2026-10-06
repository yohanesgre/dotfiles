#!/usr/bin/env bun
/**
 * lane-wait.ts — reactive wait for a luvus lane's persisted return file.
 *
 *   bun ~/.agents/skills/orchestration/scripts/lane-wait.ts <return-file> [timeout-ms]
 *
 * An orchestration lane runs foreground in its own pane (the user watches live
 * progress there) and the pane persists at DONE. Completion is still a
 * durable artifact, not scrollback: the runner writes the lane
 * report/output to `<return-file>.tmp` and atomically renames it onto
 * `<return-file>` as the LAST step — so the file's appearance means the
 * runner finished (its `rc=` line carries real completion: `rc=0` ok,
 * `rc!=0` failed). This script waits for that file (bounded 200ms
 * poll) and prints its contents on success.
 *
 * Exit 0 = return file appeared (+ elapsed, contents printed), 1 = timeout,
 * 2 = bad argv.
 */
import { existsSync, readFileSync } from "node:fs";

interface Args {
  file: string;
  timeoutMs: number;
}

class InvalidArgs extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

class LaneTimeout extends Error {
  constructor(
    public readonly file: string,
    public readonly timeoutMs: number,
  ) {
    super(`${file} not written within ${timeoutMs}ms`);
  }
}

const decodeArgs = (argv: Array<string>): Args => {
  const file = argv[0];
  if (file === undefined || file === "") {
    throw new InvalidArgs("usage: lane-wait.ts <return-file> [timeout-ms]");
  }
  const rawTimeout = argv[1] ?? "120000";
  const timeoutMs = Number.parseInt(rawTimeout, 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new InvalidArgs(`timeout-ms must be a positive integer, got ${rawTimeout}`);
  }
  return { file, timeoutMs };
};

/** Returns the body, or null if the file vanished between check and read. */
const readBody = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
};

const awaitFile = async (args: Args): Promise<string> => {
  const deadline = Date.now() + args.timeoutMs;
  for (;;) {
    if (existsSync(args.file)) {
      const body = readBody(args.file);
      if (body !== null) return body;
    }
    if (Date.now() >= deadline) {
      throw new LaneTimeout(args.file, args.timeoutMs);
    }
    await Bun.sleep(200);
  }
};

const main = async (): Promise<number> => {
  const args = decodeArgs(Bun.argv.slice(2));
  const started = Date.now();
  const body = await awaitFile(args);
  const elapsed = Date.now() - started;
  console.log(`lane-wait: return file seen in ${elapsed}ms`);
  console.log(body.slice(-4000));
  return 0;
};

main().then(
  (code) => process.exit(code),
  (e) => {
    if (e instanceof InvalidArgs) {
      console.error(`lane-wait: InvalidArgs: ${e.reason}`);
      process.exit(2);
    }
    if (e instanceof LaneTimeout) {
      console.error(`lane-wait: LaneTimeout: ${e.file} not written within ${e.timeoutMs}ms`);
      process.exit(1);
    }
    console.error(`lane-wait: Defect: ${String(e)}`);
    process.exit(1);
  },
);
