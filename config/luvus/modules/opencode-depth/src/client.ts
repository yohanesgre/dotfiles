import { basicAuthHeader, type FetchLike } from "./discover.ts";
import type { OpenCodeEvent, OpenCodeSession, PendingPermission } from "./types.ts";

export interface ClientOptions {
  url: string;
  password: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

interface Fetched {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
}

/** One parsed `data:` frame from an SSE stream. */
export interface SseFrame {
  event?: string;
  data: string;
}

/** Parses an SSE chunk buffer into complete frames plus the trailing remainder. */
export function parseSseBuffer(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const frames: SseFrame[] = [];
  for (const part of parts) {
    let event: string | undefined;
    const data: string[] = [];
    for (const rawLine of part.split("\n")) {
      const line = rawLine.trimEnd();
      if (line.length === 0 || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (data.length > 0) frames.push(event ? { event, data: data.join("\n") } : { data: data.join("\n") });
  }
  return { frames, rest };
}

/** Turns one SSE `data:` payload into an OpenCode event, or null when it is not one. */
export function parseEventData(data: string): OpenCodeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== "string") return null;
  const event: OpenCodeEvent = { type: obj.type };
  if (typeof obj.id === "string") event.id = obj.id;
  if (typeof obj.created === "number") event.created = obj.created;
  if (typeof obj.location === "object" && obj.location !== null) {
    event.location = obj.location as { directory?: string };
  }
  if (typeof obj.data === "object" && obj.data !== null) {
    event.data = obj.data as Record<string, unknown>;
  }
  return event;
}

export class OpenCodeClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private headers(): Record<string, string> {
    return { authorization: basicAuthHeader(this.options.password) };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Fetched> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const merged: RequestInit = {
      ...init,
      headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
      signal: init.signal ?? controller.signal,
    };
    try {
      const res = await this.fetchImpl(`${this.options.url}${path}`, merged);
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { ok: res.ok, status: res.status, json, text };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Lists sessions across cursor pages. `GET /api/session` returns only the
   * newest page by default, which drops older roots (their leases would be
   * released) and turns their children into fake roots; paginate instead.
   */
  async listSessions(maxPages = 10): Promise<OpenCodeSession[]> {
    const out: OpenCodeSession[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const res = await this.request(`/api/session${query}`);
      if (!res.ok) throw new Error(`GET /api/session -> ${res.status}`);
      const body = res.json as { data?: OpenCodeSession[]; cursor?: { next?: string | null } } | null;
      out.push(...(body?.data ?? []));
      const next = body?.cursor?.next;
      if (!next) break;
      cursor = next;
    }
    return out;
  }

  async activeSessions(): Promise<Set<string>> {
    const res = await this.request("/api/session/active");
    if (!res.ok) throw new Error(`GET /api/session/active -> ${res.status}`);
    const body = res.json as { data?: Record<string, unknown> } | null;
    return new Set(Object.keys(body?.data ?? {}));
  }

  async pendingPermissions(): Promise<PendingPermission[]> {
    const res = await this.request("/api/permission/request");
    if (!res.ok) throw new Error(`GET /api/permission/request -> ${res.status}`);
    const body = res.json as { data?: PendingPermission[] } | null;
    return normalizePermissions(body?.data ?? []);
  }

  async sessionPermissions(sessionID: string): Promise<PendingPermission[]> {
    const res = await this.request(`/api/session/${encodeURIComponent(sessionID)}/permission`);
    if (!res.ok) throw new Error(`GET session permission -> ${res.status}`);
    const body = res.json as { data?: PendingPermission[] } | null;
    return normalizePermissions(body?.data ?? []);
  }

  async replyPermission(sessionID: string, requestID: string, decision: "once" | "always" | "reject"): Promise<void> {
    const res = await this.request(
      `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) },
    );
    if (!res.ok) throw new Error(`POST permission reply -> ${res.status}`);
  }

  async openEventStream(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const res = await this.fetchImpl(`${this.options.url}/api/event`, {
      headers: this.headers(),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`GET /api/event -> ${res.status}`);
    return res.body;
  }

  async openSessionLog(sessionID: string, after: number, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const res = await this.fetchImpl(
      `${this.options.url}/api/experimental/session/${encodeURIComponent(sessionID)}/log?after=${after}&follow=true`,
      { headers: this.headers(), signal },
    );
    if (!res.ok || !res.body) throw new Error(`GET session log -> ${res.status}`);
    return res.body;
  }
}

function normalizePermissions(raw: unknown[]): PendingPermission[] {
  const out: PendingPermission[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : typeof obj.requestID === "string" ? obj.requestID : "";
    const sessionID = typeof obj.sessionID === "string" ? obj.sessionID : "";
    if (!id || !sessionID) continue;
    const action = typeof obj.action === "string" ? obj.action : "unknown";
    const permission: PendingPermission = { id, sessionID, action };
    if (typeof obj.message === "string") permission.message = obj.message;
    out.push(permission);
  }
  return out;
}

/** Reads an SSE stream to exhaustion, invoking `onFrame` for each data frame. */
export async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrame) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSseBuffer(buffer);
      buffer = rest;
      for (const frame of frames) onFrame(frame);
    }
  } finally {
    reader.releaseLock();
  }
}

export interface SseReaderOptions {
  open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;
  onEvent: (event: OpenCodeEvent) => void;
  onReconnect?: (attempt: number) => void | Promise<void>;
  onError?: (error: unknown, attempt: number) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Owns the live SSE subscription: parses data frames, reconnects with capped
 * exponential backoff, and reports each reconnect so the caller can replay.
 */
export class SseReader {
  private attempt = 0;

  constructor(private readonly options: SseReaderOptions) {}

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    const sleep = this.options.sleep;
    if (sleep) return sleep(ms, signal);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  async run(signal: AbortSignal): Promise<void> {
    const initial = this.options.initialBackoffMs ?? 1000;
    const max = this.options.maxBackoffMs ?? 30_000;
    let backoff = initial;
    let first = true;
    while (!signal.aborted) {
      try {
        const stream = await this.options.open(signal);
        backoff = initial;
        this.attempt = 0;
        if (!first) this.options.onReconnect?.(this.attempt + 1);
        first = false;
        await readSseStream(
          stream,
          (frame) => {
            const parsed = parseEventData(frame.data);
            if (parsed) this.options.onEvent(parsed);
          },
          signal,
        );
        // A clean EOF is still a disconnect; fall through to backoff + reopen.
      } catch (error) {
        this.options.onError?.(error, this.attempt + 1);
      }
      if (signal.aborted) break;
      this.attempt += 1;
      await this.sleep(backoff, signal);
      backoff = Math.min(backoff * 2, max);
    }
  }
}
