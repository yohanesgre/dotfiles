#!/usr/bin/env bun
/**
 * wave-wait.ts — reactive join for a wave of luvus lanes' return files.
 *
 *   bun ~/.agents/skills/orchestration/scripts/wave-wait.ts [--any] [--timeout <ms>] <return-file>...
 *
 * A wave's lanes are dispatched as a batch (`luvus pane run` is non-blocking
 * — text + Enter), so the orchestrator waits on several durable return files
 * at once. Each file is written atomically by the canonical lane runner as
 * its LAST step (the runner also clears any prior run's file first, so a
 * present file always belongs to the current run); its `rc=` line carries
 * real completion (rc=0 ok, rc!=0 failed).
 *
 * Default: waits for EVERY file, then prints each in discovery order with
 * its `rc=` line and a body tail.
 * `--any`: returns as soon as at least one file appears — start that
 * lane's close-out early, then re-invoke with the remaining files.
 *
 * Exit 0 = all files seen (default) / >=1 file seen (--any), 1 = timeout
 * (missing files printed) or unreadable file, 2 = bad argv. A timeout is NOT
 * proof of a dead lane: check `luvus pane status <pane-id>` and re-wait.
 * Invoke with the shell timeout raised (timeout 0 or >= --timeout): the
 * default 600000 ms can exceed a harness's default foreground shell timeout.
 */
import { Data, Effect } from "effect";
import { existsSync, readFileSync } from "node:fs";

export class InvalidArgs extends Data.TaggedError("InvalidArgs")<{ reason: string }> {}
export class WaveTimeout extends Data.TaggedError("WaveTimeout")<{
  missing: Array<string>;
  timeoutMs: number;
}> {}
export class FileUnreadable extends Data.TaggedError("FileUnreadable")<{
  file: string;
  reason: string;
}> {}

interface Args {
  files: Array<string>;
  any: boolean;
  timeoutMs: number;
}

interface Seen {
  file: string;
  elapsedMs: number;
  rc: string;
  body: string;
}

/** `rc=<n>` is the runner's first line; `?` = file present but no rc line. */
const rcOf = (body: string): string => body.match(/^rc=(\S+)/m)?.[1] ?? "?";

const decodeArgs = (argv: Array<string>): Effect.Effect<Args, InvalidArgs> => {
  const files: Array<string> = [];
  let any = false;
  let timeoutMs = 600_000;
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--any") any = true;
    else if (k === "--timeout") {
      const raw = argv[++i] ?? "";
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        return Effect.fail(new InvalidArgs({ reason: `--timeout must be a positive integer, got ${raw === "" ? "(missing)" : raw}` }));
      }
      timeoutMs = n;
    } else if (k.startsWith("--")) {
      return Effect.fail(new InvalidArgs({ reason: `unknown flag: ${k}` }));
    } else if (k !== "") {
      files.push(k);
    }
  }
  const unique = [...new Set(files)];
  if (unique.length === 0) {
    return Effect.fail(new InvalidArgs({ reason: "usage: wave-wait.ts [--any] [--timeout <ms>] <return-file>..." }));
  }
  return Effect.succeed({ files: unique, any, timeoutMs });
};

const awaitFiles = (args: Args): Effect.Effect<Array<Seen>, WaveTimeout | FileUnreadable> =>
  Effect.gen(function* () {
    const started = Date.now();
    const deadline = started + args.timeoutMs;
    const seen = new Map<string, Seen>();
    const target = args.any ? 1 : args.files.length;
    while (seen.size < target) {
      for (const file of args.files) {
        if (seen.has(file) || !existsSync(file)) continue;
        let body: string;
        try {
          body = readFileSync(file, "utf8");
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code === "ENOENT") continue; // vanished between check and read; retry next pass
          return yield* new FileUnreadable({ file, reason: e instanceof Error ? e.message : String(e) });
        }
        seen.set(file, {
          file,
          elapsedMs: Date.now() - started,
          rc: rcOf(body),
          body: body.slice(-4000),
        });
      }
      if (seen.size >= target) break;
      if (Date.now() >= deadline) {
        return yield* new WaveTimeout({
          missing: args.files.filter((f) => !seen.has(f)),
          timeoutMs: args.timeoutMs,
        });
      }
      yield* Effect.sleep("200 millis");
    }
    return [...seen.values()];
  });

const program = Effect.gen(function* () {
  const args = yield* decodeArgs(Bun.argv.slice(2));
  const started = Date.now();
  const seen = yield* awaitFiles(args);
  for (const s of seen) {
    console.log(`wave-wait: ${s.file} seen in ${s.elapsedMs}ms rc=${s.rc}`);
    console.log(s.body);
  }
  const pending = args.files.filter((f) => !seen.some((s) => s.file === f));
  console.log(
    `wave-wait: ready ${seen.length}/${args.files.length} in ${Date.now() - started}ms` +
      (pending.length > 0 ? `; pending: ${pending.join(" ")}` : ""),
  );
});

Effect.runPromise(
  Effect.catchAll(program, (e: InvalidArgs | WaveTimeout | FileUnreadable) =>
    Effect.sync(() => {
      if (e._tag === "InvalidArgs") {
        console.error(`wave-wait: ${e._tag}: ${e.reason}`);
        return 2;
      }
      if (e._tag === "FileUnreadable") {
        console.error(`wave-wait: cannot read ${e.file}: ${e.reason}`);
        return 1;
      }
      console.error(
        `wave-wait: ${e._tag}: ${e.missing.length} file(s) not written within ${e.timeoutMs}ms: ${e.missing.join(" ")}`,
      );
      return 1;
    }),
  ),
).then(
  (code) => process.exit(code),
  (defect) => {
    console.error(`wave-wait: Defect: ${String(defect)}`);
    process.exit(1);
  },
);
