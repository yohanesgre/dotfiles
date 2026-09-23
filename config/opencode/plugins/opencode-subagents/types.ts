// Shared contract for the subagents sidebar plugin.
// Shapes mirror @opencode-ai/client generated SessionInfo types.

export type SubagentStatus = "running" | "idle" | "done" | "error" | "interrupted";

export interface SubagentSummary {
  sessionID: string;
  depth: number;
  agent: string;
  title: string;
  model: string;
  status: SubagentStatus;
  // One activity token shown in place of the state label while running
  // (Phase A renders the status label; the field is wired for Phase 3).
  activity?: string;
  outcome?: "succeeded" | "failed" | "interrupted";
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
  cost: number;
  created: number;
  updated: number;
  // Completion time (session record's `time.idle`). Updated on every idle, so a
  // resumed running session may carry a stale value — the status check wins.
  idle?: number;
}

export interface SubagentsState {
  children: SubagentSummary[];
  // True once a descendant fetch has succeeded at least once. Distinguishes
  // the loading void state from a genuinely empty descendant set.
  hydrated: boolean;
  // Children whose per-id sync/get threw during the last refresh; when > 0 and
  // rows exist the section renders the partial footer instead of a bare list.
  failedCount: number;
  error: string | undefined;
  lastUpdated: number;
}

export interface UseSubagents {
  readonly state: SubagentsState;
}

export function subagentStatus(info: {
  outcome?: "succeeded" | "failed" | "interrupted";
  status: "idle" | "running";
}): SubagentStatus {
  if (info.status === "running") return "running";
  if (info.outcome === "failed") return "error";
  if (info.outcome === "interrupted") return "interrupted";
  if (info.outcome) return "done";
  return "idle";
}

export function modelLabel(model?: { providerID: string; id: string; variant?: string }): string {
  if (!model) return "unknown";
  return model.variant ? `${model.providerID}/${model.id} (${model.variant})` : `${model.providerID}/${model.id}`;
}

export function summarizeSession(
  info: {
    id: string;
    agent?: string;
    title?: string;
    model?: { providerID: string; id: string; variant?: string };
    cost: number;
    outcome?: "succeeded" | "failed" | "interrupted";
    tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
    time: { created: number; updated: number; idle?: number };
  },
  status: "idle" | "running",
  depth: number,
): SubagentSummary {
  const t = info.tokens;
  return {
    sessionID: info.id,
    depth,
    agent: info.agent ?? "agent",
    title: info.title ?? info.id,
    model: modelLabel(info.model),
    status: subagentStatus({ outcome: info.outcome, status }),
    outcome: info.outcome,
    tokens: {
      input: t?.input ?? 0,
      output: t?.output ?? 0,
      reasoning: t?.reasoning ?? 0,
      cacheRead: t?.cache.read ?? 0,
      cacheWrite: t?.cache.write ?? 0,
    },
    cost: info.cost ?? 0,
    created: info.time.created,
    updated: info.time.updated,
    idle: info.time.idle,
  };
}
