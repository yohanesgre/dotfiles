/**
 * ACP v1 transport for one parent-owned harness process.
 *
 * Built only on the official `@agentclientprotocol/sdk` 2.0.1 stable-v1
 * entrypoint: the SDK owns JSON-RPC framing, request ids, and schema parsing.
 * This module owns the parent-side lifecycle: version-pinned launch into one
 * user-systemd transient unit, one new session, prompt/control turns,
 * permission plumbing, cancellation, and graceful stdin-EOF shutdown with
 * exact unit/cgroup stop proof. It holds no goal registry and no plan state.
 *
 * Limits are deliberately explicit: callbacks observe activity and permission
 * requests, but they do not enforce every native tool (OMP ordinary writes and
 * edits bypass the ACP permission gate). A cancelled turn does not stop native
 * subagents. A stop whose bounded exit deadline expires is RECONCILING, not
 * stopped, and the owned process handle is retained.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

import {
  type ControlBinding,
  type ControlEnvelope,
  ControlValidationError,
  type ControlAckEnvelope,
  buildControlPrompt,
  createAckEnvelope,
  parseControlReply,
  serializeControlEnvelope,
} from "./control-message";
import {
  type LaunchProfileId,
  type PreparedLaunch,
  type ProcessStartIdentity,
  LaunchProfileError,
  prepareLaunch,
  readProcessStartIdentity,
  verifyProcessStartIdentity,
} from "./launch-profiles";
import {
  type StartedUnitIdentity,
  type UnitStopProof,
  DEFAULT_UNIT_TIMEOUT_MS,
  SystemdLifecycleError,
  assertUserSystemdAvailable,
  buildSystemdRunArgs,
  environmentNamesForUnit,
  newUnitName,
  proveOwnedUnitStopped,
  queryUserUnit,
  rootedCgroupPath,
  waitForUserUnit,
} from "./systemd-lifecycle";

export const ACP_SDK_VERSION = "2.0.1";

export const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_PROMPT_BYTES = 256 * 1024;
export const DEFAULT_INIT_TIMEOUT_MS = 120_000;
export const DEFAULT_SESSION_TIMEOUT_MS = 60_000;
/** Bound for an agent's asynchronous config_option_update to confirm a set. */
export const DEFAULT_CONFIG_SETTLE_TIMEOUT_MS = 5_000;
export const DEFAULT_PROMPT_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_STOP_TIMEOUT_MS = 30_000;

const CANCEL_NOTIFY_TIMEOUT_MS = 5_000;
const MAX_SUMMARY_CHARS = 200;
const MAX_PLAN_ENTRIES = 64;

const textEncoder = new TextEncoder();
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]+/g;
const SECRET_RE =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*["']?[^\s"',}]{4,})/gi;

function byteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeSummary(value: unknown, maxChars = MAX_SUMMARY_CHARS): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_CHARS_RE, " ").replace(SECRET_RE, "[redacted]").trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, maxChars);
}

function redactError(error: unknown): { code: string; detail: string } {
  if (error instanceof acp.RequestError) {
    return {
      code: `jsonrpc_${error.code}`,
      detail: sanitizeSummary(error.message, 300) ?? "JSON-RPC error",
    };
  }
  if (error instanceof AcpStartupError) {
    return { code: error.code, detail: sanitizeSummary(error.detail, 300) ?? error.code };
  }
  if (error instanceof ControlValidationError) {
    return { code: error.code, detail: sanitizeSummary(error.detail, 300) ?? error.code };
  }
  if (error instanceof LaunchProfileError) {
    return { code: error.code, detail: sanitizeSummary(error.detail, 300) ?? error.code };
  }
  if (error instanceof Error) {
    return {
      code: error.name || "error",
      detail: sanitizeSummary(error.message, 300) ?? "operation failed",
    };
  }
  return { code: "error", detail: sanitizeSummary(String(error), 300) ?? "operation failed" };
}

function assertPositiveSafeInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function authRequired(error: unknown): boolean {
  return error instanceof acp.RequestError && error.code === -32000;
}

const MAX_SESSION_CONFIG_VALUE_CHARS = 512;

/** Generic per-session selection kinds; no provider-specific option ids. */
export type AcpSessionConfigKind = "model" | "effort";

/** One validated per-session configuration choice. */
export interface AcpSessionConfigSelection {
  readonly kind: AcpSessionConfigKind;
  readonly config_id: string;
  readonly value: string;
}

function normalizedSessionConfigValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_SESSION_CONFIG_VALUE_CHARS) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

function matchesSessionConfigSelection(
  option: acp.SessionConfigOption,
  kind: AcpSessionConfigKind,
): option is acp.SessionConfigOption & { readonly type: "select" } {
  if (option.type !== "select") return false;
  if (kind === "model") return option.id === "model" || option.category === "model";
  return option.id === "effort" || option.category === "thought_level";
}

function sessionConfigOptionValues(option: acp.SessionConfigSelect): readonly string[] {
  const values: string[] = [];
  for (const entry of option.options) {
    if ("group" in entry) {
      for (const nested of entry.options) {
        const value = normalizedSessionConfigValue(nested.value);
        if (value !== null) values.push(value);
      }
      continue;
    }
    const value = normalizedSessionConfigValue(entry.value);
    if (value !== null) values.push(value);
  }
  return values;
}

/** Standard select currentValue for one selection kind; never guessed. */
function observedSessionSelection(
  configOptions: readonly acp.SessionConfigOption[] | null | undefined,
  kind: AcpSessionConfigKind,
): string | null {
  if (!configOptions) return null;
  for (const option of configOptions) {
    if (!matchesSessionConfigSelection(option, kind)) continue;
    return normalizedSessionConfigValue(option.currentValue);
  }
  return null;
}

/** Current advertised value for one exact option id, or null. */
export function sessionConfigCurrentValue(
  configOptions: readonly acp.SessionConfigOption[] | null | undefined,
  configId: string,
): string | null {
  if (!configOptions) return null;
  for (const option of configOptions) {
    if (option.type !== "select" || option.id !== configId) continue;
    return normalizedSessionConfigValue(option.currentValue);
  }
  return null;
}

/**
 * Resolve one explicit selection against the agent's advertised select
 * options, flattening option groups. Unknown, unsupported, malformed, and
 * ambiguous requests fail closed; nothing is defaulted or guessed.
 */
export function resolveSessionConfigSelection(
  configOptions: readonly acp.SessionConfigOption[] | null | undefined,
  kind: AcpSessionConfigKind,
  requested: unknown,
): AcpSessionConfigSelection {
  const value = normalizedSessionConfigValue(requested);
  if (value === null) {
    throw new AcpStartupError(
      "session_config_invalid",
      `requested ${kind} must be a non-empty string of at most ${MAX_SESSION_CONFIG_VALUE_CHARS} characters without control characters`,
    );
  }
  const options = configOptions ?? [];
  const matched: (acp.SessionConfigOption & { readonly type: "select" })[] = [];
  for (const option of options) {
    if (matchesSessionConfigSelection(option, kind)) matched.push(option);
  }
  if (matched.length === 0) {
    throw new AcpStartupError(
      "session_config_unavailable",
      `agent did not advertise a ${kind} select option`,
    );
  }
  if (matched.length > 1) {
    throw new AcpStartupError(
      "session_config_ambiguous",
      `agent advertised ${matched.length} ${kind} select options; refusing to guess`,
    );
  }
  const option = matched[0]!;
  if (!sessionConfigOptionValues(option).includes(value)) {
    throw new AcpStartupError(
      "session_config_value_unadvertised",
      `requested ${kind} ${JSON.stringify(value)} is not an advertised ${option.id} value`,
    );
  }
  return Object.freeze({ kind, config_id: option.id, value });
}

/** Null/omitted means no selection; malformed explicit values fail closed. */
function requestedSessionSelection(value: unknown, kind: AcpSessionConfigKind): string | null {
  if (value === undefined || value === null) return null;
  const normalized = normalizedSessionConfigValue(value);
  if (normalized === null) {
    throw new AcpStartupError(
      "session_config_invalid",
      `requested ${kind} must be a non-empty string of at most ${MAX_SESSION_CONFIG_VALUE_CHARS} characters without control characters`,
    );
  }
  return normalized;
}

/** One settlement result and the observation generation it corresponds to. */
export interface AcpConfigResolution {
  readonly options: readonly acp.SessionConfigOption[];
  readonly generation: number;
}

/**
 * State machine for one explicit session-config set request.
 *
 * Only the RPC response or a post-request config_option_update can confirm the
 * request. An update counts only when it carries the exact requested value and
 * actually transitions the option away from its previous value: neither a
 * pre-request snapshot nor a no-change repeat of a baseline value can bless it.
 * A post-request update that contradicts the request also invalidates a stale
 * matching RPC response.
 */
export class AcpSessionConfigSettlement {
  private readonly configIdValue: string;
  private readonly requestedValue: string;
  private latestOptions: readonly acp.SessionConfigOption[] | null = null;
  private latestGeneration = 0;
  private confirmed = false;
  private sawUpdate = false;
  private conflict = false;
  private done = false;
  private waiters: (() => void)[] = [];

  constructor(configId: string, value: string) {
    this.configIdValue = configId;
    this.requestedValue = value;
  }

  /** Feed one post-request config snapshot; `previous` is the state before it. */
  observe(
    previous: readonly acp.SessionConfigOption[] | null,
    next: readonly acp.SessionConfigOption[],
    generation = this.latestGeneration + 1,
  ): void {
    if (this.done) return;
    this.sawUpdate = true;
    this.latestOptions = next;
    this.latestGeneration = generation;
    const nextValue = sessionConfigCurrentValue(next, this.configIdValue);
    if (nextValue !== this.requestedValue) {
      // A later authoritative update supersedes any earlier confirmation.
      this.confirmed = false;
      this.conflict = true;
    } else {
      const previousValue =
        previous === null ? null : sessionConfigCurrentValue(previous, this.configIdValue);
      if (previousValue === null || previousValue !== this.requestedValue) {
        this.confirmed = true;
        this.conflict = false;
      }
    }
    this.wake();
  }

