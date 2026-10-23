/**
 * Read-only progress observation for the /goal command center.
 *
 * Reads the coordinator-owned canonical artifacts (plan.md, status.md,
 * lanes/*.md, report.md) under the resolved plan root. It never writes child
 * artifacts, never prompts a model, and never infers completion from token
 * output or a harness turn end. Observations are bound to the current
 * coordinator attempt and appended to the command-center journal through
 * CoordinatorStore.appendObservation.
 *
 * Refresh is coalesced: at most one read per plan at a time, automatic refresh
 * defaults to one pass per 5000 ms per plan, and an explicit force override is
 * the only way to read earlier. Snapshot freshness, coordinator lifecycle and
 * the child's PLAN|WAIT|WORKING|DONE|FAILED heartbeat stay separate fields.
 */
import type { Stats } from "node:fs";
import { lstatSync, promises as fsp, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  CoordinatorStore,
  type CoordinatorLifecycle,
  type ArtifactBaseline,
  type JournalRecovery,
  type LaneObservation,
  type LastObservation,
  type ManagerIdentity,
  type PlanHeartbeatState,
  type PlanRecord,
  type RuntimeProfile,
} from "./coordinator-state";

const PLAN_STATES: readonly PlanHeartbeatState[] = [
  "PLAN",
  "WAIT",
  "WORKING",
  "DONE",
  "FAILED",
];
const LANE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_LANES = 32;
const MAX_SOURCE_ITEMS = 8;
const DEFAULT_REFRESH_MS = 5_000;
const DEFAULT_FRESHNESS_MS = 30_000;

export interface HeartbeatObservation {
  state: PlanHeartbeatState | null;
  /** Epoch milliseconds, normalised from the heartbeat's epoch seconds. */
  ts: number | null;
  msg: string | null;
  /** True only when the file has at most three recognised heartbeat lines. */
  valid: boolean;
  line_count: number;
}

export interface PlanDocumentObservation {
  gate: string | null;
  wave: string | null;
  next_action: string | null;
}

export interface PlanBinding {
  goal_id: string;
  approved_revision: string;
  request_id: string | null;
  attempt: number | null;
  lifecycle: CoordinatorLifecycle | null;
  manager: ManagerIdentity | null;
  runtime: ManagerIdentity | null;
  runtime_profile: RuntimeProfile;
  artifact_baseline: ArtifactBaseline | null;
  working_directory: string | null;
}

export interface PlanProgressSnapshot {
  plan_id: string;
  plan_path: string;
  binding: PlanBinding;
  observed: {
    state: PlanHeartbeatState | null;
    wave: string | null;
    lanes: LaneObservation[] | null;
    blocker: { text: string; source: "status.md" } | null;
    next_action: string | null;
    evidence: {
      report_path: string | null;
      report_result: string | null;
      tests: string[];
    };
    status_msg: string | null;
    heartbeat_ts: number | null;
    heartbeat_valid: boolean;
  };
  freshness: {
    artifact_read_at: number | null;
    meaningful_progress_at: number | null;
    runtime_event_at: number | null;
    age_ms: number | null;
    meaningful_age_ms: number | null;
    status: "fresh" | "stale" | "unknown";
  };
  observation: {
    applied: boolean;
    inconsistent: boolean;
    reason: string | null;
    fingerprint: string | null;
  };
  activity_gap: {
    from_seq: number;
    to_seq: number;
    since: number;
    until: number;
  } | null;
}

export interface ProgressRecovery extends JournalRecovery {
  snapshots: PlanProgressSnapshot[];
}

export interface CoordinatorProgressOptions {
  store: CoordinatorStore;
  refresh_interval_ms?: number;
  freshness_ms?: number;
  gap_ms?: number;
  now?: () => number;
}

interface FileProbe {
  status: "ok" | "missing" | "unsafe" | "too_large" | "unstable" | "error";
  content: string | null;
  reason: string | null;
}

interface LaneDirectoryProbe {
  status:
    | "ok"
    | "missing"
    | "unsafe"
    | "unstable"
    | "invalid_heartbeat"
    | "error";
  lanes: LaneObservation[] | null;
  files: string[];
  reason: string | null;
}

interface ReportObservation {
  result: string | null;
  tests: string[];
}

interface PlanRuntimeState {
  timer: ReturnType<typeof setInterval> | null;
  in_flight: Promise<PlanProgressSnapshot> | null;
  last_refresh_at: number | null;
  last_success_at: number | null;
  last_seen_seq: number;
  runtime_event_at: number | null;
  snapshot: PlanProgressSnapshot | null;
}

