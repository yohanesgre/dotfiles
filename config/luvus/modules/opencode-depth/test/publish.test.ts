import { expect, test } from "bun:test";
import { classifyAgentError, Publisher, type CliResult } from "../src/publish.ts";
import { Log } from "../src/log.ts";
import { SeqStore, resolveLuvusBin } from "../src/state.ts";
import { WatcherCore, shouldAdvanceRenewal, type Settings } from "../src/watcher.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const silent = new Log(() => {});

function settings(overrides: Partial<Settings> = {}): Settings {
  return { source: "opencode/depth", ttlS: 900, maxRows: 16, bar: false, title: false, ...overrides };
}

function result(overrides: Partial<CliResult>): CliResult {
  return { code: 0, stdout: "", stderr: "", ...overrides };
}

test("classifyAgentError maps conflict, stale and everything else", () => {
  expect(classifyAgentError('{"error":{"type":"authority_conflict"}}')).toBe("conflict");
  expect(classifyAgentError("another integration owns this pane; release it first")).toBe("conflict");
  expect(classifyAgentError('{"error":{"type":"stale_report"}}')).toBe("stale");
  expect(classifyAgentError("sequence must increase for this authority")).toBe("stale");
  expect(classifyAgentError("boom")).toBe("error");
});

test("a stale report releases the pane and re-reports with a fresh sequence", () => {
  const calls: string[][] = [];
  let reports = 0;
  const runner = (args: string[]): CliResult => {
    calls.push(args);
    if (args[1] === "report") {
      reports += 1;
      if (reports === 1) return result({ code: 1, stderr: "stale_report: sequence must increase" });
      return result({ code: 0, stdout: '{"result":{"type":"agent_report"}}' });
    }
    return result({});
  };
  const seq = new SeqStore(mkdtempSync(join(tmpdir(), "depth-seq-")));
  const publisher = new Publisher({ runner, source: "opencode/depth", ttlS: 900, seq, log: silent });
  expect(publisher.reportWithRecovery("38", "working", "", "ses_x")).toBe("ok");
  expect(calls.filter((args) => args[1] === "report")).toHaveLength(2);
  expect(calls.some((args) => args[1] === "release" && args[2] === "38")).toBe(true);
});

test("a conflicted pane is skipped until the backoff expires", () => {
  const core = new WatcherCore(settings());
  core.setSessions([{ id: "ses_root", parentID: null, location: { directory: "/repo" } }]);
  const pane30 = {
    pane_id: "30",
    agent: "opencode",
    agent_session: "ses_root",
    cwd: "/repo",
    kind: "terminal",
    focused: true,
    root_process: null,
    agent_authority: null,
    agent_status: "idle",
  };
  core.setPanes([pane30]);
  core.map();
  expect(core.planReports(0)).toHaveLength(1);
  core.markReported("30", "idle", "ses_root", 0);
  expect(core.planReports(1_000)).toHaveLength(0);
  core.markConflict("30", 1_000);
  expect(core.planReports(2_000)).toHaveLength(0);
  expect(core.planReports(1_000 + 30_001)).toHaveLength(1);

  // attempts accumulate; clearResolvedConflicts must not reset them while the
  // pane is still owned by an integration report.
  core.markConflict("30", 31_001); // attempts 2 -> until 91_001
  core.clearResolvedConflicts([{ ...pane30, agent_authority: "integration_report" }]);
  core.markConflict("30", 91_001); // attempts 3 -> until 181_001
  expect(core.planReports(150_000)).toHaveLength(0);
  expect(core.planReports(181_001)).toHaveLength(1);
});

test("lease renewal is planned at ttl/3", () => {
  const core = new WatcherCore(settings({ ttlS: 900 }));
  core.setSessions([{ id: "ses_root", parentID: null, location: { directory: "/repo" } }]);
  core.setPanes([
    {
      pane_id: "30",
      agent: "opencode",
      agent_session: "ses_root",
      cwd: "/repo",
      kind: "terminal",
      focused: true,
      root_process: null,
      agent_authority: null,
      agent_status: "idle",
    },
  ]);
  core.map();
  core.markReported("30", "idle", "ses_root", 0);
  const renewMs = Math.floor((900 * 1000) / 3);
  expect(core.planReports(renewMs - 1)).toHaveLength(0);
  expect(core.planReports(renewMs)).toHaveLength(1);
});

