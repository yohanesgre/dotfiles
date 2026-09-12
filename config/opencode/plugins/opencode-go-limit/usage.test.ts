import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUsageClient,
  decodeUsage,
  keySource,
  readKey,
  type GoUsage,
  type UsageError,
} from "./usage";

const PAYLOAD = {
  usage: {
    rolling: { status: "ok", percent: 0, resetsAt: "2026-09-13T00:21:07.261Z" },
    weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-09-14T00:00:00.261Z" },
    monthly: { status: "ok", percent: 80, resetsAt: "2026-09-26T16:04:38.261Z" },
  },
};

function isErr(value: GoUsage | UsageError): value is UsageError {
  return typeof (value as UsageError).kind === "string";
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response) {
  let calls = 0;
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    return handler(input, init);
  }) as typeof fetch;
  return { fetch: fn, calls: () => calls };
}

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "go-limit-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface CredentialRow {
  id: string;
  integration_id: string;
  label: string;
  value: string;
  active: number;
}

function writeDb(dir: string, rows: CredentialRow[]): void {
  mkdirSync(join(dir, "opencode"), { recursive: true });
  const db = new Database(join(dir, "opencode", "opencode.db"));
  try {
    db.run(
      "CREATE TABLE credential (id TEXT, integration_id TEXT, label TEXT, value TEXT, active INTEGER, time_created INTEGER)",
    );
    const insert = db.query(
      "INSERT INTO credential (id, integration_id, label, value, active, time_created) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const r of rows) insert.run(r.id, r.integration_id, r.label, r.value, r.active, 0);
  } finally {
    db.close();
  }
}

function writeAuth(dir: string, data: unknown): void {
  mkdirSync(join(dir, "opencode"), { recursive: true });
  writeFileSync(join(dir, "opencode", "auth.json"), JSON.stringify(data));
}

const ACTIVE_DB_ROW: CredentialRow = {
  id: "c-active",
  integration_id: "opencode-go",
  label: "OpenCode Go 2",
  value: JSON.stringify({ type: "api", key: "db-key" }),
  active: 1,
};

const INACTIVE_DB_ROW: CredentialRow = {
  id: "c-old",
  integration_id: "opencode-go",
  label: "OpenCode Go",
  value: JSON.stringify({ type: "api", key: "db-old" }),
  active: 0,
};

describe("decodeUsage", () => {
  test("decodes the captured payload", () => {
    const result = decodeUsage(PAYLOAD);
    expect(isErr(result)).toBe(false);
    const usage = result as GoUsage;
    expect(usage.rolling.percent).toBe(0);
    expect(usage.weekly.status).toBe("rate-limited");
    expect(usage.weekly.percent).toBe(100);
    expect(usage.monthly.percent).toBe(80);
  });

  test("clamps out-of-range percent and passes unknown status through", () => {
    const result = decodeUsage({
      usage: {
        rolling: { status: "weird", percent: 120, resetsAt: "x" },
        weekly: { status: "ok", percent: -5, resetsAt: "y" },
        monthly: { status: "ok", percent: 50, resetsAt: "z" },
      },
    });
    const usage = result as GoUsage;
    expect(usage.rolling.percent).toBe(100);
    expect(usage.rolling.status).toBe("weird");
    expect(usage.weekly.percent).toBe(0);
  });

  test("ignores extra fields", () => {
    const result = decodeUsage({ usage: { ...PAYLOAD.usage, extra: 1 }, other: true });
    expect(isErr(result)).toBe(false);
  });

  test("rejects malformed bodies", () => {
    for (const body of [undefined, null, {}, { usage: {} }, { usage: { rolling: {} } }, "nope", 42]) {
      const result = decodeUsage(body);
      expect(isErr(result)).toBe(true);
      expect((result as UsageError).kind).toBe("BadSchema");
    }
  });

  test("rejects non-finite percent", () => {
    const result = decodeUsage({
      usage: {
        rolling: { status: "ok", percent: Number.NaN, resetsAt: "x" },
        weekly: { status: "ok", percent: 0, resetsAt: "y" },
        monthly: { status: "ok", percent: 0, resetsAt: "z" },
      },
    });
    expect((result as UsageError).kind).toBe("BadSchema");
  });
});

describe("readKey", () => {
  test("returns undefined when auth file is missing", () => {
    withTempDir((dir) => {
      expect(readKey({ XDG_DATA_HOME: dir })).toBeUndefined();
    });
  });

  test("reads opencode-go key from XDG_DATA_HOME", () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, "opencode"), { recursive: true });
      writeFileSync(join(dir, "opencode", "auth.json"), JSON.stringify({ "opencode-go": { key: "secret" } }));
      expect(readKey({ XDG_DATA_HOME: dir })).toBe("secret");
    });
  });

  test("returns undefined for empty or missing key", () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, "opencode"), { recursive: true });
      const path = join(dir, "opencode", "auth.json");
      writeFileSync(path, JSON.stringify({ "opencode-go": { key: "" } }));
      expect(readKey({ XDG_DATA_HOME: dir })).toBeUndefined();
      writeFileSync(path, JSON.stringify({ "opencode-go": {} }));
      expect(readKey({ XDG_DATA_HOME: dir })).toBeUndefined();
      writeFileSync(path, "{not json");
      expect(readKey({ XDG_DATA_HOME: dir })).toBeUndefined();
    });
  });

  test("falls back to auth opencode-go key", () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, "opencode"), { recursive: true });
      writeFileSync(join(dir, "opencode", "auth.json"), JSON.stringify({ "opencode-go": { key: "go-key" } }));
      expect(readKey({ XDG_DATA_HOME: dir })).toBe("go-key");
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("auth:opencode-go");
    });
  });

  test("falls back to auth opencode key when opencode-go absent", () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, "opencode"), { recursive: true });
      writeFileSync(join(dir, "opencode", "auth.json"), JSON.stringify({ opencode: { key: "plain-key" } }));
      expect(readKey({ XDG_DATA_HOME: dir })).toBe("plain-key");
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("auth:opencode");
    });
  });

  test("no DB and no auth.json -> undefined", () => {
    withTempDir((dir) => {
      expect(readKey({ XDG_DATA_HOME: dir })).toBeUndefined();
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("none");
    });
  });

  test("active DB row wins over auth.json", () => {
    withTempDir((dir) => {
      writeDb(dir, [ACTIVE_DB_ROW, INACTIVE_DB_ROW]);
      writeAuth(dir, { "opencode-go": { key: "auth-key" } });
      expect(readKey({ XDG_DATA_HOME: dir })).toBe("db-key");
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("db");
    });
  });

  test("DB without active row falls through to auth opencode-go", () => {
    withTempDir((dir) => {
      writeDb(dir, [INACTIVE_DB_ROW]);
      writeAuth(dir, { "opencode-go": { key: "auth-key" } });
      expect(readKey({ XDG_DATA_HOME: dir })).toBe("auth-key");
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("auth:opencode-go");
    });
  });

  test("missing DB file falls through to auth opencode-go", () => {
    withTempDir((dir) => {
      writeAuth(dir, { "opencode-go": { key: "auth-key" } });
      expect(readKey({ XDG_DATA_HOME: dir })).toBe("auth-key");
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("auth:opencode-go");
    });
  });

  test("no DB and only auth opencode key -> auth:opencode", () => {
    withTempDir((dir) => {
      writeAuth(dir, { opencode: { key: "plain-key" } });
      expect(readKey({ XDG_DATA_HOME: dir })).toBe("plain-key");
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("auth:opencode");
    });
  });

  test("nothing anywhere -> undefined and none", () => {
    withTempDir((dir) => {
      expect(readKey({ XDG_DATA_HOME: dir })).toBeUndefined();
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("none");
    });
  });

  test("DB value not valid JSON falls through without throwing", () => {
    withTempDir((dir) => {
      writeDb(dir, [{ ...ACTIVE_DB_ROW, value: "not json" }]);
      writeAuth(dir, { "opencode-go": { key: "auth-key" } });
      expect(readKey({ XDG_DATA_HOME: dir })).toBe("auth-key");
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("auth:opencode-go");
    });
  });

  test("DB row with apiKey field is accepted", () => {
    withTempDir((dir) => {
      writeDb(dir, [
        { ...ACTIVE_DB_ROW, value: JSON.stringify({ type: "api", apiKey: "api-key-field" }) },
      ]);
      expect(readKey({ XDG_DATA_HOME: dir })).toBe("api-key-field");
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("db");
    });
  });

  test("keySource tracks the source readKey would use", () => {
    withTempDir((dir) => {
      expect(keySource({ XDG_DATA_HOME: join(dir, "missing") })).toBe("none");
    });
    withTempDir((dir) => {
      writeDb(dir, [ACTIVE_DB_ROW]);
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("db");
      writeAuth(dir, { "opencode-go": { key: "go" }, opencode: { key: "plain" } });
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("db");
    });
    withTempDir((dir) => {
      writeAuth(dir, { "opencode-go": { key: "go" } });
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("auth:opencode-go");
    });
    withTempDir((dir) => {
      writeAuth(dir, { opencode: { key: "plain" } });
      expect(keySource({ XDG_DATA_HOME: dir })).toBe("auth:opencode");
    });
  });
});