interface ObservedFields {
  state: PlanHeartbeatState | null;
  wave: string | null;
  lanes: LaneObservation[] | null;
  blocker: { text: string; source: "status.md" } | null;
  next_action: string | null;
  evidence: {
    report_path: string | null;
    report_result: string | null;
    tests: string[];
  };
  status_msg: string | null;
  heartbeat_ts: number | null;
  heartbeat_valid: boolean;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function cleanText(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  let text = value.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  text = text.replace(
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    "Bearer [redacted]",
  );
  text = text.replace(
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)\b\s*[:=]\s*\S+/gi,
    "$1=[redacted]",
  );
  text = text.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted]");
  return text.slice(0, maxLength);
}

export function parseHeartbeat(text: string | null): HeartbeatObservation {
  if (text === null || text.trim().length === 0) {
    return { state: null, ts: null, msg: null, valid: false, line_count: 0 };
  }
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  let state: PlanHeartbeatState | null = null;
  let ts: number | null = null;
  let msg: string | null = null;
  let valid = lines.length > 0 && lines.length <= 3;
  const seen = new Set<string>();
  for (const line of lines) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!match) {
      valid = false;
      continue;
    }
    const key = match[1] as string;
    const raw = (match[2] as string).trim();
    if (seen.has(key)) valid = false;
    seen.add(key);
    if (key === "state") {
      if (
        typeof raw === "string" &&
        PLAN_STATES.includes(raw as PlanHeartbeatState)
      ) {
        state = raw as PlanHeartbeatState;
      } else {
        valid = false;
      }
    } else if (key === "ts") {
      if (/^\d+(?:\.\d+)?$/.test(raw)) {
        const value = Number(raw);
        if (Number.isFinite(value) && value > 0) {
          ts = value < 1_000_000_000_000 ? Math.round(value * 1000) : Math.round(value);
        } else {
          valid = false;
        }
      } else {
        valid = false;
      }
    } else if (key === "msg") {
      msg = raw.length > 0 ? raw : null;
      if (msg === null) valid = false;
    } else {
      valid = false;
    }
  }
  if (state === null || ts === null || msg === null) valid = false;
  if (!valid) {
    return { state: null, ts: null, msg: null, valid: false, line_count: lines.length };
  }
  return { state, ts, msg, valid, line_count: lines.length };
}

export function parsePlanDocument(text: string | null): PlanDocumentObservation {
  if (text === null) {
    return { gate: null, wave: null, next_action: null };
  }
  let gate: string | null = null;
  let wave: string | null = null;
  let nextAction: string | null = null;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(?:#{2,}\s|`{3,}|~{3,})/.test(line)) break;
    if (gate === null) {
      const gateMatch = /^gate:\s*(.+)$/.exec(line);
      if (gateMatch) gate = (gateMatch[1] as string).trim() || null;
    }
    if (wave === null) {
      const iterMatch = /^iter:\s*(\S+)/.exec(line);
      if (iterMatch) {
        const value = (iterMatch[1] as string).trim();
        const waveMatch = /^(W\d+i\d+)/.exec(value);
        wave = waveMatch ? (waveMatch[1] as string) : null;
      }
    }
    if (nextAction === null) {
      const actionMatch = /^next_action:\s*(.+)$/.exec(line);
      if (actionMatch) {
        nextAction = (actionMatch[1] as string).trim() || null;
      }
    }
  }
  return { gate, wave, next_action: nextAction };
}

function parseReportDocument(text: string | null): ReportObservation {
  if (text === null) return { result: null, tests: [] };
  let result: string | null = null;
  const tests: string[] = [];
  let inTests = false;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (match) {
      const key = match[1] as string;
      const value = (match[2] as string).trim();
      inTests = key === "tests";
      if (key === "result" && result === null) result = value || null;
      if (inTests && value.length > 0) tests.push(value);
      continue;
    }
    if (inTests && line.trim().length > 0 && tests.length < 8) {
      tests.push(line.trim());
    }
  }
  return { result, tests: tests.slice(0, 8) };
}

