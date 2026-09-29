# Lane C — batch wave dispatch smoke

Independent lane. Owns only this file. No edges to other lanes.

## wave-wait.ts

Joins N return files in one wait: a single invocation watches every
`*.return` path given on argv instead of polling them one at a time.

`--any` returns as soon as the first file appears, even if the remaining
files have not landed yet.

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | all files present (or, with `--any`, at least one file present) |
| 1    | timeout — watched files did not appear within the deadline |
| 2    | bad argv — missing/invalid arguments |

## Gate

`test -s docs/smoke/lane-c.md && grep -q -- "lane-wait" docs/smoke/lane-c.md && grep -qi "exit" docs/smoke/lane-c.md`
