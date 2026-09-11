#!/usr/bin/env bun
/**
 * lane-layout.ts — build a "master + grid" herdr layout for /goal lanes.
 *
 *   bun lane-layout.ts --anchor <orchestrator-pane> --lanes '<json>' \
 *       [--master-ratio 0.34] [--min-w 60] [--min-h 16] [--dry-run]
 *
 * Shape (design-graph, variant C):
 *   ┌─────────────┬───────────────────────────┐
 *   │             │ lane 1                    │
 *   │ ORCHESTRATOR├───────────────────────────┤
 *   │ (full height)│ lane 2                   │
 *   │             ├───────────────────────────┤
 *   │             │ lane 3                    │
 *   └─────────────┴───────────────────────────┘
 *
 * The anchor pane keeps a fixed left master column (full height); the lanes
 * tile a balanced grid in the remaining width. A tile needs at least
 * --min-w x --min-h cells; when N lanes exceed one tab's capacity the
 * remainder is placed on a second (and further) lane-only tab, never
 * squeezed. Every lane gets its own pane with cwd = that lane's worktree.
 *
 * `--lanes` is a JSON array: [{ "name": "feat-a", "cwd": "/abs/worktree" }].
 * Prints JSON: { anchor, master_pane, master_ratio, tabs: [{ tab_id, grid,
 * lanes: [{ name, pane_id, tab_id, cwd, col, row }] }], overflow }.
 *
 * herdr ratio semantics (verified): `split --ratio r` keeps the ORIGINAL
 * pane at r and gives the NEW pane 1-r, so equal columns come from
 * splitting the remaining area with ratio 1/remaining.
 */
type Lane = { name: string; cwd: string };
type Rect = { width: number; height: number; x: number; y: number };
type Args = {
  anchor: string;
  lanes: Array<Lane>;
  masterRatio: number;
  minW: number;
  minH: number;
  dryRun: boolean;
};

class UsageError extends Error {}

const parseArgs = (argv: Array<string>): Args => {
  const a: Partial<Args> = { masterRatio: 0.34, minW: 60, minH: 16, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--anchor") a.anchor = argv[++i];
    else if (k === "--lanes") a.lanes = JSON.parse(argv[++i] ?? "[]");
    else if (k === "--master-ratio") a.masterRatio = Number(argv[++i]);
    else if (k === "--min-w") a.minW = Number(argv[++i]);
    else if (k === "--min-h") a.minH = Number(argv[++i]);
    else if (k === "--dry-run") a.dryRun = true;
    else throw new UsageError(`unknown arg: ${k}`);
  }
  if (!a.anchor) throw new UsageError("--anchor <pane-id> is required");
  if (!Array.isArray(a.lanes) || a.lanes.length === 0) {
    throw new UsageError("--lanes '<json>' must be a non-empty array of {name,cwd}");
  }
  for (const l of a.lanes) {
    if (!l || typeof l.name !== "string" || typeof l.cwd !== "string") {
      throw new UsageError("each lane needs string name + cwd");
    }
  }
  return a as Args;
};

const herdr = (args: Array<string>): any => {
  const p = Bun.spawnSync(["herdr", ...args], { stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString();
  const err = p.stderr.toString();
  if (p.exitCode !== 0) {
    throw new Error(`herdr ${args.join(" ")} failed (${p.exitCode}): ${(err.trim() || out.trim()).slice(0, 300)}`);
  }
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`herdr ${args.join(" ")}: non-JSON output: ${out.slice(0, 200)}`);
  }
};

let fake = 0;
const makeSplit = (a: Args) => (pane: string, dir: "right" | "down", ratio: number, cwd: string): string => {
  if (a.dryRun) return `dry-pane-${++fake}`;
  const r = herdr(["pane", "split", "--pane", pane, "--direction", dir, "--ratio", String(ratio), "--no-focus", "--cwd", cwd]);
  return r.result.pane.pane_id as string;
};
const makeTab = (a: Args) => (cwd: string): { tab_id: string; pane_id: string } => {
  if (a.dryRun) return { tab_id: `dry-tab-${++fake}`, pane_id: `dry-pane-${++fake}` };
  const r = herdr(["tab", "create", "--no-focus", "--cwd", cwd]);
  return { tab_id: r.result.tab.tab_id as string, pane_id: r.result.root_pane.pane_id as string };
};

/** Pick columns/rows for n tiles in WxH, target tile aspect ~2 chars wide : 1 tall. */
const chooseGrid = (n: number, W: number, H: number, minW: number, minH: number): { C: number; R: number } => {
  const Cmax = Math.max(1, Math.floor(W / minW));
  const Rmax = Math.max(1, Math.floor(H / minH));
  let best: { C: number; R: number; score: number } | null = null;
  for (let C = 1; C <= Math.min(n, Cmax); C++) {
    const R = Math.ceil(n / C);
    if (R > Rmax) continue;
    const tw = W / C;
    const th = H / R;
    if (tw < minW || th < minH) continue;
    const score = Math.abs(tw / th - 2);
    if (!best || score < best.score) best = { C, R, score };
  }
  if (!best) {
    const C = Math.max(1, Math.min(n, Cmax));
    best = { C, R: Math.ceil(n / C) };
  }
  return { C: best.C, R: best.R };
};

