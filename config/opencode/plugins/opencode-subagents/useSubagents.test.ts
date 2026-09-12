import { describe, expect, test } from "bun:test";
import {
  type ChildrenSource,
  clientChildrenSources,
  descendantsFromClient,
  fetchChildren,
  seedFromCache,
  seedFromList,
} from "./useSubagents";

interface Info {
  id: string;
  parentID?: string;
  time?: { created: number };
}

function fakeData(infos: Info[] = []): any {
  return {
    listen: () => () => {},
    session: {
      list: () => infos,
      get: () => undefined,
      status: () => "idle",
      sync: async () => {},
    },
  };
}

const src = (
  name: ChildrenSource["name"],
  fetch: (parentID: string) => Promise<unknown>,
): ChildrenSource => ({ name, fetch });

describe("clientChildrenSources", () => {
  test("orders v2.session.list before session.children", () => {
    const client = {
      v2: { session: { list: async () => [] } },
      session: { children: async () => [] },
    };
    expect(clientChildrenSources(client).map((s) => s.name)).toEqual([
      "v2.session.list",
      "session.children",
    ]);
  });

  test("omits missing functions and tolerates undefined", () => {
    expect(clientChildrenSources(undefined)).toEqual([]);
    expect(clientChildrenSources({})).toEqual([]);
    expect(clientChildrenSources({ v2: { session: {} } }).map((s) => s.name)).toEqual([]);
    expect(
      clientChildrenSources({ session: { children: async () => [] } }).map((s) => s.name),
    ).toEqual(["session.children"]);
  });

  test("passes parentID to v2 and sessionID to the V1 shim", async () => {
    const v2Calls: unknown[] = [];
    const childCalls: unknown[] = [];
    const client = {
      v2: {
        session: {
          list: async (input: unknown) => {
            v2Calls.push(input);
            return [];
          },
        },
      },
      session: {
        children: async (input: unknown) => {
          childCalls.push(input);
          return [];
        },
      },
    };
    const [v2, kids] = clientChildrenSources(client);
    await v2.fetch("ses_parent");
    await kids.fetch("ses_parent");
    expect(v2Calls).toEqual([{ parentID: "ses_parent" }]);
    expect(childCalls).toEqual([{ sessionID: "ses_parent" }]);
  });
});

describe("fetchChildren", () => {
  test("prefers the first source and skips the rest", async () => {
    let secondCalled = false;
    const res = await fetchChildren(
      [
        src("v2.session.list", async () => [{ id: "a" }]),
        src("session.children", async () => {
          secondCalled = true;
          return [{ id: "b" }];
        }),
      ],
      "p",
    );
    expect(res.source).toBe("v2.session.list");
    expect(res.list.map((s) => s.id)).toEqual(["a"]);
    expect(secondCalled).toBe(false);
  });

  test("falls through to the next source on rejection", async () => {
    const res = await fetchChildren(
      [
        src("v2.session.list", async () => {
          throw new Error("404");
        }),
        src("session.children", async () => ({ data: [{ id: "c" }] })),
      ],
      "p",
    );
    expect(res.source).toBe("session.children");
    expect(res.list.map((s) => s.id)).toEqual(["c"]);
  });

  test("reports the last error when every source rejects", async () => {
    const res = await fetchChildren(
      [
        src("v2.session.list", async () => {
          throw new Error("first");
        }),
        src("session.children", async () => {
          throw new Error("second");
        }),
      ],
      "p",
    );
    expect(res.source).toBeUndefined();
    expect(res.list).toEqual([]);
    expect(res.error).toBe("second");
  });

  test("normalizes array and { data } envelopes and drops bad entries", async () => {
    const arr = await fetchChildren(
      [src("v2.session.list", async () => [{ id: "a" }, { no: 1 }])],
      "p",
    );
    expect(arr.list.map((s) => s.id)).toEqual(["a"]);
    const env = await fetchChildren(
      [src("v2.session.list", async () => ({ data: [{ id: "b" }] }))],
      "p",
    );
    expect(env.list.map((s) => s.id)).toEqual(["b"]);
    const bad = await fetchChildren(
      [src("v2.session.list", async () => ({ nope: true }))],
      "p",
    );
    expect(bad.list).toEqual([]);
    expect(bad.source).toBe("v2.session.list");
  });
});

