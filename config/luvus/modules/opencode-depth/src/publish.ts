import { spawnSync } from "node:child_process";
import { Log } from "./log.ts";
import { SeqStore, resolveLuvusBin } from "./state.ts";
import type { AgentState } from "./types.ts";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CliRunner = (args: string[]) => CliResult;

export type ReportOutcome = "ok" | "conflict" | "stale" | "error";

/** A hung luvus CLI must not freeze the watcher's event loop. */
export const CLI_TIMEOUT_MS = 5000;

export function defaultRunner(args: string[]): CliResult {
  const bin = resolveLuvusBin();
  const result = spawnSync(bin, args, { encoding: "utf8", env: process.env, timeout: CLI_TIMEOUT_MS });
  const stderr = result.error ? `${result.stderr ?? ""}${String(result.error)}` : result.stderr ?? "";
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr };
}

/**
 * Classifies an `agent report` failure from the combined CLI output. The exact
 * error code is `authority_conflict` or `stale_report`; message text is a
 * fallback for older builds.
 */
export function classifyAgentError(output: string): ReportOutcome {
  const text = output.toLowerCase();
  if (text.includes("authority_conflict") || text.includes("another integration owns")) return "conflict";
  if (text.includes("stale_report") || text.includes("sequence must increase")) return "stale";
  return "error";
}

/**
 * Success is exit 0 with a JSON envelope that has no top-level `error` field.
 * Never substring-match the raw text: a payload string may contain "error".
 * An unparseable non-empty stdout is treated as an error.
 */
export function envelopeHasError(stdout: string): boolean {
  const text = stdout.trim();
  if (text.length === 0) return false;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
      return Boolean((parsed as { error?: unknown }).error);
    }
    return false;
  } catch {
    return true;
  }
}

export interface PublisherOptions {
  runner?: CliRunner;
  source: string;
  ttlS: number;
  seq: SeqStore;
  log: Log;
  kind?: string;
}

/** Owns the `agent.report` / `agent.release` lease lifecycle. */
export class Publisher {
  private readonly runner: CliRunner;

  constructor(private readonly options: PublisherOptions) {
    this.runner = options.runner ?? defaultRunner;
  }

  report(
    paneId: string,
    status: AgentState,
    message: string,
    sessionId?: string,
  ): ReportOutcome {
    const args = [
      "agent",
      "report",
      paneId,
      "--source",
      this.options.source,
      "--kind",
      this.options.kind ?? "opencode",
      "--status",
      status,
    ];
    if (message.length > 0) args.push("--message", message);
    if (sessionId && sessionId.length > 0) args.push("--session", sessionId);
    args.push("--sequence", String(this.options.seq.next()), "--ttl", String(this.options.ttlS));

    const result = this.runner(args);
    if (result.code === 0 && !envelopeHasError(result.stdout)) return "ok";
    const outcome = classifyAgentError(`${result.stdout}\n${result.stderr}`);
    if (outcome === "error") {
      this.options.log.warn(`agent.report pane ${paneId} failed (exit ${result.code}): ${this.options.log.redact(result.stderr.trim() || result.stdout.trim())}`);
    }
    return outcome;
  }

  /** On a stale sequence, release and re-report once with a fresh authority. */
  reportWithRecovery(
    paneId: string,
    status: AgentState,
    message: string,
    sessionId?: string,
  ): ReportOutcome {
    const first = this.report(paneId, status, message, sessionId);
    if (first !== "stale") return first;
    this.options.log.warn(`stale_report on pane ${paneId}; releasing and re-reporting`);
    this.release(paneId);
    return this.report(paneId, status, message, sessionId);
  }

  release(paneId: string): boolean {
    const result = this.runner(["agent", "release", paneId, "--source", this.options.source]);
    if (result.code !== 0) {
      this.options.log.warn(`agent.release pane ${paneId} failed (exit ${result.code})`);
      return false;
    }
    return true;
  }

  releaseAll(paneIds: Iterable<string>): void {
    for (const paneId of paneIds) this.release(paneId);
  }
}

export interface DockRow {
  text: string;
  dot?: AgentState;
  tone?: "normal" | "muted" | "accent" | "success" | "warning" | "error";
  action?: string;
  value?: string;
}

export type BarTone = "normal" | "muted" | "accent" | "success" | "warning" | "error";

export interface BarSegment {
  type: "text" | "symbol" | "state" | "badge" | "progress" | "spacer" | "separator";
  text?: string;
  state?: AgentState;
  tone?: BarTone;
  label?: string;
  value?: number | string;
  action?: string;
}

export class UiPublisher {
  constructor(
    private readonly runner: CliRunner,
    private readonly log: Log,
  ) {}

  private run(args: string[]): boolean {
    const result = this.runner(args);
    if (result.code === 0) return true;
    this.log.warn(`ui command failed (${args.slice(0, 3).join(" ")}): ${this.log.redact(result.stderr.trim() || result.stdout.trim())}`);
    return false;
  }

  pushDock(dockId: string, title: string, rows: DockRow[]): boolean {
    return this.run(["ui", "dock", "push", "--id", dockId, "--title", title, "--rows", JSON.stringify(rows)]);
  }

  clearDock(dockId: string): boolean {
    return this.pushDock(dockId, "OPENCODE", []);
  }

  pushBar(barId: string, region: string, content: BarSegment[]): boolean {
    return this.run(["bar", "push", "--id", barId, "--region", region, "--content", JSON.stringify(content)]);
  }

  removeBar(barId: string): boolean {
    return this.run(["bar", "remove", "--id", barId]);
  }

  pushTitles(titles: Array<{ pane: string; title: string }>): boolean {
    if (titles.length === 0) return true;
    return this.run(["ui", "agent-title", "push", "--titles", JSON.stringify(titles)]);
  }

  clearTitles(): boolean {
    return this.run(["ui", "agent-title", "clear"]);
  }
}
