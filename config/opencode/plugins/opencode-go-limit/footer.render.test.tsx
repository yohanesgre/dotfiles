/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/solid";
import { GoFooter } from "./GoFooter";
import type { GoUsageContext } from "./useGoUsage";

const PAYLOAD = {
  usage: {
    rolling: { status: "ok", percent: 0, resetsAt: "2026-09-13T00:21:07.261Z" },
    weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-09-14T00:00:00.261Z" },
    monthly: { status: "ok", percent: 80, resetsAt: "2026-09-26T16:04:38.261Z" },
  },
};

function stubContext(): GoUsageContext {
  return {
    data: { on: () => () => {} },
    storage: {
      store<T>(
        _key: string,
        options: { initial: T },
      ): [T, (updater: (draft: T) => void) => unknown] {
        return [options.initial, async () => {}];
      },
    },
    theme: {
      hue: { interactive: { 200: "#4dabf7" } },
      text: {
        base: "#eeeeee",
        muted: "#808080",
        action: { primary: { base: "#eeeeee" } },
        feedback: {
          success: { base: "#7fd88f" },
          warning: { base: "#e0af68" },
          error: { base: "#f7768e" },
        },
      },
    },
  };
}

function withAuthDir(hasKey: boolean): { dir: string; restore: () => void } {
  const originalDataHome = process.env.XDG_DATA_HOME;
  const dir = mkdtempSync(join(tmpdir(), "go-footer-render-"));
  if (hasKey) {
    mkdirSync(join(dir, "opencode"), { recursive: true });
    writeFileSync(
      join(dir, "opencode", "auth.json"),
      JSON.stringify({ "opencode-go": { type: "api", key: "test-key" } }),
    );
  }
  process.env.XDG_DATA_HOME = dir;
  return {
    dir,
    restore: () => {
      if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = originalDataHome;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function withFetch(
  handler: typeof fetch,
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

describe("GoFooter render", () => {
  test("ready: renders the usage chips", async () => {
    const auth = withAuthDir(true);
    try {
      await withFetch(
        (async () =>
          new Response(JSON.stringify(PAYLOAD), {
            status: 200,
            headers: { "content-type": "application/json" },
          })) as typeof fetch,
        async () => {
          let setup: Awaited<ReturnType<typeof testRender>> | undefined;
          try {
            setup = await testRender(() => <GoFooter context={stubContext()} />, {
              width: 120,
              height: 4,
            });
            await setup.waitFor(() => setup!.captureCharFrame().includes("5h"), {
              maxPasses: 200,
            });
            const frame = setup.captureCharFrame();
            console.log("FRAME:case1:\n" + frame);
            expect(frame).toContain("5h");
            expect(frame).toContain("wk");
            expect(frame).toContain("mo");
            expect(frame).toContain("↻");
            expect(frame).toContain("5h 0%");
            expect(frame).toContain("wk 100%");
            expect(frame).toContain("mo 80%");
          } finally {
            setup?.renderer.destroy();
          }
        },
      );
    } finally {
      auth.restore();
    }
  });

  test("no auth: renders the error state", async () => {
    const auth = withAuthDir(false);
    try {
      let setup: Awaited<ReturnType<typeof testRender>> | undefined;
      try {
        setup = await testRender(() => <GoFooter context={stubContext()} />, {
          width: 120,
          height: 4,
        });
        await setup.flush();
        const frame = setup.captureCharFrame();
        console.log("FRAME:case2:\n" + frame);
        expect(frame).toContain("Go —");
        expect(frame).not.toContain("5h");
      } finally {
        setup?.renderer.destroy();
      }
    } finally {
      auth.restore();
    }
  });
});