describe("descendantsFromClient", () => {
  test("builds the full descendant tree with depths via v2.session.list", async () => {
    const edges: Record<string, Info[]> = {
      root: [
        { id: "a", time: { created: 1 } },
        { id: "b", time: { created: 2 } },
      ],
      a: [{ id: "a1", time: { created: 3 } }],
    };
    const client = {
      v2: {
        session: {
          list: async ({ parentID }: { parentID: string }) => edges[parentID] ?? [],
        },
      },
    };
    const res = await descendantsFromClient(client, fakeData(), "root");
    expect(res.ids).toEqual([
      { id: "a", depth: 1 },
      { id: "a1", depth: 2 },
      { id: "b", depth: 1 },
    ]);
    expect(res.fetchedAny).toBe(true);
    expect(res.failures).toBe(0);
    expect(res.listCount).toBe(0);
  });

  test("guards cycles and self-parents", async () => {
    const edges: Record<string, Info[]> = {
      root: [{ id: "a", time: { created: 1 } }],
      a: [
        { id: "root", time: { created: 2 } },
        { id: "a", time: { created: 2 } },
      ],
    };
    const client = {
      v2: {
        session: {
          list: async ({ parentID }: { parentID: string }) => edges[parentID] ?? [],
        },
      },
    };
    const res = await descendantsFromClient(client, fakeData(), "root");
    expect(res.ids).toEqual([{ id: "a", depth: 1 }]);
  });

  test("falls back per level to session.children when v2 rejects", async () => {
    const calls: string[] = [];
    const tree: Record<string, Info[]> = { root: [{ id: "a", time: { created: 1 } }], a: [] };
    const client = {
      v2: {
        session: {
          list: async ({ parentID }: { parentID: string }) => {
            calls.push(`v2:${parentID}`);
            throw new Error("v2 down");
          },
        },
      },
      session: {
        children: async ({ sessionID }: { sessionID: string }) => {
          calls.push(`v1:${sessionID}`);
          return tree[sessionID] ?? [];
        },
      },
    };
    const res = await descendantsFromClient(client, fakeData(), "root");
    expect(res.ids).toEqual([{ id: "a", depth: 1 }]);
    expect(res.fetchedAny).toBe(true);
    expect(res.failures).toBe(0);
    expect(calls).toEqual(["v2:root", "v1:root", "v2:a", "v1:a"]);
  });

  test("folds a level where every source rejects into failures (partial)", async () => {
    const client = {
      v2: {
        session: {
          list: async ({ parentID }: { parentID: string }) => {
            if (parentID === "root") return [{ id: "a", time: { created: 1 } }];
            throw new Error("v2 down");
          },
        },
      },
      session: {
        children: async () => {
          throw new Error("v1 down");
        },
      },
    };
    const res = await descendantsFromClient(client, fakeData(), "root");
    expect(res.ids).toEqual([{ id: "a", depth: 1 }]);
    expect(res.fetchedAny).toBe(true);
    expect(res.failures).toBe(1);
    expect(res.lastError).toBe("v1 down");
  });

  test("reports nothing fetched when all levels reject", async () => {
    const client = {
      v2: {
        session: {
          list: async () => {
            throw new Error("v2 down");
          },
        },
      },
      session: {
        children: async () => {
          throw new Error("v1 down");
        },
      },
    };
    const res = await descendantsFromClient(client, fakeData(), "root");
    expect(res.ids).toEqual([]);
    expect(res.fetchedAny).toBe(false);
    expect(res.failures).toBe(1);
    expect(res.lastError).toBe("v1 down");
  });

  test("uses the data.session.list adjacency when no client source exists", async () => {
    const infos: Info[] = [
      { id: "a", parentID: "root", time: { created: 1 } },
      { id: "a1", parentID: "a", time: { created: 2 } },
      { id: "orphan", time: { created: 3 } },
    ];
    const res = await descendantsFromClient(undefined, fakeData(infos), "root");
    expect(res.fetchedAny).toBe(false);
    expect(res.listCount).toBe(3);
    expect(res.ids).toEqual([
      { id: "a", depth: 1 },
      { id: "a1", depth: 2 },
    ]);
  });
});

