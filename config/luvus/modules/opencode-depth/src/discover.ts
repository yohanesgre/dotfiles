import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export interface ServiceInfo {
  id?: string;
  password: string;
  pid?: number;
  url: string;
  version?: string;
}

export interface ServiceState {
  path: string;
  url: string;
  password: string;
  version?: string;
}

export function serviceFilePath(home: string = homedir()): string {
  const override = process.env.OPENCODE_SERVICE_FILE;
  if (override && override.length > 0) return override;
  return join(home, ".local", "state", "opencode", "service.json");
}

export function parseService(raw: string): ServiceInfo {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const url = typeof parsed.url === "string" ? parsed.url : "";
  const password = typeof parsed.password === "string" ? parsed.password : "";
  if (!url) throw new Error("service.json missing url");
  if (!password) throw new Error("service.json missing password");
  const info: ServiceInfo = { url, password };
  if (typeof parsed.id === "string") info.id = parsed.id;
  if (typeof parsed.pid === "number") info.pid = parsed.pid;
  if (typeof parsed.version === "string") info.version = parsed.version;
  return info;
}

export async function readService(path: string = serviceFilePath()): Promise<ServiceInfo> {
  const raw = await readFile(path, "utf8");
  return parseService(raw);
}

export function basicAuthHeader(password: string): string {
  const encoded = Buffer.from(`opencode:${password}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Confirms the advertised URL actually answers the OpenCode info endpoint. */
export async function verifyService(
  info: ServiceInfo,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 3000,
): Promise<{ version?: string; urls: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${info.url}/api/info`, {
      headers: { authorization: basicAuthHeader(info.password) },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GET /api/info -> ${res.status}`);
    const body = (await res.json()) as { version?: string; urls?: string[] };
    return { version: body.version, urls: body.urls ?? [] };
  } finally {
    clearTimeout(timer);
  }
}

export interface DiscoveryDeps {
  home?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Reads service.json each cycle, verifies it, and retries with capped
 * exponential backoff. Returns null only when `signal` aborts.
 */
export class ServiceDiscovery {
  private nextAttemptAt = 0;
  private backoffMs = 1000;

  constructor(private readonly deps: DiscoveryDeps = {}) {}

  async discover(signal: AbortSignal): Promise<ServiceState | null> {
    const now = this.deps.now ?? (() => Date.now());
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const fetchImpl = this.deps.fetchImpl ?? fetch;

    while (!signal.aborted) {
      if (now() < this.nextAttemptAt) {
        await sleep(Math.min(500, this.nextAttemptAt - now()));
        continue;
      }
      try {
        const info = await readService(serviceFilePath(this.deps.home));
        const verified = await verifyService(info, fetchImpl);
        const url = verified.urls[0] ?? info.url;
        this.backoffMs = 1000;
        return { path: serviceFilePath(this.deps.home), url, password: info.password, version: verified.version ?? info.version };
      } catch {
        this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
        this.nextAttemptAt = now() + this.backoffMs;
      }
    }
    return null;
  }
}
