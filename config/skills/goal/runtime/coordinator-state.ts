/**
 * Command-center registry for the /goal multi-plan flow.
 *
 * Harness-neutral. No host SDK imports. All state lives outside every
 * checkout, under <parent of plan root>/.goals/<repo-id>/. The repository-wide
 * ownership ledger is shared by every manager of the same repository (linked
 * worktrees resolve the same plan root), so two command centers cannot reserve
 * the same canonical plan.
 *
 * Files:
 *   .goals/<repo-id>/.lock                 repo-wide exclusive flock
 *   .goals/<repo-id>/ownership.json        cross-goal ownership ledger
 *   .goals/<repo-id>/<goal-id>/goal.json   frozen goal/plan registry + snapshot
 *   .goals/<repo-id>/<goal-id>/events.jsonl signed observation/request journal
 *
 * Invariants:
 *   - plan heartbeats stay PLAN|WAIT|WORKING|DONE|FAILED (three lines)
 *   - coordinator lifecycle stays QUEUED|LAUNCHING|RUNNING|RECONCILING|STOPPED
 *   - an event is appended (fsynced) before the snapshot's applied_seq advances
 *   - ownership is committed to the ledger before a launch may happen
 *   - a reservation is released only with explicit stop evidence
 *   - unknown/corrupt state fails closed; nothing is reset to an empty center
 */
import type { Dirent } from "node:fs";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export interface ManagerIdentity {
  harness: string;
  session_id: string;
}

export type CoordinatorHarness = "omp" | "opencode";

export interface RuntimeProfile {
  /** Harness committed at approval time; no later start request may change it. */
  harness: CoordinatorHarness;
  /** Approved expected runtime version, or null when intentionally unpinned. */
  runtime_version: string | null;
  /** Approved exact model, or null when the harness default is approved. */
  model: string | null;
  /**
   * Approved exact reasoning effort, or null when the harness default is
   * approved. An omitted input also normalizes to null; this is never encoded
   * in the model string.
   */
  effort?: string | null;
}

export type CoordinatorLifecycle =
  | "QUEUED"
  | "LAUNCHING"
  | "RUNNING"
  | "RECONCILING"
  | "STOPPED";

/** Child plan heartbeat state. Never a coordinator lifecycle value. */
export type PlanHeartbeatState = "PLAN" | "WAIT" | "WORKING" | "DONE" | "FAILED";

export type LifecyclePermission = "launch" | "stop";

export interface ProcessIdentity {
  /** Actual harness MainPID; never the systemd-run wrapper. */
  pid: number;
  /** Actual MainPID start identity; never the wrapper's. */
  start_id: string;
  /** Verified user-systemd transient unit identity; optional as a complete set. */
  unit_name?: string | null;
  invocation_id?: string | null;
  control_group?: string | null;
  main_pid?: number | null;
  main_pid_start_id?: string | null;
}

export interface ArtifactBaseline {
  captured_at: number;
  status_path: string;
  status_exists: boolean;
  status_sha256: string | null;
  status_mtime_ms: number | null;
  report_path: string;
  report_exists: boolean;
  report_sha256: string | null;
  report_mtime_ms: number | null;
}

export interface PlanDependency {
  plan_id: string;
  /** Evidence tokens that must be present in the predecessor's verification. */
  required_evidence: string[];
}

export interface PlanScope {
  in: string[];
  out: string[];
}

export interface LaneObservation {
  name: string;
  state: PlanHeartbeatState | null;
  msg: string | null;
  updated_at: number | null;
}

export interface LastObservation {
  attempt: number;
  request_id: string;
  state: PlanHeartbeatState | null;
  wave: string | null;
  lanes: LaneObservation[] | null;
  blocker: string | null;
  next_action: string | null;
  evidence_report: string | null;
  heartbeat_ts: number | null;
  meaningful_progress_at: number | null;
  observed_at: number;
  source: string;
  fingerprint: string;
  seq: number;
}

export interface CoordinatorRecord {
  request_id: string;
  attempt: number;
  lifecycle: CoordinatorLifecycle;
  manager: ManagerIdentity;
  runtime: ManagerIdentity | null;
  runtime_version: string | null;
  runtime_model: string | null;
  /** Actual observed reasoning effort, or null when the session reports none. */
  runtime_effort: string | null;
  process: ProcessIdentity | null;
  artifact_baseline: ArtifactBaseline | null;
  working_directory: string | null;
  launch_intent_at: number;
  acknowledged_at: number | null;
  reconciled_at: number | null;
  stopped_at: number | null;
  stop_evidence: string | null;
  approved_revision: string;
  runtime_profile: RuntimeProfile;
}

export interface VerificationRecord {
  revision: string;
  attempt: number;
  request_id: string;
  evidence: string[];
  report_path: string;
  verified_by: ManagerIdentity;
  verified_at: number;
}

export interface GoalPlanSpec {
  plan_id: string;
  approved_revision: string;
  acceptance: string[];
  scope: PlanScope;
  /** Frozen coordinator selection approved with the plan. */
  runtime: RuntimeProfile;
  predecessors?: PlanDependency[];
  resources?: string[];
  conflicts?: string[];
  lifecycle_permissions?: LifecyclePermission[];
  worktree?: string | null;
  branch?: string | null;
  /** Explicit adoption of an already completed plan; never inferred. */
  adoption?: {
    state: "DONE";
    evidence: string[];
    report_path: string;
  } | null;
}

export interface GoalSpec {
  goal: string;
  acceptance: string[];
  approval_revision: string;
  max_running_coordinators: number;
  plans: GoalPlanSpec[];
}

export interface PlanRecord {
  plan_id: string;
  plan_path: string;
  approved_revision: string;
  scope: PlanScope;
  acceptance: string[];
  runtime: RuntimeProfile;
  predecessors: PlanDependency[];
  resources: string[];
  conflicts: string[];
  lifecycle_permissions: LifecyclePermission[];
  worktree: string | null;
  branch: string | null;
  coordinator: CoordinatorRecord | null;
  verification: VerificationRecord | null;
  last_observation: LastObservation | null;
}

export interface GoalPlanReport {
  plan_id: string;
  revision: string;
  report_path: string;
  evidence: string[];
}

export interface GoalCompletionRecord {
  approval_revision: string;
  evidence: string[];
  report_path: string;
  completed_at: number;
  completed_by: ManagerIdentity;
  plan_reports: GoalPlanReport[];
}

export interface GoalRecord {
  schema_version: 1;
  goal_id: string;
  goal: string;
  acceptance: string[];
  approval_revision: string;
  manager: ManagerIdentity;
  role: "command-center";
  repository: {
    repo_root: string;
    plan_root: string;
    repo_id: string;
  };
  scheduling: {
    max_running_coordinators: number;
  };
  created_at: number;
  updated_at: number;
  applied_seq: number;
  plans: PlanRecord[];
  completion: GoalCompletionRecord | null;
}

export interface CompleteGoalInput {
  approval_revision: string;
  evidence: string[];
}

export interface CompleteGoalResult {
  report_path: string;
  completion: GoalCompletionRecord;
  state: GoalState;
}

export interface JournalState {
  last_seq: number;
  applied_seq: number;
  pending: number;
  repaired_tail_bytes: number;
}

export interface OwnershipConflict {
  plan_id: string;
  goal_id: string;
  request_id: string;
  lifecycle: CoordinatorLifecycle;
  runtime: ManagerIdentity | null;
}

export interface GoalState {
  record: GoalRecord;
  journal: JournalState;
  ownership_conflicts: OwnershipConflict[];
}

export type ReadinessBlocker =
  | { kind: "missing_dependency"; plan_id: string }
  | { kind: "self_dependency"; plan_id: string }
  | { kind: "dependency_cycle"; plan_ids: string[] }
  | {
      kind: "dependency_not_verified";
      plan_id: string;
      required_evidence: string[];
      missing_evidence: string[];
      verification_revision: string | null;
    }
  | {
      kind: "dependency_state_not_done";
      plan_id: string;
      observed_state: PlanHeartbeatState | null;
    }
  | { kind: "resource_conflict"; resource: string; with_plan_id: string }
  | { kind: "conflict_token"; token: string; with_plan_id: string }
  | {
      kind: "owned_elsewhere";
      goal_id: string;
      plan_id: string;
      request_id: string;
      lifecycle: CoordinatorLifecycle;
      runtime: ManagerIdentity | null;
    }
  | { kind: "concurrency_limit"; active: number; limit: number }
  | { kind: "not_launch_authorized" }
  | { kind: "already_verified" }
  | {
      kind: "inconsistent_verification";
      verification_revision: string;
      observed_state: PlanHeartbeatState | null;
    }
  | { kind: "missing_plan_path" }
  | {
      kind: "untracked_plan_state";
      observed_state: PlanHeartbeatState | null;
      reason: "active" | "terminal" | "invalid";
    };

export interface ReadinessReport {
  ready: string[];
  blocked: Array<{ plan_id: string; reasons: ReadinessBlocker[] }>;
  active: Array<{
    plan_id: string;
    lifecycle: CoordinatorLifecycle;
    attempt: number;
  }>;
  completed: string[];
}

export type ReservationResult =
  | { status: "reserved"; coordinator: CoordinatorRecord }
  | { status: "duplicate"; coordinator: CoordinatorRecord }
  | { status: "blocked"; reasons: ReadinessBlocker[] }
  | {
      status: "conflict";
      reason: "request_id_reused";
      owner: { goal_id: string; plan_id: string; request_id: string };
    };

export type GoalEventKind =
  | "goal.created"
  | "goal.revised"
  | "goal.completed"
  | "plan.reserved"
  | "plan.spawned"
  | "plan.acknowledged"
  | "plan.lifecycle"
  | "plan.observation"
  | "plan.verification"
  | "plan.reopened"
  | "plan.released"
  | "request.outcome";

export interface GoalEvent {
  schema_version: 1;
  seq: number;
  time: number;
  kind: GoalEventKind;
  goal_id: string;
  plan_id: string | null;
  origin: ManagerIdentity;
  attempt: number | null;
  request_id: string | null;
  source: string | null;
  data: Record<string, unknown> | null;
}

export interface ObservationInput {
  plan_id: string;
  request_id: string;
  attempt: number;
  state: PlanHeartbeatState | null;
  wave: string | null;
  lanes: LaneObservation[] | null;
  blocker: string | null;
  next_action: string | null;
  evidence_report: string | null;
  heartbeat_ts: number | null;
  meaningful_progress_at: number | null;
  observed_at: number;
  source: string;
  fingerprint: string;
}

export type ObservationAppendResult = {
  accepted: boolean;
  reason:
    | "accepted"
    | "duplicate"
    | "stale_attempt"
    | "stale_time"
    | "terminal_regression"
    | "unknown_binding"
    | "not_acknowledged"
    | "unproven_done";
  seq: number | null;
  applied_seq: number;
};

export interface RequestOutcomeInput {
  plan_id: string;
  request_id: string;
  attempt: number;
  action: string;
  direction: "to_coordinator" | "from_coordinator";
  outcome:
    | "delivered"
    | "accepted"
    | "rejected"
    | "unknown"
    | "duplicate"
    | "permission_denied";
  source: string;
  detail?: string | null;
}

export interface RequestOutcomeRecord {
  seq: number;
  time: number;
  plan_id: string;
  request_id: string;
  attempt: number;
  action: string;
  direction: string;
  outcome: string;
  source: string;
  detail: string | null;
}

export interface JournalRecovery extends JournalState {
  events: number;
}

export interface AcknowledgeInput {
  request_id: string;
  attempt: number;
  /** Actual runtime identity; harness must equal the frozen profile. */
  runtime: ManagerIdentity;
  /** Actual observed runtime version; recorded for every launch. */
  runtime_version: string;
  /** Actual observed model, or null when the session reports no explicit model. */
  model: string | null;
  /** Actual observed reasoning effort, or null when the session reports none. */
  effort?: string | null;
  working_directory: string;
  process?: ProcessIdentity | null;
}

/**
 * Spawn-before-session evidence. Recorded as soon as the owned process exists
 * but before ACP initialization/session creation returns a real session ID.
 * A crash after spawn but before this record is persisted remains RECONCILING;
 * the API never guesses a PID or session.
 */
export interface RecordSpawnInput {
  request_id: string;
  attempt: number;
  process: ProcessIdentity;
  working_directory: string;
}

export interface TransitionInput {
  request_id: string;
  attempt: number;
  lifecycle: CoordinatorLifecycle;
  reason?: string;
}

export interface ReleaseInput {
  request_id: string;
  attempt: number;
  /** Explicit evidence that the owned coordinator is quiescent. */
  stop_evidence: string;
}

export interface VerificationInput {
  request_id: string;
  attempt: number;
  revision: string;
  evidence: string[];
  report_path: string;
}

export interface ReopenPlanInput {
  finding: string;
  evidence: string[];
}

export interface CenterSnapshot extends GoalState {
  readiness: ReadinessReport;
}

export interface CoordinatorStoreOptions {
  repo_root: string;
  plan_root: string;
  goal_id: string;
  manager: ManagerIdentity;
  lock_timeout_ms?: number;
  now?: () => number;
}

export type CoordinatorStateErrorCode =
  | "invalid_path"
  | "invalid_name"
  | "invalid_schema"
  | "unsupported_schema"
  | "not_found"
  | "already_exists"
  | "conflict"
  | "lifecycle"
  | "permission"
  | "stale_evidence"
  | "not_ready"
  | "journal_corruption"
  | "lock"
  | "io";

export class CoordinatorStateError extends Error {
  readonly code: CoordinatorStateErrorCode;

  constructor(code: CoordinatorStateErrorCode, message: string) {
    super(message);
    this.name = "CoordinatorStateError";
    this.code = code;
  }
}

const SCHEMA_VERSION = 1 as const;
const MAX_PLANS = 64;
const MAX_LANES = 32;
const MAX_GOAL_TEXT = 20_000;
const MAX_TEXT = 2_000;
const MAX_ITEM = 500;
const MAX_EVIDENCE = 32;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_BASELINE_BYTES = 1024 * 1024;
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
const MAX_STATE_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;

const PLAN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const GOAL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const REPO_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const HARNESS_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const LANE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;
const LIFECYCLES: readonly CoordinatorLifecycle[] = [
  "QUEUED",
  "LAUNCHING",
  "RUNNING",
  "RECONCILING",
  "STOPPED",
];
const PLAN_STATES: readonly PlanHeartbeatState[] = [
  "PLAN",
  "WAIT",
  "WORKING",
  "DONE",
  "FAILED",
];
const LIFECYCLE_PERMISSIONS: readonly LifecyclePermission[] = ["launch", "stop"];
const EVENT_KINDS: readonly GoalEventKind[] = [
  "goal.created",
  "goal.revised",
  "goal.completed",
  "plan.reserved",
  "plan.spawned",
  "plan.acknowledged",
  "plan.lifecycle",
  "plan.observation",
  "plan.verification",
  "plan.reopened",
  "plan.released",
  "request.outcome",
];
const FORBIDDEN_DATA_KEYS = new Set([
  "transcript",
  "transcripts",
  "token",
  "tokens",
  "token_delta",
  "content",
  "messages",
  "stdout",
  "stderr",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "api_key",
  "apikey",
  "authorization",
  "password",
  "env",
  "prompt",
]);
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

interface StateContext {
  repoId: string;
  planRoot: string;
}

interface OwnershipEntry {
  schema_version: 1;
  owner_key: string;
  goal_id: string;
  plan_id: string;
  plan_path: string;
  resources: string[];
  conflicts: string[];
  active: boolean;
  updated_at: number;
  coordinator: CoordinatorRecord;
}

interface OwnershipLedger {
  schema_version: 1;
  repo_root: string;
  plan_root: string;
  repo_id: string;
  entries: OwnershipEntry[];
}

interface LoadedState {
  record: GoalRecord;
  events: GoalEvent[];
  ledger: OwnershipLedger;
  repaired_tail_bytes: number;
}

interface CycleInfo {
  /** Plans that are members of a dependency cycle (including self-dependency). */
  nodes: Set<string>;
  /** Cycle members plus every plan that transitively depends on one. */
  blocked: Set<string>;
}

function fail(code: CoordinatorStateErrorCode, message: string): never {
  throw new CoordinatorStateError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  const code = error.code;
  return typeof code === "string" ? code : null;
}

