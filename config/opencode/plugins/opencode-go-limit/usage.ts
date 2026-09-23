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

export type Auth =
  | { kind: "apiKey"; key: string }
  | { kind: "oauth"; access: string; server: string; orgID?: string };

export const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
export const CONSOLE_DEFAULT_SERVER = "https://opencode.ai/console";
export const CONSOLE_STATUS_PATH = "/api/go/status";

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

// Console (device-OAuth) payload from `${server}/api/go/status`:
// { access: { endsAt, meters: { fiveHour, week, month } } } with micro-cent strings.
export function decodeConsoleStatus(body: unknown): GoUsage | UsageError {
  if (!isRecord(body)) return { kind: "BadSchema", cause: "body is not an object" };
  const access = body.access;
  if (!isRecord(access)) return { kind: "BadSchema", cause: "access is not an object" };
  const meters = access.meters;
  if (!isRecord(meters)) return { kind: "BadSchema", cause: "meters is not an object" };
  const fallbackReset = typeof access.endsAt === "string" ? access.endsAt : "";
  const rolling = decodeMeter(meters.fiveHour, fallbackReset);
  const weekly = decodeMeter(meters.week, fallbackReset);
  const monthly = decodeMeter(meters.month, fallbackReset);
  if (!rolling) return { kind: "BadSchema", cause: "invalid fiveHour meter" };
  if (!weekly) return { kind: "BadSchema", cause: "invalid week meter" };
  if (!monthly) return { kind: "BadSchema", cause: "invalid month meter" };
  return { rolling, weekly, monthly };
}

function decodeMeter(value: unknown, fallbackReset: string): WindowUsage | undefined {
  if (!isRecord(value)) return undefined;
  const limit = toFinite(value.limitMicroCents);
  const used = toFinite(value.usedMicroCents);
  if (limit === undefined || used === undefined || limit <= 0) return undefined;
  const exact = clamp((used / limit) * 100, 0, 100);
  const resetsAt = typeof value.resetsAt === "string" && value.resetsAt.length > 0 ? value.resetsAt : fallbackReset;
  return { status: exact >= 100 ? "rate-limited" : "ok", percent: Math.round(exact), resetsAt };
}

