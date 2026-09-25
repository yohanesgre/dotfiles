import { expect, test } from "bun:test";
import { OpenCodeClient, parseEventData, parseSseBuffer, SseReader } from "../src/client.ts";

const encoder = new TextEncoder();

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("parseSseBuffer extracts data frames and holds the remainder", () => {
  const first = 'data: {"id":"evt_1","type":"session.created","data":{"sessionID":"ses_a","parentID":"ses_root"}}\n\n: heartbeat\n\n';
  const { frames, rest } = parseSseBuffer(`${first}data: {"type":"session.execution.star`);
  expect(frames).toHaveLength(1);
  expect(frames[0]?.data).toContain("session.created");
  expect(rest).toBe('data: {"type":"session.execution.star');
});

test("parseEventData rejects heartbeats and non-events", () => {
  expect(parseEventData("")).toBeNull();
  expect(parseEventData("not json")).toBeNull();
  expect(parseEventData('{"no":"type"}')).toBeNull();
  const event = parseEventData('{"id":"evt_2","created":42,"type":"session.execution.started","data":{"sessionID":"ses_a"}}');
  expect(event?.type).toBe("session.execution.started");
  expect(event?.data?.sessionID).toBe("ses_a");
});

test("SseReader reconnects with backoff and reports the reconnect", async () => {
  const events: string[] = [];
  let opens = 0;
  let reconnects = 0;
  const abort = new AbortController();
  const reader = new SseReader({
    open: async () => {
      opens += 1;
      if (opens === 1) {
        return streamOf([
          'data: {"type":"session.execution.started","data":{"sessionID":"ses_a"}}\n\n',
          'data: {"type":"session.execution.succeeded","data":{"sessionID":"ses_a"}}\n\n',
        ]);
      }
      return streamOf(['data: {"type":"session.execution.started","data":{"sessionID":"ses_b"}}\n\n']);
    },
    onEvent: (event) => {
      events.push(event.type);
      if (events.length === 3) abort.abort();
    },
    onReconnect: () => {
      reconnects += 1;
    },
    initialBackoffMs: 1,
    sleep: async () => {},
  });
  await reader.run(abort.signal);
  expect(opens).toBe(2);
  expect(reconnects).toBe(1);
  expect(events).toEqual([
    "session.execution.started",
    "session.execution.succeeded",
    "session.execution.started",
  ]);
});

test("replayed durable-log item is applied by the event parser", () => {
  const item = '{"type":"session.execution.succeeded","sessionID":"ses_a","seq":657}';
  const event = parseEventData(item);
  expect(event?.type).toBe("session.execution.succeeded");
});

test("listShells parses the /api/shell envelope and keeps only usable rows", async () => {
  const payload = {
    location: {},
    data: [
      { id: "sh_1", status: "running", command: "sleep 30", cwd: "/repo", shell: "/bin/zsh", file: "/f", pid: 10, metadata: { sessionID: "ses_a" }, time: { started: 1 } },
      { id: "sh_2", status: "exited", exit: 0, metadata: { sessionID: "ses_b" }, time: { started: 1 } },
      { id: "sh_3", status: "running", metadata: {}, time: { started: 1 } },
      { id: "", status: "running", metadata: { sessionID: "ses_c" } },
      "not an object",
    ],
  };
  let seen = "";
  const fetchImpl = (async (input: string) => {
    seen = input;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const client = new OpenCodeClient({ url: "http://x", password: "p", fetchImpl });
  expect(await client.listShells()).toEqual([
    { id: "sh_1", status: "running", sessionID: "ses_a" },
    { id: "sh_2", status: "exited", sessionID: "ses_b" },
    { id: "sh_3", status: "running" },
  ]);
  expect(seen).toContain("/api/shell");
  expect(seen).toBe("http://x/api/shell");
});

test("listShells scopes the request to a directory with deepObject encoding", async () => {
  const payload = { location: { directory: "/project/a" }, data: [] };
  const inputs: string[] = [];
  const fetchImpl = (async (input: string) => {
    inputs.push(input);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const client = new OpenCodeClient({ url: "http://x", password: "p", fetchImpl });
  await client.listShells({ directory: "/project/a b&c" });
  expect(inputs[0]).toBe("http://x/api/shell?location[directory]=%2Fproject%2Fa%20b%26c");
});

test("listSessions follows cursor.next across pages and stops when bounded", async () => {
  const pages = [
    { data: [{ id: "ses_1" }], cursor: { next: "c2" } },
    { data: [{ id: "ses_2" }], cursor: { next: "c3" } },
    { data: [{ id: "ses_3" }], cursor: { next: null } },
  ];
  let calls = 0;
  const inputs: string[] = [];
  const fetchImpl = (async (input: string) => {
    inputs.push(input);
    const page = pages[Math.min(calls, pages.length - 1)];
    calls += 1;
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const client = new OpenCodeClient({ url: "http://x", password: "p", fetchImpl });
  expect((await client.listSessions()).map((s) => s.id)).toEqual(["ses_1", "ses_2", "ses_3"]);
  expect(calls).toBe(3);
  expect(inputs[0]).not.toContain("cursor=");
  expect(inputs[1]).toContain("cursor=c2");
  expect(inputs[2]).toContain("cursor=c3");

  calls = 0;
  const endless = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: [], cursor: { next: "more" } }), { status: 200 });
  }) as unknown as typeof fetch;
  const bounded = new OpenCodeClient({ url: "http://x", password: "p", fetchImpl: endless });
  await bounded.listSessions(4);
  expect(calls).toBe(4);
});
