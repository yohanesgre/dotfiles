// Shared contract for the subagents sidebar plugin.
// Shapes mirror @opencode-ai/client generated SessionInfo types.

export type SubagentStatus = "running" | "idle" | "done" | "error";

export interface SubagentSummary {
  sessionID: string;
  agent: string;
  title: string;
  model: string;
  status: SubagentStatus;
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
}

export interface SubagentsState {
  children: SubagentSummary[];
  loading: boolean;
  syncing: boolean;
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
  if (info.outcome === "failed") return "error";
  if (info.outcome) return "done";
  return info.status === "running" ? "running" : "idle";
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
    time: { created: number; updated: number };
  },
  status: "idle" | "running",
): SubagentSummary {
  const t = info.tokens;
  return {
    sessionID: info.id,
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
  };
}
