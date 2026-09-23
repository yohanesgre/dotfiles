import { createStore } from "solid-js/store";
import { onCleanup } from "solid-js";
import {
  type SubagentSummary,
  type SubagentsState,
  type UseSubagents,
  summarizeSession,
} from "./types";

interface SessionInfo {
  id: string;
  parentID?: string;
  time?: { created: number };
}

interface Data {
  listen: (handler: (event: { details: { type: string; data?: any } }) => void) => () => void;
  session: {
    list(): SessionInfo[];
    get(sessionID: string): SessionInfo | undefined;
    status(sessionID: string): "idle" | "running";
    sync(sessionID: string): Promise<void>;
  };
}

// Descendant discovery prefers the generated HTTP client, but the TUI
// `data.session` layer (SSE-cached, empty after a service restart) is the only
// verified surface: REDESIGN.md records that `client.v2` and
// `client.session.children` do NOT exist on 2.0.2. The client sources are
// probed in order (`v2.session.list`, then the V1 shim `session.children`);
// when none exists, or every probe rejects, the whole-list
// `data.session.list()` adjacency is used instead.
interface Client {
  v2?: {
    session?: {
      list?: (input: { parentID: string }) => Promise<unknown>;
    };
  };
  session?: {
    children?: (input: { sessionID: string }) => Promise<unknown>;
  };
}

const REFRESH_EVENTS = new Set([
  "session.status",
  "session.usage.updated",
  "session.tool.called",
  "session.tool.success",
  "session.tool.failed",
  "session.step.started",
  "session.step.ended",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
]);

const POLL_MS = 2000;