describe("createUsageClient", () => {
  test("happy path returns all three windows", async () => {
    const f = fakeFetch(() => jsonResponse(PAYLOAD));
    const client = createUsageClient({ fetch: f.fetch, retries: 0, sleep: async () => {}, timeoutMs: 1000 });
    const result = await client.fetchUsage("k");
    expect(isErr(result)).toBe(false);
    const usage = result as GoUsage;
    expect(usage.rolling.percent).toBe(0);
    expect(usage.weekly.percent).toBe(100);
    expect(usage.monthly.percent).toBe(80);
    expect(f.calls()).toBe(1);
  });

  test("401 -> AuthError without retry", async () => {
    const f = fakeFetch(() => new Response(null, { status: 401 }));
    const client = createUsageClient({ fetch: f.fetch, retries: 3, sleep: async () => {} });
    const result = await client.fetchUsage("k");
    expect(result).toEqual({ kind: "AuthError" });
    expect(f.calls()).toBe(1);
  });

  test("403 -> Entitlement without retry", async () => {
    const f = fakeFetch(() => new Response(null, { status: 403 }));
    const client = createUsageClient({ fetch: f.fetch, retries: 3, sleep: async () => {} });
    const result = await client.fetchUsage("k");
    expect(result).toEqual({ kind: "Entitlement" });
    expect(f.calls()).toBe(1);
  });

  test("other 4xx -> Network without retry", async () => {
    const f = fakeFetch(() => new Response(null, { status: 418 }));
    const client = createUsageClient({ fetch: f.fetch, retries: 3, sleep: async () => {} });
    const result = await client.fetchUsage("k");
    expect(isErr(result) && result.kind).toBe("Network");
    expect(f.calls()).toBe(1);
  });

  test("429 honors Retry-After then RateLimited", async () => {
    const f = fakeFetch(() => new Response(null, { status: 429, headers: { "retry-after": "2" } }));
    const sleeps: number[] = [];
    const client = createUsageClient({
      fetch: f.fetch,
      retries: 1,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const result = await client.fetchUsage("k");
    expect(result).toEqual({ kind: "RateLimited", retryAfterMs: 2000 });
    expect(sleeps).toEqual([2000]);
    expect(f.calls()).toBe(2);
  });

  test("500 retries then Network", async () => {
    const f = fakeFetch(() => new Response(null, { status: 500 }));
    const sleeps: number[] = [];
    const client = createUsageClient({
      fetch: f.fetch,
      retries: 2,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const result = await client.fetchUsage("k");
    expect(isErr(result) && result.kind).toBe("Network");
    expect(f.calls()).toBe(3);
    expect(sleeps.length).toBe(2);
  });

  test("fetch throw -> Network", async () => {
    const f = fakeFetch(() => {
      throw new Error("boom");
    });
    const client = createUsageClient({ fetch: f.fetch, retries: 0, sleep: async () => {} });
    const result = await client.fetchUsage("k");
    expect(isErr(result) && result.kind).toBe("Network");
  });

  test("timeout -> Network", async () => {
    const f = fakeFetch(() => new Promise<Response>(() => {}));
    const client = createUsageClient({ fetch: f.fetch, retries: 0, timeoutMs: 10, sleep: async () => {} });
    const result = await client.fetchUsage("k");
    expect(isErr(result) && result.kind).toBe("Network");
    expect(f.calls()).toBe(1);
  });

  test("caller abort -> Network without retry", async () => {
    const f = fakeFetch(() => new Promise<Response>(() => {}));
    const controller = new AbortController();
    const client = createUsageClient({ fetch: f.fetch, retries: 3, sleep: async () => {}, timeoutMs: 5000 });
    const pending = client.fetchUsage("k", controller.signal);
    controller.abort();
    const result = await pending;
    expect(isErr(result) && result.kind).toBe("Network");
    expect(f.calls()).toBe(1);
  });

  test("malformed bodies -> BadSchema", async () => {
    for (const body of [{}, { usage: {} }, "nope"]) {
      const f = fakeFetch(() => jsonResponse(body));
      const client = createUsageClient({ fetch: f.fetch, retries: 0, sleep: async () => {} });
      const result = await client.fetchUsage("k");
      expect(isErr(result)).toBe(true);
      expect((result as UsageError).kind).toBe("BadSchema");
    }
  });

  test("invalid JSON 200 -> BadSchema", async () => {
    const f = fakeFetch(() => new Response("{not json", { status: 200 }));
    const client = createUsageClient({ fetch: f.fetch, retries: 0, sleep: async () => {} });
    const result = await client.fetchUsage("k");
    expect((result as UsageError).kind).toBe("BadSchema");
  });

  test("single-flight shares one in-flight request", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = fakeFetch(async () => {
      await gate;
      return jsonResponse(PAYLOAD);
    });
    const client = createUsageClient({ fetch: f.fetch, retries: 0, sleep: async () => {} });
    const first = client.fetchUsage("k");
    const second = client.fetchUsage("k");
    release?.();
    const [a, b] = await Promise.all([first, second]);
    expect(f.calls()).toBe(1);
    expect(isErr(a)).toBe(false);
    expect(a).toEqual(b);
  });

  test("sequential calls are not cached", async () => {
    const f = fakeFetch(() => jsonResponse(PAYLOAD));
    const client = createUsageClient({ fetch: f.fetch, retries: 0, sleep: async () => {} });
    await client.fetchUsage("k");
    await client.fetchUsage("k");
    expect(f.calls()).toBe(2);
  });
});
