#!/usr/bin/env bun
/**
 * lane-layout.ts — build a "master + grid" luvus layout for orchestration lanes.
 *
 *   bun lane-layout.ts --anchor <orchestrator-pane> --lanes '<json>' \
 *       [--master-ratio 0.34] [--max-per-tab 6] [--dry-run]
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
 * The anchor pane keeps a fixed left master column (full height); lanes tile a
 * balanced grid in the remaining width. Lanes beyond --max-per-tab go to extra
 * lane-only tabs (no master column there).
 *
 * How it drives luvus:
 *   1. `luvus uhp snapshot` locates the anchor's workspace/tab (the CLI has no
 *      pane -> tab mapping); those are focused so every mutation lands in the
 *      orchestrator's own workspace;
 *   2. one `luvus pane split <base> --auto --no-focus` per lane creates the
 *      panes (luvus owns the intermediate geometry);
 *   3. `luvus pane run <id> "cd '<cwd>'"` parks each lane's shell in that lane's
 *      worktree (panes are addressed by the id from step 2 — luvus aliases only
 *      follow recognized agents, so no name is assigned to a plain shell);
 *   4. final geometry is applied in ONE atomic UHP `layout.apply` per tab with
 *      the exported tree shape {Split:{a,axis,b,ratio}} | {Leaf:<pane>}
 *      (axis 0 = side by side, axis 1 = stacked; ratio is the fraction `a`
 *      keeps). No CLI command sets ratios, hence `uhp proxy`.
 *
 * luvus exposes no pane geometry, so the grid is chosen from a nominal 160x48
 * terminal targeting ~2:1 tiles, and tab capacity is a lane count
 * (--max-per-tab), not a cell computation.
 *
 * `--lanes` is a JSON array: [{ "name": "feat-a", "cwd": "/abs/worktree" }].
 * Prints JSON: { anchor, master_ratio, tabs: [{ tab, grid, lanes: [{ name,
 * pane, cwd, col, row }] }], overflow }.
 */
type Lane = { name: string; cwd: string };
type Node = { Leaf: number } | { Split: { a: Node; axis: 0 | 1; b: Node; ratio: number } };
type Json = Record<string, unknown>;
type Args = {
  anchor: string;
  lanes: Array<Lane>;
  masterRatio: number;
  maxPerTab: number;
  dryRun: boolean;
};

class UsageError extends Error {}

// ── external JSON (luvus CLI / UHP) — narrow once, then consume typed values ──
const asObject = (v: unknown): Json => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : {});
const asArray = (v: unknown): Array<unknown> => (Array.isArray(v) ? v : []);
const asText = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

const parseArgs = (argv: Array<string>): Args => {
  const a: Partial<Args> = { masterRatio: 0.34, maxPerTab: 6, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--anchor") a.anchor = argv[++i];
    else if (k === "--lanes") {
      try {
        a.lanes = JSON.parse(argv[++i] ?? "[]");
      } catch {
        throw new UsageError("--lanes must be valid JSON");
      }
    }
    else if (k === "--master-ratio") a.masterRatio = Number(argv[++i]);
    else if (k === "--max-per-tab") a.maxPerTab = Number(argv[++i]);
    else if (k === "--dry-run") a.dryRun = true;
    else throw new UsageError(`unknown arg: ${k}`);
  }
  if (!a.anchor || !/^[0-9]+$/.test(a.anchor)) throw new UsageError("--anchor <pane-id> must be a numeric pane id");
  if (!Array.isArray(a.lanes) || a.lanes.length === 0) throw new UsageError("--lanes '<json>' with >=1 lane is required");
  if (!(a.masterRatio > 0 && a.masterRatio < 1)) throw new UsageError("--master-ratio must be between 0 and 1");
  if (!Number.isInteger(a.maxPerTab) || a.maxPerTab < 1) throw new UsageError("--max-per-tab must be a positive integer");
  const names = new Set<string>();
  for (const l of a.lanes) {
    if (typeof l?.name !== "string" || typeof l?.cwd !== "string") {
      throw new UsageError("each lane needs { name, cwd } strings");
    }
    if (names.has(l.name)) throw new UsageError(`duplicate lane name: ${l.name}`);
    names.add(l.name);
  }
  return a as Args;
};