function isEnoent(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function assertInteger(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    fail("invalid_schema", `${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function assertTimestamp(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("invalid_schema", `${label} must be a finite timestamp`);
  }
  return value;
}

function assertOneLine(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    fail("invalid_schema", `${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    fail("invalid_schema", `${label} must be 1..${maxLength} characters`);
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    fail("invalid_schema", `${label} must be one line without control characters`);
  }
  return trimmed;
}

function assertMultilineText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    fail("invalid_schema", `${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    fail("invalid_schema", `${label} must be 1..${maxLength} characters`);
  }
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(trimmed)) {
    fail("invalid_schema", `${label} contains control characters`);
  }
  return trimmed;
}

function optionalOneLine(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) return null;
  return assertOneLine(value, label, maxLength);
}

function assertStringArray(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; itemMax?: number; unique?: boolean } = {},
): string[] {
  const min = options.min ?? 0;
  const max = options.max ?? MAX_PLANS;
  const itemMax = options.itemMax ?? MAX_TEXT;
  if (!Array.isArray(value)) {
    fail("invalid_schema", `${label} must be an array`);
  }
  if (value.length < min || value.length > max) {
    fail("invalid_schema", `${label} must contain ${min}..${max} items`);
  }
  const result = value.map((item, index) =>
    assertOneLine(item, `${label}[${index}]`, itemMax),
  );
  if (options.unique) {
    const seen = new Set<string>();
    for (const item of result) {
      if (seen.has(item)) {
        fail("invalid_schema", `${label} contains the duplicate item ${item}`);
      }
      seen.add(item);
    }
  }
  return result;
}

function assertToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !REQUEST_ID_RE.test(value)) {
    fail(
      "invalid_schema",
      `${label} must be a safe token over [A-Za-z0-9._:@-]`,
    );
  }
  return value;
}

function assertPlanId(value: unknown, label = "plan_id"): string {
  if (typeof value !== "string" || !PLAN_ID_RE.test(value)) {
    fail("invalid_name", `${label} must match ${PLAN_ID_RE}`);
  }
  return value;
}

function assertGoalId(value: unknown, label = "goal_id"): string {
  if (typeof value !== "string" || !GOAL_ID_RE.test(value)) {
    fail("invalid_name", `${label} must match ${GOAL_ID_RE}`);
  }
  return value;
}

function assertHarness(value: unknown, label: string): string {
  if (typeof value !== "string" || !HARNESS_RE.test(value)) {
    fail("invalid_schema", `${label} must match ${HARNESS_RE}`);
  }
  return value;
}

function assertCoordinatorHarness(
  value: unknown,
  label: string,
): CoordinatorHarness {
  if (value !== "omp" && value !== "opencode") {
    fail("invalid_schema", `${label} must be "omp" or "opencode"`);
  }
  return value;
}

function normalizeManager(value: unknown, label: string): ManagerIdentity {
  if (!isRecord(value)) {
    fail("invalid_schema", `${label} must be an object`);
  }
  const harness = assertHarness(value.harness, `${label}.harness`);
  if (typeof value.session_id !== "string") {
    fail("invalid_schema", `${label}.session_id must be a string`);
  }
  const session_id = value.session_id;
  if (
    session_id.length === 0 ||
    session_id.length > 512 ||
    session_id !== session_id.trim() ||
    /[\u0000-\u001f\u007f]/.test(session_id)
  ) {
    fail("invalid_schema", `${label}.session_id is not a valid session identity`);
  }
  return { harness, session_id };
}

function normalizeRuntimeProfile(
  value: unknown,
  label: string,
): RuntimeProfile {
  if (!isRecord(value)) {
    fail("invalid_schema", `${label} must be an object`);
  }
  return {
    harness: assertCoordinatorHarness(value.harness, `${label}.harness`),
    runtime_version: optionalOneLine(
      value.runtime_version,
      `${label}.runtime_version`,
      100,
    ),
    model: optionalOneLine(value.model, `${label}.model`, 200),
    effort: optionalOneLine(value.effort, `${label}.effort`, 100),
  };
}

function normalizeProcess(
  value: unknown,
  label: string,
): ProcessIdentity | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    fail("invalid_schema", `${label} must be an object`);
  }
  const pid = assertInteger(value.pid, `${label}.pid`, 1, 2_147_483_647);
  const startId = assertOneLine(value.start_id, `${label}.start_id`, 128);
  const unitFields = [
    "unit_name",
    "invocation_id",
    "control_group",
    "main_pid",
    "main_pid_start_id",
  ] as const;
  const present = unitFields.filter(
    (field) => value[field] !== null && value[field] !== undefined,
  );
  if (present.length === 0) {
    return { pid, start_id: startId };
  }
  if (present.length !== unitFields.length) {
    fail(
      "invalid_schema",
      `${label} must supply unit_name, invocation_id, control_group, main_pid and main_pid_start_id together`,
    );
  }
  const unitName = assertOneLine(
    value.unit_name,
    `${label}.unit_name`,
    256,
  );
  if (!unitName.endsWith(".service") || /[/\s]/.test(unitName)) {
    fail(
      "invalid_schema",
      `${label}.unit_name must be a single transient .service unit name`,
    );
  }
  const invocationId = assertOneLine(
    value.invocation_id,
    `${label}.invocation_id`,
    128,
  );
  if (!/^[0-9a-f]{32}$/.test(invocationId)) {
    fail("invalid_schema", `${label}.invocation_id must be 32 lowercase hex`);
  }
  const controlGroup = assertOneLine(
    value.control_group,
    `${label}.control_group`,
    4096,
  );
  if (
    !controlGroup.startsWith("/sys/fs/cgroup/") ||
    !controlGroup.endsWith(`/${unitName}`)
  ) {
    fail(
      "invalid_schema",
      `${label}.control_group must be the rooted cgroup2 path ending in the unit name`,
    );
  }
  const mainPid = assertInteger(
    value.main_pid,
    `${label}.main_pid`,
    1,
    2_147_483_647,
  );
  const mainPidStart = assertOneLine(
    value.main_pid_start_id,
    `${label}.main_pid_start_id`,
    128,
  );
  if (!/^\d+$/.test(startId) || !/^\d+$/.test(mainPidStart)) {
    fail(
      "invalid_schema",
      `${label} unit identity requires decimal /proc starttime ids`,
    );
  }
  if (mainPid !== pid || mainPidStart !== startId) {
    fail(
      "invalid_schema",
      `${label}.pid/start_id must be the actual systemd MainPID/start identity, not the wrapper`,
    );
  }
  return {
    pid,
    start_id: startId,
    unit_name: unitName,
    invocation_id: invocationId,
    control_group: controlGroup,
    main_pid: mainPid,
    main_pid_start_id: mainPidStart,
  };
}

function processIdentityEqual(
  left: ProcessIdentity,
  right: ProcessIdentity,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nullableSha256(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !FINGERPRINT_RE.test(value)) {
    fail("invalid_schema", `${label} must be a sha256 hex digest or null`);
  }
  return value;
}

function nullableMtime(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return assertTimestamp(value, label);
}

function normalizeArtifactBaseline(
  value: unknown,
  label: string,
): ArtifactBaseline {
  if (!isRecord(value)) {
    fail("invalid_schema", `${label} must be an object`);
  }
  const statusPath = assertOneLine(
    value.status_path,
    `${label}.status_path`,
    4096,
  );
  const reportPath = assertOneLine(
    value.report_path,
    `${label}.report_path`,
    4096,
  );
  if (!isAbsolute(statusPath) || !isAbsolute(reportPath)) {
    fail("invalid_schema", `${label} artifact paths must be absolute`);
  }
  const statusExists = value.status_exists;
  const reportExists = value.report_exists;
  if (typeof statusExists !== "boolean" || typeof reportExists !== "boolean") {
    fail("invalid_schema", `${label} existence flags must be booleans`);
  }
  const statusSha = nullableSha256(
    value.status_sha256,
    `${label}.status_sha256`,
  );
  const statusMtime = nullableMtime(
    value.status_mtime_ms,
    `${label}.status_mtime_ms`,
  );
  const reportSha = nullableSha256(
    value.report_sha256,
    `${label}.report_sha256`,
  );
  const reportMtime = nullableMtime(
    value.report_mtime_ms,
    `${label}.report_mtime_ms`,
  );
  if (
    (statusExists && (statusSha === null || statusMtime === null)) ||
    (!statusExists && (statusSha !== null || statusMtime !== null))
  ) {
    fail("invalid_schema", `${label} status existence, digest and mtime disagree`);
  }
  if (
    (reportExists && (reportSha === null || reportMtime === null)) ||
    (!reportExists && (reportSha !== null || reportMtime !== null))
  ) {
    fail("invalid_schema", `${label} report existence, digest and mtime disagree`);
  }
  return {
    captured_at: assertTimestamp(value.captured_at, `${label}.captured_at`),
    status_path: resolve(statusPath),
    status_exists: statusExists,
    status_sha256: statusSha,
    status_mtime_ms: statusMtime,
    report_path: resolve(reportPath),
    report_exists: reportExists,
    report_sha256: reportSha,
    report_mtime_ms: reportMtime,
  };
}

function assertLifecycle(value: unknown, label: string): CoordinatorLifecycle {
  if (
    typeof value !== "string" ||
    !LIFECYCLES.includes(value as CoordinatorLifecycle)
  ) {
    fail("invalid_schema", `${label} is not a coordinator lifecycle`);
  }
  return value as CoordinatorLifecycle;
}

function assertPlanState(
  value: unknown,
  label: string,
): PlanHeartbeatState | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "string" ||
    !PLAN_STATES.includes(value as PlanHeartbeatState)
  ) {
    fail("invalid_schema", `${label} is not a plan heartbeat state`);
  }
  return value as PlanHeartbeatState;
}

function normalizeLanes(
  value: unknown,
  label: string,
): LaneObservation[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length > MAX_LANES) {
    fail("invalid_schema", `${label} must be a lane array of at most ${MAX_LANES}`);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item)) {
      fail("invalid_schema", `${label}[${index}] must be an object`);
    }
    const name = item.name;
    if (typeof name !== "string" || !LANE_NAME_RE.test(name)) {
      fail("invalid_schema", `${label}[${index}].name is not a safe lane name`);
    }
    if (seen.has(name)) {
      fail("invalid_schema", `${label} contains the duplicate lane ${name}`);
    }
    seen.add(name);
    return {
      name,
      state: assertPlanState(item.state, `${label}[${index}].state`),
      msg: optionalOneLine(item.msg, `${label}[${index}].msg`, MAX_ITEM),
      updated_at:
        item.updated_at === null || item.updated_at === undefined
          ? null
          : assertTimestamp(item.updated_at, `${label}[${index}].updated_at`),
    };
  });
}

function normalizeLastObservation(
  value: unknown,
  label: string,
): LastObservation {
  if (!isRecord(value)) {
    fail("invalid_schema", `${label} must be an object`);
  }
  const fingerprint = value.fingerprint;
  if (typeof fingerprint !== "string" || !FINGERPRINT_RE.test(fingerprint)) {
    fail("invalid_schema", `${label}.fingerprint must be a sha256 hex digest`);
  }
  return {
    attempt: assertInteger(value.attempt, `${label}.attempt`, 0, 1_000_000),
    request_id: assertToken(value.request_id, `${label}.request_id`),
    state: assertPlanState(value.state, `${label}.state`),
    wave: optionalOneLine(value.wave, `${label}.wave`, MAX_ITEM),
    lanes: normalizeLanes(value.lanes, `${label}.lanes`),
    blocker: optionalOneLine(value.blocker, `${label}.blocker`, MAX_ITEM),
    next_action: optionalOneLine(
      value.next_action,
      `${label}.next_action`,
      MAX_ITEM,
    ),
    evidence_report: optionalOneLine(
      value.evidence_report,
      `${label}.evidence_report`,
      4096,
    ),
    heartbeat_ts:
      value.heartbeat_ts === null || value.heartbeat_ts === undefined
        ? null
        : assertTimestamp(value.heartbeat_ts, `${label}.heartbeat_ts`),
    meaningful_progress_at:
      value.meaningful_progress_at === null ||
      value.meaningful_progress_at === undefined
        ? null
        : assertTimestamp(
            value.meaningful_progress_at,
            `${label}.meaningful_progress_at`,
          ),
    observed_at: assertTimestamp(value.observed_at, `${label}.observed_at`),
    source: assertOneLine(value.source, `${label}.source`, MAX_ITEM),
    fingerprint,
    seq: assertInteger(value.seq, `${label}.seq`, 0, Number.MAX_SAFE_INTEGER),
  };
}

function normalizeEvidence(
  value: unknown,
  label: string,
  min = 0,
): string[] {
  return assertStringArray(value, label, {
    min,
    max: MAX_EVIDENCE,
    itemMax: MAX_ITEM,
    unique: true,
  });
}

function normalizeVerification(
  value: unknown,
  label: string,
): VerificationRecord {
  if (!isRecord(value)) {
    fail("invalid_schema", `${label} must be an object`);
  }
  const reportPath = value.report_path;
  if (typeof reportPath !== "string" || !isAbsolute(reportPath)) {
    fail("invalid_schema", `${label}.report_path must be an absolute path`);
  }
  return {
    revision: assertOneLine(value.revision, `${label}.revision`, MAX_ITEM),
    attempt: assertInteger(value.attempt, `${label}.attempt`, 0, 1_000_000),
    request_id: assertToken(value.request_id, `${label}.request_id`),
    evidence: normalizeEvidence(value.evidence, `${label}.evidence`, 1),
    report_path: resolve(reportPath),
    verified_by: normalizeManager(
      value.verified_by,
      `${label}.verified_by`,
    ),
    verified_at: assertTimestamp(value.verified_at, `${label}.verified_at`),
  };
}

function normalizeGoalCompletion(
  value: unknown,
  label: string,
): GoalCompletionRecord {
  if (!isRecord(value)) {
    fail("invalid_schema", `${label} must be an object`);
  }
  const reportPath = value.report_path;
  if (typeof reportPath !== "string" || !isAbsolute(reportPath)) {
    fail("invalid_schema", `${label}.report_path must be an absolute path`);
  }
  if (!Array.isArray(value.plan_reports) || value.plan_reports.length === 0) {
    fail("invalid_schema", `${label}.plan_reports must be a non-empty array`);
  }
  if (value.plan_reports.length > MAX_PLANS) {
    fail("invalid_schema", `${label}.plan_reports exceeds ${MAX_PLANS}`);
  }
  const seen = new Set<string>();
  const planReports: GoalPlanReport[] = value.plan_reports.map(
    (item, index) => {
      if (!isRecord(item)) {
        fail("invalid_schema", `${label}.plan_reports[${index}] must be an object`);
      }
      const planId = assertPlanId(
        item.plan_id,
        `${label}.plan_reports[${index}].plan_id`,
      );
      if (seen.has(planId)) {
        fail("invalid_schema", `${label}.plan_reports repeats ${planId}`);
      }
      seen.add(planId);
      const planReportPath = item.report_path;
      if (
        typeof planReportPath !== "string" ||
        !isAbsolute(planReportPath)
      ) {
        fail(
          "invalid_schema",
          `${label}.plan_reports[${index}].report_path must be absolute`,
        );
      }
      return {
        plan_id: planId,
        revision: assertOneLine(
          item.revision,
          `${label}.plan_reports[${index}].revision`,
          MAX_ITEM,
        ),
        report_path: resolve(planReportPath),
        evidence: normalizeEvidence(
          item.evidence,
          `${label}.plan_reports[${index}].evidence`,
          1,
        ),
      };
    },
  );
  return {
    approval_revision: assertOneLine(
      value.approval_revision,
      `${label}.approval_revision`,
      MAX_ITEM,
    ),
    evidence: normalizeEvidence(value.evidence, `${label}.evidence`, 1),
    report_path: resolve(reportPath),
    completed_at: assertTimestamp(
      value.completed_at,
      `${label}.completed_at`,
    ),
    completed_by: normalizeManager(
      value.completed_by,
      `${label}.completed_by`,
    ),
    plan_reports: planReports,
  };
}

function normalizeCoordinator(
  value: unknown,
  label: string,
): CoordinatorRecord {
  if (!isRecord(value)) {
    fail("invalid_schema", `${label} must be an object`);
  }
  const nullableTimestamp = (field: unknown, name: string): number | null =>
    field === null || field === undefined
      ? null
      : assertTimestamp(field, `${label}.${name}`);
  const workingDirectory = value.working_directory;
  if (
    workingDirectory !== null &&
    workingDirectory !== undefined &&
    (typeof workingDirectory !== "string" || !isAbsolute(workingDirectory))
  ) {
    fail(
      "invalid_schema",
      `${label}.working_directory must be null or an absolute path`,
    );
  }
  return {
    request_id: assertToken(value.request_id, `${label}.request_id`),
    attempt: assertInteger(value.attempt, `${label}.attempt`, 1, 1_000_000),
    lifecycle: assertLifecycle(value.lifecycle, `${label}.lifecycle`),
    manager: normalizeManager(value.manager, `${label}.manager`),
    runtime:
      value.runtime === null || value.runtime === undefined
        ? null
        : normalizeManager(value.runtime, `${label}.runtime`),
    runtime_version: optionalOneLine(
      value.runtime_version,
      `${label}.runtime_version`,
      100,
    ),
    runtime_model: optionalOneLine(
      value.runtime_model,
      `${label}.runtime_model`,
      200,
    ),
    runtime_effort: optionalOneLine(
      value.runtime_effort,
      `${label}.runtime_effort`,
      100,
    ),
    process: normalizeProcess(value.process, `${label}.process`),
    artifact_baseline:
      value.artifact_baseline === null ||
      value.artifact_baseline === undefined
        ? null
        : normalizeArtifactBaseline(
            value.artifact_baseline,
            `${label}.artifact_baseline`,
          ),
    working_directory:
      workingDirectory === null || workingDirectory === undefined
        ? null
        : resolve(workingDirectory),
    launch_intent_at: assertTimestamp(
      value.launch_intent_at,
      `${label}.launch_intent_at`,
    ),
    acknowledged_at: nullableTimestamp(
      value.acknowledged_at,
      "acknowledged_at",
    ),
    reconciled_at: nullableTimestamp(value.reconciled_at, "reconciled_at"),
    stopped_at: nullableTimestamp(value.stopped_at, "stopped_at"),
    stop_evidence: optionalOneLine(
      value.stop_evidence,
      `${label}.stop_evidence`,
      MAX_ITEM,
    ),
    approved_revision: assertOneLine(
      value.approved_revision,
      `${label}.approved_revision`,
      MAX_ITEM,
    ),
    runtime_profile: normalizeRuntimeProfile(
      value.runtime_profile,
      `${label}.runtime_profile`,
    ),
  };
}

function normalizePlanScope(value: unknown, label: string): PlanScope {
  if (!isRecord(value)) {
    fail("invalid_schema", `${label} must be an object`);
  }
  return {
    in: assertStringArray(value.in, `${label}.in`, {
      max: MAX_PLANS,
      itemMax: MAX_TEXT,
    }),
    out: assertStringArray(value.out, `${label}.out`, {
      max: MAX_PLANS,
      itemMax: MAX_TEXT,
    }),
  };
}

function normalizeDependencies(
  value: unknown,
  label: string,
): PlanDependency[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PLANS) {
    fail("invalid_schema", `${label} must be an array`);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item)) {
      fail("invalid_schema", `${label}[${index}] must be an object`);
    }
    const planId = assertPlanId(item.plan_id, `${label}[${index}].plan_id`);
    if (seen.has(planId)) {
      fail("invalid_schema", `${label} lists ${planId} more than once`);
    }
    seen.add(planId);
    return {
      plan_id: planId,
      required_evidence: normalizeEvidence(
        item.required_evidence ?? [],
        `${label}[${index}].required_evidence`,
      ),
    };
  });
}

function normalizePermissions(
  value: unknown,
  label: string,
): LifecyclePermission[] {
  if (value === null || value === undefined) return ["launch", "stop"];
  if (!Array.isArray(value) || value.length > LIFECYCLE_PERMISSIONS.length) {
    fail("invalid_schema", `${label} must be an array`);
  }
  const seen = new Set<LifecyclePermission>();
  return value.map((item, index) => {
    if (
      typeof item !== "string" ||
      !LIFECYCLE_PERMISSIONS.includes(item as LifecyclePermission)
    ) {
      fail("invalid_schema", `${label}[${index}] is not a lifecycle permission`);
    }
    const permission = item as LifecyclePermission;
    if (seen.has(permission)) {
      fail("invalid_schema", `${label} repeats ${permission}`);
    }
    seen.add(permission);
    return permission;
  });
}

function normalizePlanRecord(
  value: unknown,
  label: string,
  context: StateContext,
): PlanRecord {
  if (!isRecord(value)) {
    fail("invalid_schema", `${label} must be an object`);
  }
  const planId = assertPlanId(value.plan_id, `${label}.plan_id`);
  const expectedPath = resolve(join(context.planRoot, planId));
  if (value.plan_path !== expectedPath) {
    fail(
      "invalid_path",
      `${label}.plan_path must be the canonical ${expectedPath}`,
    );
  }
  const approvedRevision = assertOneLine(
    value.approved_revision,
    `${label}.approved_revision`,
    MAX_ITEM,
  );
  const runtime = normalizeRuntimeProfile(
    value.runtime,
    `${label}.runtime`,
  );
  const coordinator =
    value.coordinator === null || value.coordinator === undefined
      ? null
      : normalizeCoordinator(value.coordinator, `${label}.coordinator`);
  if (coordinator) {
    const stopped = coordinator.lifecycle === "STOPPED";
    if (coordinator.approved_revision !== approvedRevision && !stopped) {
      fail(
        "invalid_schema",
        `${label}: a live coordinator's approved revision differs from the frozen plan revision`,
      );
    }
    if (!stopped && !runtimeProfilesEqual(coordinator.runtime_profile, runtime)) {
      fail(
        "invalid_schema",
        `${label}: a live coordinator's runtime profile differs from the frozen plan profile`,
      );
    }
  }
  const verification =
    value.verification === null || value.verification === undefined
      ? null
      : normalizeVerification(value.verification, `${label}.verification`);
  if (verification && verification.revision !== approvedRevision) {
    fail(
      "invalid_schema",
      `${label}: verification revision differs from the frozen plan revision`,
    );
  }
  return {
    plan_id: planId,
    plan_path: expectedPath,
    approved_revision: approvedRevision,
    scope: normalizePlanScope(value.scope, `${label}.scope`),
    acceptance: assertStringArray(value.acceptance, `${label}.acceptance`, {
      min: 1,
      max: MAX_PLANS,
      itemMax: MAX_TEXT,
    }),
    runtime,
    predecessors: normalizeDependencies(
      value.predecessors,
      `${label}.predecessors`,
    ),
    resources: assertStringArray(value.resources ?? [], `${label}.resources`, {
      max: MAX_EVIDENCE,
      itemMax: MAX_ITEM,
      unique: true,
    }),
    conflicts: assertStringArray(value.conflicts ?? [], `${label}.conflicts`, {
      max: MAX_EVIDENCE,
      itemMax: MAX_ITEM,
      unique: true,
    }),
    lifecycle_permissions: normalizePermissions(
      value.lifecycle_permissions,
      `${label}.lifecycle_permissions`,
    ),
    worktree: optionalOneLine(value.worktree, `${label}.worktree`, 4096),
    branch: optionalOneLine(value.branch, `${label}.branch`, MAX_ITEM),
    coordinator,
    verification,
    last_observation:
      value.last_observation === null || value.last_observation === undefined
        ? null
        : normalizeLastObservation(
            value.last_observation,
            `${label}.last_observation`,
          ),
  };
}

