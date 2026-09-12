import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Window = "rolling" | "weekly" | "monthly";

export interface WindowUsage {
  status: string;
  percent: number;
  resetsAt: string;
}

export interface GoUsage {
  rolling: WindowUsage;
  weekly: WindowUsage;
  monthly: WindowUsage;
}

export type UsageError =
  | { kind: "NoAuth" }
  | { kind: "AuthError" }
  | { kind: "Entitlement" }
  | { kind: "RateLimited"; retryAfterMs?: number }
  | { kind: "Network"; cause?: string }
  | { kind: "BadSchema"; cause?: string };

export const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

export const WINDOWS: readonly Window[] = ["rolling", "weekly", "monthly"];

export function decodeUsage(body: unknown): GoUsage | UsageError {
  if (!isRecord(body)) return { kind: "BadSchema", cause: "body is not an object" };
  const usage = body.usage;
  if (!isRecord(usage)) return { kind: "BadSchema", cause: "usage is not an object" };
  const rolling = decodeWindow(usage.rolling);
  const weekly = decodeWindow(usage.weekly);
  const monthly = decodeWindow(usage.monthly);
  if (!rolling) return { kind: "BadSchema", cause: "invalid rolling window" };
  if (!weekly) return { kind: "BadSchema", cause: "invalid weekly window" };
  if (!monthly) return { kind: "BadSchema", cause: "invalid monthly window" };
  return { rolling, weekly, monthly };
}

export type KeySource = "db" | "auth:opencode-go" | "auth:opencode" | "none";

export interface KeyEnv {
  XDG_DATA_HOME?: string;
}

function dataBase(env?: KeyEnv): string {
  return envValue(env, "XDG_DATA_HOME") ?? join(homedir(), ".local", "share");
}

function envValue(env: KeyEnv | undefined, name: keyof KeyEnv): string | undefined {
  const raw = env ? env[name] : process.env[name];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function readAuth(env?: KeyEnv): Record<string, unknown> | undefined {
  const path = join(dataBase(env), "opencode", "auth.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}

function dbKeyValue(env?: KeyEnv): string | undefined {
  const path = join(dataBase(env), "opencode", "opencode.db");
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    const row = db
      .query("SELECT value FROM credential WHERE integration_id = 'opencode-go' AND active = 1 LIMIT 1")
      .get() as { value?: unknown } | null;
    if (!row || typeof row.value !== "string") return undefined;
    const parsed: unknown = JSON.parse(row.value);
    if (!isRecord(parsed)) return undefined;
    const key = parsed.key ?? parsed.apiKey;
    return typeof key === "string" && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

function entryKey(auth: Record<string, unknown>, name: string): string | undefined {
  const entry = auth[name];
  if (!isRecord(entry)) return undefined;
  const key = entry.key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

export function keySource(env?: KeyEnv): KeySource {
  if (dbKeyValue(env) !== undefined) return "db";
  const auth = readAuth(env);
  if (!auth) return "none";
  if (entryKey(auth, "opencode-go") !== undefined) return "auth:opencode-go";
  if (entryKey(auth, "opencode") !== undefined) return "auth:opencode";
  return "none";
}

export function readKey(env?: KeyEnv): string | undefined {
  const dbKey = dbKeyValue(env);
  if (dbKey !== undefined) return dbKey;
  const auth = readAuth(env);
  if (!auth) return undefined;
  return entryKey(auth, "opencode-go") ?? entryKey(auth, "opencode");
}

export interface UsageClient {
  fetchUsage(key: string, signal?: AbortSignal): Promise<GoUsage | UsageError>;
}

export interface UsageClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

type Attempt =
  | { kind: "ok"; usage: GoUsage }
  | { kind: "fatal"; error: UsageError }
  | { kind: "retry"; retryAfterMs?: number; rateLimited: boolean };

export function createUsageClient(opts: UsageClientOptions = {}): UsageClient {
  const doFetch =
    opts.fetch ?? (typeof globalThis.fetch === "function" ? globalThis.fetch : undefined);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const inflight = new Map<string, Promise<GoUsage | UsageError>>();

  async function requestOnce(key: string, callerSignal?: AbortSignal): Promise<Attempt> {
    if (!doFetch) {
      return { kind: "fatal", error: { kind: "Network", cause: "fetch unavailable" } };
    }
    if (callerSignal?.aborted) {
      return { kind: "fatal", error: { kind: "Network", cause: "aborted" } };
    }
    const controller = new AbortController();
    let callerAborted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onCallerAbort = () => {
      callerAborted = true;
      controller.abort();
    };
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    };

    callerSignal?.addEventListener("abort", onCallerAbort);
    timer = setTimeout(() => controller.abort(), timeoutMs);

    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });

    const fetchPromise = doFetch(USAGE_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    fetchPromise.catch(() => {});

    let res: Response;
    try {
      res = await Promise.race([fetchPromise, aborted]);
    } catch {
      cleanup();
      if (callerAborted) return { kind: "fatal", error: { kind: "Network", cause: "aborted" } };
      return { kind: "retry", rateLimited: false };
    }

    cleanup();

    if (res.status === 401) return { kind: "fatal", error: { kind: "AuthError" } };
    if (res.status === 403) return { kind: "fatal", error: { kind: "Entitlement" } };
    if (res.status === 429) {
      return { kind: "retry", rateLimited: true, retryAfterMs: parseRetryAfter(res.headers.get("retry-after")) };
    }
    if (res.status >= 500) return { kind: "retry", rateLimited: false };
    if (res.status !== 200) {
      return { kind: "fatal", error: { kind: "Network", cause: `HTTP ${res.status}` } };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { kind: "fatal", error: { kind: "BadSchema", cause: "invalid JSON" } };
    }

    const decoded = decodeUsage(body);
    if (isUsageError(decoded)) return { kind: "fatal", error: decoded };
    return { kind: "ok", usage: decoded };
  }

  async function run(key: string, callerSignal?: AbortSignal): Promise<GoUsage | UsageError> {
    const maxAttempts = Math.max(1, retries + 1);
    let last: Attempt | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await requestOnce(key, callerSignal);
      if (result.kind === "ok") return result.usage;
      if (result.kind === "fatal") return result.error;
      last = result;
      if (attempt >= maxAttempts - 1) break;
      if (callerSignal?.aborted) return { kind: "Network", cause: "aborted" };
      await sleep(result.retryAfterMs ?? backoff(attempt));
    }
    if (last && last.kind === "retry" && last.rateLimited) {
      return { kind: "RateLimited", retryAfterMs: last.retryAfterMs };
    }
    return { kind: "Network", cause: "request failed after retries" };
  }

  function fetchUsage(key: string, signal?: AbortSignal): Promise<GoUsage | UsageError> {
    const existing = inflight.get(key);
    if (existing) return existing;
    const promise = run(key, signal).finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  }

  return { fetchUsage };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeWindow(value: unknown): WindowUsage | undefined {
  if (!isRecord(value)) return undefined;
  const { status, percent, resetsAt } = value;
  if (typeof status !== "string") return undefined;
  if (typeof percent !== "number" || !Number.isFinite(percent)) return undefined;
  if (typeof resetsAt !== "string") return undefined;
  return { status, percent: clamp(percent, 0, 100), resetsAt };
}

function isUsageError(value: GoUsage | UsageError): value is UsageError {
  return typeof (value as UsageError).kind === "string";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function backoff(attempt: number): number {
  const base = 300 * 2 ** attempt;
  return base + Math.floor(Math.random() * base);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || value.length === 0) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}
