#!/usr/bin/env bun
/**
 * lane-wait.ts — reactive wait for a herdr lane's persisted return file.
 *
 *   bun ~/.agents/skills/goal/scripts/lane-wait.ts <return-file> [timeout-ms]
 *
 * A `/goal` lane pane is short-lived: opencode2 runs one-shot and the
 * runner closes the pane at DONE, so its scrollback is gone. Completion is
 * a durable artifact instead: the runner writes the lane report/output to
 * `<return-file>.tmp` and atomically renames it onto `<return-file>` as the
 * LAST step before closing its pane — so the file's appearance can only
 * mean real completion. This script waits for that file (bounded 200ms
 * poll + Effect timeout) and prints its contents on success.
 *
 * Exit 0 = return file appeared (+ elapsed, contents printed), 1 = timeout,
 * 2 = bad argv.
 */
import { Data, Effect } from "effect";
import { existsSync, readFileSync } from "node:fs";

export class InvalidArgs extends Data.TaggedError("InvalidArgs")<{ reason: string }> {}
export class LaneTimeout extends Data.TaggedError("LaneTimeout")<{
  file: string;
  timeoutMs: number;
}> {}

interface Args {
  file: string;
  timeoutMs: number;
}

const decodeArgs = (argv: Array<string>): Effect.Effect<Args, InvalidArgs> => {
  const file = argv[0];
  if (file === undefined || file === "") {
    return Effect.fail(new InvalidArgs({ reason: "usage: lane-wait.ts <return-file> [timeout-ms]" }));
  }
  const rawTimeout = argv[1] ?? "120000";
  const timeoutMs = Number.parseInt(rawTimeout, 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return Effect.fail(new InvalidArgs({ reason: `timeout-ms must be a positive integer, got ${rawTimeout}` }));
  }
  return Effect.succeed({ file, timeoutMs });
};

const awaitFile = (args: Args): Effect.Effect<void, LaneTimeout> =>
  Effect.gen(function* () {
    const deadline = Date.now() + args.timeoutMs;
    while (!existsSync(args.file)) {
      if (Date.now() >= deadline) {
        return yield* new LaneTimeout({ file: args.file, timeoutMs: args.timeoutMs });
      }
      yield* Effect.sleep("200 millis");
    }
  });

const program = Effect.gen(function* () {
  const args = yield* decodeArgs(Bun.argv.slice(2));
  const started = Date.now();
  yield* awaitFile(args);
  const elapsed = Date.now() - started;
  const body = readFileSync(args.file, "utf8");
  console.log(`lane-wait: return file seen in ${elapsed}ms`);
  console.log(body.slice(-4000));
});

Effect.runPromise(
  Effect.catchAll(program, (e: InvalidArgs | LaneTimeout) =>
    Effect.sync(() => {
      const detail =
        e._tag === "InvalidArgs" ? e.reason : `${e.file} not written within ${e.timeoutMs}ms`;
      console.error(`lane-wait: ${e._tag}: ${detail}`);
      return e._tag === "InvalidArgs" ? 2 : 1;
    }),
  ),
).then(
  (code) => process.exit(code),
  (defect) => {
    console.error(`lane-wait: Defect: ${String(defect)}`);
    process.exit(1);
  },
);