  /**
   * Decide from the RPC response. Resolution always returns the latest full
   * matching snapshot and the observation generation it corresponds to, never
   * a superseded confirmation or a stale response.
   */
  async resolve(
    returned: readonly acp.SessionConfigOption[],
    timeoutMs = DEFAULT_CONFIG_SETTLE_TIMEOUT_MS,
    baseGeneration = 0,
  ): Promise<AcpConfigResolution> {
    const returnedMatches =
      sessionConfigCurrentValue(returned, this.configIdValue) === this.requestedValue;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const resolved = this.currentResolution(returned, returnedMatches, baseGeneration);
      if (resolved !== null) return resolved;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const signaled = await this.waitForUpdate(remaining);
      if (!signaled) break;
    }
    const observed =
      this.latestOptions === null
        ? "no post-request config update"
        : `${this.configIdValue}=${JSON.stringify(sessionConfigCurrentValue(this.latestOptions, this.configIdValue))}`;
    throw new AcpStartupError(
      "session_config_readback_mismatch",
      `${this.configIdValue} did not read back ${JSON.stringify(this.requestedValue)} within ${timeoutMs} ms (${observed})`,
    );
  }

  cancel(): void {
    this.done = true;
    this.wake();
  }

  private currentResolution(
    returned: readonly acp.SessionConfigOption[],
    returnedMatches: boolean,
    baseGeneration: number,
  ): AcpConfigResolution | null {
    const latestMatches =
      this.latestOptions !== null &&
      sessionConfigCurrentValue(this.latestOptions, this.configIdValue) === this.requestedValue;
    if (latestMatches && (this.confirmed || (returnedMatches && !this.conflict))) {
      return { options: this.latestOptions!, generation: this.latestGeneration };
    }
    if (returnedMatches && !this.conflict && !this.sawUpdate) {
      return { options: returned, generation: baseGeneration };
    }
    return null;
  }

  private wake(): void {
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  private waitForUpdate(timeoutMs: number): Promise<boolean> {
    if (this.done) return Promise.resolve(false);
    return new Promise((resolve) => {
      const waiter = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(false);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
}

/**
 * Single authoritative observation of the session config options. Every
 * accepted config_option_update advances the generation; a settlement result is
 * published only when no newer observation exists, and startup validates the
 * latest canonical snapshot instead of a stale local result.
 */
export class AcpConfigObservation {
  private optionsValue: readonly acp.SessionConfigOption[] | null = null;
  private generationValue = 0;

  get options(): readonly acp.SessionConfigOption[] | null {
    return this.optionsValue;
  }

  get generation(): number {
    return this.generationValue;
  }

  /** Seed the session/new snapshot only while no update has been observed. */
  seed(options: readonly acp.SessionConfigOption[] | null): void {
    if (this.generationValue === 0) this.optionsValue = options;
  }

  /** Record one accepted config_option_update and return its generation. */
  record(next: readonly acp.SessionConfigOption[]): number {
    this.generationValue += 1;
    this.optionsValue = next;
    return this.generationValue;
  }

  /**
   * Publish a settlement resolution unless a newer observation arrived after
   * it. A superseded result never overwrites the newer snapshot; if the newer
   * snapshot no longer carries the exact value, the handoff fails closed.
   */
  adopt(
    resolution: AcpConfigResolution,
    expect: { readonly config_id: string; readonly value: string },
  ): readonly acp.SessionConfigOption[] {
    if (this.generationValue > resolution.generation) {
      const latest = this.optionsValue;
      const observed = latest === null ? null : sessionConfigCurrentValue(latest, expect.config_id);
      if (observed !== expect.value) {
        throw new AcpStartupError(
          "session_config_readback_mismatch",
          `${expect.config_id} was superseded by a later config update (${JSON.stringify(observed)})`,
        );
      }
      return latest!;
    }
    this.optionsValue = resolution.options;
    return resolution.options;
  }

  /**
   * Validate the latest canonical observation before startup becomes ready.
   * Required selections must still be present; returns the observed values.
   */
  requireSelections(
    requested: readonly { readonly kind: AcpSessionConfigKind; readonly value: string }[],
  ): { readonly model: string | null; readonly effort: string | null } {
    const options = this.optionsValue;
    for (const request of requested) {
      const observed = observedSessionSelection(options, request.kind);
      if (observed !== request.value) {
        throw new AcpStartupError(
          "session_config_readback_mismatch",
          `${request.kind} read back ${JSON.stringify(observed)} before startup ready; requested ${JSON.stringify(request.value)}`,
        );
      }
    }
    return {
      model: observedSessionSelection(options, "model"),
      effort: observedSessionSelection(options, "effort"),
    };
  }
}


type Raced<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "timeout" };

async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<Raced<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Raced<T>>((resolve) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        resolve({ kind: "timeout" });
      }
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      promise.then(
        (value): Raced<T> => ({ kind: "value", value }),
        (error): Raced<T> => ({ kind: "error", error }),
      ),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type AcpCoordinatorState =
  | "starting"
  | "ready"
  | "busy"
  | "cancelling"
  | "stopping"
  | "reconciling"
  | "stopped"
  | "failed";

export type AcpTurnKind = "control" | "work";

export type AcpTurnOutcome =
  | "acknowledged"
  | "completed"
  | "cancelled"
  | "refused"
  | "max_tokens"
  | "max_turn_requests"
  | "timeout_uncertain"
  | "protocol_error"
  | "invalid_envelope"
  | "binding_mismatch"
  | "not_ready"
  | "busy"
  | "ack_required"
  | "auth_required"
  | "invalid_prompt"
  | "error";

export interface AcpTurnError {
  readonly code: string;
  readonly detail: string;
  readonly retryable: false;
}

export interface AcpWorkPromptResult {
  readonly turn_id: string;
  readonly outcome: AcpTurnOutcome;
  readonly stop_reason: acp.StopReason | null;
  readonly reply_bytes: number;
  readonly cancel_sent: boolean;
  readonly timed_out: boolean;
  readonly error: AcpTurnError | null;
}

export interface AcpControlResult extends AcpWorkPromptResult {
  readonly ack: ControlAckEnvelope | null;
}

export interface AcpRequestOptions {
  readonly timeout_ms?: number;
}

export interface AcpLaunchOptions {
  readonly cwd: string;
  readonly binding: ControlBinding;
  readonly callbacks?: AcpCoordinatorCallbacks;
  readonly max_message_bytes?: number;
  readonly max_prompt_bytes?: number;
  readonly max_control_reply_bytes?: number;
  readonly init_timeout_ms?: number;
  readonly session_timeout_ms?: number;
  readonly prompt_timeout_ms?: number;
  readonly stop_timeout_ms?: number;
  readonly version_timeout_ms?: number;
  readonly unit_timeout_ms?: number;
  /** Explicit session model; null/omitted leaves the agent default untouched. */
  readonly model?: string | null;
  /** Explicit session effort; null/omitted leaves the agent default untouched. */
  readonly effort?: string | null;
}

export interface AcpToolActivity {
  readonly tool_call_id: string;
  readonly title: string | null;
  readonly name: string | null;
  readonly kind: acp.ToolKind | null;
  readonly status: acp.ToolCallStatus | null;
}

export interface AcpPlanActivity {
  readonly entry_count: number;
  readonly entries: readonly {
    readonly priority: acp.PlanEntryPriority;
    readonly status: acp.PlanEntryStatus;
  }[];
}

export interface AcpMessageActivity {
  readonly message_id: string | null;
  readonly bytes: number;
}

/** Secret-free session activity: no message text, raw input/output, or usage. */
export interface AcpActivityEvent {
  readonly type: "session_update";
  readonly session_id: string;
  readonly update_type: acp.SessionUpdate["sessionUpdate"];
  readonly at: string;
  readonly tool: AcpToolActivity | null;
  readonly plan: AcpPlanActivity | null;
  readonly mode_id: string | null;
  readonly message: AcpMessageActivity | null;
}

export interface AcpPermissionOptionSummary {
  readonly optionId: string;
  readonly name: string;
  readonly kind: acp.PermissionOptionKind;
}

export interface AcpPendingPermission {
  readonly permission_id: string;
  readonly acp_request_id: acp.JsonRpcId;
  readonly session_id: string;
  readonly binding: ControlBinding;
  readonly tool_call_id: string;
  readonly tool_title: string | null;
  readonly tool_name: string | null;
  readonly tool_kind: acp.ToolKind | null;
  /**
   * Standard native locations for scope review. Ephemeral in-memory data:
   * never persist or log this request payload.
   */
  readonly locations: readonly acp.ToolCallLocation[];
  /** Full native toolCall update, including rawInput/rawOutput. Ephemeral. */
  readonly tool_call: acp.ToolCallUpdate;
  readonly options: readonly AcpPermissionOptionSummary[];
  readonly requested_at: string;
}

export type AcpPermissionDecision =
  | { readonly outcome: "selected"; readonly option_id: string }
  | { readonly outcome: "cancelled" };

export type AcpPermissionResponseResult =
  | {
      readonly ok: true;
      readonly permission_id: string;
      readonly outcome: "selected" | "cancelled";
      readonly option_id: string | null;
      readonly option_kind: acp.PermissionOptionKind | null;
    }
  | {
      readonly ok: false;
      readonly permission_id: string;
      readonly code:
        | "unknown_permission"
        | "stale_permission"
        | "unknown_option"
        | "insufficient_scope"
        | "invalid_decision"
        | "cancel_requested";
      readonly denied: boolean;
    };

export interface AcpExitEvent {
  readonly type: "exit";
  readonly profile_id: LaunchProfileId;
  readonly launch_id: string;
  /** Real harness MainPID, never the systemd-run wrapper. */
  readonly pid: number | null;
  readonly wrapper_pid: number | null;
  readonly unit_name: string;
  readonly invocation_id: string | null;
  /** Rooted cgroup2 path: /sys/fs/cgroup + systemd ControlGroup. */
  readonly control_group: string | null;
  readonly session_id: string | null;
  readonly at: string;
  /** Harness/unit exit status when known; null until unit proof. */
  readonly exit_code: number | null;
  readonly exit_signal: string | null;
  readonly wrapper_exit_code: number | null;
  readonly wrapper_exit_signal: string | null;
  readonly expected: boolean;
  readonly identity: ProcessStartIdentity | null;
  readonly identity_verified: boolean;
  readonly children_cleanup: "systemd_control_group";
}

export interface AcpSpawnEvent {
  readonly type: "spawn";
  readonly launch_id: string;
  readonly profile_id: LaunchProfileId;
  readonly binding: ControlBinding;
  /** Real unit MainPID, never the systemd-run wrapper. */
  readonly pid: number;
  readonly start_time_ticks: string;
  readonly exe_path: string | null;
  readonly wrapper_pid: number | null;
  readonly unit_name: string;
  readonly invocation_id: string;
  /** Rooted cgroup2 path: /sys/fs/cgroup + systemd ControlGroup. */
  readonly control_group: string;
  readonly resolved_executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly prepared_at: string;
  readonly started_at: string;
  readonly cli_version: string;
}

export interface AcpCoordinatorCallbacks {
  /**
   * Awaited after the real PID/start identity exists and before initialize.
   * Persist the actual process identity here so a failed handshake still has
   * a durable owner record. A rejection aborts the launch.
   */
  readonly onSpawn?: (event: AcpSpawnEvent) => void | Promise<void>;
  readonly onActivity?: (event: AcpActivityEvent) => void | Promise<void>;
  readonly onPermission?: (request: AcpPendingPermission) => void | Promise<void>;
  readonly onExit?: (event: AcpExitEvent) => void | Promise<void>;
}

export interface AcpInFlightTurn {
  readonly turn_id: string;
  readonly kind: AcpTurnKind;
  readonly started_at: string;
  readonly timed_out: boolean;
  readonly cancel_sent: boolean;
}

export interface AcpSettledTurn {
  readonly turn_id: string;
  readonly kind: AcpTurnKind;
  readonly outcome: AcpTurnOutcome;
  readonly stop_reason: acp.StopReason | null;
  readonly timed_out: boolean;
  /** True when this is the late settlement of a turn the caller saw as uncertain. */
  readonly after_timeout: boolean;
  readonly cancel_sent: boolean;
  readonly settled_at: string;
}

export interface AcpCoordinatorStatus {
  readonly state: AcpCoordinatorState;
  readonly profile_id: LaunchProfileId;
  readonly launch_id: string;
  readonly pid: number | null;
  readonly session_id: string | null;
  readonly started_at: string;
  readonly acked: boolean;
  readonly active_turn: AcpInFlightTurn | null;
  readonly last_turn: AcpSettledTurn | null;
  readonly pending_permissions: number;
  readonly ownership_retained: boolean;
  readonly quiescence_verified: boolean;
  readonly wrapper_pid: number | null;
  readonly unit_name: string;
  readonly invocation_id: string | null;
  /** Rooted cgroup2 path: /sys/fs/cgroup + systemd ControlGroup. */
  readonly control_group: string | null;
  readonly exit_code: number | null;
  readonly exit_signal: string | null;
  readonly last_error: string | null;
}

export interface AcpLaunchInfo {
  readonly launch_id: string;
  readonly profile_id: LaunchProfileId;
  /** Real unit MainPID, never the systemd-run wrapper. */
  readonly pid: number;
  readonly start_time_ticks: string;
  readonly exe_path: string | null;
  readonly identity_source: "proc";
  readonly identity_verified: boolean;
  readonly wrapper_pid: number | null;
  readonly unit_name: string;
  readonly invocation_id: string;
  /** Rooted cgroup2 path: /sys/fs/cgroup + systemd ControlGroup. */
  readonly control_group: string;
  readonly resolved_executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly prepared_at: string;
  readonly started_at: string;
}

export interface AcpModeInfo {
  readonly current_mode_id: string;
  readonly available_mode_ids: readonly string[];
}

export interface AcpAuthMethodInfo {
  readonly id: string;
  readonly name: string;
  readonly type: "agent" | "terminal";
}

export interface AcpCapabilityLimitations {
  readonly auth: "explicit_failure_only";
  readonly interactive_login: false;
  readonly session_load_resume_used: false;
  readonly durable_reattach: false;
  readonly permission_gate: "acp_request_permission_only";
  readonly enforces_all_native_tools: false;
  readonly lifecycle: "systemd_user_transient_service";
  readonly cgroup_cleanup: true;
  readonly filesystem_sandbox: false;
  readonly network_sandbox: false;
  readonly unit_migration_authorized: false;
  readonly external_service_execution_authorized: false;
  readonly cancel_stops_children: false;
}

export interface AcpCapabilityInfo {
  readonly profile_id: LaunchProfileId;
  readonly sdk_version: typeof ACP_SDK_VERSION;
  readonly protocol_version: 1;
  readonly cli_version: string;
  readonly launch: AcpLaunchInfo;
  readonly agent: {
    readonly name: string;
    readonly version: string;
    readonly title: string | null;
  };
  readonly session_id: string;
  /** Standard session/new model config option currentValue, else null. */
  readonly model: string | null;
  /** Standard session effort (thought_level category) currentValue, else null. */
  readonly effort: string | null;
  readonly modes: AcpModeInfo | null;
  readonly acked: boolean;
  readonly capabilities: {
    readonly load_session_advertised: boolean;
    readonly prompt: {
      readonly image: boolean;
      readonly audio: boolean;
      readonly embedded_context: boolean;
    };
    readonly mcp: { readonly http: boolean; readonly sse: boolean };
    readonly session: {
      readonly list: boolean;
      readonly delete: boolean;
      readonly resume: boolean;
      readonly close: boolean;
      readonly additional_directories: boolean;
    };
    readonly auth_methods: readonly AcpAuthMethodInfo[];
  };
  readonly limitations: AcpCapabilityLimitations;
}

export interface AcpConnectionInfo {
  readonly launch_id: string;
  readonly profile_id: LaunchProfileId;
  /** Real unit MainPID, never the systemd-run wrapper. */
  readonly pid: number;
  readonly wrapper_pid: number | null;
  readonly unit_name: string;
  readonly invocation_id: string;
  /** Rooted cgroup2 path: /sys/fs/cgroup + systemd ControlGroup. */
  readonly control_group: string;
  readonly session_id: string;
  readonly initialized_at: string;
  readonly cli_version: string;
  readonly model: string | null;
  readonly effort: string | null;
  readonly agent: {
    readonly name: string;
    readonly version: string;
    readonly title: string | null;
  };
}

export interface AcpCancelTurnOptions {
  readonly reason?: string;
}

export interface AcpCancelTurnResult {
  readonly sent: boolean;
  readonly session_id: string | null;
  readonly turn_id: string | null;
  readonly state: AcpCoordinatorState;
  readonly denied_pending_permissions: number;
  readonly children_not_stopped: true;
  readonly error: AcpTurnError | null;
}

export interface AcpGracefulStopOptions {
  readonly timeout_ms?: number;
}

export interface AcpGracefulStopResult {
  readonly outcome: "stopped" | "unknown" | "not_started";
  readonly launch_id: string;
  readonly pid: number | null;
  readonly deadline_ms: number;
  readonly already_stopped: boolean;
  readonly exit_code: number | null;
  readonly exit_signal: string | null;
  readonly identity: ProcessStartIdentity | null;
  readonly identity_verified_before_exit: boolean;
  readonly ownership_retained: boolean;
  readonly quiescence_verified: boolean;
  readonly wrapper_pid: number | null;
  readonly unit_name: string;
  readonly invocation_id: string | null;
  readonly control_group: string | null;
  readonly unit_load_state: string | null;
  readonly unit_active_state: string | null;
  readonly unit_sub_state: string | null;
  readonly cgroup_present: boolean;
  readonly cgroup_populated: boolean | null;
  readonly agent_exit_status: number | null;
  readonly unit_result: string | null;
  readonly wrapper_exit_code: number | null;
  readonly wrapper_exit_signal: string | null;
  readonly stdin_closed: boolean;
  readonly children_not_signaled_by_transport: true;
  readonly children_cleanup: "systemd_control_group";
  readonly detail: string | null;
}

export type AcpStartupErrorCode =
  | "spawn_failed"
  | "process_identity_unavailable"
  | "initialize_failed"
  | "initialize_timeout"
  | "protocol_version_unsupported"
  | "agent_identity_missing"
  | "agent_identity_mismatch"
  | "agent_version_mismatch"
  | "session_new_failed"
  | "session_new_timeout"
  | "session_id_invalid"
  | "auth_required"
  | "spawn_record_failed"
  | "version_unparseable"
  | "systemd_unavailable"
  | "unit_start_timeout"
  | "unit_query_failed"
  | "unit_identity_invalid"
  | "agent_main_pid_invalid"
  | "session_config_invalid"
  | "session_config_unavailable"
  | "session_config_ambiguous"
  | "session_config_value_unadvertised"
  | "session_config_apply_failed"
  | "session_config_readback_mismatch";

export class AcpStartupError extends Error {
  readonly code: AcpStartupErrorCode;
  readonly detail: string;

  constructor(code: AcpStartupErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "AcpStartupError";
    this.code = code;
    this.detail = detail;
  }
}

export class AcpLaunchError extends Error {
  readonly code: string;
  readonly failure: unknown;
  readonly coordinator: AcpCoordinator;
  readonly stop: AcpGracefulStopResult | null;
  readonly stop_outcome: AcpGracefulStopResult["outcome"] | null;

  constructor(failure: unknown, coordinator: AcpCoordinator, stop: AcpGracefulStopResult | null) {
    const summary = redactError(failure);
    super(`${summary.code}: ${summary.detail}`);
    this.name = "AcpLaunchError";
    this.code = summary.code;
    this.failure = failure;
    this.coordinator = coordinator;
    this.stop = stop;
    this.stop_outcome = stop?.outcome ?? null;
  }
}

/** Identity checks applied to every accepted session update. */
export type AcpUpdateIdentityRejection = "session_mismatch" | "child_inlined" | "attempt_mismatch";

/**
 * Filter mismatched sessions, explicitly identified child/subagent updates,
 * and top-level attempt metadata that does not match the bound attempt.
 */
function classifyIdentityMeta(
  meta: unknown,
  boundSessionId: string,
  attempt: number,
): AcpUpdateIdentityRejection | null {
  if (!isRecord(meta)) return null;
  for (const [key, value] of Object.entries(meta)) {
    const lower = key.toLowerCase();
    if (typeof value === "string" && lower.includes("session") && value !== boundSessionId) {
      return "child_inlined";
    }
    if (
      (lower === "attempt" || lower.includes("attempt_id") || lower.includes("attemptid")) &&
      typeof value === "number" &&
      value !== attempt
    ) {
      return "attempt_mismatch";
    }
    if (/(^|[^a-z])(child|subagent|parent)([^a-z]|$)/.test(lower)) {
      if (value === false || value === null || value === undefined) continue;
      return "child_inlined";
    }
  }
  return null;
}

export function classifyUpdateIdentity(input: {
  readonly session_id: string;
  readonly bound_session_id: string;
  readonly attempt: number;
  readonly meta?: unknown;
}): AcpUpdateIdentityRejection | null {
  if (input.session_id !== input.bound_session_id) return "session_mismatch";
  return classifyIdentityMeta(input.meta, input.bound_session_id, input.attempt);
}

/**
 * Handler filter: both the notification and the update metadata are checked
 * independently before any activity or ACK aggregation.
 */
export function classifySessionNotificationIdentity(input: {
  readonly session_id: string;
  readonly bound_session_id: string;
  readonly attempt: number;
  readonly notification_meta?: unknown;
  readonly update_meta?: unknown;
}): AcpUpdateIdentityRejection | null {
  if (input.session_id !== input.bound_session_id) return "session_mismatch";
  return (
    classifyIdentityMeta(input.notification_meta, input.bound_session_id, input.attempt) ??
    classifyIdentityMeta(input.update_meta, input.bound_session_id, input.attempt)
  );
}

interface ActiveTurn {
  readonly turn_id: string;
  readonly kind: AcpTurnKind;
  readonly started_at: string;
  readonly timeout_ms: number;
  readonly envelope: ControlEnvelope | null;
  readonly reply_limit: number;
  reply: string;
  reply_bytes: number;
  reply_overflow: boolean;
  cancel_sent: boolean;
  cancel_requested: boolean;
  timed_out: boolean;
  control_violation: boolean;
}

interface PendingPermission {
  readonly public: AcpPendingPermission;
  settled: boolean;
  resolve: (response: acp.RequestPermissionResponse) => void;
}

interface ExitInfo {
  readonly code: number | null;
  readonly signal: string | null;
  readonly expected: boolean;
  readonly at: string;
}

const CANCELLED_RESPONSE: acp.RequestPermissionResponse = Object.freeze({
  outcome: Object.freeze({ outcome: "cancelled" as const }),
});

function permissionHasScope(request: AcpPendingPermission): boolean {
  if (request.locations.some((location) => typeof location?.path === "string" && location.path.length > 0)) {
    return true;
  }
  const raw = request.tool_call.rawInput;
  if (raw === undefined || raw === null) return false;
  if (typeof raw === "string") return raw.trim().length > 0;
  if (Array.isArray(raw)) return raw.length > 0;
  if (typeof raw === "object") return Object.keys(raw as Record<string, unknown>).length > 0;
  return false;
}

export class AcpCoordinator {
  private readonly prepared: PreparedLaunch;
  private readonly binding: ControlBinding;
  private readonly callbacks: AcpCoordinatorCallbacks;
  private readonly maxPromptBytes: number;
  private readonly maxControlReplyBytes: number;
  private readonly initTimeoutMs: number;
  private readonly sessionTimeoutMs: number;
  private readonly promptTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly requestedModel: string | null;
  private readonly requestedEffort: string | null;
  private readonly maxMessageBytes: number;
  private readonly launchId: string;
  private readonly startedAt: string;
  private readonly exitPromise: Promise<ExitInfo>;
  private resolveExit!: (info: ExitInfo) => void;

  private child: ReturnType<typeof spawn> | null = null;
  private connection: acp.ClientConnection | null = null;
  private identity: ProcessStartIdentity | null = null;
  private identityVerified = false;
  private spawned = false;
  private exitObserved = false;
  private exitInfo: ExitInfo | null = null;
  private connectionClosed = false;
  private state: AcpCoordinatorState = "starting";
  private sessionId: string | null = null;
  private initializedAt: string | null = null;
  private connectionInfo: AcpConnectionInfo | null = null;
  private connectPromise: Promise<AcpConnectionInfo> | null = null;
  private connectAttempted = false;
  private capabilitySnapshot: AcpCapabilityInfo | null = null;
  private activeTurn: ActiveTurn | null = null;
  private lastTurn: AcpSettledTurn | null = null;
  private pending = new Map<string, PendingPermission>();
  private ack: { readonly request_id: string; readonly at: string } | null = null;
  private stdinClosed = false;
  private ownershipRetained = false;
  private quiescenceVerified = false;
  private cancelRequested = false;
  private unitName: string;
  private unitTimeoutMs: number;
  private invocationId: string | null = null;
  /** systemd ControlGroup property (relative to cgroup root). */
  private controlGroup: string | null = null;
  /** Rooted cgroup2 filesystem path exposed to callers/store. */
  private controlGroupPath: string | null = null;
  private wrapperPid: number | null = null;
  private agentPid: number | null = null;
  private wrapperExit: { readonly code: number | null; readonly signal: string | null } | null = null;
  private unitProof: UnitStopProof | null = null;
  private currentModel: string | null = null;
  private currentEffort: string | null = null;
  private readonly configObservation = new AcpConfigObservation();
  private pendingConfigSettlement: AcpSessionConfigSettlement | null = null;
  private lastError: string | null = null;

  private constructor(prepared: PreparedLaunch, options: AcpLaunchOptions) {
    this.prepared = prepared;
    this.callbacks = options.callbacks ?? {};
    this.binding = Object.freeze({
      goal_id: options.binding.goal_id,
      plan_id: options.binding.plan_id,
      revision: options.binding.revision,
      attempt: options.binding.attempt,
    });
    // Building one ACK validates the binding with the same strict rules used
    // on the wire; the request id is a local sentinel and is never sent.
    createAckEnvelope(this.binding, "binding-check");
    this.maxMessageBytes = assertPositiveSafeInteger(
      options.max_message_bytes,
      DEFAULT_MAX_MESSAGE_BYTES,
      "max_message_bytes",
    );
    this.maxPromptBytes = assertPositiveSafeInteger(
      options.max_prompt_bytes,
      DEFAULT_MAX_PROMPT_BYTES,
      "max_prompt_bytes",
    );
    this.maxControlReplyBytes = assertPositiveSafeInteger(
      options.max_control_reply_bytes,
      16 * 1024,
      "max_control_reply_bytes",
    );
    this.initTimeoutMs = assertPositiveSafeInteger(
      options.init_timeout_ms,
      DEFAULT_INIT_TIMEOUT_MS,
      "init_timeout_ms",
    );
    this.sessionTimeoutMs = assertPositiveSafeInteger(
      options.session_timeout_ms,
      DEFAULT_SESSION_TIMEOUT_MS,
      "session_timeout_ms",
    );
    this.promptTimeoutMs = assertPositiveSafeInteger(
      options.prompt_timeout_ms,
      DEFAULT_PROMPT_TIMEOUT_MS,
      "prompt_timeout_ms",
    );
    this.stopTimeoutMs = assertPositiveSafeInteger(
      options.stop_timeout_ms,
      DEFAULT_STOP_TIMEOUT_MS,
      "stop_timeout_ms",
    );
    this.requestedModel = requestedSessionSelection(options.model, "model");
    this.requestedEffort = requestedSessionSelection(options.effort, "effort");
    this.unitName = newUnitName();
    this.unitTimeoutMs = assertPositiveSafeInteger(
      options.unit_timeout_ms,
      DEFAULT_UNIT_TIMEOUT_MS,
      "unit_timeout_ms",
    );
    this.launchId = randomUUID();
    this.startedAt = nowIso();
    this.exitPromise = new Promise<ExitInfo>((resolve) => {
      this.resolveExit = resolve;
    });
  }

  /**
   * Probe the pinned CLI, spawn the parent-owned ACP process, negotiate v1,
   * and create exactly one new session. No session load, resume, or retry.
   */
  static async launch(
    profile_id: LaunchProfileId,
    options: AcpLaunchOptions,
  ): Promise<AcpCoordinator> {
    if (options.version_timeout_ms !== undefined) {
      assertPositiveSafeInteger(options.version_timeout_ms, 10_000, "version_timeout_ms");
    }
    const prepared = await prepareLaunch(profile_id, {
      cwd: options.cwd,
      version_timeout_ms: options.version_timeout_ms,
    });
    const coordinator = new AcpCoordinator(prepared, options);
    try {
      await coordinator.connect();
      return coordinator;
    } catch (error) {
      let stop: AcpGracefulStopResult | null = null;
      try {
        stop = await coordinator.gracefulStop({
          timeout_ms: options.stop_timeout_ms ?? DEFAULT_STOP_TIMEOUT_MS,
        });
      } catch (stopError) {
        coordinator.lastError = sanitizeSummary(
          `startup cleanup failed: ${redactError(stopError).detail}`,
          300,
        );
      }
      throw new AcpLaunchError(error, coordinator, stop);
    }
  }

  /** Idempotent connection for the already-launched instance. */
  async connect(): Promise<AcpConnectionInfo> {
    if (this.connectionInfo !== null) return this.connectionInfo;
    if (this.connectPromise !== null) return this.connectPromise;
    if (this.connectAttempted) {
      throw new AcpStartupError(
        "initialize_failed",
        "connect was already attempted; automatic session replacement is forbidden",
      );
    }
    this.connectAttempted = true;
    this.connectPromise = this.connectInternal();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connectInternal(): Promise<AcpConnectionInfo> {
    this.state = "starting";
    try {
      await assertUserSystemdAvailable();
    } catch (error) {
      throw this.failStartup("systemd_unavailable", redactError(error).detail);
    }

    const serviceEnv = { ...process.env, WORK_PLANS_H2H_ROLE: "coordinator" };
    let wrapperArgv: string[];
    try {
      wrapperArgv = buildSystemdRunArgs({
        unit_name: this.unitName,
        cwd: this.prepared.cwd,
        executable: this.prepared.executable,
        argv: [...this.prepared.argv],
        environment_names: environmentNamesForUnit(serviceEnv),
        stop_timeout_seconds: Math.max(1, Math.ceil(this.stopTimeoutMs / 1000)),
      });
    } catch (error) {
      throw this.failStartup("unit_identity_invalid", redactError(error).detail);
    }

    const child = spawn(wrapperArgv[0]!, wrapperArgv.slice(1), {
      cwd: this.prepared.cwd,
      shell: false,
      detached: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: serviceEnv,
    });
    this.child = child;
    this.attachChild(child);

    let pid: number;
    try {
      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
          child.off("error", onError);
          resolve();
        };
        const onError = (error: Error) => {
          child.off("spawn", onSpawn);
          reject(error);
        };
        child.once("spawn", onSpawn);
        child.once("error", onError);
      });
      this.spawned = true;
      this.ownershipRetained = true;
      this.wrapperPid = child.pid ?? null;
      if (this.wrapperPid === null) {
        throw this.failStartup("spawn_failed", "systemd-run wrapper has no PID");
      }

      let started: StartedUnitIdentity;
      try {
        started = await waitForUserUnit(this.unitName, this.unitTimeoutMs);
      } catch (error) {
        const summary = redactError(error);
        throw this.failStartup(
          error instanceof SystemdLifecycleError && error.code === "unit_query_failed"
            ? "unit_query_failed"
            : "unit_start_timeout",
          `${summary.code}: ${summary.detail}`,
        );
      }
      this.invocationId = started.invocation_id;
      this.controlGroup = started.control_group;
      this.controlGroupPath = started.cgroup.path;
      this.agentPid = started.main_pid;
      pid = started.main_pid;

      const identity = await readProcessStartIdentity(pid);
      if (identity.source !== "proc" || identity.start_time_ticks === null) {
        throw this.failStartup(
          "agent_main_pid_invalid",
          "cannot read /proc start identity for the real unit MainPID",
        );
      }
      if (identity.start_time_ticks !== started.main_pid_start_id) {
        throw this.failStartup(
          "agent_main_pid_invalid",
          "real unit MainPID start identity changed during launch",
        );
      }
      this.identity = identity;
      this.identityVerified = await verifyProcessStartIdentity(identity);
      if (!this.identityVerified) {
        throw this.failStartup(
          "agent_main_pid_invalid",
          "real unit MainPID start identity did not verify",
        );
      }
      await this.emitSpawnEvent();
    } catch (error) {
      if (error instanceof AcpStartupError) throw error;
      if (authRequired(error)) {
        throw new AcpStartupError("auth_required", "agent requires authentication; no login attempted");
      }
      throw this.failStartup(
        this.spawned ? "agent_main_pid_invalid" : "spawn_failed",
        redactError(error).detail,
      );
    }

    try {
      child.stdin.on("error", () => {
        // EPIPE after an owned process exit is expected; never crash on it.
      });
      child.stderr.on("data", () => {
        // Drain only. stderr is not persisted and is never parsed.
      });

      const app = acp
        .client({ name: "goal-runtime" })
        .onNotification(acp.methods.client.session.update, ({ params }) => {
          this.handleSessionUpdate(params);
        })
        .onRequest(acp.methods.client.session.requestPermission, (context) =>
          this.handlePermissionRequest(context.params, context.requestId, context.signal),
        )
        .onRequest("*", ({ method }) => {
          throw acp.RequestError.methodNotFound(method);
        });

      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
        { maxMessageBytes: this.maxMessageBytes },
      );
      const connection = app.connect(stream);
      this.connection = connection;
      void connection.closed.then(() => this.handleConnectionClosed());

      const initialized = await this.requestStartup(
        connection.agent,
        acp.methods.agent.initialize,
        {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "goal-runtime", version: "1" },
        },
        this.initTimeoutMs,
        "initialize",
      );
      if (initialized.protocolVersion !== 1) {
        throw new AcpStartupError(
          "protocol_version_unsupported",
          `agent negotiated protocol ${String(initialized.protocolVersion)}; v1 required`,
        );
      }
      const agentInfo = initialized.agentInfo;
      if (
        agentInfo === null ||
        agentInfo === undefined ||
        typeof agentInfo.name !== "string" ||
        typeof agentInfo.version !== "string"
      ) {
        throw new AcpStartupError("agent_identity_missing", "agentInfo name/version missing");
      }
      if (!this.prepared.profile.expected_agent_names.includes(agentInfo.name)) {
        throw new AcpStartupError(
          "agent_identity_mismatch",
          `expected ${this.prepared.profile.expected_agent_names.join(", ")}, got ${JSON.stringify(agentInfo.name)}`,
        );
      }
      if (agentInfo.version !== this.prepared.probe.observed_version) {
        throw new AcpStartupError(
          "agent_version_mismatch",
          `CLI ${this.prepared.probe.observed_version} reported agent version ${JSON.stringify(agentInfo.version)}`,
        );
      }

      const session = await this.requestStartup(
        connection.agent,
        acp.methods.agent.session.new,
        { cwd: this.prepared.cwd, mcpServers: [...this.prepared.profile.session_mcp_servers] },
        this.sessionTimeoutMs,
        "session/new",
      );
      if (
        typeof session.sessionId !== "string" ||
        session.sessionId.length === 0 ||
        session.sessionId.length > 512
      ) {
        throw new AcpStartupError("session_id_invalid", "session/new returned an invalid session id");
      }
      this.sessionId = session.sessionId;
      this.configObservation.seed(session.configOptions ?? null);
      if (this.requestedModel !== null) {
        await this.applySessionConfigSelection(
          connection.agent,
          session.sessionId,
          "model",
          this.requestedModel,
        );
      }
      if (this.requestedEffort !== null) {
        await this.applySessionConfigSelection(
          connection.agent,
          session.sessionId,
          "effort",
          this.requestedEffort,
        );
      }
      const selectionRequests: { readonly kind: AcpSessionConfigKind; readonly value: string }[] = [];
      if (this.requestedModel !== null) {
        selectionRequests.push({ kind: "model", value: this.requestedModel });
      }
      if (this.requestedEffort !== null) {
        selectionRequests.push({ kind: "effort", value: this.requestedEffort });
      }
      const observedSelections = this.configObservation.requireSelections(selectionRequests);
      this.currentModel = observedSelections.model;
      this.currentEffort = observedSelections.effort;
      this.initializedAt = nowIso();
      this.state = "ready";
      this.capabilitySnapshot = Object.freeze({
        profile_id: this.prepared.profile.id,
        sdk_version: ACP_SDK_VERSION,
        protocol_version: 1,
        cli_version: this.prepared.probe.observed_version,
        launch: this.launchInfo(),
        agent: Object.freeze({
          name: agentInfo.name,
          version: agentInfo.version,
          title: sanitizeSummary(agentInfo.title, 100),
        }),
        session_id: session.sessionId,
        model: this.currentModel,
        effort: this.currentEffort,
        modes:
          session.modes === null || session.modes === undefined
            ? null
            : Object.freeze({
                current_mode_id: session.modes.currentModeId,
                available_mode_ids: Object.freeze(
                  session.modes.availableModes.slice(0, 64).map((mode) => mode.id),
                ),
              }),
        acked: false,
        capabilities: Object.freeze({
          load_session_advertised: Boolean(initialized.agentCapabilities?.loadSession),
          prompt: Object.freeze({
            image: Boolean(initialized.agentCapabilities?.promptCapabilities?.image),
            audio: Boolean(initialized.agentCapabilities?.promptCapabilities?.audio),
            embedded_context: Boolean(
              initialized.agentCapabilities?.promptCapabilities?.embeddedContext,
            ),
          }),
          mcp: Object.freeze({
            http: Boolean(initialized.agentCapabilities?.mcpCapabilities?.http),
            sse: Boolean(initialized.agentCapabilities?.mcpCapabilities?.sse),
          }),
          session: Object.freeze({
            list: Boolean(initialized.agentCapabilities?.sessionCapabilities?.list),
            delete: Boolean(initialized.agentCapabilities?.sessionCapabilities?.delete),
            resume: Boolean(initialized.agentCapabilities?.sessionCapabilities?.resume),
            close: Boolean(initialized.agentCapabilities?.sessionCapabilities?.close),
            additional_directories: Boolean(
              initialized.agentCapabilities?.sessionCapabilities?.additionalDirectories,
            ),
          }),
          auth_methods: Object.freeze(
            (initialized.authMethods ?? [])
              .map((method) =>
                Object.freeze({
                  id: sanitizeSummary(method.id, 100) ?? "",
                  name: sanitizeSummary(method.name, 120) ?? "",
                  type: "type" in method && method.type === "terminal" ? "terminal" : "agent",
                }),
              )
              .filter((method) => method.id.length > 0),
          ),
        }),
        limitations: Object.freeze({
          auth: "explicit_failure_only",
          interactive_login: false,
          session_load_resume_used: false,
          durable_reattach: false,
          permission_gate: "acp_request_permission_only",
          enforces_all_native_tools: false,
          lifecycle: "systemd_user_transient_service",
          cgroup_cleanup: true,
          filesystem_sandbox: false,
          network_sandbox: false,
          unit_migration_authorized: false,
          external_service_execution_authorized: false,
          cancel_stops_children: false,
        }),
      });

      this.connectionInfo = Object.freeze({
        launch_id: this.launchId,
        profile_id: this.prepared.profile.id,
        pid,
        wrapper_pid: this.wrapperPid,
        unit_name: this.unitName,
        invocation_id: this.invocationId!,
        control_group: this.controlGroupPath!,
        session_id: session.sessionId,
        initialized_at: this.initializedAt,
        cli_version: this.prepared.probe.observed_version,
        model: this.currentModel,
        effort: this.currentEffort,
        agent: Object.freeze({
          name: agentInfo.name,
          version: agentInfo.version,
          title: sanitizeSummary(agentInfo.title, 100),
        }),
      });
      return this.connectionInfo;
    } catch (error) {
      if (error instanceof AcpStartupError) {
        this.state = "failed";
        if (this.lastError === null) {
          this.lastError = sanitizeSummary(`${error.code}: ${error.detail}`, 400);
        }
        throw error;
      }
      if (authRequired(error)) {
        throw this.failStartup("auth_required", "agent requires authentication; no login attempted");
      }
      throw this.failStartup("initialize_failed", redactError(error).detail);
    }
  }

  private async emitSpawnEvent(): Promise<void> {
    const callback = this.callbacks.onSpawn;
    if (callback === undefined) return;
    if (this.identity === null || this.identity.start_time_ticks === null) {
      throw this.failStartup(
        "process_identity_unavailable",
        "cannot emit spawn identity before it exists",
      );
    }
    const cliVersion = this.prepared.probe.observed_version;
    if (cliVersion === null) {
      throw this.failStartup("version_unparseable", "pinned probe has no observed version");
    }
    if (
      this.invocationId === null ||
      this.controlGroup === null ||
      this.controlGroupPath === null ||
      this.wrapperPid === null
    ) {
      throw this.failStartup(
        "unit_identity_invalid",
        "owned unit identity is incomplete before onSpawn",
      );
    }
    const event: AcpSpawnEvent = Object.freeze({
      type: "spawn",
      launch_id: this.launchId,
      profile_id: this.prepared.profile.id,
      binding: this.binding,
      pid: this.identity.pid,
      start_time_ticks: this.identity.start_time_ticks,
      exe_path: this.identity.exe_path,
      wrapper_pid: this.wrapperPid,
      unit_name: this.unitName,
      invocation_id: this.invocationId,
      control_group: this.controlGroupPath!,
      resolved_executable: this.prepared.executable,
      argv: Object.freeze([...this.prepared.argv]),
      cwd: this.prepared.cwd,
      prepared_at: this.prepared.prepared_at,
      started_at: this.startedAt,
      cli_version: cliVersion,
    });
    try {
      await callback(event);
    } catch (error) {
      throw this.failStartup(
        "spawn_record_failed",
        `onSpawn persistence failed: ${redactError(error).detail}`,
      );
    }
  }

  private failStartup(code: AcpStartupErrorCode, detail: string): AcpStartupError {
    if (this.state !== "stopping" && this.state !== "stopped" && this.state !== "failed") {
      this.state = "failed";
    }
    this.lastError = sanitizeSummary(`${code}: ${detail}`, 400);
    return new AcpStartupError(code, detail);
  }

  private async requestStartup<Method extends acp.AgentRequestMethod>(
    context: acp.ClientContext,
    method: Method,
    params: acp.AgentRequestParamsByMethod[Method],
    timeoutMs: number,
    label: string,
  ): Promise<acp.AgentRequestResponsesByMethod[Method]> {
    const controller = new AbortController();
    const raced = await raceWithTimeout(
      context.request(method, params, { cancellationSignal: controller.signal }),
      timeoutMs,
      () => controller.abort(new Error(`${label} timed out`)),
    );
    if (raced.kind === "timeout") {
      throw new AcpStartupError(
        label === "initialize" ? "initialize_timeout" : "session_new_timeout",
        `${label} exceeded ${timeoutMs} ms`,
      );
    }
    if (raced.kind === "error") {
      if (authRequired(raced.error)) {
        throw new AcpStartupError("auth_required", "agent requires authentication; no login attempted");
      }
      throw this.failStartup(
        label === "initialize" ? "initialize_failed" : "session_new_failed",
        redactError(raced.error).detail,
      );
    }
    return raced.value;
  }

  /**
   * Apply one explicit selection to this newly created session only, then
   * require the agent's returned full config set to read back the requested
   * value. Any failure is a startup failure: launch cleanup stops the owned
   * unit and no ACK or work is attempted.
   */
  private async applySessionConfigSelection(
    context: acp.ClientContext,
    sessionId: string,
    kind: AcpSessionConfigKind,
    requested: string,
  ): Promise<void> {
    const selection = resolveSessionConfigSelection(this.configObservation.options, kind, requested);
    // Arm the settlement before sending: only config_option_updates observed
    // after this point can confirm the request.
    const settlement = new AcpSessionConfigSettlement(selection.config_id, selection.value);
    this.pendingConfigSettlement = settlement;
    try {
      const controller = new AbortController();
      const raced = await raceWithTimeout(
        context.request(
          acp.methods.agent.session.setConfigOption,
          { sessionId, configId: selection.config_id, value: selection.value },
          { cancellationSignal: controller.signal },
        ),
        this.sessionTimeoutMs,
        () => controller.abort(new Error(`session/set_config_option (${kind}) timed out`)),
      );
      if (raced.kind === "timeout") {
        throw new AcpStartupError(
          "session_config_apply_failed",
          `session/set_config_option ${kind} exceeded ${this.sessionTimeoutMs} ms`,
        );
      }
      if (raced.kind === "error") {
        if (authRequired(raced.error)) {
          throw new AcpStartupError("auth_required", "agent requires authentication; no login attempted");
        }
        throw new AcpStartupError(
          "session_config_apply_failed",
          `session/set_config_option ${selection.config_id}: ${redactError(raced.error).detail}`,
        );
      }
      const resolution = await settlement.resolve(
        raced.value.configOptions,
        DEFAULT_CONFIG_SETTLE_TIMEOUT_MS,
        this.configObservation.generation,
      );
      this.configObservation.adopt(resolution, selection);
    } finally {
      settlement.cancel();
      if (this.pendingConfigSettlement === settlement) this.pendingConfigSettlement = null;
    }
  }

  private attachChild(child: ReturnType<typeof spawn>): void {
    child.once("exit", (code, signal) => {
      this.handleProcessExit(code, signal, null);
    });
    child.once("error", (error) => {
      if (!this.spawned) {
        this.lastError = sanitizeSummary(`spawn failed: ${redactError(error).detail}`, 300);
        this.handleProcessExit(null, null, error);
      }
    });
    child.once("close", (code, signal) => {
      if (!this.exitObserved) this.handleProcessExit(code, signal, null);
    });
  }

  private handleProcessExit(
    code: number | null,
    signal: NodeJS.Signals | null,
    spawnError: unknown,
  ): void {
    if (this.exitObserved) return;
    this.exitObserved = true;
    const wasExpected = this.state === "stopping" || this.state === "reconciling";
    this.exitInfo = Object.freeze({
      code,
      signal: signal ?? null,
      expected: wasExpected,
      at: nowIso(),
    });
    this.wrapperExit = Object.freeze({ code, signal: signal ?? null });
    this.wrapperPid = this.child?.pid ?? this.wrapperPid;
    if (wasExpected) {
      this.state = "reconciling";
    } else {
      this.state = "failed";
      if (this.lastError === null) {
        this.lastError = sanitizeSummary(
          spawnError === null
            ? `owned process exited unexpectedly (code=${String(code)}, signal=${String(signal)})`
            : `owned process failed: ${redactError(spawnError).detail}`,
          300,
        );
      }
    }
    this.ownershipRetained = this.spawned;
    this.quiescenceVerified = false;
    this.denyAllPendingPermissions();
    try {
      this.connection?.close(new Error("owned ACP process exited"));
    } catch {
      // The connection is already unusable; nothing else to release.
    }
    this.resolveExit(this.exitInfo);
    const exitEvent: AcpExitEvent = Object.freeze({
      type: "exit",
      profile_id: this.prepared.profile.id,
      launch_id: this.launchId,
      pid: this.agentPid ?? null,
      wrapper_pid: this.wrapperPid,
      unit_name: this.unitName,
      invocation_id: this.invocationId,
      control_group: this.controlGroupPath,
      session_id: this.sessionId,
      at: this.exitInfo.at,
      exit_code: null,
      exit_signal: null,
      wrapper_exit_code: code,
      wrapper_exit_signal: signal ?? null,
      expected: wasExpected,
      identity: this.identity,
      identity_verified: this.identityVerified,
      children_cleanup: "systemd_control_group",
    });
    this.emitCallback("onExit", exitEvent);
  }

  private handleConnectionClosed(): void {
    this.connectionClosed = true;
    if (
      this.state === "starting" ||
      this.state === "ready" ||
      this.state === "busy" ||
      this.state === "cancelling"
    ) {
      this.state = "failed";
      this.lastError = sanitizeSummary(
        "ACP connection closed before the owned process exited",
        300,
      );
    }
  }

  private emitCallback<Name extends keyof AcpCoordinatorCallbacks>(
    name: Name,
    event: Parameters<NonNullable<AcpCoordinatorCallbacks[Name]>>[0],
  ): void {
    const callback = this.callbacks[name] as
      | ((value: typeof event) => void | Promise<void>)
      | undefined;
    if (callback === undefined) return;
    try {
      const result = callback(event);
      if (result !== undefined && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>).catch(() => {});
      }
    } catch {
      // Callback failure never changes coordinator state.
    }
  }

  private launchInfo(): AcpLaunchInfo {
    if (
      this.identity === null ||
      this.identity.start_time_ticks === null ||
      this.invocationId === null ||
      this.controlGroup === null ||
      this.controlGroupPath === null ||
      this.wrapperPid === null
    ) {
      throw new Error("launch identity is not available");
    }
    return Object.freeze({
      launch_id: this.launchId,
      profile_id: this.prepared.profile.id,
      pid: this.identity.pid,
      start_time_ticks: this.identity.start_time_ticks,
      exe_path: this.identity.exe_path,
      identity_source: "proc",
      identity_verified: this.identityVerified,
      wrapper_pid: this.wrapperPid,
      unit_name: this.unitName,
      invocation_id: this.invocationId,
      control_group: this.controlGroupPath!,
      resolved_executable: this.prepared.executable,
      argv: Object.freeze([...this.prepared.argv]),
      cwd: this.prepared.cwd,
      prepared_at: this.prepared.prepared_at,
      started_at: this.startedAt,
    });
  }

  get status(): AcpCoordinatorStatus {
    return Object.freeze({
      state: this.state,
      profile_id: this.prepared.profile.id,
      launch_id: this.launchId,
      pid: this.agentPid ?? null,
      wrapper_pid: this.wrapperPid,
      unit_name: this.unitName,
      invocation_id: this.invocationId,
      control_group: this.controlGroupPath,
      session_id: this.sessionId,
      started_at: this.startedAt,
      acked: this.ack !== null,
      active_turn:
        this.activeTurn === null
          ? null
          : Object.freeze({
              turn_id: this.activeTurn.turn_id,
              kind: this.activeTurn.kind,
              started_at: this.activeTurn.started_at,
              timed_out: this.activeTurn.timed_out,
              cancel_sent: this.activeTurn.cancel_sent,
            }),
      last_turn: this.lastTurn,
      pending_permissions: this.pending.size,
      ownership_retained: this.ownershipRetained,
      quiescence_verified: this.quiescenceVerified,
      exit_code: this.unitProof?.identity.exec_main_status ?? null,
      exit_signal: null,
      last_error: this.lastError,
    });
  }

  get capabilityInfo(): AcpCapabilityInfo | null {
    if (this.capabilitySnapshot === null) return null;
    return Object.freeze({
      ...this.capabilitySnapshot,
      model: this.currentModel,
      effort: this.currentEffort,
      acked: this.ack !== null,
    });
  }

  /**
   * Send one ACK control envelope as a separate no-work prompt and require the
   * exact structured echo. The ACK does not authorize or perform peer work.
   *
   * Request ids are transport-scoped only: this method never deduplicates by
   * `request_id`. Durable idempotency is the store's responsibility.
   */
  async sendControl(
    envelope: ControlEnvelope,
    options: AcpRequestOptions = {},
  ): Promise<AcpControlResult> {
    const unavailable = this.unavailableTurn("control");
    if (unavailable !== null) return { ...unavailable, ack: null };

    try {
      serializeControlEnvelope(envelope);
    } catch (error) {
      const summary = redactError(error);
      return {
        ...this.rejectedTurn("control", "invalid_envelope", summary.detail),
        ack: null,
      };
    }
    if (
      envelope.goal_id !== this.binding.goal_id ||
      envelope.plan_id !== this.binding.plan_id ||
      envelope.revision !== this.binding.revision ||
      envelope.attempt !== this.binding.attempt
    ) {
      return {
        ...this.rejectedTurn(
          "control",
          "binding_mismatch",
          "control envelope does not match this coordinator's bound goal/plan/revision/attempt",
        ),
        ack: null,
      };
    }

    let prompt: string;
    try {
      prompt = buildControlPrompt(envelope);
    } catch (error) {
      const summary = redactError(error);
      return {
        ...this.rejectedTurn("control", "invalid_envelope", summary.detail),
        ack: null,
      };
    }
    const promptBytes = byteLength(prompt);
    if (promptBytes > this.maxPromptBytes) {
      return {
        ...this.rejectedTurn("control", "invalid_envelope", `control prompt exceeds ${this.maxPromptBytes} bytes`),
        ack: null,
      };
    }

    const turn = this.beginTurn("control", envelope, options.timeout_ms ?? this.promptTimeoutMs);
    if (turn.kind === "rejected") return { ...turn.result, ack: null };
    const active = turn.turn;
    const raced = await this.racePrompt(active, prompt);
    const base = this.finishTurnResult(active, raced);
    if (base.outcome !== "completed") {
      return { ...base, ack: null };
    }
    if (active.control_violation) {
      return {
        ...base,
        outcome: "protocol_error",
        error: Object.freeze({
          code: "no_work_violation",
          detail: "native tool activity occurred during the no-work ACK prompt",
          retryable: false,
        }),
        ack: null,
      };
    }

    if (active.reply_overflow) {
      return {
        ...base,
        outcome: "protocol_error",
        error: Object.freeze({
          code: "reply_too_large",
          detail: `control reply exceeded ${this.maxControlReplyBytes} bytes`,
          retryable: false,
        }),
        ack: null,
      };
    }

    const parsed = parseControlReply(active.reply, envelope, {
      maxReplyBytes: this.maxControlReplyBytes,
    });
    if (parsed.ok === false) {
      return {
        ...base,
        outcome: "protocol_error",
        error: Object.freeze({
          code: parsed.error.code,
          detail: sanitizeSummary(parsed.error.detail, 300) ?? parsed.error.code,
          retryable: false,
        }),
        ack: null,
      };
    }

    this.ack = Object.freeze({ request_id: envelope.request_id, at: nowIso() });
    return {
      ...base,
      outcome: "acknowledged",
      ack: parsed.value,
    };
  }

  /**
   * Send the approved work prompt. Work is refused until an ACK for this exact
   * binding has completed; one prompt may be in flight per bound session.
   */
  async sendPrompt(
    text: string,
    options: AcpRequestOptions = {},
  ): Promise<AcpWorkPromptResult> {
    const unavailable = this.unavailableTurn("work");
    if (unavailable !== null) return unavailable;
    if (this.ack === null) {
      return this.rejectedTurn("work", "ack_required", "no completed ACK for this binding");
    }
    if (typeof text !== "string") {
      return this.rejectedTurn("work", "invalid_prompt", "work prompt must be a string");
    }
    const promptBytes = byteLength(text);
    if (promptBytes === 0) {
      return this.rejectedTurn("work", "invalid_prompt", "work prompt is empty");
    }
    if (promptBytes > this.maxPromptBytes) {
      return this.rejectedTurn(
        "work",
        "invalid_prompt",
        `work prompt exceeds ${this.maxPromptBytes} bytes`,
      );
    }

    const turn = this.beginTurn("work", null, options.timeout_ms ?? this.promptTimeoutMs);
    if (turn.kind === "rejected") return turn.result;
    const active = turn.turn;
    const raced = await this.racePrompt(active, text);
    return this.finishTurnResult(active, raced);
  }

  private unavailableTurn(kind: AcpTurnKind): AcpWorkPromptResult | null {
    if (this.state !== "ready") {
      return this.rejectedTurn(kind, "not_ready", `coordinator state is ${this.state}`);
    }
    if (this.activeTurn !== null) {
      return this.rejectedTurn(kind, "busy", "another prompt is in flight for this session");
    }
    if (this.sessionId === null || this.connection === null || this.connection.signal.aborted) {
      return this.rejectedTurn(kind, "not_ready", "ACP session is not usable");
    }
    return null;
  }

  private rejectedTurn(_kind: AcpTurnKind, code: string, detail: string): AcpWorkPromptResult {
    const outcome: AcpTurnOutcome =
      code === "busy"
        ? "busy"
        : code === "ack_required"
          ? "ack_required"
          : code === "invalid_envelope"
            ? "invalid_envelope"
            : code === "binding_mismatch"
              ? "binding_mismatch"
              : code === "invalid_prompt" || code === "invalid_timeout"
                ? "invalid_prompt"
                : "not_ready";
    return Object.freeze({
      turn_id: "",
      outcome,
      stop_reason: null,
      reply_bytes: 0,
      cancel_sent: false,
      timed_out: false,
      error: Object.freeze({ code, detail: sanitizeSummary(detail, 300) ?? code, retryable: false }),
    });
  }

  private beginTurn(
    kind: AcpTurnKind,
    envelope: ControlEnvelope | null,
    timeoutMs: number,
  ): { kind: "started"; turn: ActiveTurn } | { kind: "rejected"; result: AcpWorkPromptResult } {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      return {
        kind: "rejected",
        result: this.rejectedTurn(kind, "invalid_timeout", "timeout_ms must be a positive safe integer"),
      };
    }
    const turn: ActiveTurn = {
      turn_id: randomUUID(),
      kind,
      started_at: nowIso(),
      timeout_ms: timeoutMs,
      envelope,
      reply_limit: kind === "control" ? this.maxControlReplyBytes : this.maxPromptBytes,
      reply: "",
      reply_bytes: 0,
      reply_overflow: false,
      cancel_sent: false,
      cancel_requested: false,
      timed_out: false,
      control_violation: false,
    };
    this.cancelRequested = false;
    this.activeTurn = turn;
    this.state = "busy";
    return { kind: "started", turn };
  }

  private async racePrompt(
    turn: ActiveTurn,
    prompt: string,
  ): Promise<Raced<acp.PromptResponse>> {
    const context = this.connection!.agent;
    let request: Promise<acp.PromptResponse>;
    try {
      request = context.request(acp.methods.agent.session.prompt, {
        sessionId: this.sessionId!,
        prompt: [{ type: "text", text: prompt }],
      });
    } catch (error) {
      return { kind: "error", error };
    }
    const raced = await raceWithTimeout(request, turn.timeout_ms);
    if (raced.kind === "timeout") {
      turn.timed_out = true;
      turn.cancel_requested = true;
      this.cancelRequested = true;
      const cancel = await this.sendCancelNotification();
      if (cancel.sent) turn.cancel_sent = true;
      if (this.state === "busy") this.state = "cancelling";
      this.denyAllPendingPermissions();
      // Keep the turn reserved. A late settlement is recorded in status but
      // never reported to the caller as a completion.
      void request.then(
        (response) => this.settleAfterTimeout(turn, { kind: "value", value: response }),
        (error) => this.settleAfterTimeout(turn, { kind: "error", error }),
      );
    }
    return raced;
  }

  private settleAfterTimeout(
    turn: ActiveTurn,
    raced: Exclude<Raced<acp.PromptResponse>, { readonly kind: "timeout" }>,
  ): void {
    if (this.activeTurn !== turn) return;
    this.activeTurn = null;
    this.denyAllPendingPermissions();
    // The caller saw uncertainty. Keep the coordinator reserved under
    // RECONCILING even if the late settlement looks normal; a new prompt may
    // not be sent until the owner explicitly stops or replaces this process.
    if (this.state === "busy" || this.state === "cancelling") {
      this.state = "reconciling";
      this.ownershipRetained = this.ownershipRetained || !this.exitObserved;
    }
    if (raced.kind === "error") {
      const summary = redactError(raced.error);
      this.lastError = sanitizeSummary(`${summary.code}: ${summary.detail}`, 400);
    }
    const outcome: AcpTurnOutcome =
      raced.kind === "value"
        ? outcomeFromStopReason(raced.value.stopReason)
        : authRequired(raced.error)
          ? "auth_required"
          : "error";
    this.lastTurn = Object.freeze({
      turn_id: turn.turn_id,
      kind: turn.kind,
      outcome,
      stop_reason: raced.kind === "value" ? raced.value.stopReason : null,
      timed_out: true,
      after_timeout: true,
      cancel_sent: turn.cancel_sent,
      settled_at: nowIso(),
    });
  }

  private finishTurnResult(
    turn: ActiveTurn,
    raced: Raced<acp.PromptResponse>,
  ): AcpWorkPromptResult {
    if (raced.kind === "timeout") {
      this.lastTurn = Object.freeze({
        turn_id: turn.turn_id,
        kind: turn.kind,
        outcome: "timeout_uncertain",
        stop_reason: null,
        timed_out: true,
        after_timeout: false,
        cancel_sent: turn.cancel_sent,
        settled_at: nowIso(),
      });
      return Object.freeze({
        turn_id: turn.turn_id,
        outcome: "timeout_uncertain",
        stop_reason: null,
        reply_bytes: turn.reply_bytes,
        cancel_sent: turn.cancel_sent,
        timed_out: true,
        error: Object.freeze({
          code: "prompt_timeout",
          detail: `prompt did not settle within its timeout; session/cancel sent=${String(turn.cancel_sent)}; outcome is uncertain`,
          retryable: false,
        }),
      });
    }

    if (this.activeTurn === turn) this.activeTurn = null;
    if (this.state === "busy" || this.state === "cancelling") this.state = "ready";
    this.denyAllPendingPermissions();

    if (raced.kind === "error") {
      const summary = redactError(raced.error);
      const outcome: AcpTurnOutcome = authRequired(raced.error) ? "auth_required" : "error";
      this.lastError = sanitizeSummary(`${summary.code}: ${summary.detail}`, 400);
      this.lastTurn = Object.freeze({
        turn_id: turn.turn_id,
        kind: turn.kind,
        outcome,
        stop_reason: null,
        timed_out: false,
        after_timeout: false,
        cancel_sent: turn.cancel_sent,
        settled_at: nowIso(),
      });
      return Object.freeze({
        turn_id: turn.turn_id,
        outcome,
        stop_reason: null,
        reply_bytes: turn.reply_bytes,
        cancel_sent: turn.cancel_sent,
        timed_out: false,
        error: Object.freeze({ ...summary, retryable: false }),
      });
    }

    const stopReason = raced.value.stopReason;
    const outcome = outcomeFromStopReason(stopReason);
    this.lastTurn = Object.freeze({
      turn_id: turn.turn_id,
      kind: turn.kind,
      outcome,
      stop_reason: stopReason,
      timed_out: false,
      after_timeout: false,
      cancel_sent: turn.cancel_sent,
      settled_at: nowIso(),
    });
    return Object.freeze({
      turn_id: turn.turn_id,
      outcome,
      stop_reason: stopReason,
      reply_bytes: turn.reply_bytes,
      cancel_sent: turn.cancel_sent,
      timed_out: false,
      error: null,
    });
  }

  private async sendCancelNotification(): Promise<{ sent: boolean; error: AcpTurnError | null }> {
    if (this.sessionId === null || this.connection === null || this.connection.signal.aborted) {
      return {
        sent: false,
        error: Object.freeze({
          code: "not_ready",
          detail: "ACP session is not usable",
          retryable: false,
        }),
      };
    }
    const raced = await raceWithTimeout(
      this.connection.agent.notify(acp.methods.agent.session.cancel, {
        sessionId: this.sessionId,
      }),
      CANCEL_NOTIFY_TIMEOUT_MS,
    );
    if (raced.kind === "value") return { sent: true, error: null };
    const summary =
      raced.kind === "timeout"
        ? Object.freeze({
            code: "cancel_timeout",
            detail: "session/cancel notification did not flush within its bound",
            retryable: false,
          })
        : Object.freeze({ ...redactError(raced.error), retryable: false });
    return { sent: false, error: summary as AcpTurnError };
  }

  /**
   * Ask the agent to cancel the current turn. This does NOT stop native
   * subagents, close stdin, or claim the turn stopped.
   */
  async cancelTurn(options: AcpCancelTurnOptions = {}): Promise<AcpCancelTurnResult> {
    this.cancelRequested = true;
    const denied = this.denyAllPendingPermissions();
    const turn = this.activeTurn;
    if (turn !== null) turn.cancel_requested = true;
    if (turn === null || this.sessionId === null) {
      return Object.freeze({
        sent: false,
        session_id: this.sessionId,
        turn_id: turn?.turn_id ?? null,
        state: this.state,
        denied_pending_permissions: denied,
        children_not_stopped: true,
        error: Object.freeze({
          code: "no_turn_in_flight",
          detail: sanitizeSummary(options.reason, 200) ?? "no turn is in flight",
          retryable: false,
        }),
      });
    }
    const cancel = await this.sendCancelNotification();
    if (cancel.sent) {
      turn.cancel_sent = true;
      if (this.state === "busy") this.state = "cancelling";
    }
    return Object.freeze({
      sent: cancel.sent,
      session_id: this.sessionId,
      turn_id: turn.turn_id,
      state: this.state,
      denied_pending_permissions: denied,
      children_not_stopped: true,
      error: cancel.error,
    });
  }

  /**
   * Graceful stop: close the systemd-run wrapper stdin, await wrapper exit, and
   * require exact owned-unit/cgroup proof. The transport never signals a PID or
   * unit; if proof is incomplete, ownership stays retained as RECONCILING.
   */
  async gracefulStop(options: AcpGracefulStopOptions = {}): Promise<AcpGracefulStopResult> {
    const deadlineMs = assertPositiveSafeInteger(
      options.timeout_ms,
      this.stopTimeoutMs,
      "timeout_ms",
    );
    if (this.child === null || !this.spawned) {
      return Object.freeze({
        outcome: "not_started",
        launch_id: this.launchId,
        pid: this.agentPid,
        wrapper_pid: this.wrapperPid,
        unit_name: this.unitName,
        invocation_id: this.invocationId,
        control_group: this.controlGroup,
        deadline_ms: deadlineMs,
        already_stopped: false,
        exit_code: null,
        exit_signal: null,
        wrapper_exit_code: null,
        wrapper_exit_signal: null,
        identity: this.identity,
        identity_verified_before_exit: false,
        ownership_retained: false,
        quiescence_verified: true,
        unit_load_state: null,
        unit_active_state: null,
        unit_sub_state: null,
        cgroup_present: false,
        cgroup_populated: false,
        agent_exit_status: null,
        unit_result: null,
        stdin_closed: this.stdinClosed,
        children_not_signaled_by_transport: true,
        children_cleanup: "systemd_control_group",
        detail: "owned process was never started",
      });
    }

    const alreadyStopped = this.wrapperExit !== null || this.exitObserved;
    const turn = this.activeTurn;
    this.cancelRequested = true;
    this.denyAllPendingPermissions();
    let identityVerified = this.identityVerified;
    let raced: { readonly kind: "exit" } | { readonly kind: "timeout" } = { kind: "exit" };

    if (!alreadyStopped) {
      if (this.state !== "stopping" && this.state !== "reconciling") {
        this.state = "stopping";
      }
      if (turn !== null) {
        turn.cancel_requested = true;
        if (!turn.cancel_sent) {
          const cancel = await this.sendCancelNotification();
          if (cancel.sent) turn.cancel_sent = true;
        }
      }
      if (this.identity !== null) {
        identityVerified = await verifyProcessStartIdentity(this.identity);
        if (identityVerified) this.identityVerified = true;
      }
      this.closeStdin();
      raced = await this.raceExit(deadlineMs);
    }

    await this.ensureUnitIdentity();
    const wrapperExited = alreadyStopped || raced.kind === "exit" || this.wrapperExit !== null;
    let proof: UnitStopProof | null = null;
    if (this.invocationId !== null && this.controlGroup !== null) {
      try {
        proof = await proveOwnedUnitStopped({
          unit_name: this.unitName,
          invocation_id: this.invocationId,
          control_group: this.controlGroup,
          main_pid: this.agentPid ?? this.identity?.pid ?? 0,
          main_pid_start_id: this.identity?.start_time_ticks ?? "",
        });
      } catch (error) {
        const summary = redactError(error);
        this.lastError = sanitizeSummary(`unit stop proof failed: ${summary.detail}`, 300);
      }
    }
    this.unitProof = proof;

    if (wrapperExited && proof?.quiescent === true) {
      this.state = this.exitInfo?.expected ? "stopped" : "failed";
      this.ownershipRetained = false;
      this.quiescenceVerified = true;
      return this.stopResult(
        "stopped",
        deadlineMs,
        alreadyStopped,
        identityVerified || this.identityVerified,
        null,
        proof,
        true,
      );
    }

    this.state = "reconciling";
    this.ownershipRetained = true;
    this.quiescenceVerified = false;
    const detail = !wrapperExited
      ? `systemd-run wrapper did not exit within ${deadlineMs} ms after stdin EOF`
      : (proof?.detail ?? "owned unit/cgroup proof unavailable");
    return this.stopResult(
      "unknown",
      deadlineMs,
      alreadyStopped,
      identityVerified || this.identityVerified,
      detail,
      proof,
      wrapperExited,
    );
  }

  /** Fill unit identity after a failed startup, only from the exact unique unit. */
  private async ensureUnitIdentity(): Promise<void> {
    if (this.invocationId !== null && this.controlGroup !== null && this.identity !== null) return;
    try {
      const identity = await queryUserUnit(this.unitName);
      if (identity.invocation_id !== null) this.invocationId ??= identity.invocation_id;
      if (identity.control_group !== null) {
        this.controlGroup ??= identity.control_group;
        this.controlGroupPath ??= rootedCgroupPath(identity.control_group);
      }
      if (identity.main_pid !== null && identity.main_pid > 0) {
        this.agentPid ??= identity.main_pid;
        if (this.identity === null) {
          const start = await readProcessStartIdentity(identity.main_pid);
          if (start.source === "proc" && start.start_time_ticks !== null) {
            this.identity = start;
          }
        }
      }
    } catch {
      // No guessed unit and no fallback: missing proof stays retained.
    }
  }

  private closeStdin(): void {
    const child = this.child;
    if (this.stdinClosed || child === null) return;
    const stdin = child.stdin;
    if (stdin === null) return;
    this.stdinClosed = true;
    try {
      if (!stdin.destroyed) stdin.end();
    } catch (error) {
      this.lastError = sanitizeSummary(`stdin close failed: ${redactError(error).detail}`, 300);
    }
  }

  private async raceExit(
    deadlineMs: number,
  ): Promise<{ readonly kind: "exit" } | { readonly kind: "timeout" }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ readonly kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), deadlineMs);
    });
    try {
      return await Promise.race([
        this.exitPromise.then(() => ({ kind: "exit" as const })),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private stopResult(
    outcome: "stopped" | "unknown",
    deadlineMs: number,
    alreadyStopped: boolean,
    identityVerified: boolean,
    detail: string | null,
    proof: UnitStopProof | null,
    wrapperExited: boolean,
  ): AcpGracefulStopResult {
    return Object.freeze({
      outcome,
      launch_id: this.launchId,
      pid: this.agentPid ?? this.identity?.pid ?? null,
      wrapper_pid: this.wrapperPid,
      unit_name: this.unitName,
      invocation_id: this.invocationId,
      control_group: this.controlGroupPath,
      deadline_ms: deadlineMs,
      already_stopped: alreadyStopped,
      exit_code: proof?.identity.exec_main_status ?? null,
      exit_signal: null,
      wrapper_exit_code: this.wrapperExit?.code ?? null,
      wrapper_exit_signal: this.wrapperExit?.signal ?? null,
      identity: this.identity,
      identity_verified_before_exit: identityVerified,
      ownership_retained: this.ownershipRetained,
      quiescence_verified: wrapperExited && proof?.quiescent === true,
      unit_load_state: proof?.identity.load_state ?? null,
      unit_active_state: proof?.identity.active_state ?? null,
      unit_sub_state: proof?.identity.sub_state ?? null,
      cgroup_present: proof?.cgroup.present ?? false,
      cgroup_populated: proof?.cgroup.populated ?? null,
      agent_exit_status: proof?.identity.exec_main_status ?? null,
      unit_result: proof?.identity.result ?? null,
      stdin_closed: this.stdinClosed,
      children_not_signaled_by_transport: true,
      children_cleanup: "systemd_control_group",
      detail: sanitizeSummary(detail, 400),
    });
  }

  private handleSessionUpdate(params: acp.SessionNotification): void {
    const sessionId = this.sessionId;
    if (sessionId === null) return;
    const update = params.update;
    const rejection = classifySessionNotificationIdentity({
      session_id: params.sessionId,
      bound_session_id: sessionId,
      attempt: this.binding.attempt,
      notification_meta: params._meta,
      update_meta: update._meta,
    });
    if (rejection !== null) return;

    let message: AcpMessageActivity | null = null;
    let tool: AcpToolActivity | null = null;
    let plan: AcpPlanActivity | null = null;
    let modeId: string | null = null;

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk":
      case "user_message_chunk": {
        const text = update.content.type === "text" ? update.content.text : "";
        const bytes = text.length === 0 ? 0 : byteLength(text);
        message = Object.freeze({
          message_id: typeof update.messageId === "string" ? update.messageId : null,
          bytes,
        });
        if (update.sessionUpdate === "agent_message_chunk" && this.activeTurn !== null) {
          this.activeTurn.reply_bytes += bytes;
          if (this.activeTurn.kind === "control" && !this.activeTurn.reply_overflow) {
            if (this.activeTurn.reply_bytes > this.activeTurn.reply_limit) {
              this.activeTurn.reply_overflow = true;
            } else {
              this.activeTurn.reply += text;
            }
          }
        }
        break;
      }
      case "tool_call":
      case "tool_call_update": {
        if (this.activeTurn?.kind === "control") this.activeTurn.control_violation = true;
        tool = Object.freeze({
          tool_call_id: update.toolCallId,
          title: sanitizeSummary(update.title, 160),
          name: sanitizeSummary(update.name, 100),
          kind: update.kind ?? null,
          status: update.status ?? null,
        });
        break;
      }
      case "plan": {
        plan = Object.freeze({
          entry_count: update.entries.length,
          entries: Object.freeze(
            update.entries.slice(0, MAX_PLAN_ENTRIES).map((entry) =>
              Object.freeze({ priority: entry.priority, status: entry.status }),
            ),
          ),
        });
        break;
      }
      case "config_option_update": {
        const previousOptions = this.configObservation.options;
        const generation = this.configObservation.record(update.configOptions);
        this.pendingConfigSettlement?.observe(previousOptions, update.configOptions, generation);
        this.currentModel = observedSessionSelection(update.configOptions, "model");
        this.currentEffort = observedSessionSelection(update.configOptions, "effort");
        break;
      }
      case "current_mode_update": {
        modeId = sanitizeSummary(update.currentModeId, 100);
        break;
      }
      default:
        break;
    }

    this.emitCallback(
      "onActivity",
      Object.freeze({
        type: "session_update",
        session_id: params.sessionId,
        update_type: update.sessionUpdate,
        at: nowIso(),
        tool,
        plan,
        mode_id: modeId,
        message,
      }),
    );
  }

  private handlePermissionRequest(
    params: acp.RequestPermissionRequest,
    requestId: acp.JsonRpcId,
    signal: AbortSignal,
  ): Promise<acp.RequestPermissionResponse> {
    if (params.sessionId !== this.sessionId || this.sessionId === null) {
      return Promise.resolve(CANCELLED_RESPONSE);
    }
    if (this.activeTurn?.kind === "control") {
      // A permission request during the no-work ACK proves the agent tried to
      // act. Deny it and fail the ACK rather than letting a callback grant it.
      this.activeTurn.control_violation = true;
      return Promise.resolve(CANCELLED_RESPONSE);
    }
    if (
      this.cancelRequested ||
      this.activeTurn?.cancel_requested === true ||
      this.state === "cancelling" ||
      this.state === "stopping" ||
      this.state === "reconciling" ||
      this.state === "stopped" ||
      this.state === "failed" ||
      this.connectionClosed
    ) {
      return Promise.resolve(CANCELLED_RESPONSE);
    }
    const options = params.options
      .filter((option) => typeof option.optionId === "string" && option.optionId.length > 0)
      .map((option) =>
        Object.freeze({
          optionId: option.optionId,
          name: sanitizeSummary(option.name, 120) ?? "(unnamed)",
          kind: option.kind,
        }),
      );
    if (options.length === 0) return Promise.resolve(CANCELLED_RESPONSE);

    const permissionId = `perm_${randomUUID()}`;
    const publicRequest = {
      permission_id: permissionId,
      acp_request_id: requestId,
      session_id: params.sessionId,
      binding: this.binding,
      tool_call_id: params.toolCall.toolCallId,
      tool_title: sanitizeSummary(params.toolCall.title, 160),
      tool_name: sanitizeSummary(params.toolCall.name, 100),
      tool_kind: params.toolCall.kind ?? null,
      options: Object.freeze(options),
      requested_at: nowIso(),
    } as AcpPendingPermission;
    // Scope payload is deliberately non-enumerable so accidental JSON
    // serialization/logging cannot persist raw native arguments.
    Object.defineProperties(publicRequest, {
      locations: {
        value: Object.freeze([...(params.toolCall.locations ?? [])]),
        enumerable: false,
        writable: false,
        configurable: false,
      },
      tool_call: {
        value: Object.freeze(params.toolCall),
        enumerable: false,
        writable: false,
        configurable: false,
      },
    });
    Object.freeze(publicRequest);

    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      const entry: PendingPermission = { public: publicRequest, settled: false, resolve };
      this.pending.set(permissionId, entry);
      if (signal.aborted) {
        this.resolvePermission(entry, CANCELLED_RESPONSE);
        return;
      }
      signal.addEventListener("abort", () => this.resolvePermission(entry, CANCELLED_RESPONSE), {
        once: true,
      });
      const callback = this.callbacks.onPermission;
      if (callback === undefined) {
        this.resolvePermission(entry, CANCELLED_RESPONSE);
        return;
      }
      try {
        const result = callback(publicRequest);
        if (result !== undefined && typeof (result as Promise<void>).then === "function") {
          void (result as Promise<void>).catch(() => {
            this.resolvePermission(entry, CANCELLED_RESPONSE);
          });
        }
      } catch {
        this.resolvePermission(entry, CANCELLED_RESPONSE);
      }
    });
  }

  private resolvePermission(entry: PendingPermission, response: acp.RequestPermissionResponse): void {
    if (entry.settled) return;
    entry.settled = true;
    this.pending.delete(entry.public.permission_id);
    entry.resolve(response);
  }

  private denyAllPendingPermissions(): number {
    const entries = [...this.pending.values()];
    for (const entry of entries) this.resolvePermission(entry, CANCELLED_RESPONSE);
    return entries.length;
  }

  /** Resolve one pending permission only if it is still bound to this session. */
  respondPermission(
    permissionId: string,
    decision: AcpPermissionDecision,
  ): AcpPermissionResponseResult {
    const entry = this.pending.get(permissionId);
    if (entry === undefined) {
      return Object.freeze({
        ok: false,
        permission_id: permissionId,
        code: "unknown_permission",
        denied: false,
      });
    }
    if (
      entry.public.session_id !== this.sessionId ||
      entry.public.binding.attempt !== this.binding.attempt ||
      entry.public.binding.goal_id !== this.binding.goal_id ||
      entry.public.binding.plan_id !== this.binding.plan_id ||
      entry.public.binding.revision !== this.binding.revision
    ) {
      this.resolvePermission(entry, CANCELLED_RESPONSE);
      return Object.freeze({
        ok: false,
        permission_id: permissionId,
        code: "stale_permission",
        denied: true,
      });
    }
    if (decision.outcome === "cancelled") {
      this.resolvePermission(entry, CANCELLED_RESPONSE);
      return Object.freeze({
        ok: true,
        permission_id: permissionId,
        outcome: "cancelled",
        option_id: null,
        option_kind: null,
      });
    }
    if (decision.outcome !== "selected") {
      this.resolvePermission(entry, CANCELLED_RESPONSE);
      return Object.freeze({
        ok: false,
        permission_id: permissionId,
        code: "invalid_decision",
        denied: true,
      });
    }
    if (this.cancelRequested) {
      this.resolvePermission(entry, CANCELLED_RESPONSE);
      return Object.freeze({
        ok: false,
        permission_id: permissionId,
        code: "cancel_requested",
        denied: true,
      });
    }
    if (!permissionHasScope(entry.public)) {
      // Never approve an opaque native action from a title alone.
      this.resolvePermission(entry, CANCELLED_RESPONSE);
      return Object.freeze({
        ok: false,
        permission_id: permissionId,
        code: "insufficient_scope",
        denied: true,
      });
    }
    const selected = entry.public.options.find(
      (option) => option.optionId === decision.option_id,
    );
    if (selected === undefined) {
      // A malformed approval is a denial, never an implicit grant.
      this.resolvePermission(entry, CANCELLED_RESPONSE);
      return Object.freeze({
        ok: false,
        permission_id: permissionId,
        code: "unknown_option",
        denied: true,
      });
    }
    this.resolvePermission(
      entry,
      Object.freeze({
        outcome: Object.freeze({ outcome: "selected" as const, optionId: selected.optionId }),
      }),
    );
    return Object.freeze({
      ok: true,
      permission_id: permissionId,
      outcome: "selected",
      option_id: selected.optionId,
      option_kind: selected.kind,
    });
  }
}

function outcomeFromStopReason(stopReason: acp.StopReason): AcpTurnOutcome {
  switch (stopReason) {
    case "end_turn":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "refusal":
      return "refused";
    case "max_tokens":
      return "max_tokens";
    case "max_turn_requests":
      return "max_turn_requests";
    default:
      return "error";
  }
}