describe("seedFromList / seedFromCache", () => {
  interface RichInfo {
    id: string;
    parentID?: string;
    time?: { created: number };
    agent?: string;
    title?: string;
    cost?: number;
    tokens?: {
      input: number;
      output: number;
      reasoning: number;
      cache: { read: number; write: number };
    };
  }

  function seedData(
    infos: RichInfo[],
    overrides: Partial<{
      get: (id: string) => unknown;
      status: (id: string) => "idle" | "running";
      list: () => unknown;
    }> = {},
  ): any {
    return {
      listen: () => () => {},
      session: {
        list: overrides.list ?? (() => infos),
        get: overrides.get ?? ((id: string) => infos.find((s) => s.id === id)),
        status: overrides.status ?? (() => "idle"),
        sync: async () => {},
      },
    };
  }

  const tree: RichInfo[] = [
    { id: "a", parentID: "root", time: { created: 1 }, agent: "build", cost: 0.5 },
    { id: "a1", parentID: "a", time: { created: 2 }, agent: "explore" },
    { id: "b", parentID: "root", time: { created: 3 }, agent: "plan" },
    { id: "orphan", time: { created: 4 } },
  ];

  test("maps cached infos to summaries with DFS depths and running status", () => {
    const data = seedData(tree, { status: (id) => (id === "a" ? "running" : "idle") });
    const children = seedFromList(data, "root", tree);
    expect(children.map((c) => c.sessionID)).toEqual(["a", "a1", "b"]);
    expect(children.map((c) => c.depth)).toEqual([1, 2, 1]);
    expect(children.map((c) => c.agent)).toEqual(["build", "explore", "plan"]);
    expect(children[0].status).toBe("running");
    expect(children[1].status).toBe("idle");
    expect(children[0].cost).toBe(0.5);
  });

  test("falls back to the placeholder shape when get is undefined", () => {
    const data = seedData(tree, { get: () => undefined });
    const children = seedFromList(data, "root", tree);
    expect(children.map((c) => c.sessionID)).toEqual(["a", "a1", "b"]);
    expect(children[0].agent).toBe("agent");
    expect(children[0].title).toBe("a");
    expect(children[0].model).toBe("unknown");
    expect(children[0].cost).toBe(0);
  });

  test("guards a throwing get", () => {
    const data = seedData(tree, {
      get: () => {
        throw new Error("cache miss");
      },
    });
    expect(() => seedFromList(data, "root", tree)).not.toThrow();
    expect(seedFromList(data, "root", tree).map((c) => c.title)).toEqual(["a", "a1", "b"]);
  });

  test("hydrates from a non-empty cache with rows", () => {
    const seed = seedFromCache(seedData(tree), "root");
    expect(seed.hydrated).toBe(true);
    expect(seed.children.map((c) => c.sessionID)).toEqual(["a", "a1", "b"]);
  });

  test("hydrates a non-empty cache with no descendants (empty, not loading)", () => {
    const infos: RichInfo[] = [{ id: "other", time: { created: 1 } }];
    const seed = seedFromCache(seedData(infos), "root");
    expect(seed.hydrated).toBe(true);
    expect(seed.children).toEqual([]);
  });

  test("stays unhydrated for an empty cache", () => {
    expect(seedFromCache(seedData([]), "root")).toEqual({ children: [], hydrated: false });
  });

  test("degrades to async-only when list is missing or throws", () => {
    const missing = seedData(tree);
    missing.session.list = undefined;
    expect(seedFromCache(missing, "root")).toEqual({ children: [], hydrated: false });

    const throwing = seedData(tree, {
      list: () => {
        throw new Error("cache down");
      },
    });
    expect(seedFromCache(throwing, "root")).toEqual({ children: [], hydrated: false });
  });

  test("never throws at mount", () => {
    const broken: any = {
      session: { get: () => undefined, status: () => "idle", sync: async () => {} },
    };
    expect(() => seedFromCache(broken, "root")).not.toThrow();
    expect(() => seedFromCache(undefined as any, "root")).not.toThrow();
  });
});
