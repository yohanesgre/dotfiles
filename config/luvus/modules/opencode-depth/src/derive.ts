import type { AgentState, OpenCodeSession, PendingPermission } from "./types.ts";

export interface Signals {
  /** Sessions the OpenCode service reports as actively draining. */
  active: Set<string>;
  /** Last execution phase observed per session (SSE-driven, more precise than `active`). */
  execState: Map<string, "working" | "terminal">;
  /** When a terminal execution event was observed, ms epoch. */
  terminalAt: Map<string, number>;
  /** Live shell commands (`bash` tool) per session; a detached shell outlives its tool call. */
  liveShells: ReadonlyMap<string, ReadonlySet<string>>;
  permissions: PendingPermission[];
  now: number;
  doneWindowMs: number;
}

export interface Derived {
  state: AgentState;
  message: string;
}

const STATE_RANK: Record<AgentState, number> = { idle: 0, done: 1, working: 2, blocked: 3 };

export function worstState(states: AgentState[]): AgentState {
  let worst: AgentState = "idle";
  for (const state of states) if (STATE_RANK[state] > STATE_RANK[worst]) worst = state;
  return worst;
}

/** Sessions in `tree` rooted at `id` (inclusive). */
export function subtreeOf(tree: OpenCodeSession[], id: string): OpenCodeSession[] {
  const out: OpenCodeSession[] = [];
  const byParent = new Map<string, OpenCodeSession[]>();
  for (const session of tree) {
    if (!session.parentID) continue;
    const list = byParent.get(session.parentID) ?? [];
    list.push(session);
    byParent.set(session.parentID, list);
  }
  const start = tree.find((session) => session.id === id);
  if (!start) return out;
  const queue = [start];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift() as OpenCodeSession;
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    out.push(current);
    for (const child of byParent.get(current.id) ?? []) queue.push(child);
  }
  return out;
}

function isWorking(session: OpenCodeSession, signals: Signals): boolean {
  // A live shell can outlive the terminal execution event that spawned it, so it
  // wins over the terminal short-circuit below.
  if ((signals.liveShells.get(session.id)?.size ?? 0) > 0) return true;
  const exec = signals.execState.get(session.id);
  if (exec === "terminal") return false;
  if (exec === "working") return true;
  return signals.active.has(session.id);
}

function isRecentTerminal(session: OpenCodeSession, signals: Signals): boolean {
  const at = signals.terminalAt.get(session.id);
  if (at !== undefined && signals.now - at <= signals.doneWindowMs) return true;
  if (session.outcome && session.time?.updated !== undefined) {
    return signals.now - session.time.updated <= signals.doneWindowMs;
  }
  return false;
}

function shortSession(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-3)}` : id;
}

/** blocked > working > done > idle, evaluated over one scope of sessions. */
export function deriveStateFor(scope: OpenCodeSession[], signals: Signals): Derived {
  const ids = new Set(scope.map((session) => session.id));
  const permissions = signals.permissions.filter((permission) => ids.has(permission.sessionID));
  if (permissions.length > 0) {
    const first = permissions[0] as PendingPermission;
    return {
      state: "blocked",
      message: `${shortSession(first.sessionID)} ${first.id} · ${first.action}`,
    };
  }
  if (scope.some((session) => isWorking(session, signals))) {
    const active = scope.filter((session) => isWorking(session, signals));
    return { state: "working", message: `${active.length} active` };
  }
  if (scope.some((session) => isRecentTerminal(session, signals))) {
    return { state: "done", message: "recent" };
  }
  return { state: "idle", message: "" };
}

export function derivePaneSignals(tree: OpenCodeSession[], signals: Signals): Derived {
  return deriveStateFor(tree, signals);
}

export function deriveSessionState(tree: OpenCodeSession[], session: OpenCodeSession, signals: Signals): Derived {
  return deriveStateFor(subtreeOf(tree, session.id), signals);
}
