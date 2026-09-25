import type { LuvusPane, MapResult, MappedPane, OpenCodeSession } from "./types.ts";

export interface SessionIndex {
  byId: Map<string, OpenCodeSession>;
  childrenByParent: Map<string, OpenCodeSession[]>;
  rootOf: (session: OpenCodeSession) => OpenCodeSession;
  roots: OpenCodeSession[];
}

export function buildIndex(sessions: OpenCodeSession[]): SessionIndex {
  const byId = new Map<string, OpenCodeSession>();
  for (const session of sessions) byId.set(session.id, session);

  const rootOf = (session: OpenCodeSession): OpenCodeSession => {
    let current = session;
    const seen = new Set<string>([current.id]);
    while (current.parentID && byId.has(current.parentID) && !seen.has(current.parentID)) {
      current = byId.get(current.parentID) as OpenCodeSession;
      seen.add(current.id);
    }
    return current;
  };

  const childrenByParent = new Map<string, OpenCodeSession[]>();
  for (const session of sessions) {
    const parent = session.parentID && byId.has(session.parentID) ? session.parentID : null;
    if (!parent) continue;
    const list = childrenByParent.get(parent) ?? [];
    list.push(session);
    childrenByParent.set(parent, list);
  }

  const roots = sessions.filter((session) => rootOf(session).id === session.id);
  return { byId, childrenByParent, rootOf, roots };
}

/** All sessions in a root's tree, root first, breadth-first. */
export function subtree(index: SessionIndex, root: OpenCodeSession): OpenCodeSession[] {
  const out: OpenCodeSession[] = [root];
  const queue: OpenCodeSession[] = [root];
  const seen = new Set<string>([root.id]);
  while (queue.length > 0) {
    const current = queue.shift() as OpenCodeSession;
    for (const child of index.childrenByParent.get(current.id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

function paneOrder(a: LuvusPane, b: LuvusPane): number {
  const na = Number.parseInt(a.pane_id, 10);
  const nb = Number.parseInt(b.pane_id, 10);
  if (Number.isNaN(na) || Number.isNaN(nb)) return a.pane_id.localeCompare(b.pane_id);
  return na - nb;
}

function newest(candidates: OpenCodeSession[]): OpenCodeSession {
  return [...candidates].sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0))[0] as OpenCodeSession;
}

/**
 * Maps OpenCode panes to their root session. Exact `agent_session` wins; a
 * headless root pane is matched by `cwd` against root sessions, newest active
 * drain first. Ambiguity is skipped and reported, never guessed.
 */
export function mapPanesToSessions(
  panes: LuvusPane[],
  sessions: OpenCodeSession[],
  active: Set<string>,
): MapResult {
  const index = buildIndex(sessions);
  const mapped: MappedPane[] = [];
  const skipped: Array<{ paneId: string; reason: string }> = [];
  const used = new Set<string>();
  const ordered = [...panes].sort(paneOrder);

  const opencodePanes = ordered.filter((pane) => pane.agent === "opencode");

  // Pass 1: exact session identity.
  for (const pane of opencodePanes) {
    if (!pane.agent_session) continue;
    const session = index.byId.get(pane.agent_session);
    if (!session) {
      skipped.push({ paneId: pane.pane_id, reason: "agent_session not in session list" });
      continue;
    }
    const root = index.rootOf(session);
    if (used.has(root.id)) {
      skipped.push({ paneId: pane.pane_id, reason: "session already mapped to another pane" });
      continue;
    }
    used.add(root.id);
    mapped.push({ paneId: pane.pane_id, root, lane: false, tree: subtree(index, root) });
  }

  // Pass 2: headless roots discovered through cwd.
  for (const pane of opencodePanes) {
    if (pane.agent_session) continue;
    if (!pane.cwd) {
      skipped.push({ paneId: pane.pane_id, reason: "no agent_session and no cwd" });
      continue;
    }
    const candidates = index.roots.filter(
      (root) => !used.has(root.id) && root.location?.directory === pane.cwd,
    );
    if (candidates.length === 0) {
      skipped.push({ paneId: pane.pane_id, reason: "no root session for cwd" });
      continue;
    }
    const activeCandidates = candidates.filter((root) => active.has(root.id));
    const chosen = activeCandidates.length > 0 ? newest(activeCandidates) : candidates.length === 1 ? candidates[0] : undefined;
    if (!chosen) {
      skipped.push({ paneId: pane.pane_id, reason: `ambiguous cwd (${candidates.length} candidate sessions)` });
      continue;
    }
    used.add(chosen.id);
    mapped.push({ paneId: pane.pane_id, root: chosen, lane: true, tree: subtree(index, chosen) });
  }

  return { mapped, skipped };
}