function normalizeGoalRecord(
  value: unknown,
  context: StateContext & { goalId: string },
): GoalRecord {
  if (!isRecord(value)) {
    fail("invalid_schema", "goal.json must contain an object");
  }
  if (value.schema_version !== SCHEMA_VERSION) {
    fail(
      "unsupported_schema",
      `goal.json schema_version ${String(value.schema_version)} is unsupported`,
    );
  }
  const goalId = assertGoalId(value.goal_id, "goal.json.goal_id");
  if (goalId !== context.goalId) {
    fail(
      "invalid_schema",
      `goal.json belongs to ${goalId}, not ${context.goalId}`,
    );
  }
  if (value.role !== "command-center") {
    fail("invalid_schema", "goal.json role must be command-center");
  }
  if (!isRecord(value.repository)) {
    fail("invalid_schema", "goal.json.repository must be an object");
  }
  if (value.repository.plan_root !== context.planRoot) {
    fail("invalid_path", "goal.json plan_root does not match the resolved plan root");
  }
  if (value.repository.repo_id !== context.repoId) {
    fail("invalid_schema", "goal.json repo_id does not match the plan root");
  }
  const repoRoot = value.repository.repo_root;
  if (typeof repoRoot !== "string" || !isAbsolute(repoRoot)) {
    fail("invalid_schema", "goal.json repository.repo_root must be absolute");
  }
  if (!isRecord(value.scheduling)) {
    fail("invalid_schema", "goal.json.scheduling must be an object");
  }
  const limit = assertInteger(
    value.scheduling.max_running_coordinators,
    "goal.json.scheduling.max_running_coordinators",
    1,
    MAX_PLANS,
  );
  const plansValue = value.plans;
  if (!Array.isArray(plansValue) || plansValue.length > MAX_PLANS) {
    fail("invalid_schema", "goal.json.plans must be an array");
  }
  const plans: PlanRecord[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < plansValue.length; index += 1) {
    const plan = normalizePlanRecord(
      plansValue[index],
      `goal.json.plans[${index}]`,
      context,
    );
    if (seen.has(plan.plan_id)) {
      fail("invalid_schema", `goal.json repeats plan ${plan.plan_id}`);
    }
    seen.add(plan.plan_id);
    plans.push(plan);
  }
  return {
    schema_version: SCHEMA_VERSION,
    goal_id: goalId,
    goal: assertMultilineText(value.goal, "goal.json.goal", MAX_GOAL_TEXT),
    acceptance: assertStringArray(value.acceptance, "goal.json.acceptance", {
      min: 1,
      max: MAX_PLANS,
      itemMax: MAX_TEXT,
    }),
    approval_revision: assertOneLine(
      value.approval_revision,
      "goal.json.approval_revision",
      MAX_ITEM,
    ),
    manager: normalizeManager(value.manager, "goal.json.manager"),
    role: "command-center",
    repository: {
      repo_root: resolve(repoRoot),
      plan_root: context.planRoot,
      repo_id: context.repoId,
    },
    scheduling: { max_running_coordinators: limit },
    created_at: assertTimestamp(value.created_at, "goal.json.created_at"),
    updated_at: assertTimestamp(value.updated_at, "goal.json.updated_at"),
    applied_seq: assertInteger(
      value.applied_seq,
      "goal.json.applied_seq",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    plans,
    completion:
      value.completion === null || value.completion === undefined
        ? null
        : normalizeGoalCompletion(
            value.completion,
            "goal.json.completion",
          ),
  };
}

function normalizeOwnershipEntry(
  value: unknown,
  label: string,
  context: StateContext,
): OwnershipEntry {
  if (!isRecord(value)) {
    fail("invalid_schema", `${label} must be an object`);
  }
  if (value.schema_version !== SCHEMA_VERSION) {
    fail("unsupported_schema", `${label} schema_version is unsupported`);
  }
  const goalId = assertGoalId(value.goal_id, `${label}.goal_id`);
  const planId = assertPlanId(value.plan_id, `${label}.plan_id`);
  const planPath = resolve(join(context.planRoot, planId));
  if (value.plan_path !== planPath) {
    fail(
      "invalid_path",
      `${label}.plan_path must be the canonical ${planPath}`,
    );
  }
  const coordinator = normalizeCoordinator(
    value.coordinator,
    `${label}.coordinator`,
  );
  const active = value.active;
  if (typeof active !== "boolean") {
    fail("invalid_schema", `${label}.active must be a boolean`);
  }
  if (active !== (coordinator.lifecycle !== "STOPPED")) {
    fail(
      "invalid_schema",
      `${label}.active must agree with the coordinator lifecycle`,
    );
  }
  const ownerKey = ownerKeyFor(context.planRoot, planPath);
  if (value.owner_key !== ownerKey) {
    fail("invalid_schema", `${label}.owner_key does not match its repository/plan`);
  }
  return {
    schema_version: SCHEMA_VERSION,
    owner_key: ownerKey,
    goal_id: goalId,
    plan_id: planId,
    plan_path: planPath,
    resources: assertStringArray(value.resources ?? [], `${label}.resources`, {
      max: MAX_EVIDENCE,
      itemMax: MAX_ITEM,
      unique: true,
    }),
    conflicts: assertStringArray(value.conflicts ?? [], `${label}.conflicts`, {
      max: MAX_EVIDENCE,
      itemMax: MAX_ITEM,
      unique: true,
    }),
    active,
    updated_at: assertTimestamp(value.updated_at, `${label}.updated_at`),
    coordinator,
  };
}

function normalizeLedger(
  value: unknown,
  context: StateContext,
): OwnershipLedger {
  if (!isRecord(value)) {
    fail("invalid_schema", "ownership.json must contain an object");
  }
  if (value.schema_version !== SCHEMA_VERSION) {
    fail(
      "unsupported_schema",
      `ownership.json schema_version ${String(value.schema_version)} is unsupported`,
    );
  }
  if (value.plan_root !== context.planRoot) {
    fail("invalid_path", "ownership.json plan_root does not match the resolver");
  }
  if (value.repo_id !== context.repoId) {
    fail("invalid_schema", "ownership.json repo_id does not match the plan root");
  }
  const repoRoot = value.repo_root;
  if (typeof repoRoot !== "string" || !isAbsolute(repoRoot)) {
    fail("invalid_schema", "ownership.json repo_root must be absolute");
  }
  if (!Array.isArray(value.entries)) {
    fail("invalid_schema", "ownership.json entries must be an array");
  }
  const entries = value.entries.map((entry, index) =>
    normalizeOwnershipEntry(entry, `ownership.json.entries[${index}]`, context),
  );
  const activePlans = new Set<string>();
  const requestIds = new Set<string>();
  for (const entry of entries) {
    if (entry.active) {
      if (activePlans.has(entry.plan_path)) {
        fail(
          "invalid_schema",
          `ownership.json has more than one active owner for ${entry.plan_path}`,
        );
      }
      activePlans.add(entry.plan_path);
    }
    if (requestIds.has(entry.coordinator.request_id)) {
      fail(
        "invalid_schema",
        `ownership.json repeats request ${entry.coordinator.request_id}`,
      );
    }
    requestIds.add(entry.coordinator.request_id);
  }
  return {
    schema_version: SCHEMA_VERSION,
    repo_root: resolve(repoRoot),
    plan_root: context.planRoot,
    repo_id: context.repoId,
    entries,
  };
}

function normalizeGoalEvent(
  value: unknown,
  label: string,
  context: StateContext & { goalId: string },
  expectedSeq: number,
): GoalEvent {
  if (!isRecord(value)) {
    fail("journal_corruption", `${label} must contain a JSON object`);
  }
  if (value.schema_version !== SCHEMA_VERSION) {
    fail("unsupported_schema", `${label} schema_version is unsupported`);
  }
  const seq = assertInteger(
    value.seq,
    `${label}.seq`,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (seq !== expectedSeq) {
    fail(
      "journal_corruption",
      `${label}.seq is ${seq}; expected ${expectedSeq} (interior gap or duplicate)`,
    );
  }
  if (value.goal_id !== context.goalId) {
    fail("journal_corruption", `${label}.goal_id does not match this goal`);
  }
  if (
    typeof value.kind !== "string" ||
    !EVENT_KINDS.includes(value.kind as GoalEventKind)
  ) {
    fail("unsupported_schema", `${label}.kind is unsupported`);
  }
  const kind = value.kind as GoalEventKind;
  const planId =
    value.plan_id === null || value.plan_id === undefined
      ? null
      : assertPlanId(value.plan_id, `${label}.plan_id`);
  const attempt =
    value.attempt === null || value.attempt === undefined
      ? null
      : assertInteger(value.attempt, `${label}.attempt`, 0, 1_000_000);
  const requestId =
    value.request_id === null || value.request_id === undefined
      ? null
      : assertToken(value.request_id, `${label}.request_id`);
  const source = optionalOneLine(value.source, `${label}.source`, MAX_ITEM);
  const data =
    value.data === null || value.data === undefined
      ? null
      : (value.data as Record<string, unknown>);
  if (data !== null) assertSafeData(data, `${label}.data`, 0);
  if (
    kind !== "goal.created" &&
    kind !== "goal.revised" &&
    kind !== "goal.completed" &&
    kind !== "request.outcome" &&
    planId === null
  ) {
    fail("journal_corruption", `${label} ${kind} requires a plan_id`);
  }
  if (kind === "plan.observation") {
    if (!isRecord(data) || !isRecord(data.observation)) {
      fail("journal_corruption", `${label} lacks its observation payload`);
    }
    const observation = normalizeLastObservation(
      data.observation,
      `${label}.data.observation`,
    );
    if (observation.seq !== seq) {
      fail(
        "journal_corruption",
        `${label}.data.observation.seq does not match the event sequence`,
      );
    }
  }
  if (kind === "plan.verification") {
    if (!isRecord(data) || !isRecord(data.verification)) {
      fail("journal_corruption", `${label} lacks its verification payload`);
    }
    normalizeVerification(data.verification, `${label}.data.verification`);
  }
  if (kind === "plan.reopened") {
    if (
      !isRecord(data) ||
      typeof data.finding !== "string" ||
      !Array.isArray(data.evidence)
    ) {
      fail("journal_corruption", `${label} lacks its reopen payload`);
    }
    assertOneLine(data.finding, `${label}.data.finding`, MAX_TEXT);
    normalizeEvidence(data.evidence, `${label}.data.evidence`, 1);
    if (
      data.previous_verification !== null &&
      data.previous_verification !== undefined
    ) {
      normalizeVerification(
        data.previous_verification,
        `${label}.data.previous_verification`,
      );
    }
    if (
      data.previous_completion !== null &&
      data.previous_completion !== undefined
    ) {
      normalizeGoalCompletion(
        data.previous_completion,
        `${label}.data.previous_completion`,
      );
    }
    if (data.baseline !== null && data.baseline !== undefined) {
      normalizeArtifactBaseline(
        data.baseline,
        `${label}.data.baseline`,
      );
    }
  }
  if (kind === "goal.revised") {
    if (
      !isRecord(data) ||
      typeof data.approval_revision !== "string" ||
      typeof data.previous_approval_revision !== "string" ||
      !isRecord(data.next) ||
      !isRecord(data.next.scheduling)
    ) {
      fail("journal_corruption", `${label} lacks its revision payload`);
    }
    if (data.next.approval_revision !== data.approval_revision) {
      fail(
        "journal_corruption",
        `${label}.data.next.approval_revision does not match the event revision`,
      );
    }
    assertInteger(
      data.next.scheduling.max_running_coordinators,
      `${label}.data.next.scheduling.max_running_coordinators`,
      1,
      MAX_PLANS,
    );
    if (
      !Array.isArray(data.next.plans) ||
      data.next.plans.length === 0 ||
      data.next.plans.length > MAX_PLANS
    ) {
      fail("journal_corruption", `${label}.data.next.plans is not a plan list`);
    }
    for (let index = 0; index < data.next.plans.length; index += 1) {
      normalizePlanRecord(
        data.next.plans[index],
        `${label}.data.next.plans[${index}]`,
        context,
      );
    }
    if (
      data.next.completion !== null &&
      data.next.completion !== undefined
    ) {
      normalizeGoalCompletion(
        data.next.completion,
        `${label}.data.next.completion`,
      );
    }
    if (
      data.previous_completion !== null &&
      data.previous_completion !== undefined
    ) {
      normalizeGoalCompletion(
        data.previous_completion,
        `${label}.data.previous_completion`,
      );
    }
  }
  if (kind === "goal.completed") {
    if (!isRecord(data) || !isRecord(data.completion)) {
      fail("journal_corruption", `${label} lacks its completion payload`);
    }
    normalizeGoalCompletion(
      data.completion,
      `${label}.data.completion`,
    );
  }
  if (
    (kind === "plan.reserved" ||
      kind === "plan.spawned" ||
      kind === "plan.acknowledged" ||
      kind === "plan.lifecycle" ||
      kind === "plan.released") &&
    (!isRecord(data) || !isRecord(data.coordinator))
  ) {
    fail("journal_corruption", `${label} lacks its coordinator payload`);
  }
  if (isRecord(data) && isRecord(data.coordinator)) {
    normalizeCoordinator(data.coordinator, `${label}.data.coordinator`);
  }
  const event: GoalEvent = {
    schema_version: SCHEMA_VERSION,
    seq,
    time: assertTimestamp(value.time, `${label}.time`),
    kind,
    goal_id: context.goalId,
    plan_id: planId,
    origin: normalizeManager(value.origin, `${label}.origin`),
    attempt,
    request_id: requestId,
    source,
    data,
  };
  const bytes = Buffer.byteLength(JSON.stringify(event), "utf8");
  if (bytes > MAX_EVENT_BYTES) {
    fail("journal_corruption", `${label} exceeds ${MAX_EVENT_BYTES} bytes`);
  }
  return event;
}

function assertSafeData(
  value: unknown,
  label: string,
  depth: number,
): void {
  if (depth > 8) fail("invalid_schema", `${label} is too deeply nested`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("invalid_schema", `${label} contains a non-finite number`);
    }
    return;
  }
  if (typeof value === "string") {
    if (value.length > 8_192) {
      fail("invalid_schema", `${label} contains a string longer than 8192 characters`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_PLANS) {
      fail("invalid_schema", `${label} contains too many array items`);
    }
    value.forEach((item, index) =>
      assertSafeData(item, `${label}[${index}]`, depth + 1),
    );
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length > MAX_PLANS) {
      fail("invalid_schema", `${label} contains too many object keys`);
    }
    for (const key of keys) {
      if (FORBIDDEN_DATA_KEYS.has(key.toLowerCase())) {
        fail(
          "invalid_schema",
          `${label}.${key} is forbidden: events must not journal prompts, transcripts, tokens or secrets`,
        );
      }
      assertSafeData(value[key], `${label}.${key}`, depth + 1);
    }
    return;
  }
  fail("invalid_schema", `${label} contains an unsupported value`);
}

function canonicalDirectory(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    fail("invalid_path", `${label} must be an absolute path`);
  }
  if (value.includes("\u0000")) {
    fail("invalid_path", `${label} contains a NUL byte`);
  }
  const normalized = resolve(value);
  let stat;
  try {
    stat = lstatSync(normalized);
  } catch (error) {
    if (isEnoent(error)) {
      fail("invalid_path", `${label} does not exist: ${normalized}`);
    }
    fail("io", `${label} cannot be inspected: ${String(error)}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("invalid_path", `${label} must be a real directory, not a symlink: ${normalized}`);
  }
  let real: string;
  try {
    real = realpathSync(normalized);
  } catch (error) {
    fail("io", `${label} cannot be resolved: ${String(error)}`);
  }
  if (real !== normalized) {
    fail(
      "invalid_path",
      `${label} is not canonical (a component is a symlink): ${value} -> ${real}`,
    );
  }
  return normalized;
}

function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child.startsWith(prefix);
}

function ensurePrivateDirectory(path: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (!isEnoent(error)) {
      fail("io", `cannot inspect state directory ${path}: ${String(error)}`);
    }
    try {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    } catch (mkdirError) {
      fail("io", `cannot create state directory ${path}: ${String(mkdirError)}`);
    }
    stat = lstatSync(path);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("invalid_path", `state directory must be a real directory: ${path}`);
  }
  const real = realpathSync(path);
  if (real !== path) {
    fail("invalid_path", `state directory must not use symlinks: ${path} -> ${real}`);
  }
  chmodSync(path, 0o700);
}

function fsyncDirectory(path: string): void {
  try {
    const fd = openSync(path, constants.O_RDONLY);
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Directory fsync is best effort on platforms that reject it.
  }
}

function writeAll(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.length) {
    const written = writeSync(fd, buffer, offset, buffer.length - offset);
    if (written <= 0) fail("io", "short write while persisting command-center state");
    offset += written;
  }
}

function atomicWriteText(path: string, text: string): void {
  const directory = dirname(path);
  const temporary = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let fd: number | null = null;
  try {
    fd = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        O_NOFOLLOW,
      0o600,
    );
    fchmodSync(fd, 0o600);
    writeAll(fd, Buffer.from(text, "utf8"));
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    fsyncDirectory(directory);
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore close failure while unwinding
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // temporary may not exist
    }
    if (error instanceof CoordinatorStateError) throw error;
    fail("io", `cannot persist ${path}: ${String(error)}`);
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readRegularFile(
  path: string,
  label: string,
  maxBytes: number,
): Buffer | null {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (isEnoent(error)) return null;
    fail("io", `${label} cannot be inspected: ${String(error)}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail("invalid_path", `${label} must be a regular file, not a symlink: ${path}`);
  }
  if (stat.size > maxBytes) {
    fail("invalid_schema", `${label} exceeds ${maxBytes} bytes`);
  }
  try {
    return readFileSync(path);
  } catch (error) {
    fail("io", `${label} cannot be read: ${String(error)}`);
  }
}

function readJsonFile(path: string, label: string): unknown | null {
  const buffer = readRegularFile(path, label, MAX_STATE_FILE_BYTES);
  if (buffer === null) return null;
  try {
    return JSON.parse(buffer.toString("utf8")) as unknown;
  } catch (error) {
    fail("invalid_schema", `${label} is not valid JSON: ${String(error)}`);
  }
}

interface ArtifactSnapshot {
  path: string;
  exists: boolean;
  sha256: string | null;
  mtime_ms: number | null;
}

function captureArtifactFile(path: string, label: string): ArtifactSnapshot {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (isEnoent(error)) {
      return { path, exists: false, sha256: null, mtime_ms: null };
    }
    fail("io", `${label} cannot be inspected: ${String(error)}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail("invalid_path", `${label} must be a regular file, not a symlink`);
  }
  if (stat.size > MAX_BASELINE_BYTES) {
    fail("invalid_schema", `${label} exceeds ${MAX_BASELINE_BYTES} bytes`);
  }
  let buffer: Buffer;
  try {
    buffer = readFileSync(path);
  } catch (error) {
    if (isEnoent(error)) {
      return { path, exists: false, sha256: null, mtime_ms: null };
    }
    fail("io", `${label} cannot be read: ${String(error)}`);
  }
  return {
    path,
    exists: true,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    mtime_ms: stat.mtimeMs,
  };
}

function captureArtifactBaseline(
  planPath: string,
  now: number,
): ArtifactBaseline {
  if (!planDirectoryReady(planPath)) {
    fail("invalid_path", `plan directory is not available: ${planPath}`);
  }
  const status = captureArtifactFile(
    join(planPath, "status.md"),
    "status.md",
  );
  const report = captureArtifactFile(
    join(planPath, "report.md"),
    "report.md",
  );
  return {
    captured_at: now,
    status_path: status.path,
    status_exists: status.exists,
    status_sha256: status.sha256,
    status_mtime_ms: status.mtime_ms,
    report_path: report.path,
    report_exists: report.exists,
    report_sha256: report.sha256,
    report_mtime_ms: report.mtime_ms,
  };
}

function artifactsChangedFromBaseline(
  baseline: ArtifactBaseline,
  current: ArtifactBaseline,
): boolean {
  return (
    current.status_exists &&
    current.status_sha256 !== null &&
    current.status_sha256 !== baseline.status_sha256 &&
    current.report_exists &&
    current.report_sha256 !== null &&
    current.report_sha256 !== baseline.report_sha256
  );
}

interface ArtifactHeartbeatObservation {
  status: "missing" | "invalid" | "ok";
  state: PlanHeartbeatState | null;
}

function readPlanArtifactHeartbeat(
  planPath: string,
): ArtifactHeartbeatObservation {
  let buffer: Buffer | null;
  try {
    buffer = readRegularFile(
      join(planPath, "status.md"),
      "status.md",
      MAX_BASELINE_BYTES,
    );
  } catch (error) {
    if (error instanceof CoordinatorStateError) {
      return { status: "invalid", state: null };
    }
    throw error;
  }
  if (buffer === null) {
    return { status: "missing", state: null };
  }
  const text = buffer.toString("utf8").replace(/\r\n/g, "\n");
  const lines = text
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (lines.length !== 3) {
    return { status: "invalid", state: null };
  }
  const fields = new Map<string, string>();
  for (const line of lines) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!match) return { status: "invalid", state: null };
    const key = match[1] as string;
    if (fields.has(key)) return { status: "invalid", state: null };
    fields.set(key, (match[2] as string).trim());
  }
  const state = fields.get("state");
  const ts = fields.get("ts");
  const msg = fields.get("msg");
  if (
    fields.size !== 3 ||
    state === undefined ||
    !PLAN_STATES.includes(state as PlanHeartbeatState) ||
    ts === undefined ||
    !/^\d+$/.test(ts) ||
    Number(ts) <= 0 ||
    msg === undefined ||
    msg.length === 0
  ) {
    return { status: "invalid", state: null };
  }
  return { status: "ok", state: state as PlanHeartbeatState };
}

function readDoneStatus(planPath: string): string {
  const path = join(planPath, "status.md");
  const buffer = readRegularFile(path, "status.md", MAX_BASELINE_BYTES);
  if (buffer === null) {
    fail("not_ready", "status.md is required for verification");
  }
  const text = buffer.toString("utf8").replace(/\r\n/g, "\n");
  const lines = text
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (lines.length !== 3) {
    fail("not_ready", "status.md must be exactly three heartbeat lines");
  }
  const fields = new Map<string, string>();
  for (const line of lines) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!match) {
      fail("not_ready", "status.md heartbeat is malformed");
    }
    const key = match[1] as string;
    if (fields.has(key)) {
      fail("not_ready", "status.md heartbeat repeats a field");
    }
    fields.set(key, (match[2] as string).trim());
  }
  if (fields.size !== 3) {
    fail("not_ready", "status.md heartbeat must contain state, ts and msg");
  }
  if (fields.get("state") !== "DONE") {
    fail("not_ready", "status.md heartbeat state is not DONE");
  }
  const ts = fields.get("ts");
  if (ts === undefined || !/^\d+$/.test(ts) || Number(ts) <= 0) {
    fail("not_ready", "status.md heartbeat ts is invalid");
  }
  const msg = fields.get("msg");
  if (msg === undefined || msg.length === 0) {
    fail("not_ready", "status.md heartbeat msg is empty");
  }
  return createHash("sha256").update(buffer).digest("hex");
}

function appendEventLine(path: string, line: string): void {
  const buffer = Buffer.from(line, "utf8");
  if (buffer.length > MAX_EVENT_BYTES) {
    fail("invalid_schema", `event exceeds ${MAX_EVENT_BYTES} bytes`);
  }
  let stat = null;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (!isEnoent(error)) {
      fail("io", `journal cannot be inspected: ${String(error)}`);
    }
  }
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail("invalid_path", "events.jsonl must be a regular file");
    }
    if (stat.size > MAX_JOURNAL_BYTES) {
      fail("invalid_schema", "events.jsonl exceeds the journal size bound");
    }
  }
  let fd: number | null = null;
  try {
    fd = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_APPEND |
        O_NOFOLLOW,
      0o600,
    );
    fchmodSync(fd, 0o600);
    writeAll(fd, buffer);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    fsyncDirectory(dirname(path));
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
    if (error instanceof CoordinatorStateError) throw error;
    fail("io", `cannot append to events.jsonl: ${String(error)}`);
  }
}

function truncateFile(path: string, size: number): void {
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_WRONLY | O_NOFOLLOW);
    ftruncateSync(fd, size);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    fsyncDirectory(dirname(path));
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
    fail("io", `cannot recover the journal tail: ${String(error)}`);
  }
}

function readJournal(
  path: string,
  context: StateContext & { goalId: string },
  repairTail: boolean,
): { events: GoalEvent[]; repaired_tail_bytes: number } {
  const buffer = readRegularFile(path, "events.jsonl", MAX_JOURNAL_BYTES);
  if (buffer === null) {
    return { events: [], repaired_tail_bytes: 0 };
  }
  let complete = buffer;
  let repaired = 0;
  if (buffer.length > 0 && buffer[buffer.length - 1] !== 0x0a) {
    const lastNewline = buffer.lastIndexOf(0x0a);
    const cut = lastNewline + 1;
    repaired = buffer.length - cut;
    complete = buffer.subarray(0, cut);
    if (repairTail) truncateFile(path, cut);
  }
  const text = complete.toString("utf8");
  if (text.length === 0) {
    return { events: [], repaired_tail_bytes: repaired };
  }
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const events: GoalEvent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.trim().length === 0) {
      fail(
        "journal_corruption",
        `events.jsonl line ${index + 1} is empty (interior corruption)`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      fail(
        "journal_corruption",
        `events.jsonl line ${index + 1} is not valid JSON: ${String(error)}`,
      );
    }
    events.push(
      normalizeGoalEvent(
        parsed,
        `events.jsonl line ${index + 1}`,
        context,
        index + 1,
      ),
    );
  }
  return { events, repaired_tail_bytes: repaired };
}

function applyEventToRecord(record: GoalRecord, event: GoalEvent): void {
  if (event.kind === "goal.completed" && isRecord(event.data)) {
    if (isRecord(event.data.completion)) {
      // Journal loading already validated this completion payload.
      record.completion =
        event.data.completion as unknown as GoalCompletionRecord;
    }
    return;
  }
  if (event.kind === "goal.revised" && isRecord(event.data)) {
    const next = event.data.next;
    if (isRecord(next)) {
      if (typeof next.approval_revision === "string") {
        record.approval_revision = next.approval_revision;
      }
      if (isRecord(next.scheduling)) {
        const limit = next.scheduling.max_running_coordinators;
        if (typeof limit === "number" && Number.isInteger(limit)) {
          record.scheduling = { max_running_coordinators: limit };
        }
      }
      if (Array.isArray(next.plans)) {
        // Journal loading already validated every plan record.
        record.plans = next.plans as unknown as PlanRecord[];
      }
      // Journal loading validates any non-null completion payload.
      record.completion =
        next.completion === null || next.completion === undefined
          ? null
          : (next.completion as unknown as GoalCompletionRecord);
    }
    return;
  }
  if (event.plan_id === null) return;
  const plan = record.plans.find((item) => item.plan_id === event.plan_id);
  if (!plan || !isRecord(event.data)) return;
  if (
    (event.kind === "plan.reserved" ||
      event.kind === "plan.spawned" ||
      event.kind === "plan.acknowledged" ||
      event.kind === "plan.lifecycle" ||
      event.kind === "plan.released") &&
    isRecord(event.data.coordinator)
  ) {
    // Journal loading already validated this coordinator payload.
    const coordinator =
      event.data.coordinator as unknown as CoordinatorRecord;
    if (
      !plan.coordinator ||
      coordinator.attempt >= plan.coordinator.attempt
    ) {
      plan.coordinator = coordinator;
    }
  }
  if (event.kind === "plan.observation" && isRecord(event.data.observation)) {
    // Journal loading already validated this payload as a LastObservation.
    const observation = event.data.observation as unknown as LastObservation;
    if (
      !plan.last_observation ||
      observation.seq >= plan.last_observation.seq
    ) {
      plan.last_observation = observation;
    }
    return;
  }
  if (
    event.kind === "plan.verification" &&
    isRecord(event.data.verification)
  ) {
    // Journal loading already validated this payload as a VerificationRecord.
    plan.verification =
      event.data.verification as unknown as VerificationRecord;
    return;
  }
  if (event.kind === "plan.reopened") {
    plan.verification = null;
    record.completion = null;
    if (
      isRecord(event.data.baseline) &&
      plan.coordinator !== null
    ) {
      // Journal loading already validated this baseline payload.
      plan.coordinator.artifact_baseline =
        event.data.baseline as unknown as ArtifactBaseline;
    }
  }
}

function planIsCompleted(plan: PlanRecord): boolean {
  return (
    plan.verification !== null &&
    plan.verification.revision === plan.approved_revision &&
    plan.last_observation?.state === "DONE"
  );
}

function goalRevisionTouchedPlan(event: GoalEvent, planId: string): boolean {
  if (!isRecord(event.data) || !Array.isArray(event.data.changed)) {
    return false;
  }
  return event.data.changed.some(
    (item) => isRecord(item) && item.plan_id === planId,
  );
}

/**
 * Journal-derived provenance of an explicit manager reconciliation. Only a
 * `plan.reopened` event that is still the latest plan-specific state event
 * qualifies; any later reservation, observation, verification, release or
 * plan-changing revision invalidates it. Arbitrary legacy DONE artifacts have
 * no such event and therefore remain fail-closed.
 */
function hasExplicitReopenProvenance(
  events: GoalEvent[],
  planId: string,
): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    if (event.plan_id === planId) {
      return event.kind === "plan.reopened";
    }
    if (
      event.kind === "goal.revised" &&
      goalRevisionTouchedPlan(event, planId)
    ) {
      return false;
    }
  }
  return false;
}

function intersectToken(left: string[], right: string[]): string | null {
  const rightSet = new Set(right);
  for (const token of left) {
    if (rightSet.has(token)) return token;
  }
  return null;
}

function dedupeReasons(reasons: ReadinessBlocker[]): ReadinessBlocker[] {
  const seen = new Set<string>();
  const result: ReadinessBlocker[] = [];
  for (const reason of reasons) {
    const key = JSON.stringify(reason);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reason);
  }
  return result;
}

function detectCycles(plans: PlanRecord[]): CycleInfo {
  const byId = new Map(plans.map((plan) => [plan.plan_id, plan]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const nodes = new Set<string>();

  const visit = (planId: string): void => {
    state.set(planId, 1);
    stack.push(planId);
    const plan = byId.get(planId);
    if (plan) {
      for (const dependency of plan.predecessors) {
        if (!byId.has(dependency.plan_id)) continue;
        if (dependency.plan_id === planId) {
          nodes.add(planId);
          continue;
        }
        const dependencyState = state.get(dependency.plan_id) ?? 0;
        if (dependencyState === 0) {
          visit(dependency.plan_id);
        } else if (dependencyState === 1) {
          const position = stack.lastIndexOf(dependency.plan_id);
          if (position >= 0) {
            for (let index = position; index < stack.length; index += 1) {
              nodes.add(stack[index] as string);
            }
          }
        }
      }
    }
    stack.pop();
    state.set(planId, 2);
  };

  for (const plan of plans) {
    if ((state.get(plan.plan_id) ?? 0) === 0) visit(plan.plan_id);
  }

  const dependents = new Map<string, string[]>();
  for (const plan of plans) {
    for (const dependency of plan.predecessors) {
      if (!byId.has(dependency.plan_id)) continue;
      const list = dependents.get(dependency.plan_id) ?? [];
      list.push(plan.plan_id);
      dependents.set(dependency.plan_id, list);
    }
  }
  const blocked = new Set(nodes);
  const queue = [...nodes];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependent of dependents.get(current) ?? []) {
      if (!blocked.has(dependent)) {
        blocked.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return { nodes, blocked };
}

function dependencyReasons(
  plan: PlanRecord,
  byId: Map<string, PlanRecord>,
  cycles: CycleInfo,
): ReadinessBlocker[] {
  const reasons: ReadinessBlocker[] = [];
  if (cycles.nodes.has(plan.plan_id)) {
    reasons.push({ kind: "dependency_cycle", plan_ids: [...cycles.nodes] });
  }
  for (const dependency of plan.predecessors) {
    if (dependency.plan_id === plan.plan_id) {
      reasons.push({ kind: "self_dependency", plan_id: plan.plan_id });
      continue;
    }
    const predecessor = byId.get(dependency.plan_id);
    if (!predecessor) {
      reasons.push({
        kind: "missing_dependency",
        plan_id: dependency.plan_id,
      });
      continue;
    }
    if (cycles.blocked.has(predecessor.plan_id)) {
      reasons.push({ kind: "dependency_cycle", plan_ids: [...cycles.nodes] });
    }
    const verification = predecessor.verification;
    const missing = dependency.required_evidence.filter(
      (token) => !verification?.evidence.includes(token),
    );
    if (
      !verification ||
      verification.revision !== predecessor.approved_revision ||
      missing.length > 0
    ) {
      reasons.push({
        kind: "dependency_not_verified",
        plan_id: predecessor.plan_id,
        required_evidence: [...dependency.required_evidence],
        missing_evidence: missing,
        verification_revision: verification?.revision ?? null,
      });
    }
    const observedState = predecessor.last_observation?.state ?? null;
    if (observedState !== "DONE") {
      reasons.push({
        kind: "dependency_state_not_done",
        plan_id: predecessor.plan_id,
        observed_state: observedState,
      });
    }
  }
  return dedupeReasons(reasons);
}

function ownerKeyFor(planRoot: string, planPath: string): string {
  return createHash("sha256")
    .update(JSON.stringify([planRoot, planPath]))
    .digest("hex");
}

/**
 * Canonical form of an approved runtime profile. An omitted effort is the
 * same approval as an explicit null, so every comparison hashes the same shape.
 */
function canonicalRuntimeProfile(profile: RuntimeProfile): RuntimeProfile {
  return {
    harness: profile.harness,
    runtime_version: profile.runtime_version,
    model: profile.model,
    effort: profile.effort ?? null,
  };
}

function runtimeProfilesEqual(
  left: RuntimeProfile,
  right: RuntimeProfile,
): boolean {
  return (
    JSON.stringify(canonicalRuntimeProfile(left)) ===
    JSON.stringify(canonicalRuntimeProfile(right))
  );
}

function planSpecOf(plan: PlanRecord): GoalPlanSpec {
  return {
    plan_id: plan.plan_id,
    approved_revision: plan.approved_revision,
    acceptance: [...plan.acceptance],
    scope: { in: [...plan.scope.in], out: [...plan.scope.out] },
    runtime: canonicalRuntimeProfile(plan.runtime),
    predecessors: plan.predecessors.map((dependency) => ({
      plan_id: dependency.plan_id,
      required_evidence: [...dependency.required_evidence],
    })),
    resources: [...plan.resources],
    conflicts: [...plan.conflicts],
    lifecycle_permissions: [...plan.lifecycle_permissions],
    worktree: plan.worktree,
    branch: plan.branch,
  };
}

function canonicalPlanSpec(spec: GoalPlanSpec): unknown {
  return {
    approved_revision: spec.approved_revision,
    acceptance: spec.acceptance,
    scope: spec.scope,
    runtime: canonicalRuntimeProfile(spec.runtime),
    predecessors: spec.predecessors ?? [],
    resources: spec.resources ?? [],
    conflicts: spec.conflicts ?? [],
    lifecycle_permissions: spec.lifecycle_permissions ?? ["launch", "stop"],
    worktree: spec.worktree ?? null,
    branch: spec.branch ?? null,
  };
}

function planSpecsEqual(left: GoalPlanSpec, right: GoalPlanSpec): boolean {
  return JSON.stringify(canonicalPlanSpec(left)) === JSON.stringify(canonicalPlanSpec(right));
}

function normalizeExpectedPlanSpec(value: unknown): GoalPlanSpec {
  if (!isRecord(value)) {
    fail("invalid_schema", "expected plan must be an object");
  }
  return {
    plan_id: assertPlanId(value.plan_id, "expected_plan.plan_id"),
    approved_revision: assertOneLine(
      value.approved_revision,
      "expected_plan.approved_revision",
      MAX_ITEM,
    ),
    scope: normalizePlanScope(value.scope, "expected_plan.scope"),
    acceptance: assertStringArray(
      value.acceptance,
      "expected_plan.acceptance",
      { min: 1, max: MAX_PLANS, itemMax: MAX_TEXT },
    ),
    runtime: normalizeRuntimeProfile(
      value.runtime,
      "expected_plan.runtime",
    ),
    predecessors: normalizeDependencies(
      value.predecessors,
      "expected_plan.predecessors",
    ),
    resources: assertStringArray(
      value.resources ?? [],
      "expected_plan.resources",
      { max: MAX_EVIDENCE, itemMax: MAX_ITEM, unique: true },
    ),
    conflicts: assertStringArray(
      value.conflicts ?? [],
      "expected_plan.conflicts",
      { max: MAX_EVIDENCE, itemMax: MAX_ITEM, unique: true },
    ),
    lifecycle_permissions: normalizePermissions(
      value.lifecycle_permissions,
      "expected_plan.lifecycle_permissions",
    ),
    worktree: optionalOneLine(
      value.worktree,
      "expected_plan.worktree",
      4096,
    ),
    branch: optionalOneLine(
      value.branch,
      "expected_plan.branch",
      MAX_ITEM,
    ),
  };
}

function planSpecDigest(plans: PlanRecord[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        plans.map((plan) => canonicalPlanSpec(planSpecOf(plan))),
      ),
    )
    .digest("hex");
}

function latestEntry(entries: OwnershipEntry[]): OwnershipEntry | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((left, right) => {
    if (right.coordinator.attempt !== left.coordinator.attempt) {
      return right.coordinator.attempt - left.coordinator.attempt;
    }
    return right.updated_at - left.updated_at;
  });
  return sorted[0] ?? null;
}

function validateReportPath(value: unknown, planPath: string): string {
  const raw = assertOneLine(value, "report_path", 4096);
  if (!isAbsolute(raw)) {
    fail("invalid_path", "report_path must be absolute");
  }
  const normalized = resolve(raw);
  if (!isInside(normalized, planPath) || normalized === planPath) {
    fail("invalid_path", "report_path must be inside the plan directory");
  }
  if (basename(normalized) !== "report.md") {
    fail("invalid_path", "report_path must name report.md");
  }
  let stat;
  try {
    stat = lstatSync(normalized);
  } catch (error) {
    if (isEnoent(error)) {
      fail("invalid_path", `report_path does not exist: ${normalized}`);
    }
    fail("io", `report_path cannot be inspected: ${String(error)}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail("invalid_path", "report_path must be a regular file, not a symlink");
  }
  const real = realpathSync(normalized);
  if (real !== normalized) {
    fail("invalid_path", "report_path must not resolve through a symlink");
  }
  return normalized;
}

function assertReportSlot(path: string): void {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail("invalid_path", `aggregate report must be a regular file: ${path}`);
    }
  } catch (error) {
    if (isEnoent(error)) return;
    if (error instanceof CoordinatorStateError) throw error;
    fail("io", `cannot inspect the aggregate report path: ${String(error)}`);
  }
}

