import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { paneIdFromValue, runFocusPane } from "../src/focus-pane.ts";

test("paneIdFromValue accepts pane ids and rejects anything else", () => {
  expect(paneIdFromValue("30")).toBe("30");
  expect(paneIdFromValue(" 7 ")).toBe("7");
  expect(paneIdFromValue("0")).toBeNull();
  expect(paneIdFromValue("1; rm -rf /")).toBeNull();
  expect(paneIdFromValue("../30")).toBeNull();
  expect(paneIdFromValue(undefined)).toBeNull();
});

test("runFocusPane ignores a missing value and focuses a valid one", () => {
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    return { code: 0 };
  };
  expect(runFocusPane({ env: { LUVUS_MODULE_ROW_VALUE: "" } as NodeJS.ProcessEnv, run })).toBe(0);
  expect(calls).toEqual([]);
  expect(runFocusPane({ env: { LUVUS_MODULE_ROW_VALUE: "30" } as NodeJS.ProcessEnv, run })).toBe(0);
  expect(calls).toEqual([["pane", "focus", "30"]]);
});

test("the manifest declares the focus-pane action", () => {
  const manifest = readFileSync(new URL("../luvus-module.toml", import.meta.url), "utf8");
  expect(manifest).toContain('id = "focus-pane"');
  expect(manifest).toContain("src/focus-pane.ts");
});