async function stableReadFile(path: string): Promise<FileProbe> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let before: Stats;
    try {
      before = await fsp.lstat(path);
    } catch (error) {
      if (isEnoent(error)) {
        return { status: "missing", content: null, reason: null };
      }
      return {
        status: "error",
        content: null,
        reason: `cannot inspect artifact: ${String(error)}`,
      };
    }
    if (before.isSymbolicLink() || !before.isFile()) {
      return {
        status: "unsafe",
        content: null,
        reason: "artifact must be a regular file, not a symlink",
      };
    }
    if (before.size > MAX_ARTIFACT_BYTES) {
      return {
        status: "too_large",
        content: null,
        reason: `artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`,
      };
    }
    let content: string;
    try {
      content = await fsp.readFile(path, "utf8");
    } catch (error) {
      if (isEnoent(error)) continue;
      return {
        status: "error",
        content: null,
        reason: `cannot read artifact: ${String(error)}`,
      };
    }
    let after: Stats;
    try {
      after = await fsp.lstat(path);
    } catch (error) {
      if (isEnoent(error)) continue;
      return {
        status: "error",
        content: null,
        reason: `cannot re-inspect artifact: ${String(error)}`,
      };
    }
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      continue;
    }
    return { status: "ok", content, reason: null };
  }
  return {
    status: "unstable",
    content: null,
    reason: "artifact changed while it was being read",
  };
}

async function readLaneDirectory(path: string): Promise<LaneDirectoryProbe> {
  let stat: Stats;
  try {
    stat = await fsp.lstat(path);
  } catch (error) {
    if (isEnoent(error)) {
      return { status: "missing", lanes: null, files: [], reason: null };
    }
    return {
      status: "error",
      lanes: null,
      files: [],
      reason: `cannot inspect lanes directory: ${String(error)}`,
    };
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return {
      status: "unsafe",
      lanes: null,
      files: [],
      reason: "lanes must be a real directory, not a symlink",
    };
  }
  let names: string[];
  try {
    names = (await fsp.readdir(path)).sort();
  } catch (error) {
    return {
      status: "error",
      lanes: null,
      files: [],
      reason: `cannot list lanes: ${String(error)}`,
    };
  }
  const lanes: LaneObservation[] = [];
  const files: string[] = [];
  for (const filename of names) {
    if (!filename.endsWith(".md")) continue;
    const name = filename.slice(0, -3);
    if (!LANE_NAME_RE.test(name)) {
      return {
        status: "unsafe",
        lanes: null,
        files: [],
        reason: `lane filename is not a safe name: ${filename}`,
      };
    }
    if (lanes.length >= MAX_LANES) {
      return {
        status: "unsafe",
        lanes: null,
        files: [],
        reason: `more than ${MAX_LANES} lane files`,
      };
    }
    const probe = await stableReadFile(join(path, filename));
    if (probe.status === "missing") continue;
    if (probe.status !== "ok") {
      return {
        status:
          probe.status === "unstable" ? "unstable" : "unsafe",
        lanes: null,
        files: [],
        reason: probe.reason,
      };
    }
    const heartbeat = parseHeartbeat(probe.content);
    if (!heartbeat.valid) {
      return {
        status: "invalid_heartbeat",
        lanes: null,
        files: [],
        reason: `lane ${filename} is not a valid three-line heartbeat`,
      };
    }
    lanes.push({
      name,
      state: heartbeat.state,
      msg: cleanText(heartbeat.msg, 500),
      updated_at: heartbeat.ts,
    });
    files.push(filename);
  }
  return { status: "ok", lanes, files, reason: null };
}

function planDirectoryState(path: string): "ok" | "missing" | "unsafe" {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return "unsafe";
    return realpathSync(path) === path ? "ok" : "unsafe";
  } catch (error) {
    if (isEnoent(error)) return "missing";
    return "unsafe";
  }
}

function bindingOf(plan: PlanRecord, goalId: string): PlanBinding {
  const coordinator = plan.coordinator;
  return {
    goal_id: goalId,
    approved_revision: plan.approved_revision,
    request_id: coordinator?.request_id ?? null,
    attempt: coordinator?.attempt ?? null,
    lifecycle: coordinator?.lifecycle ?? null,
    manager: coordinator?.manager ?? null,
    runtime: coordinator?.runtime ?? null,
    runtime_profile: { ...plan.runtime },
    artifact_baseline: coordinator?.artifact_baseline
      ? { ...coordinator.artifact_baseline }
      : null,
    working_directory: coordinator?.working_directory ?? null,
  };
}

function sameBinding(left: PlanBinding, right: PlanBinding): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function emptyObserved(): ObservedFields {
  return {
    state: null,
    wave: null,
    lanes: null,
    blocker: null,
    next_action: null,
    evidence: { report_path: null, report_result: null, tests: [] },
    status_msg: null,
    heartbeat_ts: null,
    heartbeat_valid: false,
  };
}

