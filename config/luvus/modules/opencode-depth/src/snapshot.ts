import { connect } from "node:net";
import { spawnSync } from "node:child_process";
import { resolveLuvusBin } from "./state.ts";
import type { LuvusPane } from "./types.ts";

export interface UhpRequest {
  id: string;
  method: string;
  params?: unknown;
}

export interface UhpResponse {
  id?: string;
  result?: unknown;
  error?: { type?: string; message?: string } | null;
}

export type UhpTransport = (request: UhpRequest) => Promise<UhpResponse>;
export type CliRunner = (args: string[]) => { code: number; stdout: string; stderr: string };

/** Minimal newline-delimited JSON UHP client over the inherited unix socket. */
export function createSocketTransport(socketPath: string, timeoutMs = 5000): UhpTransport {
  return (request: UhpRequest) =>
    new Promise<UhpResponse>((resolve, reject) => {
      const socket = connect(socketPath);
      let buffer = "";
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error("uhp socket timeout"))), timeoutMs);
      socket.setEncoding("utf8");
      socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        try {
          const parsed = JSON.parse(line) as UhpResponse;
          finish(() => resolve(parsed));
        } catch (error) {
          finish(() => reject(error));
        }
      });
      socket.on("error", (error) => finish(() => reject(error)));
      socket.on("close", () => finish(() => reject(new Error("uhp socket closed before a response"))));
    });
}

/** Pulls the pane array out of a `session_snapshot` result (or a fenced CLI envelope). */
export function extractPanes(payload: unknown): LuvusPane[] {
  const envelope = (payload ?? {}) as Record<string, unknown>;
  const result = (envelope.result ?? envelope) as Record<string, unknown>;
  const workspaces = Array.isArray(result.workspaces) ? result.workspaces : [];
  const panes: LuvusPane[] = [];
  for (const workspace of workspaces) {
    const tabs = Array.isArray((workspace as Record<string, unknown>).tabs)
      ? ((workspace as Record<string, unknown>).tabs as unknown[])
      : [];
    for (const tab of tabs) {
      const tabPanes = Array.isArray((tab as Record<string, unknown>).panes)
        ? ((tab as Record<string, unknown>).panes as unknown[])
        : [];
      for (const pane of tabPanes) {
        const normalized = normalizePane(pane);
        if (normalized) panes.push(normalized);
      }
    }
  }
  return panes;
}

function normalizePane(raw: unknown): LuvusPane | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.pane_id !== "string") return null;
  return {
    pane_id: p.pane_id,
    agent: typeof p.agent === "string" ? p.agent : null,
    agent_session: typeof p.agent_session === "string" ? p.agent_session : null,
    cwd: typeof p.cwd === "string" ? p.cwd : null,
    kind: typeof p.kind === "string" ? p.kind : null,
    focused: p.focused === true,
    root_process:
      typeof p.root_process === "object" && p.root_process !== null
        ? (p.root_process as { pid: number; start_marker: string })
        : null,
    agent_authority: typeof p.agent_authority === "string" ? p.agent_authority : null,
    agent_status: typeof p.agent_status === "string" ? p.agent_status : null,
  };
}

export interface SnapshotOptions {
  socketPath?: string;
  transport?: UhpTransport;
  cli?: CliRunner;
}

/**
 * Reads the Luvus session snapshot. Tries the raw UHP socket first and falls
 * back to `luvus uhp snapshot` when the socket or method is unavailable.
 */
export class SnapshotReader {
  private readonly transport: UhpTransport | undefined;
  private readonly cli: CliRunner;

  constructor(options: SnapshotOptions = {}) {
    if (options.transport) this.transport = options.transport;
    else if (options.socketPath) this.transport = createSocketTransport(options.socketPath);
    this.cli = options.cli ?? defaultCliRunner;
  }

  async read(): Promise<LuvusPane[]> {
    if (this.transport) {
      try {
        const response = await this.transport({ id: "snapshot", method: "session.snapshot", params: {} });
        if (response.error) throw new Error(`uhp error: ${response.error.type ?? "unknown"}`);
        return extractPanes(response.result);
      } catch {
        // fall through to the CLI
      }
    }
    const result = this.cli(["uhp", "snapshot"]);
    if (result.code !== 0) throw new Error(`luvus uhp snapshot -> exit ${result.code}`);
    return extractPanes(JSON.parse(result.stdout));
  }
}

export function defaultCliRunner(args: string[]): { code: number; stdout: string; stderr: string } {
  const bin = resolveLuvusBin();
  const result = spawnSync(bin, args, { encoding: "utf8", env: process.env, timeout: 5000 });
  const stderr = result.error ? `${result.stderr ?? ""}${String(result.error)}` : result.stderr ?? "";
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr };
}