/** Distribute n tiles across C columns; earlier columns get the spare row. */
const distribute = (n: number, C: number): Array<number> => {
  const base = Math.floor(n / C);
  const rem = n % C;
  const cols: Array<number> = [];
  for (let j = 0; j < C; j++) cols.push(base + (j < rem ? 1 : 0));
  return cols;
};

type Tile = { name: string; cwd: string; pane_id: string; tab_id: string; col: number; row: number };

const buildGrid = (
  a: Args,
  root: string,
  tab_id: string,
  ls: Array<Lane>,
  areaW: number,
  H: number,
): { tiles: Array<Tile>; grid: { rows: number; cols: number; cols_rows: Array<number> } } => {
  const n = ls.length;
  const { C } = chooseGrid(n, areaW, H, a.minW, a.minH);
  const cols = distribute(n, C);
  const colStart: Array<number> = [];
  let acc = 0;
  for (const c of cols) {
    colStart.push(acc);
    acc += c;
  }
  const tiles: Array<Tile | undefined> = new Array(n);

  // 1) split the area into C equal columns left -> right.
  const colPanes: Array<string> = new Array(C);
  let cur = root; // represents columns [j..C-1]
  for (let j = 0; j < C - 1; j++) {
    const m = C - j; // columns remaining including cur
    const nxt = makeSplit(a)(cur, "right", 1 / m, ls[colStart[j + 1]].cwd);
    colPanes[j] = cur;
    cur = nxt;
  }
  colPanes[C - 1] = cur;
  for (let j = 0; j < C; j++) {
    tiles[colStart[j]] = { name: ls[colStart[j]].name, cwd: ls[colStart[j]].cwd, pane_id: colPanes[j], tab_id, col: j, row: 0 };
  }

  // 2) split each column down into its rows.
  for (let j = 0; j < C; j++) {
    const rows = cols[j];
    let c = colPanes[j];
    for (let r = 1; r < rows; r++) {
      const m = rows - (r - 1); // rows remaining including c
      const idx = colStart[j] + r;
      const nxt = makeSplit(a)(c, "down", 1 / m, ls[idx].cwd);
      tiles[idx] = { name: ls[idx].name, cwd: ls[idx].cwd, pane_id: nxt, tab_id, col: j, row: r };
      c = nxt;
    }
  }
  const missing = tiles.findIndex((t) => t === undefined);
  if (missing !== -1) throw new Error(`layout hole at lane index ${missing}`);
  return { tiles: tiles as Array<Tile>, grid: { rows: Math.max(...cols), cols: C, cols_rows: cols } };
};

const main = (): void => {
  const a = parseArgs(Bun.argv.slice(2));
  const layout = herdr(["pane", "layout", "--pane", a.anchor]).result.layout;
  const anchorRect: Rect =
    (layout.panes as Array<{ pane_id: string; rect: Rect }>).find((p) => p.pane_id === a.anchor)?.rect ?? layout.area;
  const W = anchorRect.width;
  const H = anchorRect.height;

  // master column width (clamped so the lane area keeps at least one min tile)
  const wrMax = Math.max(1, W - a.minW);
  let Wm = Math.max(1, Math.min(Math.round(W * a.masterRatio), wrMax));
  let areaW = W - Wm;
  if (areaW < a.minW) {
    Wm = Math.max(1, W - a.minW);
    areaW = W - Wm;
  }

  // per-tab capacity; excess lanes go to extra lane-only tabs
  const Cmax = Math.max(1, Math.floor(areaW / a.minW));
  const Rmax = Math.max(1, Math.floor(H / a.minH));
  const capacity = Math.max(1, Cmax * Rmax);
  const chunks: Array<Array<Lane>> = [];
  for (let i = 0; i < a.lanes.length; i += capacity) chunks.push(a.lanes.slice(i, i + capacity));

  const tabs: Array<{ tab_id: string; grid: unknown; lanes: Array<Tile> }> = [];
  chunks.forEach((chunk, i) => {
    if (i === 0) {
      const gridRoot = makeSplit(a)(a.anchor, "right", Wm / W, chunk[0].cwd);
      const { tiles, grid } = buildGrid(a, gridRoot, layout.tab_id, chunk, areaW, H);
      tabs.push({ tab_id: layout.tab_id, grid, lanes: tiles });
    } else {
      const t = makeTab(a)(chunk[0].cwd);
      const { tiles, grid } = buildGrid(a, t.pane_id, t.tab_id, chunk, W, H);
      tabs.push({ tab_id: t.tab_id, grid, lanes: tiles });
    }
  });

  console.log(
    JSON.stringify(
      {
        anchor: a.anchor,
        master_pane: a.anchor,
        master_ratio: Wm / W,
        area: { width: W, height: H },
        overflow: chunks.length > 1,
        tabs,
      },
      null,
      2,
    ),
  );
};

try {
  main();
} catch (e) {
  const detail = e instanceof Error ? e.message : String(e);
  console.error(`lane-layout: ${e instanceof UsageError ? "UsageError" : "Error"}: ${detail}`);
  process.exit(e instanceof UsageError ? 2 : 1);
}
