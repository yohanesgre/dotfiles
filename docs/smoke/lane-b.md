# Lane B — smoke artifact

Independent track. No file dependencies on lanes A or C.

## lane-wait.ts contract

`lane-wait.ts` waits for exactly one lane return file.

- Poll interval: 200 ms.
- Default timeout: 120000 ms.
- Exit codes:
  - `0` — return file seen.
  - `1` — timeout expired before the return file appeared.
  - `2` — bad argv.

## Purpose

Concurrent-wave dispatch smoke: three lanes run in parallel, each writing one
file. This file proves lane B completed.