function validateWorkingDirectory(
  value: unknown,
  stateDirectory: string,
  planRoot: string,
): string {
  if (typeof value !== "string" || !isAbsolute(value)) {
    fail("invalid_path", "working_directory must be an absolute path");
  }
  const normalized = resolve(value);
  let stat;
  try {
    stat = lstatSync(normalized);
  } catch (error) {
    if (isEnoent(error)) {
      fail("invalid_path", `working_directory does not exist: ${normalized}`);
    }
    fail("io", `working_directory cannot be inspected: ${String(error)}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("invalid_path", "working_directory must be a real directory");
  }
  const real = realpathSync(normalized);
  if (real !== normalized) {
    fail("invalid_path", "working_directory must not resolve through a symlink");
  }
  if (isInside(normalized, stateDirectory) || isInside(normalized, planRoot)) {
    fail(
      "invalid_path",
      "working_directory must not be the command-center state or the external plan root",
    );
  }
  return normalized;
}

function planDirectoryReady(planPath: string): boolean {
  try {
    const stat = lstatSync(planPath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    return realpathSync(planPath) === planPath;
  } catch {
    return false;
  }
}

function openLockFd(path: string): number {
  let fd: number;
  try {
    fd = openSync(
      path,
      constants.O_RDWR | constants.O_CREAT | O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    fail("lock", `cannot open the command-center lock ${path}: ${String(error)}`);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      fail("invalid_path", "the command-center lock must be a regular file");
    }
    fchmodSync(fd, 0o600);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      // ignore
    }
    throw error;
  }
  return fd;
}

export class CoordinatorStore {
  readonly repo_root: string;
  readonly plan_root: string;
  readonly goal_id: string;
  readonly manager: ManagerIdentity;
  readonly repo_id: string;
  readonly state_dir: string;
  readonly goal_dir: string;
  readonly goal_path: string;
  readonly events_path: string;
  readonly ledger_path: string;
  readonly lock_path: string;

  private readonly state_base: string;
  private readonly lockTimeoutMs: number;
  private readonly nowFn: () => number;

  constructor(options: CoordinatorStoreOptions) {
    if (!isRecord(options)) {
      fail("invalid_schema", "CoordinatorStore options must be an object");
    }
    this.repo_root = canonicalDirectory(options.repo_root, "repo_root");
    this.plan_root = canonicalDirectory(options.plan_root, "plan_root");
    if (
      isInside(this.plan_root, this.repo_root) ||
      isInside(this.repo_root, this.plan_root)
    ) {
      fail(
        "invalid_path",
        "plan_root must be physically outside the repository root",
      );
    }
    this.goal_id = assertGoalId(options.goal_id);
    this.manager = normalizeManager(options.manager, "manager");
    this.state_base = join(dirname(this.plan_root), ".goals");
    if (isInside(this.state_base, this.repo_root)) {
      fail("invalid_path", "command-center state would be inside the repository");
    }
    this.repo_id = basename(this.plan_root);
    if (!REPO_ID_RE.test(this.repo_id)) {
      fail(
        "invalid_name",
        `plan_root basename is not a safe repository id: ${this.repo_id}`,
      );
    }
    this.state_dir = join(this.state_base, this.repo_id);
    this.goal_dir = join(this.state_dir, this.goal_id);
    this.goal_path = join(this.goal_dir, "goal.json");
    this.events_path = join(this.goal_dir, "events.jsonl");
    this.ledger_path = join(this.state_dir, "ownership.json");
    this.lock_path = join(this.state_dir, ".lock");
    this.lockTimeoutMs =
      options.lock_timeout_ms === undefined
        ? DEFAULT_LOCK_TIMEOUT_MS
        : assertInteger(
            options.lock_timeout_ms,
            "lock_timeout_ms",
            100,
            600_000,
          );
    if (options.now !== undefined && typeof options.now !== "function") {
      fail("invalid_schema", "now must be a function");
    }
    this.nowFn = options.now ?? (() => Date.now());
  }

  private now(): number {
    return this.nowFn();
  }

  private context(): StateContext {
    return { repoId: this.repo_id, planRoot: this.plan_root };
  }

  private goalContext(): StateContext & { goalId: string } {
    return { ...this.context(), goalId: this.goal_id };
  }

  /**
   * Non-mutating existence check. Creates nothing. A symlink or non-regular
   * goal record fails closed instead of reading as absent.
   */
  exists(): boolean {
    let stat;
    try {
      stat = lstatSync(this.goal_path);
    } catch (error) {
      if (isEnoent(error)) return false;
      fail("io", `cannot inspect goal.json: ${String(error)}`);
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail("invalid_path", "goal.json must be a regular file, not a symlink");
    }
    return true;
  }

  private ensureStateDirectories(): void {
    ensurePrivateDirectory(this.state_base);
    ensurePrivateDirectory(this.state_dir);
    ensurePrivateDirectory(this.goal_dir);
  }

  private withLock<T>(operation: () => T): T {
    this.ensureStateDirectories();
    const fd = openLockFd(this.lock_path);
    try {
      const seconds = Math.max(1, Math.ceil(this.lockTimeoutMs / 1000));
      const result = spawnSync(
        "flock",
        ["-x", "-w", String(seconds), "3"],
        { stdio: ["ignore", "ignore", "ignore", fd] },
      );
      if (result.error) {
        fail("lock", `flock is required for command-center state: ${String(result.error)}`);
      }
      if (result.status !== 0) {
        fail(
          "lock",
          `cannot acquire the command-center lock within ${this.lockTimeoutMs}ms (flock exit ${String(result.status)})`,
        );
      }
      return operation();
    } finally {
      try {
        closeSync(fd);
      } catch {
        // The kernel releases the lock when the descriptor closes.
      }
    }
  }

  private requireExists(): void {
    if (!this.exists()) fail("not_found", `no command-center registry for ${this.goal_id}`);
  }

  private requireActor(
    expected: ManagerIdentity,
    resource: string,
  ): void {
    if (
      this.manager.harness !== expected.harness ||
      this.manager.session_id !== expected.session_id
    ) {
      fail(
        "permission",
        `${resource} is owned by a different command-center manager`,
      );
    }
  }

  private readGoalRecord(): GoalRecord {
    const parsed = readJsonFile(this.goal_path, "goal.json");
    if (parsed === null) fail("not_found", `no goal registry at ${this.goal_path}`);
    return normalizeGoalRecord(parsed, this.goalContext());
  }

  private writeGoalRecord(record: GoalRecord): void {
    atomicWriteJson(this.goal_path, record);
  }

  private assertNoInitializedGoals(): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(this.state_dir, { withFileTypes: true });
    } catch (error) {
      if (isEnoent(error)) return;
      fail("io", `cannot inspect the state directory: ${String(error)}`);
    }
    for (const entry of entries) {
      if (entry.name === ".lock" || entry.name === "ownership.json") {
        continue;
      }
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        fail(
          "invalid_path",
          `unexpected command-center state entry: ${entry.name}`,
        );
      }
      for (const filename of ["goal.json", "events.jsonl"]) {
        const path = join(this.state_dir, entry.name, filename);
        try {
          const stat = lstatSync(path);
          if (stat.isSymbolicLink() || !stat.isFile()) {
            fail("invalid_path", `unsafe command-center state file: ${path}`);
          }
          fail(
            "invalid_schema",
            `ownership.json is missing while ${path} exists; refusing to reset ownership`,
          );
        } catch (error) {
          if (isEnoent(error)) continue;
          if (error instanceof CoordinatorStateError) throw error;
          fail("io", `cannot inspect ${path}: ${String(error)}`);
        }
      }
    }
  }

  private readLedger(allowMissing = false): OwnershipLedger {
    const parsed = readJsonFile(this.ledger_path, "ownership.json");
    if (parsed === null) {
      if (!allowMissing) {
        fail(
          "invalid_schema",
          "ownership.json is missing in an initialized command center; refusing to reset ownership",
        );
      }
      return {
        schema_version: SCHEMA_VERSION,
        repo_root: this.repo_root,
        plan_root: this.plan_root,
        repo_id: this.repo_id,
        entries: [],
      };
    }
    return normalizeLedger(parsed, this.context());
  }

  private writeLedger(ledger: OwnershipLedger): void {
    atomicWriteJson(this.ledger_path, ledger);
  }

  private loadState(repairTail: boolean): LoadedState {
    const record = this.readGoalRecord();
    const journal = readJournal(this.events_path, this.goalContext(), repairTail);
    if (record.applied_seq > journal.events.length) {
      fail(
        "journal_corruption",
        `goal.json applied_seq ${record.applied_seq} exceeds the journal (${journal.events.length})`,
      );
    }
    for (let index = record.applied_seq; index < journal.events.length; index += 1) {
      applyEventToRecord(record, journal.events[index] as GoalEvent);
    }
    const ledger = this.readLedger();
    this.overlayOwnership(record, ledger);
    return {
      record,
      events: journal.events,
      ledger,
      repaired_tail_bytes: journal.repaired_tail_bytes,
    };
  }

  private appendEvent(
    record: GoalRecord,
    events: GoalEvent[],
    input: {
      kind: GoalEventKind;
      plan_id: string | null;
      attempt?: number | null;
      request_id?: string | null;
      source?: string | null;
      data?: Record<string, unknown> | null;
    },
  ): GoalEvent {
    const event: GoalEvent = {
      schema_version: SCHEMA_VERSION,
      seq: events.length + 1,
      time: this.now(),
      kind: input.kind,
      goal_id: this.goal_id,
      plan_id: input.plan_id,
      origin: this.manager,
      attempt: input.attempt ?? null,
      request_id: input.request_id ?? null,
      source: input.source ?? null,
      data: input.data ?? null,
    };
    const line = `${JSON.stringify(event)}\n`;
    normalizeGoalEvent(event, "new event", this.goalContext(), event.seq);
    appendEventLine(this.events_path, line);
    events.push(event);
    return event;
  }

  private overlayOwnership(
    record: GoalRecord,
    ledger: OwnershipLedger,
  ): OwnershipConflict[] {
    const conflicts: OwnershipConflict[] = [];
    const seen = new Set<string>();
    for (const plan of record.plans) {
      const entries = ledger.entries.filter(
        (entry) => entry.plan_path === plan.plan_path,
      );
      if (entries.length === 0) continue;
      const ownLatest = latestEntry(
        entries.filter((entry) => entry.goal_id === this.goal_id),
      );
      if (
        ownLatest &&
        (!plan.coordinator ||
          ownLatest.coordinator.attempt >= plan.coordinator.attempt)
      ) {
        plan.coordinator = { ...ownLatest.coordinator };
      }
      for (const entry of entries) {
        if (!entry.active || entry.goal_id === this.goal_id) continue;
        const key = `${entry.goal_id}\u0000${plan.plan_id}\u0000${entry.coordinator.request_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          plan_id: plan.plan_id,
          goal_id: entry.goal_id,
          request_id: entry.coordinator.request_id,
          lifecycle: entry.coordinator.lifecycle,
          runtime: entry.coordinator.runtime,
        });
      }
    }
    return conflicts;
  }

  private goalState(
    loaded: LoadedState,
    conflicts: OwnershipConflict[],
  ): GoalState {
    return {
      record: loaded.record,
      journal: {
        last_seq: loaded.events.length,
        applied_seq: loaded.record.applied_seq,
        pending: loaded.events.length - loaded.record.applied_seq,
        repaired_tail_bytes: loaded.repaired_tail_bytes,
      },
      ownership_conflicts: conflicts,
    };
  }

  createGoal(spec: GoalSpec): GoalState {
    return this.withLock(() => {
      if (this.exists()) {
        fail("already_exists", `command-center registry already exists for ${this.goal_id}`);
      }
      let orphan;
      try {
        orphan = lstatSync(this.events_path);
      } catch (error) {
        if (!isEnoent(error)) {
          fail("io", `cannot inspect events.jsonl: ${String(error)}`);
        }
      }
      if (orphan && orphan.size > 0) {
        fail(
          "invalid_schema",
          "events.jsonl exists without goal.json; refusing to reset to an empty center",
        );
      }
      const ledgerPresent = (() => {
        try {
          lstatSync(this.ledger_path);
          return true;
        } catch (error) {
          if (isEnoent(error)) return false;
          fail("io", `cannot inspect ownership.json: ${String(error)}`);
        }
      })();
      const ledger = this.readLedger(true);
      if (!ledgerPresent) this.assertNoInitializedGoals();
      const ownedPlanPaths = new Set(
        ledger.entries
          .filter((entry) => entry.active)
          .map((entry) => entry.plan_path),
      );
      if (ledger.entries.some((entry) => entry.goal_id === this.goal_id)) {
        fail(
          "conflict",
          `ownership.json already contains history for ${this.goal_id}; refusing to reset it`,
        );
      }
      const normalized = this.normalizeGoalSpec(spec);
      for (const plan of normalized.plans) {
        if (ownedPlanPaths.has(plan.plan_path)) {
          fail(
            "conflict",
            `plan ${plan.plan_id} is currently owned by another goal`,
          );
        }
      }
      const now = this.now();
      const record: GoalRecord = {
        schema_version: SCHEMA_VERSION,
        goal_id: this.goal_id,
        goal: normalized.goal,
        acceptance: normalized.acceptance,
        approval_revision: normalized.approval_revision,
        manager: { ...this.manager },
        role: "command-center",
        repository: {
          repo_root: this.repo_root,
          plan_root: this.plan_root,
          repo_id: this.repo_id,
        },
        scheduling: {
          max_running_coordinators: normalized.max_running_coordinators,
        },
        created_at: now,
        updated_at: now,
        applied_seq: 0,
        plans: normalized.plans,
        completion: null,
      };
      this.writeLedger(ledger);
      this.writeGoalRecord(record);
      const events: GoalEvent[] = [];
      const event = this.appendEvent(record, events, {
        kind: "goal.created",
        plan_id: null,
        source: "createGoal",
        data: {
          approval_revision: record.approval_revision,
          plan_ids: record.plans.map((plan) => plan.plan_id),
        },
      });
      record.applied_seq = event.seq;
      record.updated_at = event.time;
      this.writeGoalRecord(record);
      return this.goalState(
        {
          record,
          events,
          ledger,
          repaired_tail_bytes: 0,
        },
        [],
      );
    });
  }

  private normalizeGoalSpec(spec: GoalSpec): {
    goal: string;
    acceptance: string[];
    approval_revision: string;
    max_running_coordinators: number;
    plans: PlanRecord[];
  } {
    if (!isRecord(spec)) {
      fail("invalid_schema", "goal spec must be an object");
    }
    const goal = assertMultilineText(spec.goal, "goal", MAX_GOAL_TEXT);
    const acceptance = assertStringArray(spec.acceptance, "acceptance", {
      min: 1,
      max: MAX_PLANS,
      itemMax: MAX_TEXT,
    });
    const approvalRevision = assertOneLine(
      spec.approval_revision,
      "approval_revision",
      MAX_ITEM,
    );
    const maxRunning = assertInteger(
      spec.max_running_coordinators,
      "max_running_coordinators",
      1,
      MAX_PLANS,
    );
    if (!Array.isArray(spec.plans) || spec.plans.length === 0) {
      fail("invalid_schema", "plans must contain at least one plan");
    }
    if (spec.plans.length > MAX_PLANS) {
      fail("invalid_schema", `plans exceeds ${MAX_PLANS}`);
    }
    const now = this.now();
    const seen = new Set<string>();
    const plans: PlanRecord[] = spec.plans.map((raw, index) => {
      if (!isRecord(raw)) {
        fail("invalid_schema", `plans[${index}] must be an object`);
      }
      const planId = assertPlanId(raw.plan_id, `plans[${index}].plan_id`);
      if (seen.has(planId)) {
        fail("invalid_schema", `plans repeats ${planId}`);
      }
      seen.add(planId);
      const planPath = resolve(join(this.plan_root, planId));
      if (!planDirectoryReady(planPath)) {
        fail(
          "invalid_path",
          `plan ${planId} must already exist as a real directory at ${planPath}`,
        );
      }
      const approvedRevision = assertOneLine(
        raw.approved_revision,
        `plans[${index}].approved_revision`,
        MAX_ITEM,
      );
      const runtime = normalizeRuntimeProfile(
        raw.runtime,
        `plans[${index}].runtime`,
      );
      const predecessors = normalizeDependencies(
        raw.predecessors,
        `plans[${index}].predecessors`,
      );
      const resources = assertStringArray(
        raw.resources ?? [],
        `plans[${index}].resources`,
        { max: MAX_EVIDENCE, itemMax: MAX_ITEM, unique: true },
      );
      const conflicts = assertStringArray(
        raw.conflicts ?? [],
        `plans[${index}].conflicts`,
        { max: MAX_EVIDENCE, itemMax: MAX_ITEM, unique: true },
      );
      const lifecyclePermissions = normalizePermissions(
        raw.lifecycle_permissions,
        `plans[${index}].lifecycle_permissions`,
      );
      let verification: VerificationRecord | null = null;
      let lastObservation: LastObservation | null = null;
      if (raw.adoption !== null && raw.adoption !== undefined) {
        if (!isRecord(raw.adoption)) {
          fail("invalid_schema", `plans[${index}].adoption must be an object`);
        }
        if (raw.adoption.state !== "DONE") {
          fail(
            "invalid_schema",
            `plans[${index}].adoption.state must be DONE (only completed outcomes are adopted)`,
          );
        }
        const evidence = normalizeEvidence(
          raw.adoption.evidence,
          `plans[${index}].adoption.evidence`,
          1,
        );
        const reportPath = validateReportPath(
          raw.adoption.report_path,
          planPath,
        );
        verification = {
          revision: approvedRevision,
          attempt: 0,
          request_id: `adopt-${planId}`,
          evidence,
          report_path: reportPath,
          verified_by: { ...this.manager },
          verified_at: now,
        };
        lastObservation = {
          attempt: 0,
          request_id: `adopt-${planId}`,
          state: "DONE",
          wave: null,
          lanes: null,
          blocker: null,
          next_action: null,
          evidence_report: reportPath,
          heartbeat_ts: null,
          meaningful_progress_at: now,
          observed_at: now,
          source: "adoption",
          fingerprint: createHash("sha256")
            .update(JSON.stringify({ state: "DONE", report: reportPath }))
            .digest("hex"),
          seq: 0,
        };
      }
      return {
        plan_id: planId,
        plan_path: planPath,
        approved_revision: approvedRevision,
        scope: normalizePlanScope(raw.scope, `plans[${index}].scope`),
        acceptance: assertStringArray(
          raw.acceptance,
          `plans[${index}].acceptance`,
          { min: 1, max: MAX_PLANS, itemMax: MAX_TEXT },
        ),
        runtime,
        predecessors,
        resources,
        conflicts,
        lifecycle_permissions: lifecyclePermissions,
        worktree: optionalOneLine(
          raw.worktree,
          `plans[${index}].worktree`,
          4096,
        ),
        branch: optionalOneLine(raw.branch, `plans[${index}].branch`, MAX_ITEM),
        coordinator: null,
        verification,
        last_observation: lastObservation,
      };
    });
    return {
      goal,
      acceptance,
      approval_revision: approvalRevision,
      max_running_coordinators: maxRunning,
      plans,
    };
  }

  /**
   * Revise the goal under a new, never-reused approval revision.
   *
   * The original goal text and goal acceptance stay frozen. Added plans are
   * allowed. Unchanged plans keep their full runtime record (attempts,
   * evidence, verification, observations). A changed plan is allowed only
   * when it has no verified/completed evidence and no live or unknown owner;
   * after a verified stop/release its next attempt may use a new revision or
   * runtime profile while its old attempt record and counters are preserved.
   */
  reviseGoal(spec: GoalSpec): GoalState {
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      const record = loaded.record;
      this.requireActor(record.manager, "goal registry");
      const normalized = this.normalizeGoalSpec(spec);
      if (normalized.goal !== record.goal) {
        fail("conflict", "the original goal text is frozen across revisions");
      }
      if (
        JSON.stringify(normalized.acceptance) !==
        JSON.stringify(record.acceptance)
      ) {
        fail(
          "conflict",
          "the original goal acceptance is frozen; add a plan instead of removing acceptance",
        );
      }
      const usedRevisions = new Set<string>([record.approval_revision]);
      for (const event of loaded.events) {
        if (
          (event.kind === "goal.created" || event.kind === "goal.revised") &&
          isRecord(event.data)
        ) {
          if (typeof event.data.approval_revision === "string") {
            usedRevisions.add(event.data.approval_revision);
          }
          if (typeof event.data.previous_approval_revision === "string") {
            usedRevisions.add(event.data.previous_approval_revision);
          }
        }
      }
      if (usedRevisions.has(normalized.approval_revision)) {
        fail(
          "conflict",
          `approval revision ${normalized.approval_revision} was already used; revisions are never reused`,
        );
      }

      const activeEntries = loaded.ledger.entries.filter((entry) => entry.active);
      const activeForGoal = activeEntries.filter(
        (entry) => entry.goal_id === this.goal_id,
      );
      if (
        activeForGoal.length > normalized.max_running_coordinators
      ) {
        fail(
          "conflict",
          `cannot lower max_running_coordinators to ${normalized.max_running_coordinators} with ${activeForGoal.length} active owner(s)`,
        );
      }

      const existingById = new Map(
        record.plans.map((plan) => [plan.plan_id, plan]),
      );
      const incomingIds = new Set(
        normalized.plans.map((plan) => plan.plan_id),
      );
      const added: GoalPlanSpec[] = [];
      const removed: GoalPlanSpec[] = [];
      const changed: Array<{
        plan_id: string;
        previous: GoalPlanSpec;
        next: GoalPlanSpec;
      }> = [];
      const outputPlans: PlanRecord[] = [];

      for (const incoming of normalized.plans) {
        const existing = existingById.get(incoming.plan_id);
        if (!existing) {
          if (
            activeEntries.some(
              (entry) => entry.plan_path === incoming.plan_path,
            )
          ) {
            fail(
              "conflict",
              `cannot add plan ${incoming.plan_id}: its canonical plan path is actively owned`,
            );
          }
          outputPlans.push(incoming);
          added.push(planSpecOf(incoming));
          continue;
        }
        const previousSpec = planSpecOf(existing);
        const nextSpec = planSpecOf(incoming);
        if (planSpecsEqual(previousSpec, nextSpec)) {
          outputPlans.push(existing);
          continue;
        }
        if (existing.verification) {
          fail(
            "conflict",
            `plan ${existing.plan_id} has verified/completed evidence and cannot be revised in place`,
          );
        }
        if (
          activeEntries.some(
            (entry) => entry.plan_path === existing.plan_path,
          )
        ) {
          fail(
            "conflict",
            `plan ${existing.plan_id} has an active or unknown owner; wait for verified stop/release before revising it`,
          );
        }
        if (
          existing.coordinator &&
          existing.coordinator.lifecycle !== "STOPPED"
        ) {
          fail(
            "conflict",
            `plan ${existing.plan_id} has an unproven coordinator lifecycle ${existing.coordinator.lifecycle}; reconcile it before revising`,
          );
        }
        if (
          incoming.verification &&
          (existing.coordinator || existing.last_observation)
        ) {
          fail(
            "conflict",
            `plan ${existing.plan_id} cannot adopt evidence over a recorded attempt`,
          );
        }
        outputPlans.push({
          ...incoming,
          coordinator: existing.coordinator,
          last_observation: existing.last_observation,
          verification: incoming.verification,
        });
        changed.push({
          plan_id: existing.plan_id,
          previous: previousSpec,
          next: nextSpec,
        });
      }

      for (const existing of record.plans) {
        if (incomingIds.has(existing.plan_id)) continue;
        if (
          activeEntries.some(
            (entry) => entry.plan_path === existing.plan_path,
          )
        ) {
          fail(
            "conflict",
            `cannot remove plan ${existing.plan_id} while it has an active or unknown owner`,
          );
        }
        if (
          existing.coordinator ||
          existing.verification ||
          existing.last_observation
        ) {
          fail(
            "conflict",
            `cannot remove plan ${existing.plan_id}: attempts, observations or verified outcomes are preserved across revisions`,
          );
        }
        removed.push(planSpecOf(existing));
      }

      const previousSpecDigest = planSpecDigest(record.plans);
      const nextSpecDigest = planSpecDigest(outputPlans);
      const nextRecord: GoalRecord = {
        ...record,
        approval_revision: normalized.approval_revision,
        scheduling: {
          max_running_coordinators: normalized.max_running_coordinators,
        },
        plans: outputPlans,
        completion: null,
        updated_at: this.now(),
      };
      const event = this.appendEvent(record, loaded.events, {
        kind: "goal.revised",
        plan_id: null,
        source: "reviseGoal",
        data: {
          approval_revision: normalized.approval_revision,
          previous_approval_revision: record.approval_revision,
          previous_spec_digest: previousSpecDigest,
          next_spec_digest: nextSpecDigest,
          previous_completion: record.completion,
          changed,
          added,
          removed,
          next: {
            approval_revision: normalized.approval_revision,
            scheduling: nextRecord.scheduling,
            plans: outputPlans,
            completion: null,
          },
        },
      });
      nextRecord.applied_seq = event.seq;
      nextRecord.updated_at = event.time;
      this.writeGoalRecord(nextRecord);
      const conflicts = this.overlayOwnership(nextRecord, loaded.ledger);
      return this.goalState(
        {
          record: nextRecord,
          events: loaded.events,
          ledger: loaded.ledger,
          repaired_tail_bytes: loaded.repaired_tail_bytes,
        },
        conflicts,
      );
    });
  }

  /**
   * Accept the overall goal after an explicit manager inspection. This is not
   * inferred from child DONE heartbeats or counts: every registered plan must
   * already carry verified approved-revision evidence, every owner must be
   * verifiably STOPPED/released, and the caller supplies goal-level evidence.
   * The aggregate report references child reports beside goal.json.
   */
  completeGoal(input: CompleteGoalInput): CompleteGoalResult {
    this.requireExists();
    if (!isRecord(input)) {
      fail("invalid_schema", "completeGoal input must be an object");
    }
    const approvalRevision = assertOneLine(
      input.approval_revision,
      "approval_revision",
      MAX_ITEM,
    );
    const evidence = normalizeEvidence(input.evidence, "evidence", 1);
    return this.withLock((): CompleteGoalResult => {
      const loaded = this.loadState(true);
      const record = loaded.record;
      this.requireActor(record.manager, "goal registry");
      if (approvalRevision !== record.approval_revision) {
        fail(
          "stale_evidence",
          `goal completion is for revision ${approvalRevision}, but the accepted goal revision is ${record.approval_revision}`,
        );
      }
      const activeEntries = loaded.ledger.entries.filter(
        (entry) => entry.active,
      );
      const planPaths = new Set(
        record.plans.map((plan) => plan.plan_path),
      );
      for (const entry of activeEntries) {
        if (
          entry.goal_id === this.goal_id ||
          planPaths.has(entry.plan_path)
        ) {
          fail(
            "conflict",
            `goal ${this.goal_id} still has an active or unknown owner for plan ${entry.plan_id}; verified release is required before completion`,
          );
        }
      }

      const planReports: GoalPlanReport[] = [];
      for (const plan of record.plans) {
        if (
          plan.coordinator &&
          plan.coordinator.lifecycle !== "STOPPED"
        ) {
          fail(
            "conflict",
            `plan ${plan.plan_id} coordinator lifecycle ${plan.coordinator.lifecycle} is not verified stopped`,
          );
        }
        if (!planIsCompleted(plan)) {
          fail(
            "not_ready",
            `plan ${plan.plan_id} lacks current verified approved-revision evidence and an observed DONE state`,
          );
        }
        const verification = plan.verification;
        if (!verification) {
          fail(
            "not_ready",
            `plan ${plan.plan_id} has no verification record`,
          );
        }
        const reportPath = validateReportPath(
          verification.report_path,
          plan.plan_path,
        );
        planReports.push({
          plan_id: plan.plan_id,
          revision: verification.revision,
          report_path: reportPath,
          evidence: [...verification.evidence],
        });
      }

      const existing = record.completion;
      if (existing && existing.approval_revision === approvalRevision) {
        if (!isInside(existing.report_path, this.goal_dir)) {
          fail(
            "invalid_path",
            "recorded aggregate report is outside the command-center goal directory",
          );
        }
        assertReportSlot(existing.report_path);
        const sameEvidence =
          existing.evidence.length === evidence.length &&
          existing.evidence.every(
            (token, index) => token === evidence[index],
          );
        const samePlans =
          JSON.stringify(existing.plan_reports) ===
          JSON.stringify(planReports);
        if (!sameEvidence || !samePlans) {
          fail(
            "conflict",
            "goal completion is already recorded and immutable for this approval revision",
          );
        }
        const conflicts = this.overlayOwnership(record, loaded.ledger);
        return {
          report_path: existing.report_path,
          completion: existing,
          state: this.goalState(
            {
              record,
              events: loaded.events,
              ledger: loaded.ledger,
              repaired_tail_bytes: loaded.repaired_tail_bytes,
            },
            conflicts,
          ),
        };
      }

      const now = this.now();
      const completionGeneration =
        loaded.events.filter((event) => event.kind === "goal.completed")
          .length + 1;
      const digest = createHash("sha256")
        .update(approvalRevision)
        .digest("hex")
        .slice(0, 12);
      const reportPath = join(
        this.goal_dir,
        completionGeneration === 1
          ? `report-${digest}.md`
          : `report-${digest}-g${completionGeneration}.md`,
      );
      assertReportSlot(reportPath);
      const report = [
        `# Goal report: ${record.goal_id}`,
        `created: ${new Date(now).toISOString()}`,
        `approval_revision: ${approvalRevision}`,
        "result: completed — every registered plan has verified approved-revision evidence",
        "",
        "## Goal acceptance",
        ...record.acceptance.map((item) => `- ${item}`),
        "",
        "## Goal evidence",
        ...evidence.map((item) => `- ${item}`),
        "",
        "## Child plan reports",
        ...planReports.map(
          (item) =>
            `- ${item.plan_id} @ ${item.revision}: ${item.report_path}`,
        ),
        "",
      ].join("\n");
      atomicWriteText(reportPath, report);

      const completion: GoalCompletionRecord = {
        approval_revision: approvalRevision,
        evidence,
        report_path: reportPath,
        completed_at: now,
        completed_by: { ...this.manager },
        plan_reports: planReports,
      };
      const event = this.appendEvent(record, loaded.events, {
        kind: "goal.completed",
        plan_id: null,
        source: "completeGoal",
        data: { completion },
      });
      record.completion = completion;
      record.applied_seq = event.seq;
      record.updated_at = event.time;
      this.writeGoalRecord(record);
      const conflicts = this.overlayOwnership(record, loaded.ledger);
      return {
        report_path: reportPath,
        completion,
        state: this.goalState(
          {
            record,
            events: loaded.events,
            ledger: loaded.ledger,
            repaired_tail_bytes: loaded.repaired_tail_bytes,
          },
          conflicts,
        ),
      };
    });
  }

  read(): GoalState {
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      const conflicts = this.overlayOwnership(loaded.record, loaded.ledger);
      return this.goalState(loaded, conflicts);
    });
  }

  snapshot(): CenterSnapshot {
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      const conflicts = this.overlayOwnership(loaded.record, loaded.ledger);
      const state = this.goalState(loaded, conflicts);
      return {
        ...state,
        readiness: this.computeReadiness(
          loaded.record,
          loaded.events,
          loaded.ledger,
        ),
      };
    });
  }

  readyPlans(): ReadinessReport {
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      return this.computeReadiness(
        loaded.record,
        loaded.events,
        loaded.ledger,
      );
    });
  }

  private untrackedPlanBlocker(
    plan: PlanRecord,
    ledger: OwnershipLedger,
    events: GoalEvent[],
  ): ReadinessBlocker | null {
    if (
      ledger.entries.some(
        (entry) => entry.plan_path === plan.plan_path,
      )
    ) {
      return null;
    }
    if (hasExplicitReopenProvenance(events, plan.plan_id)) {
      return null;
    }
    const heartbeat = readPlanArtifactHeartbeat(plan.plan_path);
    if (heartbeat.status === "missing") return null;
    if (heartbeat.status === "invalid" || heartbeat.state === null) {
      return {
        kind: "untracked_plan_state",
        observed_state: null,
        reason: "invalid",
      };
    }
    if (heartbeat.state === "PLAN") return null;
    return {
      kind: "untracked_plan_state",
      observed_state: heartbeat.state,
      reason:
        heartbeat.state === "WORKING" || heartbeat.state === "WAIT"
          ? "active"
          : "terminal",
    };
  }

  private computeReadiness(
    record: GoalRecord,
    events: GoalEvent[],
    ledger: OwnershipLedger,
  ): ReadinessReport {
    const byId = new Map(record.plans.map((plan) => [plan.plan_id, plan]));
    const cycles = detectCycles(record.plans);
    const limit = record.scheduling.max_running_coordinators;
    const activeEntries = ledger.entries.filter((entry) => entry.active);
    const ownActive = activeEntries.filter(
      (entry) => entry.goal_id === this.goal_id,
    );
    const ready: string[] = [];
    const blocked: Array<{ plan_id: string; reasons: ReadinessBlocker[] }> = [];
    const active: ReadinessReport["active"] = [];
    const completed: string[] = [];
    const selected: PlanRecord[] = [];

    for (const plan of record.plans) {
      if (planIsCompleted(plan)) {
        completed.push(plan.plan_id);
        continue;
      }
      const own = ownActive.find(
        (entry) => entry.plan_path === plan.plan_path,
      );
      if (own) {
        active.push({
          plan_id: plan.plan_id,
          lifecycle: own.coordinator.lifecycle,
          attempt: own.coordinator.attempt,
        });
        continue;
      }
      const reasons: ReadinessBlocker[] = [];
      for (const entry of activeEntries) {
        if (
          entry.goal_id !== this.goal_id &&
          entry.plan_path === plan.plan_path
        ) {
          reasons.push({
            kind: "owned_elsewhere",
            goal_id: entry.goal_id,
            plan_id: plan.plan_id,
            request_id: entry.coordinator.request_id,
            lifecycle: entry.coordinator.lifecycle,
            runtime: entry.coordinator.runtime,
          });
        }
      }
      reasons.push(...dependencyReasons(plan, byId, cycles));
      if (!plan.lifecycle_permissions.includes("launch")) {
        reasons.push({ kind: "not_launch_authorized" });
      }
      if (plan.verification) {
        reasons.push({
          kind: "inconsistent_verification",
          verification_revision: plan.verification.revision,
          observed_state: plan.last_observation?.state ?? null,
        });
      }
      if (!planDirectoryReady(plan.plan_path)) {
        reasons.push({ kind: "missing_plan_path" });
      }
      const untracked = this.untrackedPlanBlocker(plan, ledger, events);
      if (untracked) reasons.push(untracked);
      if (ownActive.length >= limit) {
        reasons.push({
          kind: "concurrency_limit",
          active: ownActive.length,
          limit,
        });
      }
      for (const entry of activeEntries) {
        if (entry.plan_path === plan.plan_path) continue;
        const resource = intersectToken(plan.resources, entry.resources);
        if (resource !== null) {
          reasons.push({
            kind: "resource_conflict",
            resource,
            with_plan_id: entry.plan_id,
          });
        }
        const token = intersectToken(plan.conflicts, entry.conflicts);
        if (token !== null) {
          reasons.push({
            kind: "conflict_token",
            token,
            with_plan_id: entry.plan_id,
          });
        }
      }
      for (const candidate of selected) {
        const resource = intersectToken(plan.resources, candidate.resources);
        if (resource !== null) {
          reasons.push({
            kind: "resource_conflict",
            resource,
            with_plan_id: candidate.plan_id,
          });
        }
        const token = intersectToken(plan.conflicts, candidate.conflicts);
        if (token !== null) {
          reasons.push({
            kind: "conflict_token",
            token,
            with_plan_id: candidate.plan_id,
          });
        }
      }
      const deduped = dedupeReasons(reasons);
      if (deduped.length > 0) {
        blocked.push({ plan_id: plan.plan_id, reasons: deduped });
      } else {
        ready.push(plan.plan_id);
        selected.push(plan);
      }
    }
    return { ready, blocked, active, completed };
  }

  private reserveBlockers(
    record: GoalRecord,
    events: GoalEvent[],
    ledger: OwnershipLedger,
    plan: PlanRecord,
  ): ReadinessBlocker[] {
    const reasons: ReadinessBlocker[] = [];
    const byId = new Map(record.plans.map((entry) => [entry.plan_id, entry]));
    const cycles = detectCycles(record.plans);
    const activeEntries = ledger.entries.filter((entry) => entry.active);
    for (const entry of activeEntries) {
      if (entry.plan_path === plan.plan_path) {
        reasons.push({
          kind: "owned_elsewhere",
          goal_id: entry.goal_id,
          plan_id: plan.plan_id,
          request_id: entry.coordinator.request_id,
          lifecycle: entry.coordinator.lifecycle,
          runtime: entry.coordinator.runtime,
        });
      }
    }
    if (planIsCompleted(plan)) {
      reasons.push({ kind: "already_verified" });
    } else if (plan.verification) {
      reasons.push({
        kind: "inconsistent_verification",
        verification_revision: plan.verification.revision,
        observed_state: plan.last_observation?.state ?? null,
      });
    }
    reasons.push(...dependencyReasons(plan, byId, cycles));
    if (!plan.lifecycle_permissions.includes("launch")) {
      reasons.push({ kind: "not_launch_authorized" });
    }
    if (!planDirectoryReady(plan.plan_path)) {
      reasons.push({ kind: "missing_plan_path" });
    }
    const untracked = this.untrackedPlanBlocker(plan, ledger, events);
    if (untracked) reasons.push(untracked);
    const ownActive = activeEntries.filter(
      (entry) => entry.goal_id === this.goal_id,
    );
    if (ownActive.length >= record.scheduling.max_running_coordinators) {
      reasons.push({
        kind: "concurrency_limit",
        active: ownActive.length,
        limit: record.scheduling.max_running_coordinators,
      });
    }
    for (const entry of activeEntries) {
      if (entry.plan_path === plan.plan_path) continue;
      const resource = intersectToken(plan.resources, entry.resources);
      if (resource !== null) {
        reasons.push({
          kind: "resource_conflict",
          resource,
          with_plan_id: entry.plan_id,
        });
      }
      const token = intersectToken(plan.conflicts, entry.conflicts);
      if (token !== null) {
        reasons.push({
          kind: "conflict_token",
          token,
          with_plan_id: entry.plan_id,
        });
      }
    }
    return dedupeReasons(reasons);
  }

  reserve(
    plan_id: string,
    request_id: string,
    expected_plan?: GoalPlanSpec,
  ): ReservationResult {
    const planId = assertPlanId(plan_id);
    const requestId = assertToken(request_id, "request_id");
    const expected =
      expected_plan === undefined
        ? null
        : normalizeExpectedPlanSpec(expected_plan);
    this.requireExists();
    return this.withLock((): ReservationResult => {
      const loaded = this.loadState(true);
      this.requireActor(loaded.record.manager, "goal registry");
      const plan = loaded.record.plans.find((item) => item.plan_id === planId);
      if (!plan) fail("not_found", `plan ${planId} is not registered in this goal`);
      if (expected !== null && !planSpecsEqual(planSpecOf(plan), expected)) {
        fail(
          "conflict",
          "plan spec changed since it was read; re-read and retry reservation",
        );
      }
      const duplicate = loaded.ledger.entries.find(
        (entry) => entry.coordinator.request_id === requestId,
      );
      if (duplicate) {
        if (
          duplicate.plan_path !== plan.plan_path ||
          duplicate.goal_id !== this.goal_id
        ) {
          return {
            status: "conflict",
            reason: "request_id_reused",
            owner: {
              goal_id: duplicate.goal_id,
              plan_id: duplicate.plan_id,
              request_id: requestId,
            },
          };
        }
        plan.coordinator = { ...duplicate.coordinator };
        return {
          status: "duplicate",
          coordinator: { ...duplicate.coordinator },
        };
      }
      const blockers = this.reserveBlockers(
        loaded.record,
        loaded.events,
        loaded.ledger,
        plan,
      );
      if (blockers.length > 0) {
        return { status: "blocked", reasons: blockers };
      }
      const previousAttempts = loaded.ledger.entries
        .filter((entry) => entry.plan_path === plan.plan_path)
        .map((entry) => entry.coordinator.attempt);
      const attempt =
        Math.max(0, plan.coordinator?.attempt ?? 0, ...previousAttempts) + 1;
      const now = this.now();
      const coordinator: CoordinatorRecord = {
        request_id: requestId,
        attempt,
        lifecycle: "QUEUED",
        manager: { ...this.manager },
        runtime: null,
        runtime_version: null,
        runtime_model: null,
        runtime_effort: null,
        process: null,
        artifact_baseline: null,
        working_directory: null,
        launch_intent_at: now,
        acknowledged_at: null,
        reconciled_at: null,
        stopped_at: null,
        stop_evidence: null,
        approved_revision: plan.approved_revision,
        runtime_profile: { ...plan.runtime },
      };
      const entry: OwnershipEntry = {
        schema_version: SCHEMA_VERSION,
        owner_key: ownerKeyFor(this.plan_root, plan.plan_path),
        goal_id: this.goal_id,
        plan_id: plan.plan_id,
        plan_path: plan.plan_path,
        resources: [...plan.resources],
        conflicts: [...plan.conflicts],
        active: true,
        updated_at: now,
        coordinator,
      };
      loaded.ledger.entries.push(entry);
      this.writeLedger(loaded.ledger);
      const event = this.appendEvent(loaded.record, loaded.events, {
        kind: "plan.reserved",
        plan_id: plan.plan_id,
        attempt,
        request_id: requestId,
        source: "reserve",
        data: { coordinator, owner_key: entry.owner_key },
      });
      plan.coordinator = coordinator;
      loaded.record.applied_seq = event.seq;
      loaded.record.updated_at = event.time;
      this.writeGoalRecord(loaded.record);
      return {
        status: "reserved",
        coordinator: { ...coordinator },
      };
    });
  }

  private findPlan(record: GoalRecord, planId: string): PlanRecord {
    const plan = record.plans.find((item) => item.plan_id === planId);
    if (!plan) fail("not_found", `plan ${planId} is not registered in this goal`);
    return plan;
  }

  private requireCurrentCoordinator(
    plan: PlanRecord,
    requestId: string,
    attempt: number,
  ): CoordinatorRecord {
    if (!plan.coordinator) {
      fail("conflict", `plan ${plan.plan_id} has no coordinator reservation`);
    }
    const coordinator = plan.coordinator;
    if (
      coordinator.request_id !== requestId ||
      coordinator.attempt !== attempt
    ) {
      fail(
        "conflict",
        `plan ${plan.plan_id} is owned by request ${coordinator.request_id} attempt ${coordinator.attempt}`,
      );
    }
    return coordinator;
  }

  private syncLedgerCoordinator(
    ledger: OwnershipLedger,
    plan: PlanRecord,
    coordinator: CoordinatorRecord,
  ): void {
    const entry = [...ledger.entries]
      .reverse()
      .find(
        (candidate) =>
          candidate.plan_path === plan.plan_path &&
          candidate.coordinator.attempt === coordinator.attempt,
      );
    if (!entry) {
      fail(
        "journal_corruption",
        `ownership ledger lost attempt ${coordinator.attempt} for ${plan.plan_id}`,
      );
    }
    entry.coordinator = { ...coordinator };
    entry.active = coordinator.lifecycle !== "STOPPED";
    entry.updated_at = this.now();
  }

  transition(plan_id: string, input: TransitionInput): CoordinatorRecord {
    const planId = assertPlanId(plan_id);
    if (!isRecord(input)) fail("invalid_schema", "transition input must be an object");
    const requestId = assertToken(input.request_id, "request_id");
    const attempt = assertInteger(input.attempt, "attempt", 1, 1_000_000);
    const next = assertLifecycle(input.lifecycle, "lifecycle");
    const reason =
      input.reason === undefined
        ? null
        : assertOneLine(input.reason, "reason", MAX_ITEM);
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      const plan = this.findPlan(loaded.record, planId);
      const coordinator = this.requireCurrentCoordinator(
        plan,
        requestId,
        attempt,
      );
      this.requireActor(coordinator.manager, `plan ${plan.plan_id} coordinator`);
      if (next === coordinator.lifecycle) return { ...coordinator };
      if (next === "RUNNING") {
        fail(
          "lifecycle",
          "RUNNING requires acknowledge with the actual runtime identity",
        );
      }
      if (next === "STOPPED") {
        fail(
          "lifecycle",
          "STOPPED requires release with verified stop evidence",
        );
      }
      const allowed: Record<CoordinatorLifecycle, CoordinatorLifecycle[]> = {
        QUEUED: ["LAUNCHING", "RECONCILING"],
        LAUNCHING: ["RECONCILING"],
        RUNNING: ["RECONCILING"],
        RECONCILING: [],
        STOPPED: [],
      };
      if (!allowed[coordinator.lifecycle].includes(next)) {
        fail(
          "lifecycle",
          `coordinator ${plan.plan_id} cannot move ${coordinator.lifecycle} -> ${next}`,
        );
      }
      if (next === "LAUNCHING") {
        if (!plan.lifecycle_permissions.includes("launch")) {
          fail("permission", `plan ${plan.plan_id} is not authorized to launch`);
        }
        const otherActive = loaded.ledger.entries.filter(
          (entry) =>
            entry.active &&
            entry.goal_id === this.goal_id &&
            entry.plan_path !== plan.plan_path,
        );
        if (
          otherActive.length >=
          loaded.record.scheduling.max_running_coordinators
        ) {
          fail(
            "conflict",
            `concurrency limit reached (${loaded.record.scheduling.max_running_coordinators})`,
          );
        }
      }
      const now = this.now();
      const updated: CoordinatorRecord = {
        ...coordinator,
        lifecycle: next,
        reconciled_at: next === "RECONCILING" ? now : coordinator.reconciled_at,
      };
      this.syncLedgerCoordinator(loaded.ledger, plan, updated);
      this.writeLedger(loaded.ledger);
      const event = this.appendEvent(loaded.record, loaded.events, {
        kind: "plan.lifecycle",
        plan_id: plan.plan_id,
        attempt: updated.attempt,
        request_id: updated.request_id,
        source: "transition",
        data: { coordinator: updated, reason },
      });
      plan.coordinator = updated;
      loaded.record.applied_seq = event.seq;
      loaded.record.updated_at = event.time;
      this.writeGoalRecord(loaded.record);
      return { ...updated };
    });
  }

  /**
   * Record the owned process immediately after spawn, before ACP session
   * creation. The exact working directory and {pid,start_id} are immutable for
   * the attempt; a different identity needs a verified-stop release and a new
   * reservation. A crash before this call persists stays RECONCILING.
   */
  recordSpawn(plan_id: string, input: RecordSpawnInput): CoordinatorRecord {
    const planId = assertPlanId(plan_id);
    if (!isRecord(input)) {
      fail("invalid_schema", "recordSpawn input must be an object");
    }
    const requestId = assertToken(input.request_id, "request_id");
    const attempt = assertInteger(input.attempt, "attempt", 1, 1_000_000);
    const process = normalizeProcess(input.process, "process");
    if (!process) {
      fail("invalid_schema", "recordSpawn requires a real process identity");
    }
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      const plan = this.findPlan(loaded.record, planId);
      const coordinator = this.requireCurrentCoordinator(
        plan,
        requestId,
        attempt,
      );
      this.requireActor(coordinator.manager, `plan ${plan.plan_id} coordinator`);
      if (
        coordinator.lifecycle !== "LAUNCHING" &&
        coordinator.lifecycle !== "RECONCILING"
      ) {
        if (
          coordinator.process &&
          processIdentityEqual(coordinator.process, process)
        ) {
          return { ...coordinator };
        }
        fail(
          "lifecycle",
          `recordSpawn requires LAUNCHING or RECONCILING, not ${coordinator.lifecycle}`,
        );
      }
      const workingDirectory = validateWorkingDirectory(
        input.working_directory,
        this.state_dir,
        this.plan_root,
      );
      if (
        coordinator.working_directory !== null &&
        coordinator.working_directory !== workingDirectory
      ) {
        fail(
          "conflict",
          `plan ${plan.plan_id} working directory is immutable for attempt ${coordinator.attempt}`,
        );
      }
      if (coordinator.process) {
        if (processIdentityEqual(coordinator.process, process)) {
          return { ...coordinator };
        }
        fail(
          "conflict",
          `plan ${plan.plan_id} already recorded process ${coordinator.process.pid}/${coordinator.process.start_id}`,
        );
      }
      const updated: CoordinatorRecord = {
        ...coordinator,
        process,
        working_directory: workingDirectory,
      };
      this.syncLedgerCoordinator(loaded.ledger, plan, updated);
      this.writeLedger(loaded.ledger);
      const event = this.appendEvent(loaded.record, loaded.events, {
        kind: "plan.spawned",
        plan_id: plan.plan_id,
        attempt: updated.attempt,
        request_id: updated.request_id,
        source: "recordSpawn",
        data: { coordinator: updated },
      });
      plan.coordinator = updated;
      loaded.record.applied_seq = event.seq;
      loaded.record.updated_at = event.time;
      this.writeGoalRecord(loaded.record);
      return { ...updated };
    });
  }

  acknowledge(plan_id: string, input: AcknowledgeInput): CoordinatorRecord {
    const planId = assertPlanId(plan_id);
    if (!isRecord(input)) {
      fail("invalid_schema", "acknowledge input must be an object");
    }
    const requestId = assertToken(input.request_id, "request_id");
    const attempt = assertInteger(input.attempt, "attempt", 1, 1_000_000);
    const runtime = normalizeManager(input.runtime, "runtime");
    const runtimeVersion = assertOneLine(
      input.runtime_version,
      "runtime_version",
      100,
    );
    const model = optionalOneLine(input.model, "model", 200);
    const effort = optionalOneLine(input.effort, "effort", 100);
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      const plan = this.findPlan(loaded.record, planId);
      const coordinator = this.requireCurrentCoordinator(
        plan,
        requestId,
        attempt,
      );
      this.requireActor(coordinator.manager, `plan ${plan.plan_id} coordinator`);
      if (runtime.harness !== coordinator.runtime_profile.harness) {
        fail(
          "conflict",
          `runtime harness ${runtime.harness} is not the approved ${coordinator.runtime_profile.harness}`,
        );
      }
      if (
        coordinator.runtime_profile.runtime_version !== null &&
        runtimeVersion !== coordinator.runtime_profile.runtime_version
      ) {
        fail(
          "conflict",
          `runtime version ${runtimeVersion} is not the approved ${coordinator.runtime_profile.runtime_version}`,
        );
      }
      if (
        coordinator.runtime_profile.model !== null &&
        model !== coordinator.runtime_profile.model
      ) {
        fail(
          "conflict",
          `runtime model ${String(model)} is not the approved ${coordinator.runtime_profile.model}`,
        );
      }
      if (
        coordinator.runtime_profile.effort !== null &&
        effort !== coordinator.runtime_profile.effort
      ) {
        fail(
          "conflict",
          `runtime effort ${String(effort)} is not the approved ${coordinator.runtime_profile.effort}`,
        );
      }
      const workingDirectory = validateWorkingDirectory(
        input.working_directory,
        this.state_dir,
        this.plan_root,
      );
      if (
        coordinator.working_directory !== null &&
        coordinator.working_directory !== workingDirectory
      ) {
        fail(
          "conflict",
          `plan ${plan.plan_id} working directory is immutable for attempt ${coordinator.attempt}`,
        );
      }
      const inputProcess = normalizeProcess(input.process, "process");
      if (!coordinator.process) {
        fail(
          "not_ready",
          `plan ${plan.plan_id} requires recordSpawn before acknowledge`,
        );
      }
      if (
        inputProcess &&
        !processIdentityEqual(coordinator.process, inputProcess)
      ) {
        fail(
          "conflict",
          `plan ${plan.plan_id} already recorded a different process identity`,
        );
      }
      const process = coordinator.process;
      const now = this.now();
      if (!planDirectoryReady(plan.plan_path)) {
        fail(
          "invalid_path",
          `plan ${plan.plan_id} directory is required for the ACK baseline`,
        );
      }
      const baseline =
        coordinator.artifact_baseline ??
        captureArtifactBaseline(plan.plan_path, now);
      if (coordinator.runtime) {
        const sameIdentity =
          coordinator.runtime.harness === runtime.harness &&
          coordinator.runtime.session_id === runtime.session_id &&
          coordinator.runtime_version === runtimeVersion &&
          coordinator.runtime_model === model &&
          (coordinator.runtime_effort ?? null) === effort;
        if (!sameIdentity) {
          fail(
            "conflict",
            `plan ${plan.plan_id} already acknowledged runtime ${coordinator.runtime.harness}/${coordinator.runtime.session_id}`,
          );
        }
        if (coordinator.lifecycle === "RUNNING") {
          return { ...coordinator };
        }
        if (
          coordinator.lifecycle !== "LAUNCHING" &&
          coordinator.lifecycle !== "RECONCILING"
        ) {
          fail(
            "lifecycle",
            `cannot re-acknowledge a coordinator in ${coordinator.lifecycle}`,
          );
        }
        const reattached: CoordinatorRecord = {
          ...coordinator,
          lifecycle: "RUNNING",
          process,
          artifact_baseline: baseline,
          working_directory: workingDirectory,
          acknowledged_at: coordinator.acknowledged_at ?? now,
        };
        this.syncLedgerCoordinator(loaded.ledger, plan, reattached);
        this.writeLedger(loaded.ledger);
        const event = this.appendEvent(loaded.record, loaded.events, {
          kind: "plan.acknowledged",
          plan_id: plan.plan_id,
          attempt: reattached.attempt,
          request_id: reattached.request_id,
          source: "acknowledge",
          data: { coordinator: reattached },
        });
        plan.coordinator = reattached;
        loaded.record.applied_seq = event.seq;
        loaded.record.updated_at = event.time;
        this.writeGoalRecord(loaded.record);
        return { ...reattached };
      }
      if (
        coordinator.lifecycle !== "LAUNCHING" &&
        coordinator.lifecycle !== "RECONCILING"
      ) {
        fail(
          "lifecycle",
          `cannot acknowledge a coordinator in ${coordinator.lifecycle}; expected LAUNCHING or RECONCILING`,
        );
      }
      const updated: CoordinatorRecord = {
        ...coordinator,
        lifecycle: "RUNNING",
        runtime,
        runtime_version: runtimeVersion,
        runtime_model: model,
        runtime_effort: effort,
        process,
        artifact_baseline: baseline,
        working_directory: workingDirectory,
        acknowledged_at: now,
      };
      this.syncLedgerCoordinator(loaded.ledger, plan, updated);
      this.writeLedger(loaded.ledger);
      const event = this.appendEvent(loaded.record, loaded.events, {
        kind: "plan.acknowledged",
        plan_id: plan.plan_id,
        attempt: updated.attempt,
        request_id: updated.request_id,
        source: "acknowledge",
        data: { coordinator: updated },
      });
      plan.coordinator = updated;
      loaded.record.applied_seq = event.seq;
      loaded.record.updated_at = event.time;
      this.writeGoalRecord(loaded.record);
      return { ...updated };
    });
  }

  release(plan_id: string, input: ReleaseInput): CoordinatorRecord {
    const planId = assertPlanId(plan_id);
    if (!isRecord(input)) fail("invalid_schema", "release input must be an object");
    const requestId = assertToken(input.request_id, "request_id");
    const attempt = assertInteger(input.attempt, "attempt", 1, 1_000_000);
    const stopEvidence = assertOneLine(
      input.stop_evidence,
      "stop_evidence",
      MAX_ITEM,
    );
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      const plan = this.findPlan(loaded.record, planId);
      const coordinator = this.requireCurrentCoordinator(
        plan,
        requestId,
        attempt,
      );
      this.requireActor(coordinator.manager, `plan ${plan.plan_id} coordinator`);
      if (!plan.lifecycle_permissions.includes("stop")) {
        fail("permission", `plan ${plan.plan_id} is not authorized to stop`);
      }
      if (coordinator.lifecycle === "STOPPED") {
        return { ...coordinator };
      }
      const now = this.now();
      const updated: CoordinatorRecord = {
        ...coordinator,
        lifecycle: "STOPPED",
        stopped_at: now,
        stop_evidence: stopEvidence,
      };
      this.syncLedgerCoordinator(loaded.ledger, plan, updated);
      this.writeLedger(loaded.ledger);
      const event = this.appendEvent(loaded.record, loaded.events, {
        kind: "plan.released",
        plan_id: plan.plan_id,
        attempt: updated.attempt,
        request_id: updated.request_id,
        source: "release",
        data: { coordinator: updated },
      });
      plan.coordinator = updated;
      loaded.record.applied_seq = event.seq;
      loaded.record.updated_at = event.time;
      this.writeGoalRecord(loaded.record);
      return { ...updated };
    });
  }

  recordVerification(
    plan_id: string,
    input: VerificationInput,
  ): VerificationRecord {
    const planId = assertPlanId(plan_id);
    if (!isRecord(input)) {
      fail("invalid_schema", "verification input must be an object");
    }
    const requestId = assertToken(input.request_id, "request_id");
    const attempt = assertInteger(input.attempt, "attempt", 1, 1_000_000);
    const revision = assertOneLine(input.revision, "revision", MAX_ITEM);
    const evidence = normalizeEvidence(input.evidence, "evidence", 1);
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      const plan = this.findPlan(loaded.record, planId);
      const coordinator = this.requireCurrentCoordinator(
        plan,
        requestId,
        attempt,
      );
      this.requireActor(coordinator.manager, `plan ${plan.plan_id} coordinator`);
      if (revision !== plan.approved_revision) {
        fail(
          "stale_evidence",
          `verification revision ${revision} does not match the approved revision ${plan.approved_revision}`,
        );
      }
      if (coordinator.approved_revision !== revision) {
        fail(
          "stale_evidence",
          "the coordinator was launched for a different approved revision",
        );
      }
      const observedState = plan.last_observation?.state ?? null;
      if (
        observedState !== "DONE" ||
        plan.last_observation?.attempt !== coordinator.attempt
      ) {
        fail(
          "not_ready",
          `plan ${plan.plan_id} is not observed DONE at attempt ${coordinator.attempt}`,
        );
      }
      const reportPath = validateReportPath(input.report_path, plan.plan_path);
      if (reportPath !== join(plan.plan_path, "report.md")) {
        fail(
          "invalid_path",
          `plan ${plan.plan_id} verification must use its canonical report.md`,
        );
      }
      if (
        !coordinator.runtime ||
        coordinator.acknowledged_at === null ||
        coordinator.process === null
      ) {
        fail(
          "not_ready",
          `plan ${plan.plan_id} has no acknowledged current attempt`,
        );
      }
      const baseline = coordinator.artifact_baseline;
      if (!baseline) {
        fail(
          "not_ready",
          `plan ${plan.plan_id} has no ACK artifact baseline`,
        );
      }
      const statusSha = readDoneStatus(plan.plan_path);
      if (statusSha === baseline.status_sha256) {
        fail(
          "not_ready",
          `plan ${plan.plan_id} status.md has not changed since the current attempt was acknowledged`,
        );
      }
      const currentArtifacts = captureArtifactBaseline(
        plan.plan_path,
        this.now(),
      );
      if (!artifactsChangedFromBaseline(baseline, currentArtifacts)) {
        fail(
          "not_ready",
          `plan ${plan.plan_id} status/report have not both changed since the current attempt was acknowledged`,
        );
      }
      const existing = plan.verification;
      if (
        existing &&
        existing.revision === revision &&
        existing.attempt === coordinator.attempt &&
        existing.request_id === coordinator.request_id &&
        existing.report_path === reportPath &&
        existing.evidence.length === evidence.length &&
        existing.evidence.every((token, index) => token === evidence[index])
      ) {
        return { ...existing };
      }
      const now = this.now();
      const verification: VerificationRecord = {
        revision,
        attempt: coordinator.attempt,
        request_id: coordinator.request_id,
        evidence,
        report_path: reportPath,
        verified_by: { ...this.manager },
        verified_at: now,
      };
      const event = this.appendEvent(loaded.record, loaded.events, {
        kind: "plan.verification",
        plan_id: plan.plan_id,
        attempt: verification.attempt,
        request_id: verification.request_id,
        source: "recordVerification",
        data: { verification },
      });
      plan.verification = verification;
      loaded.record.applied_seq = event.seq;
      loaded.record.updated_at = event.time;
      this.writeGoalRecord(loaded.record);
      return { ...verification };
    });
  }

  /**
   * Invalidate one plan's verification for a same-plan finding. Requires a
   * current verified outcome (explicitly adopted completed outcomes included)
   * and a verified stop (no active/unknown owner). Unverified work is resumed
   * by reserving a new attempt, not by reopening. Preserves scope/acceptance/
   * profiles/attempts/files and records prior proof in plan.reopened. Refuses
   * while a transitive dependent still holds verification or an active owner;
   * the manager must reopen/reconcile those descendants first.
   */
  reopenPlan(plan_id: string, input: ReopenPlanInput): GoalState {
    const planId = assertPlanId(plan_id);
    if (!isRecord(input)) {
      fail("invalid_schema", "reopenPlan input must be an object");
    }
    const finding = assertOneLine(input.finding, "finding", MAX_TEXT);
    const evidence = normalizeEvidence(input.evidence, "evidence", 1);
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      const record = loaded.record;
      this.requireActor(record.manager, "goal registry");
      const plan = this.findPlan(record, planId);
      const activeEntries = loaded.ledger.entries.filter(
        (entry) => entry.active,
      );
      if (
        activeEntries.some(
          (entry) => entry.plan_path === plan.plan_path,
        )
      ) {
        fail(
          "conflict",
          `plan ${plan.plan_id} has an active or unknown owner; verified stop/release is required before reopening`,
        );
      }
      if (
        plan.coordinator &&
        plan.coordinator.lifecycle !== "STOPPED"
      ) {
        fail(
          "conflict",
          `plan ${plan.plan_id} coordinator ${plan.coordinator.lifecycle} is not verified stopped`,
        );
      }
      if (!plan.verification) {
        fail(
          "not_ready",
          `plan ${plan.plan_id} has no verified outcome to reopen; unverified work can be reserved again without reopening`,
        );
      }

      const byId = new Map(
        record.plans.map((item) => [item.plan_id, item]),
      );
      const dependents = new Map<string, string[]>();
      for (const candidate of record.plans) {
        for (const dependency of candidate.predecessors) {
          const list = dependents.get(dependency.plan_id) ?? [];
          list.push(candidate.plan_id);
          dependents.set(dependency.plan_id, list);
        }
      }
      const queue = [plan.plan_id];
      const visited = new Set<string>([plan.plan_id]);
      while (queue.length > 0) {
        const current = queue.shift() as string;
        for (const dependentId of dependents.get(current) ?? []) {
          if (visited.has(dependentId)) continue;
          visited.add(dependentId);
          const dependent = byId.get(dependentId);
          if (!dependent) continue;
          const activeDependent = activeEntries.some(
            (entry) => entry.plan_path === dependent.plan_path,
          );
          const liveDependent =
            dependent.coordinator !== null &&
            dependent.coordinator.lifecycle !== "STOPPED";
          if (
            activeDependent ||
            liveDependent ||
            dependent.verification !== null
          ) {
            fail(
              "conflict",
              `dependent plan ${dependent.plan_id} would consume invalidated evidence; reopen or reconcile dependents first`,
            );
          }
          queue.push(dependentId);
        }
      }

      const now = this.now();
      let baseline: ArtifactBaseline | null = null;
      if (plan.coordinator) {
        baseline = captureArtifactBaseline(plan.plan_path, now);
        const updated: CoordinatorRecord = {
          ...plan.coordinator,
          artifact_baseline: baseline,
        };
        plan.coordinator = updated;
        this.syncLedgerCoordinator(loaded.ledger, plan, updated);
        this.writeLedger(loaded.ledger);
      }
      const previousVerification = plan.verification;
      const previousCompletion = record.completion;
      const event = this.appendEvent(record, loaded.events, {
        kind: "plan.reopened",
        plan_id: plan.plan_id,
        attempt: plan.coordinator?.attempt ?? null,
        request_id: plan.coordinator?.request_id ?? null,
        source: "reopenPlan",
        data: {
          finding,
          evidence,
          previous_verification: previousVerification,
          previous_completion: previousCompletion,
          baseline,
        },
      });
      plan.verification = null;
      record.completion = null;
      record.applied_seq = event.seq;
      record.updated_at = event.time;
      this.writeGoalRecord(record);
      const conflicts = this.overlayOwnership(record, loaded.ledger);
      return this.goalState(
        {
          record,
          events: loaded.events,
          ledger: loaded.ledger,
          repaired_tail_bytes: loaded.repaired_tail_bytes,
        },
        conflicts,
      );
    });
  }

  appendObservation(input: ObservationInput): ObservationAppendResult {
    if (!isRecord(input)) {
      fail("invalid_schema", "observation input must be an object");
    }
    const planId = assertPlanId(input.plan_id);
    const requestId = assertToken(input.request_id, "request_id");
    const attempt = assertInteger(input.attempt, "attempt", 0, 1_000_000);
    const state = assertPlanState(input.state, "state");
    const wave = optionalOneLine(input.wave, "wave", MAX_ITEM);
    const lanes = normalizeLanes(input.lanes, "lanes");
    const blocker = optionalOneLine(input.blocker, "blocker", MAX_ITEM);
    const nextAction = optionalOneLine(
      input.next_action,
      "next_action",
      MAX_ITEM,
    );
    const evidenceReport = optionalOneLine(
      input.evidence_report,
      "evidence_report",
      4096,
    );
    if (evidenceReport !== null && !isAbsolute(evidenceReport)) {
      fail("invalid_path", "evidence_report must be absolute");
    }
    const heartbeatTs =
      input.heartbeat_ts === null || input.heartbeat_ts === undefined
        ? null
        : assertTimestamp(input.heartbeat_ts, "heartbeat_ts");
    const meaningfulProgressAt =
      input.meaningful_progress_at === null ||
      input.meaningful_progress_at === undefined
        ? null
        : assertTimestamp(
            input.meaningful_progress_at,
            "meaningful_progress_at",
          );
    const observedAt = assertTimestamp(input.observed_at, "observed_at");
    const source = assertOneLine(input.source, "source", MAX_ITEM);
    if (
      typeof input.fingerprint !== "string" ||
      !FINGERPRINT_RE.test(input.fingerprint)
    ) {
      fail("invalid_schema", "fingerprint must be a sha256 hex digest");
    }
    this.requireExists();
    return this.withLock((): ObservationAppendResult => {
      const loaded = this.loadState(true);
      const plan = this.findPlan(loaded.record, planId);
      if (!plan.coordinator) {
        return {
          accepted: false,
          reason: "unknown_binding",
          seq: null,
          applied_seq: loaded.record.applied_seq,
        };
      }
      this.requireActor(
        plan.coordinator.manager,
        `plan ${plan.plan_id} coordinator`,
      );
      if (
        plan.coordinator.request_id !== requestId ||
        plan.coordinator.attempt !== attempt
      ) {
        return {
          accepted: false,
          reason: "stale_attempt",
          seq: null,
          applied_seq: loaded.record.applied_seq,
        };
      }
      if (
        !plan.coordinator.runtime ||
        plan.coordinator.acknowledged_at === null
      ) {
        return {
          accepted: false,
          reason: "not_acknowledged",
          seq: null,
          applied_seq: loaded.record.applied_seq,
        };
      }
      if (state === "DONE") {
        const baseline = plan.coordinator.artifact_baseline;
        if (!baseline) {
          return {
            accepted: false,
            reason: "unproven_done",
            seq: null,
            applied_seq: loaded.record.applied_seq,
          };
        }
        const currentArtifacts = captureArtifactBaseline(
          plan.plan_path,
          this.now(),
        );
        if (!artifactsChangedFromBaseline(baseline, currentArtifacts)) {
          return {
            accepted: false,
            reason: "unproven_done",
            seq: null,
            applied_seq: loaded.record.applied_seq,
          };
        }
      }
      const previous = plan.last_observation;
      if (previous) {
        if (attempt < previous.attempt) {
          return {
            accepted: false,
            reason: "stale_attempt",
            seq: null,
            applied_seq: loaded.record.applied_seq,
          };
        }
        if (attempt === previous.attempt) {
          if (input.fingerprint === previous.fingerprint) {
            return {
              accepted: false,
              reason: "duplicate",
              seq: null,
              applied_seq: loaded.record.applied_seq,
            };
          }
          if (
            heartbeatTs !== null &&
            previous.heartbeat_ts !== null &&
            heartbeatTs < previous.heartbeat_ts
          ) {
            return {
              accepted: false,
              reason: "stale_time",
              seq: null,
              applied_seq: loaded.record.applied_seq,
            };
          }
          if (
            plan.verification &&
            previous.state === "DONE" &&
            state !== "DONE"
          ) {
            return {
              accepted: false,
              reason: "terminal_regression",
              seq: null,
              applied_seq: loaded.record.applied_seq,
            };
          }
        }
      }
      const observation: LastObservation = {
        attempt,
        request_id: requestId,
        state,
        wave,
        lanes,
        blocker,
        next_action: nextAction,
        evidence_report: evidenceReport,
        heartbeat_ts: heartbeatTs,
        meaningful_progress_at: meaningfulProgressAt,
        observed_at: observedAt,
        source,
        fingerprint: input.fingerprint,
        seq: loaded.events.length + 1,
      };
      const event = this.appendEvent(loaded.record, loaded.events, {
        kind: "plan.observation",
        plan_id: plan.plan_id,
        attempt,
        request_id: requestId,
        source,
        data: { observation },
      });
      plan.last_observation = observation;
      loaded.record.applied_seq = event.seq;
      loaded.record.updated_at = event.time;
      this.writeGoalRecord(loaded.record);
      return {
        accepted: true,
        reason: "accepted",
        seq: event.seq,
        applied_seq: loaded.record.applied_seq,
      };
    });
  }

  appendRequestOutcome(
    input: RequestOutcomeInput,
  ): { seq: number; applied_seq: number } {
    if (!isRecord(input)) {
      fail("invalid_schema", "request outcome input must be an object");
    }
    const planId = assertPlanId(input.plan_id);
    const requestId = assertToken(input.request_id, "request_id");
    const attempt = assertInteger(input.attempt, "attempt", 0, 1_000_000);
    const action = assertOneLine(input.action, "action", 64);
    if (
      input.direction !== "to_coordinator" &&
      input.direction !== "from_coordinator"
    ) {
      fail("invalid_schema", "direction must be to_coordinator or from_coordinator");
    }
    const allowedOutcomes = [
      "delivered",
      "accepted",
      "rejected",
      "unknown",
      "duplicate",
      "permission_denied",
    ] as const;
    if (!allowedOutcomes.includes(input.outcome)) {
      fail("invalid_schema", "outcome is not a supported request outcome");
    }
    const source = assertOneLine(input.source, "source", MAX_ITEM);
    const detail =
      input.detail === null || input.detail === undefined
        ? null
        : assertOneLine(input.detail, "detail", MAX_ITEM);
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      const plan = this.findPlan(loaded.record, planId);
      if (!plan.coordinator) {
        fail(
          "conflict",
          `plan ${plan.plan_id} has no coordinator attempt for request outcomes`,
        );
      }
      if (plan.coordinator.attempt !== attempt) {
        fail(
          "conflict",
          `plan ${plan.plan_id} is at attempt ${plan.coordinator.attempt}, not ${attempt}`,
        );
      }
      this.requireActor(
        plan.coordinator.manager,
        `plan ${plan.plan_id} coordinator`,
      );
      for (let index = loaded.events.length - 1; index >= 0; index -= 1) {
        const existing = loaded.events[index] as GoalEvent;
        if (
          existing.kind !== "request.outcome" ||
          existing.request_id !== requestId
        ) {
          continue;
        }
        if (
          existing.plan_id !== plan.plan_id ||
          existing.attempt !== attempt
        ) {
          fail(
            "conflict",
            `request ${requestId} is already bound to another plan/attempt`,
          );
        }
        if (
          !isRecord(existing.data) ||
          !isRecord(existing.data.request)
        ) {
          continue;
        }
        const request = existing.data.request;
        if (
          request.action === action &&
          request.direction === input.direction &&
          request.outcome === input.outcome
        ) {
          return { seq: existing.seq, applied_seq: loaded.record.applied_seq };
        }
      }
      const request = {
        action,
        direction: input.direction,
        outcome: input.outcome,
        detail,
      };
      const event = this.appendEvent(loaded.record, loaded.events, {
        kind: "request.outcome",
        plan_id: plan.plan_id,
        attempt,
        request_id: requestId,
        source,
        data: { request },
      });
      loaded.record.applied_seq = event.seq;
      loaded.record.updated_at = event.time;
      this.writeGoalRecord(loaded.record);
      return { seq: event.seq, applied_seq: loaded.record.applied_seq };
    });
  }

  findRequestOutcome(
    request_id: string,
    action?: string,
  ): RequestOutcomeRecord | null {
    const requestId = assertToken(request_id, "request_id");
    const actionFilter =
      action === undefined ? null : assertOneLine(action, "action", 64);
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      for (let index = loaded.events.length - 1; index >= 0; index -= 1) {
        const event = loaded.events[index] as GoalEvent;
        if (
          event.kind !== "request.outcome" ||
          event.request_id !== requestId ||
          !isRecord(event.data) ||
          !isRecord(event.data.request)
        ) {
          continue;
        }
        const request = event.data.request;
        const eventAction =
          typeof request.action === "string" ? request.action : "";
        if (actionFilter !== null && eventAction !== actionFilter) continue;
        if (
          typeof request.direction !== "string" ||
          typeof request.outcome !== "string" ||
          event.plan_id === null
        ) {
          continue;
        }
        return {
          seq: event.seq,
          time: event.time,
          plan_id: event.plan_id,
          request_id: requestId,
          attempt: event.attempt ?? 0,
          action: eventAction,
          direction: request.direction,
          outcome: request.outcome,
          source: event.source ?? "",
          detail:
            typeof request.detail === "string" ? request.detail : null,
        };
      }
      return null;
    });
  }

  recoverJournal(): JournalRecovery {
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      this.overlayOwnership(loaded.record, loaded.ledger);
      if (loaded.record.applied_seq < loaded.events.length) {
        loaded.record.applied_seq = loaded.events.length;
        loaded.record.updated_at = this.now();
        this.writeGoalRecord(loaded.record);
      }
      return {
        last_seq: loaded.events.length,
        applied_seq: loaded.record.applied_seq,
        pending: 0,
        repaired_tail_bytes: loaded.repaired_tail_bytes,
        events: loaded.events.length,
      };
    });
  }

  listEvents(after_seq = 0): GoalEvent[] {
    const after = assertInteger(
      after_seq,
      "after_seq",
      0,
      Number.MAX_SAFE_INTEGER,
    );
    this.requireExists();
    return this.withLock(() => {
      const loaded = this.loadState(true);
      return loaded.events
        .filter((event) => event.seq > after)
        .map((event) => ({ ...event }));
    });
  }
}
