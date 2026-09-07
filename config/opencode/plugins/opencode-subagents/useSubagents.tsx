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

function childIDs(data: Data, sessionID: string): string[] {
  return data.session
    .list()
    .filter((s) => s.parentID === sessionID)
    .map((s) => s.id);
}

export function useSubagents(sessionID: string, deps: { data: Data }): UseSubagents {
  const { data } = deps;
  const [state, setState] = createStore<SubagentsState>({
    children: [],
    loading: true,
    syncing: false,
    error: undefined,
    lastUpdated: 0,
  });

  async function refresh(): Promise<void> {
    const ids = childIDs(data, sessionID);
    const children: SubagentSummary[] = [];
    let failures = 0;
    let lastError: string | undefined;
    for (const id of ids) {
      try {
        await data.session.sync(id);
        const info = data.session.get(id) ?? { id, cost: 0, time: { created: 0, updated: 0 } };
        children.push(
          summarizeSession(
            info,
            data.session.status(id) === "running" ? "running" : "idle",
          ),
        );
      } catch (err) {
        failures++;
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    children.sort((a, b) => a.created - b.created);
    setState({
      children,
      loading: false,
      syncing: false,
      error: failures > 0 && failures === ids.length && ids.length > 0 ? lastError : undefined,
      lastUpdated: Date.now(),
    });
  }

  const known = new Set<string>(childIDs(data, sessionID));

  const unsubscribe = data.listen(({ details }) => {
    const payload = details?.data as { sessionID?: string; parentID?: string } | undefined;
    if (details?.type === "session.created") {
      if (payload?.parentID === sessionID) {
        if (payload.sessionID) known.add(payload.sessionID);
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

  const poll = setInterval(() => {
    if (childIDs(data, sessionID).some((id) => data.session.status(id) === "running")) {
      void refresh();
    }
  }, POLL_MS);

  void refresh();

  onCleanup(() => {
    unsubscribe();
    clearInterval(poll);
  });

  return { state };
}