function toFinite(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export type KeySource =
  | "db"
  | "db:oauth"
  | "auth:opencode-go"
  | "auth:opencode"
  | "auth:opencode-oauth"
  | "none";

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

function readAuthFile(env?: KeyEnv): Record<string, unknown> | undefined {
  const path = join(dataBase(env), "opencode", "auth.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}

function dbCredential(
  env: KeyEnv | undefined,
  integrationId: string,
): Record<string, unknown> | undefined {
  const path = join(dataBase(env), "opencode", "opencode.db");
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    const row = db
      .query("SELECT value FROM credential WHERE integration_id = ? AND active = 1 LIMIT 1")
      .get(integrationId) as { value?: unknown } | null;
    if (!row || typeof row.value !== "string") return undefined;
    const parsed: unknown = JSON.parse(row.value);
    return isRecord(parsed) ? parsed : undefined;
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

function dbKeyValue(env?: KeyEnv): string | undefined {
  const parsed = dbCredential(env, "opencode-go");
  if (!parsed) return undefined;
  const key = parsed.key ?? parsed.apiKey;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

function entryKey(auth: Record<string, unknown>, name: string): string | undefined {
  const entry = auth[name];
  if (!isRecord(entry)) return undefined;
  const key = entry.key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

function entryOAuth(entry: unknown): Auth | undefined {
  if (!isRecord(entry) || entry.type !== "oauth") return undefined;
  const access = entry.access;
  if (typeof access !== "string" || access.length === 0) return undefined;
  const metadata = isRecord(entry.metadata) ? entry.metadata : undefined;
  const server = metadata?.server;
  const orgID = metadata?.orgID;
  return {
    kind: "oauth",
    access,
    server: typeof server === "string" && server.length > 0 ? server : CONSOLE_DEFAULT_SERVER,
    orgID: typeof orgID === "string" && orgID.length > 0 ? orgID : undefined,
  };
}

// Resolve the credential used for the usage fetch. Precedence:
// active DB `opencode-go` key -> active DB `opencode` OAuth (Console) ->
// auth.json `opencode-go` key -> auth.json `opencode` key -> auth.json `opencode` OAuth.
export function resolveAuth(env?: KeyEnv): Auth | undefined {
  const dbKey = dbKeyValue(env);
  if (dbKey !== undefined) return { kind: "apiKey", key: dbKey };
  const dbOAuth = entryOAuth(dbCredential(env, "opencode"));
  if (dbOAuth !== undefined) return dbOAuth;
  const auth = readAuthFile(env);
  if (!auth) return undefined;
  const goKey = entryKey(auth, "opencode-go");
  if (goKey !== undefined) return { kind: "apiKey", key: goKey };
  const plainKey = entryKey(auth, "opencode");
  if (plainKey !== undefined) return { kind: "apiKey", key: plainKey };
  return entryOAuth(auth.opencode);
}

export function keySource(env?: KeyEnv): KeySource {
  if (dbKeyValue(env) !== undefined) return "db";
  if (entryOAuth(dbCredential(env, "opencode")) !== undefined) return "db:oauth";
  const auth = readAuthFile(env);
  if (!auth) return "none";
  if (entryKey(auth, "opencode-go") !== undefined) return "auth:opencode-go";
  if (entryKey(auth, "opencode") !== undefined) return "auth:opencode";
  if (entryOAuth(auth.opencode) !== undefined) return "auth:opencode-oauth";
  return "none";
}

export function readKey(env?: KeyEnv): string | undefined {
  const dbKey = dbKeyValue(env);
  if (dbKey !== undefined) return dbKey;
  const auth = readAuthFile(env);
  if (!auth) return undefined;
  return entryKey(auth, "opencode-go") ?? entryKey(auth, "opencode");
}

export interface UsageClient {
  fetchUsage(auth: Auth | string, signal?: AbortSignal): Promise<GoUsage | UsageError>;
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

  async function requestOnce(auth: Auth, callerSignal?: AbortSignal): Promise<Attempt> {
    if (!doFetch) {
      return { kind: "fatal", error: { kind: "Network", cause: "fetch unavailable" } };
    }
    if (callerSignal?.aborted) {
      return { kind: "fatal", error: { kind: "Network", cause: "aborted" } };
    }
    const isOAuth = auth.kind === "oauth";
    const url = isOAuth
      ? `${auth.server.replace(/\/+$/, "")}${CONSOLE_STATUS_PATH}`
      : USAGE_URL;
    const headers: Record<string, string> = isOAuth
      ? {
          Authorization: `Bearer ${auth.access}`,
          ...(auth.orgID !== undefined ? { "x-org-id": auth.orgID } : {}),
        }
      : { Authorization: `Bearer ${auth.key}` };
    const decode = isOAuth ? decodeConsoleStatus : decodeUsage;
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

    const fetchPromise = doFetch(url, {
      method: "GET",
      headers,
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
    if (res.status === 404 && isOAuth) return { kind: "fatal", error: { kind: "Entitlement" } };
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

    const decoded = decode(body);
    if (isUsageError(decoded)) return { kind: "fatal", error: decoded };
    return { kind: "ok", usage: decoded };
  }

  async function run(auth: Auth, callerSignal?: AbortSignal): Promise<GoUsage | UsageError> {
    const maxAttempts = Math.max(1, retries + 1);
    let last: Attempt | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await requestOnce(auth, callerSignal);
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

  function fetchUsage(auth: Auth | string, signal?: AbortSignal): Promise<GoUsage | UsageError> {
    const resolved: Auth = typeof auth === "string" ? { kind: "apiKey", key: auth } : auth;
    const cacheKey =
      resolved.kind === "apiKey" ? `key:${resolved.key}` : `oauth:${resolved.access}`;
    const existing = inflight.get(cacheKey);
    if (existing) return existing;
    const promise = run(resolved, signal).finally(() => {
      if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey);
    });
    inflight.set(cacheKey, promise);
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