test("titles count blocked children per tree, not per pane", () => {
  const core = new WatcherCore(settings({ title: true }));
  core.setSessions([
    { id: "ses_root", parentID: null, title: "root", location: { directory: "/repo" } },
    { id: "ses_child", parentID: "ses_root", title: "child", location: { directory: "/repo" } },
  ]);
  core.setPanes([
    {
      pane_id: "30",
      agent: "opencode",
      agent_session: "ses_root",
      cwd: "/repo",
      kind: "terminal",
      focused: true,
      root_process: null,
      agent_authority: null,
      agent_status: "idle",
    },
  ]);
  core.map();
  core.setPermissions([{ id: "per_1", sessionID: "ses_child", action: "bash" }]);
  const titles = core.buildTitles();
  expect(titles).toHaveLength(1);
  expect(titles[0]?.title).toBe("1 subagent · 1 blocked");
});

test("SIGTERM release calls agent release for every reported pane", () => {
  const calls: string[][] = [];
  const runner = (args: string[]): CliResult => {
    calls.push(args);
    return result({});
  };
  const seq = new SeqStore(mkdtempSync(join(tmpdir(), "depth-seq-")));
  const publisher = new Publisher({ runner, source: "opencode/depth", ttlS: 900, seq, log: silent });
  publisher.releaseAll(["30", "38"]);
  expect(calls).toEqual([
    ["agent", "release", "30", "--source", "opencode/depth"],
    ["agent", "release", "38", "--source", "opencode/depth"],
  ]);
});

test("resolveLuvusBin strips the deleted suffix and prefers an existing path", () => {
  const env = { LUVUS_BIN_PATH: "/home/yohanes/.local/bin/luvus (deleted)", HOME: "/home/yohanes" } as NodeJS.ProcessEnv;
  expect(resolveLuvusBin(env)).toBe("/home/yohanes/.local/bin/luvus");
  const missing = { LUVUS_BIN_PATH: "/nonexistent/luvus (deleted)", HOME: "/home/yohanes" } as NodeJS.ProcessEnv;
  expect(resolveLuvusBin(missing)).toBe(join("/home/yohanes", ".local", "bin", "luvus"));
});

test("report classifies from the JSON envelope, not substrings", () => {
  const seq = () => new SeqStore(mkdtempSync(join(tmpdir(), "depth-seq-")));
  const reportWith = (stdout: string, code = 0) => {
    const publisher = new Publisher({
      runner: () => ({ code, stdout, stderr: "" }),
      source: "opencode/depth",
      ttlS: 900,
      seq: seq(),
      log: silent,
    });
    return publisher.report("30", "working", "", "ses_x");
  };
  // success envelope whose payload text contains the word "error"
  expect(reportWith('{"result":{"type":"agent_report","message":"no error here"}}')).toBe("ok");
  // plain success
  expect(reportWith('{"result":{"type":"agent_report"}}')).toBe("ok");
  // error envelopes
  expect(reportWith('{"error":{"type":"authority_conflict"}}')).toBe("conflict");
  expect(reportWith('{"error":{"type":"stale_report"}}')).toBe("stale");
  expect(reportWith('{"error":{"type":"forbidden"}}')).toBe("error");
  // exit 0 but unparseable stdout is not success
  expect(reportWith("not json")).toBe("error");
});

test("shouldAdvanceRenewal ignores conflicts but not errors", () => {
  expect(shouldAdvanceRenewal([])).toBe(true);
  expect(shouldAdvanceRenewal(["ok"])).toBe(true);
  expect(shouldAdvanceRenewal(["ok", "conflict"])).toBe(true);
  expect(shouldAdvanceRenewal(["ok", "error"])).toBe(false);
  expect(shouldAdvanceRenewal(["stale"])).toBe(false);
  expect(shouldAdvanceRenewal(["conflict", "stale"])).toBe(false);
});