function fingerprintObservation(
  observation: ObservedFields,
  binding: PlanBinding,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        attempt: binding.attempt,
        request_id: binding.request_id,
        state: observation.state,
        wave: observation.wave,
        lanes:
          observation.lanes === null
            ? null
            : observation.lanes.map((lane) => ({
                name: lane.name,
                state: lane.state,
                msg: lane.msg,
              })),
        blocker: observation.blocker,
        next_action: observation.next_action,
        evidence_report: observation.evidence.report_path,
        status_msg: observation.status_msg,
      }),
    )
    .digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function freshnessStatus(
  artifactReadAt: number | null,
  now: number,
  freshnessMs: number,
  inconsistent: boolean,
): "fresh" | "stale" | "unknown" {
  if (artifactReadAt === null || inconsistent) return "unknown";
  return now - artifactReadAt <= freshnessMs ? "fresh" : "stale";
}

function snapshotMatchesPlan(
  snapshot: PlanProgressSnapshot,
  plan: PlanRecord,
  goalId: string,
): boolean {
  return JSON.stringify(snapshot.binding) === JSON.stringify(bindingOf(plan, goalId));
}

export class CoordinatorProgress {
  readonly store: CoordinatorStore;

  private readonly refreshIntervalMs: number;
  private readonly freshnessMs: number;
  private readonly gapMs: number;
  private readonly nowFn: () => number;
  private readonly states = new Map<string, PlanRuntimeState>();

  constructor(options: CoordinatorProgressOptions) {
    if (!options || typeof options !== "object") {
      throw new TypeError("CoordinatorProgress options must be an object");
    }
    if (!(options.store instanceof CoordinatorStore)) {
      throw new TypeError("CoordinatorProgress requires a CoordinatorStore");
    }
    this.store = options.store;
    this.refreshIntervalMs =
      options.refresh_interval_ms ?? DEFAULT_REFRESH_MS;
    if (
      !Number.isInteger(this.refreshIntervalMs) ||
      this.refreshIntervalMs < DEFAULT_REFRESH_MS ||
      this.refreshIntervalMs > 600_000
    ) {
      throw new TypeError(
        `refresh_interval_ms must be an integer in [${DEFAULT_REFRESH_MS}, 600000]`,
      );
    }
    this.freshnessMs = options.freshness_ms ?? DEFAULT_FRESHNESS_MS;
    if (
      !Number.isInteger(this.freshnessMs) ||
      this.freshnessMs < 1_000 ||
      this.freshnessMs > 3_600_000
    ) {
      throw new TypeError("freshness_ms must be an integer in [1000, 3600000]");
    }
    this.gapMs =
      options.gap_ms ?? Math.max(this.refreshIntervalMs * 3, 15_000);
    if (!Number.isInteger(this.gapMs) || this.gapMs < this.refreshIntervalMs) {
      throw new TypeError("gap_ms must be an integer at least refresh_interval_ms");
    }
    if (options.now !== undefined && typeof options.now !== "function") {
      throw new TypeError("now must be a function");
    }
    this.nowFn = options.now ?? (() => Date.now());
  }

  private now(): number {
    return this.nowFn();
  }

  private stateFor(planId: string): PlanRuntimeState {
    const existing = this.states.get(planId);
    if (existing) return existing;
    const created: PlanRuntimeState = {
      timer: null,
      in_flight: null,
      last_refresh_at: null,
      last_success_at: null,
      last_seen_seq: 0,
      runtime_event_at: null,
      snapshot: null,
    };
    this.states.set(planId, created);
    return created;
  }