const spawn = (argv: Array<string>, stdin?: string): { code: number; out: string; err: string } => {
  const p = Bun.spawnSync(argv, {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode ?? 1, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
};

const decode = (label: string, r: { code: number; out: string; err: string }): Json => {
  if (r.code !== 0) throw new Error(`${label} failed (${r.code}): ${r.err || r.out}`);
  if (r.out === "") return {};
  try {
    const parsed: unknown = JSON.parse(r.out);
    const obj = asObject(parsed);
    if (obj.error) throw new Error(`${label} rejected: ${JSON.stringify(obj.error)}`);
    return obj;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(label)) throw e;
    return { raw: r.out };
  }
};

/** One luvus CLI call; returns the parsed JSON envelope. */
const luvus = (args: Array<string>, dryRun = false): Json => {
  if (dryRun) return { result: {} };
  return decode(`luvus ${args.join(" ")}`, spawn(["luvus", ...args]));
};

/** One UHP method call through the bounded stdin bridge (requests are LF-framed). */
const uhp = (method: string, params: Json, dryRun = false): Json => {
  if (dryRun) return { result: {} };
  const body = `${JSON.stringify({ id: `lane-layout-${method}`, method, params })}\n`;
  const envelope = decode(`uhp ${method}`, spawn(["luvus", "uhp", "proxy"], body));
  return asObject(envelope.result);
};

/** Locate the anchor pane's workspace + tab (CLI exposes no pane -> tab map). */
const locateAnchor = (anchor: string): { workspaceName: string; workspaceCwd: string; tab: string } => {
  const snapshot = uhp("session.snapshot", {});
  for (const w of asArray(snapshot.workspaces)) {
    const ws = asObject(w);
    for (const t of asArray(ws.tabs)) {
      const tab = asObject(t);
      const hit = asArray(tab.panes).some((p) => asText(asObject(p).pane_id) === anchor);
      if (hit) {
        return {
          workspaceName: asText(ws.name),
          workspaceCwd: asText(ws.cwd),
          tab: asText(tab.index),
        };
      }
    }
  }
  throw new Error(`anchor pane ${anchor} not found in the session snapshot`);
};

/** Focus the anchor's workspace/tab so splits and `tab new` land there. */
const focusAnchorContext = (where: { workspaceName: string; workspaceCwd: string; tab: string }, dryRun: boolean): void => {
  const list = asObject(luvus(["workspace", "list"], dryRun).result);
  const match = asArray(list.workspaces).find((w) => {
    const ws = asObject(w);
    return asText(ws.name) === where.workspaceName && asText(ws.cwd) === where.workspaceCwd;
  });
  if (!match) {
    if (!dryRun) throw new Error(`anchor workspace not found in workspace list (${where.workspaceName} @ ${where.workspaceCwd})`);
  } else if (!asObject(match).active) {
    luvus(["workspace", "focus", asText(asObject(match).display_position)], dryRun);
  }
  luvus(["tab", "focus", where.tab], dryRun);
};

/** Pick columns/rows for n tiles in a nominal 160x48 area, target tile aspect ~2:1. */
const chooseGrid = (n: number, areaW: number, H: number): { C: number; R: number } => {
  let best: { C: number; R: number; score: number } | null = null;
  for (let C = 1; C <= n; C++) {
    const R = Math.ceil(n / C);
    const score = Math.abs(areaW / C / (H / R) - 2);
    if (!best || score < best.score) best = { C, R, score };
  }
  return { C: best!.C, R: best!.R };
};

/** Distribute n tiles across C columns; earlier columns get the spare row. */
const distribute = (n: number, C: number): Array<number> => {
  const base = Math.floor(n / C);
  const rem = n % C;
  const cols: Array<number> = [];
  for (let j = 0; j < C; j++) cols.push(base + (j < rem ? 1 : 0));
  return cols;
};

/** Right-nested equal split: node[0] keeps 1/m of the area, node[1..] share the rest. */
const chain = (nodes: Array<Node>, axis: 0 | 1): Node => {
  let acc = nodes[nodes.length - 1];
  for (let j = nodes.length - 2; j >= 0; j--) {
    acc = { Split: { a: nodes[j], axis, b: acc, ratio: 1 / (nodes.length - j) } };
  }
  return acc;
};

type Tile = { name: string; cwd: string; pane: string; col: number; row: number };

const buildTree = (tiles: Array<Tile>, cols: Array<number>): Node => {
  const columns: Array<Node> = [];
  let acc = 0;
  for (const count of cols) {
    const rows: Array<Node> = [];
    for (let r = 0; r < count; r++) rows.push({ Leaf: Number(tiles[acc + r].pane) });
    columns.push(rows.length === 1 ? rows[0] : chain(rows, 1));
    acc += count;
  }
  return columns.length === 1 ? columns[0] : chain(columns, 0);
};

const main = (): void => {
  const a = parseArgs(Bun.argv.slice(2));
  const chunks: Array<Array<Lane>> = [];
  for (let i = 0; i < a.lanes.length; i += a.maxPerTab) chunks.push(a.lanes.slice(i, i + a.maxPerTab));

  const where = a.dryRun ? { workspaceName: "", workspaceCwd: "", tab: "1" } : locateAnchor(a.anchor);
  focusAnchorContext(where, a.dryRun);

  const tabs: Array<{ tab: string; grid: { cols: number; cols_rows: Array<number> }; lanes: Array<Tile> }> = [];

  chunks.forEach((chunk, ci) => {
    // chunk 0 grows around the orchestrator pane; later chunks get a fresh tab
    let base = a.anchor;
    let tab = where.tab;
    if (ci > 0) {
      tab = asText(asObject(luvus(["tab", "new"], a.dryRun).result).tab);
      const panes = asArray(asObject(luvus(["pane", "list"], a.dryRun).result).panes);
      if (!a.dryRun && panes.length !== 1) {
        throw new Error(`new tab ${tab} should hold exactly 1 pane, saw ${panes.length}`);
      }
      base = asText(asObject(panes[0]).pane);
    }

    const tiles: Array<Tile> = [];
    // an overflow tab's root pane is itself a lane (no master column there), so it
    // is reused instead of split — layout.apply requires every tab pane exactly once
    let reusable = ci > 0 ? base : "";
    for (const lane of chunk) {
      const pane =
        reusable !== ""
          ? reusable
          : asText(asObject(luvus(["pane", "split", base, "--auto", "--no-focus"], a.dryRun).result).pane);
      reusable = "";
      if (!a.dryRun && pane === "") throw new Error(`pane split returned no pane for lane ${lane.name}`);
      const id = pane === "" ? "0" : pane;
      luvus(["pane", "run", id, `cd '${lane.cwd.replaceAll("'", `'\\''`)}'`], a.dryRun);
      tiles.push({ name: lane.name, cwd: lane.cwd, pane: id, col: 0, row: 0 });
    }

    const laneAreaW = ci === 0 ? Math.round(160 * (1 - a.masterRatio)) : 160;
    const { C } = chooseGrid(tiles.length, laneAreaW, 48);
    const cols = distribute(tiles.length, C);
    let acc = 0;
    cols.forEach((count, j) => {
      for (let r = 0; r < count; r++) {
        tiles[acc + r].col = j;
        tiles[acc + r].row = r;
      }
      acc += count;
    });

    const grid = buildTree(tiles, cols);
    const tree: Node =
      ci === 0 ? { Split: { a: { Leaf: Number(a.anchor) }, axis: 0, b: grid, ratio: a.masterRatio } } : grid;
    uhp("layout.apply", { tab, tree }, a.dryRun);

    tabs.push({ tab, grid: { cols: C, cols_rows: cols }, lanes: tiles });
  });

  console.log(
    JSON.stringify(
      { anchor: a.anchor, master_ratio: a.masterRatio, tabs, overflow: chunks.length > 1, dry_run: a.dryRun },
      null,
      2,
    ),
  );
};

try {
  main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`lane-layout: ${e instanceof UsageError ? "usage" : "error"}: ${msg}`);
  process.exit(e instanceof UsageError ? 2 : 1);
}