interface Descendant {
  id: string;
  depth: number;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Sibling groups sort running-first, then created. Running status comes from
// the TUI cache; a not-yet-cached id reads as not running (never throws).
function runningIn(data: Data, id: string): boolean {
  try {
    return data.session.status(id) === "running";
  } catch {
    return false;
  }
}

function sortSiblings(siblings: SessionInfo[], data: Data): void {
  siblings.sort((a, b) => {
    const ar = runningIn(data, a.id) ? 0 : 1;
    const br = runningIn(data, b.id) ? 0 : 1;
    if (ar !== br) return ar - br;
    const ac = a.time?.created;
    const bc = b.time?.created;
    if (ac === undefined || bc === undefined) return 0;
    return ac - bc;
  });
}

// DFS pre-order over session.list() adjacency; root's children are depth 1.
// Visited set guards against cycles and self-parents. Fallback path only.
function descendantsFromList(
  data: Data,
  sessionID: string,
  list: SessionInfo[] = data.session.list(),
): Descendant[] {
  const byParent = new Map<string, SessionInfo[]>();
  for (const s of list) {
    if (!s.parentID) continue;
    const siblings = byParent.get(s.parentID);
    if (siblings) siblings.push(s);
    else byParent.set(s.parentID, [s]);
  }
  for (const siblings of byParent.values()) sortSiblings(siblings, data);
  const out: Descendant[] = [];
  const visited = new Set<string>([sessionID]);
  const walk = (parent: string, depth: number): void => {
    for (const child of byParent.get(parent) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      out.push({ id: child.id, depth });
      walk(child.id, depth + 1);
    }
  };
  walk(sessionID, 1);
  return out;
}

function childList(res: unknown): SessionInfo[] {
  const arr = Array.isArray(res) ? res : (res as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (s): s is SessionInfo => !!s && typeof (s as SessionInfo).id === "string",
  );
}

// The SSE-cached list is the only verified discovery surface; a missing or
// throwing list() degrades to [] rather than failing hydration.
function safeList(data: Data): SessionInfo[] {
  try {
    const list = data.session.list();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export interface ChildrenSource {
  name: "v2.session.list" | "session.children";
  fetch: (parentID: string) => Promise<unknown>;
}

// Ordered server fetch strategies: V2 first, then the V1 shim. `data.session`
// is not here — it is the whole-list adjacency fallback used only when neither
// server function is present.
export function clientChildrenSources(client: Client | undefined): ChildrenSource[] {
  const sources: ChildrenSource[] = [];
  const v2list = client?.v2?.session?.list;
  if (typeof v2list === "function") {
    sources.push({ name: "v2.session.list", fetch: (parentID) => v2list({ parentID }) });
  }
  const kids = client?.session?.children;
  if (typeof kids === "function") {
    sources.push({ name: "session.children", fetch: (sessionID) => kids({ sessionID }) });
  }
  return sources;
}

export interface ChildrenFetch {
  list: SessionInfo[];
  source?: string;
  error?: string;
}

// Try each source in order; return the first that resolves (normalized to an
// array). Only when every source rejects does this report an error.
export async function fetchChildren(
  sources: ChildrenSource[],
  parentID: string,
): Promise<ChildrenFetch> {
  let lastError: string | undefined;
  for (const source of sources) {
    try {
      return { list: childList(await source.fetch(parentID)), source: source.name };
    } catch (err) {
      lastError = message(err);
    }
  }
  return { list: [], error: lastError };
}

interface WalkResult {
  ids: Descendant[];
  failures: number;
  lastError?: string;
  // True when at least one level's server source resolved. Distinguishes "some
  // siblings failed" (partial) from "nothing could be fetched at all" (error).
  fetchedAny: boolean;
  // Length of the data.session.list() adjacency fallback, or 0 on the server
  // path; a non-empty list hydrates even though no server fetch succeeded.
  listCount: number;
}

// Server-backed hydration: recurse the ordered child sources per level to build
// the full descendant tree with depths. A rejection is caught per level so one
// failed sibling group does not blank the whole tree; the failure is accumulated
// and returned for refresh() to fold into failedCount (partial state). Only a
// top-level sync throw should surface as the error void. When no client source
// exists, the whole-list `data.session.list()` adjacency is used instead.
export async function descendantsFromClient(
  client: Client | undefined,
  data: Data,
  sessionID: string,
): Promise<WalkResult> {
  const sources = clientChildrenSources(client);
  if (sources.length === 0) {
    const list = safeList(data);
    return {
      ids: descendantsFromList(data, sessionID, list),
      failures: 0,
      fetchedAny: false,
      listCount: list.length,
    };
  }
  const out: Descendant[] = [];
  const visited = new Set<string>([sessionID]);
  let failures = 0;
  let lastError: string | undefined;
  let fetchedAny = false;
  const walk = async (parent: string, depth: number): Promise<void> => {
    const res = await fetchChildren(sources, parent);
    if (res.source === undefined) {
      failures++;
      lastError = res.error;
      return;
    }
    fetchedAny = true;
    sortSiblings(res.list, data);
    for (const child of res.list) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      out.push({ id: child.id, depth });
      await walk(child.id, depth + 1);
    }
  };
  await walk(sessionID, 1);
  // Every server source rejected: recover from the cached adjacency instead of
  // surfacing an error void, since data.session.list() is the verified surface.
  // A recovered walk reports zero failures so it does not paint a false
  // partial-sync footer.
  if (!fetchedAny) {
    const list = safeList(data);
    if (list.length > 0) {
      return {
        ids: descendantsFromList(data, sessionID, list),
        failures: 0,
        fetchedAny: false,
        listCount: list.length,
      };
    }
  }
  return { ids: out, failures, lastError, fetchedAny, listCount: 0 };
}

// Synchronous mount seed. Map the SSE-cached session.list() adjacency to
// summaries before the first render so rows exist on frame one, even though the
// async refresh has not resolved yet (the host slot renderer does not reliably
// add nodes post-mount). Only the sync cache getters are used — the async
// sync() is deliberately skipped; the refresh corrects details and depths.
export function seedFromList(
  data: Data,
  sessionID: string,
  list: SessionInfo[],
): SubagentSummary[] {
  const children: SubagentSummary[] = [];
  for (const { id, depth } of descendantsFromList(data, sessionID, list)) {
    let info: SessionInfo | undefined;
    try {
      info = data.session.get(id);
    } catch {
      info = undefined;
    }
    children.push(
      summarizeSession(
        info ?? { id, cost: 0, time: { created: Date.now(), updated: Date.now() } },
        runningIn(data, id) ? "running" : "idle",
        depth,
      ),
    );
  }
  return children;
}

export interface MountSeed {
  children: SubagentSummary[];
  hydrated: boolean;
}

// Guarded mount-time snapshot: a missing or throwing list() degrades to the
// async-only path (hydrated false, no children) and never throws at mount. A
// non-empty list hydrates even when it has no descendants, so the first frame
// shows empty/rows — never loading — when the cache is already populated.
export function seedFromCache(data: Data, sessionID: string): MountSeed {
  let list: SessionInfo[];
  try {
    if (typeof data?.session?.list !== "function") return { children: [], hydrated: false };
    list = data.session.list();
  } catch {
    return { children: [], hydrated: false };
  }
  if (!Array.isArray(list) || list.length === 0) return { children: [], hydrated: false };
  try {
    return { children: seedFromList(data, sessionID, list), hydrated: true };
  } catch {
    return { children: [], hydrated: false };
  }
}

export function useSubagents(
  sessionID: string,
  deps: { data: Data; client?: Client },
): UseSubagents {
  const { data, client } = deps;
  const seed = seedFromCache(data, sessionID);
  const [state, setState] = createStore<SubagentsState>({
    children: seed.children,
    hydrated: seed.hydrated,
    failedCount: 0,
    error: undefined,
    lastUpdated: Date.now(),
  });

  let known = new Set(seed.children.map((c) => c.sessionID));
  let hydratedEver = seed.hydrated;
  let inFlight = false;
  let trailing = false;
  let disposed = false;

  async function doRefresh(): Promise<void> {
    let ids: Descendant[] = [];
    let hydrationError: string | undefined;
    let partialFailures = 0;
    let partialError: string | undefined;
    let serverFetch = false;
    let listCount = 0;
    try {
      const res = await descendantsFromClient(client, data, sessionID);
      ids = res.ids;
      partialFailures = res.failures;
      partialError = res.lastError;
      serverFetch = res.fetchedAny;
      listCount = res.listCount;
      // Every level rejected: nothing was fetched at all, so this is the
      // error void, not an empty result.
      if (!res.fetchedAny && res.failures > 0) hydrationError = res.lastError;
    } catch (err) {
      ids = [];
      hydrationError = message(err);
    }

    const children: SubagentSummary[] = [];
    let failedCount = partialFailures;
    let lastError = partialError;
    for (const { id, depth } of ids) {
      try {
        await data.session.sync(id);
        const info =
          data.session.get(id) ??
          { id, cost: 0, time: { created: Date.now(), updated: Date.now() } };
        children.push(
          summarizeSession(
            info,
            data.session.status(id) === "running" ? "running" : "idle",
            depth,
          ),
        );
      } catch (err) {
        failedCount++;
        lastError = message(err);
      }
    }

    // Fallback path: an empty session.list() may just mean the index is not
    // hydrated yet, so stay Loading; a non-empty list or a successful server
    // fetch hydrates. The server path is authoritative via serverFetch, so it
    // keeps the Loading/Empty distinction intact.
    if (!hydrationError && (serverFetch || listCount > 0)) hydratedEver = true;
    known = new Set(ids.map((d) => d.id));
    const allFailed = !hydrationError && ids.length > 0 && failedCount >= ids.length;
    setState({
      children,
      hydrated: hydratedEver,
      failedCount,
      error: hydrationError ?? (allFailed ? lastError : undefined),
      lastUpdated: Date.now(),
    });
  }

  // At most one refresh in flight; a request that arrives mid-flight sets the
  // trailing flag so the 2s poll and event bursts coalesce into one follow-up
  // run and a stale completion can never overwrite fresher state.
  async function refresh(): Promise<void> {
    if (disposed) return;
    if (inFlight) {
      trailing = true;
      return;
    }
    inFlight = true;
    try {
      await doRefresh();
    } finally {
      inFlight = false;
      if (trailing && !disposed) {
        trailing = false;
        void refresh();
      }
    }
  }

  let unsubscribe: (() => void) | undefined;
  try {
    const off = data.listen(({ details }) => {
      const payload = details?.data as { sessionID?: string; parentID?: string } | undefined;
      if (details?.type === "session.created") {
        if (payload?.parentID && (payload.parentID === sessionID || known.has(payload.parentID))) {
          void refresh();
        }
        return;
      }
      if (
        REFRESH_EVENTS.has(details?.type ?? "") &&
        payload?.sessionID &&
        known.has(payload.sessionID)
      ) {
        void refresh();
      }
    });
    unsubscribe = typeof off === "function" ? off : undefined;
  } catch {
    // A broken event feed must not stop the poll from driving the sidebar.
    unsubscribe = undefined;
  }

  // Poll unconditionally: the only way to discover children that appeared
  // before this TUI hydrated (or after a restart), when no descendant is known.
  const poll = setInterval(() => {
    void refresh();
  }, POLL_MS);

  void refresh();

  onCleanup(() => {
    disposed = true;
    if (typeof unsubscribe === "function") unsubscribe();
    clearInterval(poll);
  });

  return { state };
}
