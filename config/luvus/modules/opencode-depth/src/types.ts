export type AgentState = "idle" | "working" | "blocked" | "done";

export interface OpenCodeSession {
  id: string;
  parentID?: string | null;
  projectID?: string;
  agent?: string;
  title?: string;
  outcome?: "succeeded" | "failed" | "interrupted";
  time?: { created?: number; updated?: number; idle?: number };
  location?: { directory?: string };
}

export interface LuvusPane {
  pane_id: string;
  agent: string | null;
  agent_session: string | null;
  cwd: string | null;
  kind: string | null;
  focused: boolean;
  root_process: { pid: number; start_marker: string } | null;
  agent_authority: string | null;
  agent_status: string | null;
}

export interface PendingPermission {
  id: string;
  sessionID: string;
  action: string;
  message?: string;
}

export interface MappedPane {
  paneId: string;
  root: OpenCodeSession;
  /** true when the pane was resolved through cwd rather than an exact agent_session. */
  lane: boolean;
  tree: OpenCodeSession[];
}

export interface MapResult {
  mapped: MappedPane[];
  skipped: Array<{ paneId: string; reason: string }>;
}

export interface OpenCodeEvent {
  type: string;
  id?: string;
  created?: number;
  location?: { directory?: string };
  data?: Record<string, unknown>;
}

export type ShellStatus = "running" | "exited" | "timeout" | "killed";

/** `Shell.Info` as returned by `GET /api/shell`, narrowed to what the watcher tracks. */
export interface ShellInfo {
  id: string;
  status: ShellStatus;
  sessionID?: string;
}
