/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { MoreDialog } from "./MoreDialog";
import type { SubagentSummary } from "./types";

// Regression guard for the S2 scrollbar reservation: the header row is rendered
// outside the scrollbox while the data rows are inside it, so if the scrollbox
// reserves a scrollbar column the right-anchored columns shift left and every
// header label lands ~1 column right of its value. MoreDialog disables the
// scrollbar (`scrollbarOptions={{ visible: false }}`), so header and row must
// share the exact same right edge whether or not the list scrolls.
const color = (r: number, g: number, b: number) => RGBA.fromValues(r, g, b, 1);
const theme = {
  text: {
    base: color(0.9, 0.9, 0.9),
    muted: color(0.5, 0.5, 0.5),
    feedback: {
      success: color(0.2, 1, 0.2),
      error: color(1, 0.1, 0.1),
      warning: color(1, 0.7, 0.1),
      info: color(0.1, 0.2, 1),
    },
  },
  hue: { interactive: { 200: color(0.1, 0.2, 1) } },
};

function makeRows(n: number): SubagentSummary[] {
  return Array.from({ length: n }, (_, i) => ({
    sessionID: `ses_${i}`,
    depth: 0,
    agent: "reviewer",
    title: `title ${i}`,
    model: "anthropic/claude-sonnet-4",
    status: "running",
    tokens: { input: 1000, output: 400, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 1.23,
    created: 0,
    updated: 0,
  }));
}

function endCol(line: string, sub: string): number {
  const i = line.indexOf(sub);
  return i < 0 ? -1 : i + sub.length - 1;
}

async function measure(n: number) {
  const now = 12 * 60 * 1000;
  const rows = makeRows(n);
  const t = await testRender(
    () => <MoreDialog theme={theme} now={() => now} children={() => rows} />,
    { width: 80, height: 40 },
  );
  await t.renderOnce();
  const lines = t.captureCharFrame().split("\n");
  const header = lines.find((l) => l.includes("STATUS") && l.includes("TOKENS")) ?? "";
  const row = lines[lines.indexOf(header) + 1] ?? "";
  t.renderer.destroy();
  return {
    header: {
      STATUS: endCol(header, "STATUS"),
      TIME: endCol(header, "TIME"),
      TOKENS: endCol(header, "TOKENS"),
      COST: endCol(header, "COST"),
    },
    row: {
      STATUS: endCol(row, "running"),
      TIME: endCol(row, "12m"),
      TOKENS: endCol(row, "1.4k"),
      COST: endCol(row, "$1.23"),
    },
  };
}

describe("MoreDialog column alignment", () => {
  test("header and data columns share the same right edge while scrolling", async () => {
    const { header, row } = await measure(10);
    expect(header.STATUS).toBe(row.STATUS);
    expect(header.TIME).toBe(row.TIME);
    expect(header.TOKENS).toBe(row.TOKENS);
    expect(header.COST).toBe(row.COST);
  });

  test("header and data columns share the same right edge without scrolling", async () => {
    const { header, row } = await measure(2);
    expect(header.STATUS).toBe(row.STATUS);
    expect(header.TIME).toBe(row.TIME);
    expect(header.TOKENS).toBe(row.TOKENS);
    expect(header.COST).toBe(row.COST);
  });
});
