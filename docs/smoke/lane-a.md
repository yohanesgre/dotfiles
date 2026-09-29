# Smoke lane A

Independent track. No edges to other lanes.

## Layout

`lane-layout.ts` builds the master+grid luvus layout once per wave. One build, reused by every lane in that wave; lanes never rebuild the layout themselves.

## Flags

`--max-per-tab` defaults to `6`. Lanes exceeding the per-tab cap spill into additional grid tabs.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | ok |
| 1 | error |
| 2 | usage |
