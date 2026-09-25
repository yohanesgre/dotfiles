import { createSignal, onCleanup } from "solid-js";
import type { DisplayState } from "./display";
import { createUsageClient, resolveAuth, type GoUsage, type UsageError } from "./usage";

const STORAGE_KEY = "opencode-go-limit";
const DEFAULT_REFRESH_MS = 300_000;
const TICK_MS = 1_000;
const GUARD_MS = 12_000;

interface PersistedUsage {
  usage: GoUsage | null;
  fetchedAt: number;
}

export interface GoUsageContext {
  data: {
    on(event: "session.idle", handler: () => void): () => void;
  };
  storage: {
    store<T>(
      key: string,
      options: { initial: T },
    ): [T, (updater: (draft: T) => void) => unknown];
  };
  ui?: unknown;
  theme?: unknown;
}

type DataApi = GoUsageContext["data"];
type StorageApi = GoUsageContext["storage"];

function isUsageError(value: GoUsage | UsageError): value is UsageError {
  return typeof (value as UsageError).kind === "string";
}

function initialState(persisted: PersistedUsage, hasKey: boolean): DisplayState {
  if (!hasKey) return { kind: "error", error: { kind: "NoAuth" } };
  if (persisted.usage) {
    return {
      kind: "stale",
      usage: persisted.usage,
      error: { kind: "Network", cause: "cached" },
      fetchedAt: persisted.fetchedAt,
    };
  }
  return { kind: "loading" };
}

const fallbackStore: StorageApi["store"] = <T>(
  _key: string,
  options: { initial: T },
): [T, (updater: (draft: T) => void) => unknown] => [options.initial, async () => {}];

export function useGoUsage(
  context: GoUsageContext,
  refreshMs: number = DEFAULT_REFRESH_MS,
): { state: () => DisplayState; now: () => number } {
  const client = createUsageClient();
  const auth = resolveAuth();

  const data = context.data as DataApi | undefined;
  const on: DataApi["on"] =
    data?.on?.bind(data) ?? ((_event: "session.idle", _handler: () => void) => () => {});
  const storage = context.storage as StorageApi | undefined;
  const store: StorageApi["store"] = storage
    ? (storageKey, options) => storage!.store(storageKey, options)
    : fallbackStore;

  const [persisted, updatePersisted] = store<PersistedUsage>(STORAGE_KEY, {
    initial: { usage: null, fetchedAt: 0 },
  });
  const [state, setState] = createSignal<DisplayState>(
    initialState(persisted, auth !== undefined),
  );
  const [now, setNow] = createSignal(Date.now());
  const controller = new AbortController();
  let inflight = false;
  let guardTimer: ReturnType<typeof setTimeout> | undefined;

  function clearGuard(): void {
    if (guardTimer !== undefined) {
      clearTimeout(guardTimer);
      guardTimer = undefined;
    }
  }

  function transition(next: DisplayState | ((previous: DisplayState) => DisplayState)): void {
    clearGuard();
    const resolved =
      typeof next === "function" ? (next as (previous: DisplayState) => DisplayState)(state()) : next;
    setState(resolved);
  }

  function applyFailure(error: UsageError): void {
    transition((previous) => {
      if (previous.kind === "ready" || previous.kind === "stale") {
        return { kind: "stale", usage: previous.usage, error, fetchedAt: previous.fetchedAt };
      }
      return { kind: "error", error };
    });
  }

  async function refresh(): Promise<void> {
    if (auth === undefined || inflight || controller.signal.aborted) return;
    inflight = true;
    try {
      const result = await client.fetchUsage(auth, controller.signal);
      if (isUsageError(result)) {
        applyFailure(result);
        return;
      }
      const fetchedAt = Date.now();
      transition({ kind: "ready", usage: result, fetchedAt });
      try {
        await updatePersisted((draft) => {
          draft.usage = result;
          draft.fetchedAt = fetchedAt;
        });
      } catch {
        // storage is best-effort; live state already updated
      }
    } catch (error) {
      applyFailure({ kind: "Network", cause: String(error) });
    } finally {
      inflight = false;
    }
  }

  const unsubscribe = on("session.idle", () => {
    void refresh();
  });
  const tick = setInterval(() => setNow(Date.now()), TICK_MS);
  const poll = setInterval(() => {
    void refresh();
  }, refreshMs);

  void refresh();

  guardTimer = setTimeout(() => {
    guardTimer = undefined;
    if (state().kind === "loading") {
      transition({ kind: "error", error: { kind: "Network", cause: "no response" } });
    }
  }, GUARD_MS);

  onCleanup(() => {
    clearGuard();
    clearInterval(tick);
    clearInterval(poll);
    unsubscribe();
    controller.abort();
  });

  return { state, now };
}