  /**
   * Record transport activity for freshness only. It never advances
   * meaningful progress, never journals anything, and returns false when the
   * supplied binding is not the currently acknowledged attempt.
   */
  noteRuntimeActivity(
    plan_id: string,
    binding: { request_id: string; attempt: number },
    received_at?: number,
  ): boolean {
    if (
      !binding ||
      typeof binding.request_id !== "string" ||
      !Number.isInteger(binding.attempt)
    ) {
      throw new TypeError("runtime activity binding must be {request_id, attempt}");
    }
    const timestamp = received_at ?? this.now();
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new TypeError("received_at must be a finite timestamp");
    }
    const state = this.store.read();
    const plan = state.record.plans.find((item) => item.plan_id === plan_id);
    const coordinator = plan?.coordinator ?? null;
    if (
      !plan ||
      !coordinator ||
      coordinator.request_id !== binding.request_id ||
      coordinator.attempt !== binding.attempt ||
      coordinator.lifecycle === "STOPPED"
    ) {
      return false;
    }
    const runtime = this.stateFor(plan_id);
    runtime.runtime_event_at = timestamp;
    if (runtime.snapshot) {
      runtime.snapshot.freshness.runtime_event_at = timestamp;
      runtime.snapshot.freshness.age_ms =
        runtime.snapshot.freshness.artifact_read_at === null
          ? null
          : Math.max(0, this.now() - runtime.snapshot.freshness.artifact_read_at);
    }
    return true;
  }

  start(plan_id: string): void {
    const state = this.store.read();
    if (!state.record.plans.some((plan) => plan.plan_id === plan_id)) {
      throw new Error(`plan ${plan_id} is not registered in this goal`);
    }
    const runtime = this.stateFor(plan_id);
    if (runtime.timer) return;
    void this.refresh(plan_id).catch(() => {
      // The next tick or an explicit status request observes reality again.
    });
    const timer = setInterval(() => {
      void this.refresh(plan_id).catch(() => {
        // Keep the periodic observer alive; snapshots retain their last truth.
      });
    }, this.refreshIntervalMs);
    const unrefTimer = timer as unknown as { unref?: () => void };
    unrefTimer.unref?.();
    runtime.timer = timer;
  }

  /** Stop periodic reads after confirmed shutdown/final reconciliation. */
  stop(plan_id: string): void {
    const runtime = this.states.get(plan_id);
    if (!runtime) return;
    if (runtime.timer) {
      clearInterval(runtime.timer);
      runtime.timer = null;
    }
  }

  stopAll(): void {
    for (const planId of [...this.states.keys()]) this.stop(planId);
  }

  close(): void {
    this.stopAll();
  }

  async refresh(
    plan_id: string,
    options: { force?: boolean } = {},
  ): Promise<PlanProgressSnapshot> {
    const runtime = this.stateFor(plan_id);
    if (runtime.in_flight) return runtime.in_flight;
    const now = this.now();
    if (
      options.force !== true &&
      runtime.snapshot !== null &&
      runtime.last_refresh_at !== null &&
      now - runtime.last_refresh_at < this.refreshIntervalMs
    ) {
      const state = this.store.read();
      const plan = state.record.plans.find((item) => item.plan_id === plan_id);
      if (
        plan !== undefined &&
        snapshotMatchesPlan(runtime.snapshot, plan, this.store.goal_id)
      ) {
        return this.withFreshness(runtime.snapshot, now);
      }
    }
    const inFlight = this.performRefresh(plan_id)
      .then((snapshot) => {
        if (snapshot.binding.lifecycle === "STOPPED") {
          this.stop(plan_id);
        }
        return snapshot;
      })
      .finally(() => {
        const current = this.states.get(plan_id);
        if (current) current.in_flight = null;
      });
    runtime.in_flight = inFlight;
    return inFlight;
  }

  async refreshAll(
    options: { force?: boolean } = {},
  ): Promise<PlanProgressSnapshot[]> {
    const state = this.store.read();
    return Promise.all(
      state.record.plans.map((plan) => this.refresh(plan.plan_id, options)),
    );
  }

  snapshot(plan_id: string): PlanProgressSnapshot {
    const state = this.store.read();
    const plan = state.record.plans.find((item) => item.plan_id === plan_id);
    if (!plan) throw new Error(`plan ${plan_id} is not registered in this goal`);
    const runtime = this.states.get(plan_id);
    if (
      runtime?.snapshot &&
      snapshotMatchesPlan(runtime.snapshot, plan, this.store.goal_id)
    ) {
      return this.withFreshness(runtime.snapshot, this.now());
    }
    return this.persistedSnapshot(plan);
  }

  snapshots(): PlanProgressSnapshot[] {
    const state = this.store.read();
    return state.record.plans.map((plan) => {
      const runtime = this.states.get(plan.plan_id);
      if (
        runtime?.snapshot &&
        snapshotMatchesPlan(runtime.snapshot, plan, this.store.goal_id)
      ) {
        return this.withFreshness(runtime.snapshot, this.now());
      }
      return this.persistedSnapshot(plan);
    });
  }

  async recover(): Promise<ProgressRecovery> {
    const recovery = this.store.recoverJournal();
    const state = this.store.read();
    for (const plan of state.record.plans) {
      const runtime = this.stateFor(plan.plan_id);
      runtime.last_seen_seq = recovery.last_seq;
      runtime.last_success_at = null;
      runtime.snapshot = this.persistedSnapshot(plan, "recovered");
    }
    const snapshots = await this.refreshAll({ force: true });
    return { ...recovery, snapshots };
  }

  private persistedSnapshot(
    plan: PlanRecord,
    reason = "persisted",
  ): PlanProgressSnapshot {
    const binding = bindingOf(plan, this.store.goal_id);
    const observation = plan.last_observation;
    const revisionMatches =
      binding.attempt === null ||
      (plan.coordinator !== null &&
        plan.coordinator.approved_revision === plan.approved_revision);
    if (
      !observation ||
      !revisionMatches ||
      (binding.attempt !== null && observation.attempt !== binding.attempt)
    ) {
      return this.makeSnapshot({
        plan,
        binding,
        observed: emptyObserved(),
        artifactReadAt: null,
        meaningfulProgressAt: null,
        runtimeEventAt: this.states.get(plan.plan_id)?.runtime_event_at ?? null,
        inconsistent: false,
        applied: false,
        reason: observation
          ? revisionMatches
            ? "stale_attempt"
            : "stale_revision"
          : reason,
        fingerprint: null,
        activityGap: null,
      });
    }
    return this.makeSnapshot({
      plan,
      binding,
      observed: this.observedFromLast(observation),
      artifactReadAt: observation.observed_at,
      meaningfulProgressAt: observation.meaningful_progress_at,
      runtimeEventAt: this.states.get(plan.plan_id)?.runtime_event_at ?? null,
      inconsistent: false,
      applied: true,
      reason,
      fingerprint: observation.fingerprint,
      activityGap: null,
    });
  }

  private observedFromLast(observation: LastObservation): ObservedFields {
    return {
      state: observation.state,
      wave: observation.wave,
      lanes: observation.lanes,
      blocker:
        observation.blocker === null
          ? null
          : { text: observation.blocker, source: "status.md" },
      next_action: observation.next_action,
      evidence: {
        report_path: observation.evidence_report,
        report_result: null,
        tests: [],
      },
      status_msg: null,
      heartbeat_ts: observation.heartbeat_ts,
      heartbeat_valid: false,
    };
  }

  private makeSnapshot(input: {
    plan: PlanRecord;
    binding: PlanBinding;
    observed: ObservedFields;
    artifactReadAt: number | null;
    meaningfulProgressAt: number | null;
    runtimeEventAt: number | null;
    inconsistent: boolean;
    applied: boolean;
    reason: string | null;
    fingerprint: string | null;
    activityGap: PlanProgressSnapshot["activity_gap"];
  }): PlanProgressSnapshot {
    const now = this.now();
    const age =
      input.artifactReadAt === null
        ? null
        : Math.max(0, now - input.artifactReadAt);
    const meaningfulAge =
      input.meaningfulProgressAt === null
        ? null
        : Math.max(0, now - input.meaningfulProgressAt);
    return {
      plan_id: input.plan.plan_id,
      plan_path: input.plan.plan_path,
      binding: input.binding,
      observed: input.observed,
      freshness: {
        artifact_read_at: input.artifactReadAt,
        meaningful_progress_at: input.meaningfulProgressAt,
        runtime_event_at: input.runtimeEventAt,
        age_ms: age,
        meaningful_age_ms: meaningfulAge,
        status: freshnessStatus(
          input.artifactReadAt,
          now,
          this.freshnessMs,
          input.inconsistent,
        ),
      },
      observation: {
        applied: input.applied,
        inconsistent: input.inconsistent,
        reason: input.reason,
        fingerprint: input.fingerprint,
      },
      activity_gap: input.activityGap,
    };
  }

  private withFreshness(
    snapshot: PlanProgressSnapshot,
    now: number,
  ): PlanProgressSnapshot {
    const runtime = this.states.get(snapshot.plan_id);
    const artifactReadAt = snapshot.freshness.artifact_read_at;
    const meaningfulProgressAt = snapshot.freshness.meaningful_progress_at;
    const runtimeEventAt =
      runtime?.runtime_event_at ?? snapshot.freshness.runtime_event_at;
    return {
      ...snapshot,
      binding: { ...snapshot.binding },
      observed: {
        ...snapshot.observed,
        lanes:
          snapshot.observed.lanes === null
            ? null
            : snapshot.observed.lanes.map((lane) => ({ ...lane })),
        evidence: {
          ...snapshot.observed.evidence,
          tests: [...snapshot.observed.evidence.tests],
        },
        blocker:
          snapshot.observed.blocker === null
            ? null
            : { ...snapshot.observed.blocker },
      },
      freshness: {
        artifact_read_at: artifactReadAt,
        meaningful_progress_at: meaningfulProgressAt,
        runtime_event_at: runtimeEventAt,
        age_ms:
          artifactReadAt === null ? null : Math.max(0, now - artifactReadAt),
        meaningful_age_ms:
          meaningfulProgressAt === null
            ? null
            : Math.max(0, now - meaningfulProgressAt),
        status: freshnessStatus(
          artifactReadAt,
          now,
          this.freshnessMs,
          snapshot.observation.inconsistent,
        ),
      },
      observation: { ...snapshot.observation },
      activity_gap:
        snapshot.activity_gap === null ? null : { ...snapshot.activity_gap },
    };
  }

  private async performRefresh(
    planId: string,
  ): Promise<PlanProgressSnapshot> {
    const pre = this.store.read();
    const plan = pre.record.plans.find((item) => item.plan_id === planId);
    if (!plan) throw new Error(`plan ${planId} is not registered in this goal`);
    const bindingBefore = bindingOf(plan, this.store.goal_id);
    const directoryState = planDirectoryState(plan.plan_path);
    if (directoryState !== "ok") {
      const runtime = this.stateFor(planId);
      const now = this.now();
      const snapshot = this.makeSnapshot({
        plan,
        binding: bindingBefore,
        observed: emptyObserved(),
        artifactReadAt: null,
        meaningfulProgressAt: null,
        runtimeEventAt: runtime.runtime_event_at,
        inconsistent: directoryState === "unsafe",
        applied: false,
        reason: directoryState === "missing" ? "plan_missing" : "unsafe_plan_path",
        fingerprint: null,
        activityGap: null,
      });
      runtime.last_refresh_at = now;
      runtime.snapshot = snapshot;
      return snapshot;
    }

    const statusPath = join(plan.plan_path, "status.md");
    const planPath = join(plan.plan_path, "plan.md");
    const lanesPath = join(plan.plan_path, "lanes");
    const reportPath = join(plan.plan_path, "report.md");
    const [statusProbe, documentProbe, laneProbe, reportProbe] =
      await Promise.all([
        stableReadFile(statusPath),
        stableReadFile(planPath),
        readLaneDirectory(lanesPath),
        stableReadFile(reportPath),
      ]);

    const post = this.store.read();
    const postPlan = post.record.plans.find((item) => item.plan_id === planId);
    if (!postPlan) throw new Error(`plan ${planId} disappeared during observation`);
    const bindingAfter = bindingOf(postPlan, this.store.goal_id);
    const bindingChanged =
      !sameBinding(bindingBefore, bindingAfter) ||
      postPlan.plan_path !== plan.plan_path;

    const probes = [statusProbe, documentProbe, reportProbe];
    const probeProblem = probes.find(
      (probe) =>
        probe.status === "unsafe" ||
        probe.status === "too_large" ||
        probe.status === "unstable" ||
        probe.status === "error",
    );
    const laneProblem =
      laneProbe.status === "unsafe" ||
      laneProbe.status === "unstable" ||
      laneProbe.status === "invalid_heartbeat" ||
      laneProbe.status === "error"
        ? laneProbe.reason
        : null;
    const inconsistentReason =
      probeProblem?.reason ?? laneProblem ?? null;
    const bindingInconsistent = bindingChanged || inconsistentReason !== null;
    const runtime = this.stateFor(planId);
    const now = this.now();
    const previousMeaningful =
      postPlan.last_observation?.meaningful_progress_at ?? null;
    const rejectSnapshot = (
      reason: string,
      inconsistent: boolean,
      artifactReadAt: number | null,
    ): PlanProgressSnapshot => {
      const snapshot = this.makeSnapshot({
        plan: postPlan,
        binding: bindingAfter,
        observed: emptyObserved(),
        artifactReadAt,
        meaningfulProgressAt: previousMeaningful,
        runtimeEventAt: runtime.runtime_event_at,
        inconsistent,
        applied: false,
        reason,
        fingerprint: null,
        activityGap: null,
      });
      runtime.last_refresh_at = now;
      runtime.snapshot = snapshot;
      return snapshot;
    };

    if (bindingInconsistent) {
      return rejectSnapshot(
        bindingChanged
          ? "binding_changed"
          : (inconsistentReason ?? "artifact_changed"),
        true,
        null,
      );
    }

    const heartbeat = parseHeartbeat(statusProbe.content);
    if (
      statusProbe.status === "ok" &&
      heartbeat.line_count > 0 &&
      !heartbeat.valid
    ) {
      return rejectSnapshot("invalid_heartbeat", true, null);
    }
    const document = parsePlanDocument(documentProbe.content);
    const report = parseReportDocument(reportProbe.content);
    const wave =
      document.wave ??
      (heartbeat.msg !== null ? /^(W\d+i\d+)\b/.exec(heartbeat.msg)?.[1] ?? null : null);
    const reportEvidence =
      reportProbe.status === "ok" ? reportPath : null;
    const observed: ObservedFields = {
      state: heartbeat.state,
      wave,
      lanes: laneProbe.status === "ok" ? laneProbe.lanes : null,
      blocker:
        heartbeat.state === "WAIT" && heartbeat.msg !== null
          ? { text: cleanText(heartbeat.msg, 500) as string, source: "status.md" }
          : null,
      next_action: cleanText(document.next_action, 500),
      evidence: {
        report_path: reportEvidence,
        report_result: cleanText(report.result, 500),
        tests: report.tests
          .map((item) => cleanText(item, 300))
          .filter((item): item is string => item !== null)
          .slice(0, MAX_SOURCE_ITEMS),
      },
      status_msg: cleanText(heartbeat.msg, 500),
      heartbeat_ts: heartbeat.ts,
      heartbeat_valid: heartbeat.valid,
    };

    const sources: string[] = [];
    if (statusProbe.status === "ok") sources.push("status.md");
    if (documentProbe.status === "ok") sources.push("plan.md");
    if (laneProbe.status === "ok") sources.push("lanes/");
    if (reportProbe.status === "ok") sources.push("report.md");

    const coordinator = postPlan.coordinator;
    if (coordinator === null) {
      const snapshot = this.makeSnapshot({
        plan: postPlan,
        binding: bindingAfter,
        observed,
        artifactReadAt: now,
        meaningfulProgressAt: previousMeaningful,
        runtimeEventAt: runtime.runtime_event_at,
        inconsistent: false,
        applied: false,
        reason: "unbound",
        fingerprint: null,
        activityGap: null,
      });
      runtime.last_refresh_at = now;
      runtime.last_success_at = now;
      runtime.last_seen_seq = pre.journal.last_seq;
      runtime.snapshot = snapshot;
      return snapshot;
    }

    if (
      coordinator.runtime === null ||
      coordinator.acknowledged_at === null
    ) {
      return rejectSnapshot("not_acknowledged", false, now);
    }

    if (sources.length === 0) {
      const snapshot = this.makeSnapshot({
        plan: postPlan,
        binding: bindingAfter,
        observed,
        artifactReadAt: now,
        meaningfulProgressAt: previousMeaningful,
        runtimeEventAt: runtime.runtime_event_at,
        inconsistent: false,
        applied: false,
        reason: "no_artifacts",
        fingerprint: null,
        activityGap: null,
      });
      runtime.last_refresh_at = now;
      runtime.last_success_at = now;
      runtime.last_seen_seq = pre.journal.last_seq;
      runtime.snapshot = snapshot;
      return snapshot;
    }

    if (observed.state === "DONE") {
      const baseline = coordinator.artifact_baseline;
      const statusSha =
        statusProbe.status === "ok" && statusProbe.content !== null
          ? sha256Text(statusProbe.content)
          : null;
      const reportSha =
        reportProbe.status === "ok" && reportProbe.content !== null
          ? sha256Text(reportProbe.content)
          : null;
      const proven =
        baseline !== null &&
        statusSha !== null &&
        reportSha !== null &&
        statusSha !== baseline.status_sha256 &&
        reportSha !== baseline.report_sha256;
      if (!proven) {
        return rejectSnapshot("unproven_done", true, null);
      }
    }

    const fingerprint = fingerprintObservation(observed, bindingAfter);
    const activityGap =
      runtime.last_success_at !== null &&
      now - runtime.last_success_at > this.gapMs &&
      coordinator.lifecycle !== "STOPPED"
        ? {
            from_seq: runtime.last_seen_seq + 1,
            to_seq: pre.journal.last_seq,
            since: runtime.last_success_at,
            until: now,
          }
        : null;

    const appendResult = this.store.appendObservation({
      plan_id: postPlan.plan_id,
      request_id: coordinator.request_id,
      attempt: coordinator.attempt,
      state: observed.state,
      wave: observed.wave,
      lanes: observed.lanes,
      blocker: observed.blocker?.text ?? null,
      next_action: observed.next_action,
      evidence_report: observed.evidence.report_path,
      heartbeat_ts: observed.heartbeat_ts,
      meaningful_progress_at: observed.heartbeat_ts ?? previousMeaningful,
      observed_at: now,
      source: sources.join(","),
      fingerprint,
    });

    const effectiveMeaningful = appendResult.accepted
      ? (observed.heartbeat_ts ?? previousMeaningful)
      : previousMeaningful;
    const snapshot = this.makeSnapshot({
      plan: postPlan,
      binding: bindingAfter,
      observed,
      artifactReadAt: now,
      meaningfulProgressAt: effectiveMeaningful,
      runtimeEventAt: runtime.runtime_event_at,
      inconsistent: false,
      applied: appendResult.accepted,
      reason: appendResult.reason,
      fingerprint,
      activityGap,
    });
    runtime.last_refresh_at = now;
    runtime.last_success_at = now;
    runtime.last_seen_seq = Math.max(
      pre.journal.last_seq,
      appendResult.seq ?? 0,
    );
    runtime.snapshot = snapshot;
    return snapshot;
  }
}
