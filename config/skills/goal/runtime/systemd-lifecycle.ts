/**
 * Minimal user-systemd lifecycle for one harness process.
 *
 * A transient service owns the harness and every fork in its kernel cgroup.
 * This module only builds that invocation and queries the exact unit/cgroup;
 * it never starts arbitrary units and never signals or kills processes.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SYSTEMD_RUN_BIN = "systemd-run";
export const SYSTEMCTL_BIN = "systemctl";
export const UNIT_PREFIX = "work-plans-h2h-";
export const CGROUP_ROOT = "/sys/fs/cgroup";
export const DEFAULT_UNIT_TIMEOUT_MS = 10_000;
export const DEFAULT_UNIT_STOP_TIMEOUT_SECONDS = 10;

const UNIT_RE = /^work-plans-h2h-[a-z0-9]{8,64}\.service$/;
const INVOCATION_RE = /^[0-9a-f]{32}$/;
const QUERY_TIMEOUT_MS = 5_000;
const QUERY_MAX_BUFFER = 64 * 1024;

/** Manager/service variables are excluded so the unit gets its own values. */
const EXCLUDED_ENV_NAMES = new Set([
  "INVOCATION_ID",
  "SYSTEMD_EXEC_PID",
  "LISTEN_FDS",
  "LISTEN_PID",
  "LISTEN_FDNAMES",
  "NOTIFY_SOCKET",
  "WATCHDOG_USEC",
  "WATCHDOG_PID",
  "JOURNAL_STREAM",
  "MANAGERPID",
  "MONITOR_SERVICE",
  "MONITOR_UNIT",
  "MONITOR_PID",
]);

const QUERY_PROPERTIES = [
  "LoadState",
  "ActiveState",
  "SubState",
  "InvocationID",
  "ControlGroup",
  "MainPID",
  "ExecMainPID",
  "ExecMainStatus",
  "ExecMainCode",
  "Result",
];

export type SystemdLifecycleErrorCode =
  | "systemd_unavailable"
  | "unit_start_timeout"
  | "unit_query_failed"
  | "unit_identity_invalid"
  | "cgroup_invalid"
  | "invalid_invocation";

export class SystemdLifecycleError extends Error {
  readonly code: SystemdLifecycleErrorCode;
  readonly detail: string;

  constructor(code: SystemdLifecycleErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "SystemdLifecycleError";
    this.code = code;
    this.detail = detail;
  }
}

export interface UserUnitIdentity {
  readonly unit_name: string;
  readonly load_state: string;
  readonly active_state: string;
  readonly sub_state: string;
  readonly invocation_id: string | null;
  /** systemd ControlGroup property, starting with '/'. */
  readonly control_group: string | null;
  readonly main_pid: number | null;
  readonly exec_main_pid: number | null;
  readonly exec_main_status: number | null;
  readonly exec_main_code: number | null;
  readonly result: string | null;
}

export interface CgroupState {
  readonly control_group: string;
  /** Rooted cgroup2 filesystem path. */
  readonly path: string;
  readonly present: boolean;
  /** cgroup.events populated for the whole subtree; null when unreadable. */
  readonly populated: boolean | null;
  /** PIDs directly in the unit cgroup, for diagnostics. */
  readonly procs: readonly number[];
  readonly error: string | null;
}

export interface ExpectedUnitIdentity {
  readonly unit_name: string;
  readonly invocation_id: string;
  /** systemd ControlGroup property, not the rooted filesystem path. */
  readonly control_group: string;
  readonly main_pid: number;
  readonly main_pid_start_id: string;
}

export interface UnitStopProof {
  readonly unit_name: string;
  readonly expected_invocation_id: string;
  readonly expected_control_group: string;
  readonly identity: UserUnitIdentity;
  readonly cgroup: CgroupState;
  /** Unit invocation/control-group still match the recorded owned unit. */
  readonly owned: boolean;
  /** No process remains in the owned cgroup subtree. */
  readonly quiescent: boolean;
  readonly detail: string | null;
}

export function newUnitName(): string {
  return `${UNIT_PREFIX}${randomUUID().replace(/-/g, "").slice(0, 24)}.service`;
}

export function assertUnitName(unitName: string): string {
  if (!UNIT_RE.test(unitName)) {
    throw new SystemdLifecycleError("unit_identity_invalid", "invalid owned unit name");
  }
  return unitName;
}

export function isValidInvocationId(value: string | null): value is string {
  return typeof value === "string" && INVOCATION_RE.test(value);
}

/** Copy names only; values stay out of argv. Excludes manager-owned names. */
export function environmentNamesForUnit(env: NodeJS.ProcessEnv): string[] {
  const names: string[] = [];
  for (const name of Object.keys(env).sort()) {
    if (name.length === 0 || name.includes("=") || /[\u0000-\u001f\u007f]/.test(name)) continue;
    if (EXCLUDED_ENV_NAMES.has(name)) continue;
    if (env[name] === undefined) continue;
    names.push(name);
  }
  if (!names.includes("WORK_PLANS_H2H_ROLE")) names.push("WORK_PLANS_H2H_ROLE");
  return names;
}

export interface SystemdRunCommandInput {
  readonly unit_name: string;
  readonly cwd: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly environment_names: readonly string[];
  readonly stop_timeout_seconds?: number;
}

/** Build the exact transient-service argv. No shell, no environment values. */
export function buildSystemdRunArgs(input: SystemdRunCommandInput): string[] {
  const unitName = assertUnitName(input.unit_name);
  if (!input.cwd.startsWith("/") || input.cwd.includes("\0")) {
    throw new SystemdLifecycleError("cgroup_invalid", "working directory must be absolute");
  }
  if (
    input.executable.length === 0 ||
    input.executable.includes("\0") ||
    !input.executable.startsWith("/")
  ) {
    throw new SystemdLifecycleError("cgroup_invalid", "executable must be an absolute path");
  }
  const stopSeconds = input.stop_timeout_seconds ?? DEFAULT_UNIT_STOP_TIMEOUT_SECONDS;
  if (!Number.isSafeInteger(stopSeconds) || stopSeconds <= 0) {
    throw new SystemdLifecycleError("cgroup_invalid", "invalid stop timeout");
  }
  const envArgs: string[] = [];
  for (const name of input.environment_names) {
    if (name.length === 0 || name.includes("=") || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new SystemdLifecycleError("cgroup_invalid", "invalid environment name");
    }
    if (EXCLUDED_ENV_NAMES.has(name)) continue;
    envArgs.push("-E", name);
  }
  return [
    SYSTEMD_RUN_BIN,
    "--user",
    "--pipe",
    "--wait",
    "--collect",
    "--quiet",
    "--service-type=exec",
    "--unit",
    unitName,
    "-p",
    "KillMode=control-group",
    "-p",
    "SendSIGKILL=no",
    "-p",
    `TimeoutStopSec=${stopSeconds}s`,
    "--working-directory",
    input.cwd,
    ...envArgs,
    "--",
    input.executable,
    ...input.argv,
  ];
}

async function runSystemctl(args: string[]): Promise<{ stdout: string; error: unknown | null }> {
  try {
    const result = await execFileAsync(SYSTEMCTL_BIN, args, {
      shell: false,
      timeout: QUERY_TIMEOUT_MS,
      maxBuffer: QUERY_MAX_BUFFER,
      encoding: "utf8",
    });
    return { stdout: result.stdout, error: null };
  } catch (error) {
    const stdout =
      typeof (error as { stdout?: unknown }).stdout === "string"
        ? (error as { stdout: string }).stdout
        : "";
    return { stdout, error };
  }
}

function parseProperties(stdout: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

function parseInteger(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

/** Read one exact work-plans transient unit; never another unit name. */
export async function queryUserUnit(unitName: string): Promise<UserUnitIdentity> {
  const name = assertUnitName(unitName);
  const { stdout, error } = await runSystemctl([
    "--user",
    "show",
    name,
    `--property=${QUERY_PROPERTIES.join(",")}`,
    "--no-pager",
  ]);
  const values = parseProperties(stdout);
  if (error !== null) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/not[- ]found|could not be found/i.test(detail) || /not[- ]found/i.test(stdout)) {
      return Object.freeze({
        unit_name: name,
        load_state: "not-found",
        active_state: "inactive",
        sub_state: "dead",
        invocation_id: null,
        control_group: null,
        main_pid: null,
        exec_main_pid: null,
        exec_main_status: null,
        exec_main_code: null,
        result: null,
      });
    }
    throw new SystemdLifecycleError("unit_query_failed", detail);
  }
  const invocation = values.InvocationID?.trim() ?? "";
  const controlGroup = values.ControlGroup?.trim() ?? "";
  return Object.freeze({
    unit_name: name,
    load_state: values.LoadState?.trim() || "unknown",
    active_state: values.ActiveState?.trim() || "unknown",
    sub_state: values.SubState?.trim() || "unknown",
    invocation_id: INVOCATION_RE.test(invocation) ? invocation : null,
    control_group: controlGroup.startsWith("/") ? controlGroup : null,
    main_pid: parseInteger(values.MainPID),
    exec_main_pid: parseInteger(values.ExecMainPID),
    exec_main_status: parseInteger(values.ExecMainStatus),
    exec_main_code: parseInteger(values.ExecMainCode),
    result: values.Result?.trim() || null,
  });
}

export function rootedCgroupPath(controlGroup: string): string {
  if (
    !controlGroup.startsWith("/") ||
    controlGroup.includes("\0") ||
    controlGroup.includes("..") ||
    controlGroup.includes("//")
  ) {
    throw new SystemdLifecycleError("cgroup_invalid", "invalid control group path");
  }
  return `${CGROUP_ROOT}${controlGroup}`;
}

function parseProcs(text: string): number[] {
  const pids: number[] = [];
  for (const token of text.split(/\s+/)) {
    if (token.length === 0) continue;
    if (!/^\d+$/.test(token)) continue;
    const pid = Number(token);
    if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

/**
 * Read cgroup2 state for the exact recorded unit path. `populated` comes from
 * cgroup.events (whole subtree), not a process-name/snapshot guess.
 */
export async function readUnitCgroup(
  controlGroup: string,
  unitName: string,
): Promise<CgroupState> {
  const name = assertUnitName(unitName);
  if (!controlGroup.endsWith(`/${name}`)) {
    throw new SystemdLifecycleError("cgroup_invalid", "control group does not match owned unit");
  }
  const path = rootedCgroupPath(controlGroup);
  try {
    const info = await stat(path);
    if (!info.isDirectory()) {
      return Object.freeze({
        control_group: controlGroup,
        path,
        present: true,
        populated: null,
        procs: Object.freeze([]),
        error: "cgroup path is not a directory",
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return Object.freeze({
        control_group: controlGroup,
        path,
        present: false,
        populated: false,
        procs: Object.freeze([]),
        error: null,
      });
    }
    return Object.freeze({
      control_group: controlGroup,
      path,
      present: true,
      populated: null,
      procs: Object.freeze([]),
      error: "cannot stat cgroup path",
    });
  }

  let populated: boolean | null = null;
  let error: string | null = null;
  try {
    const events = await readFile(`${path}/cgroup.events`, "utf8");
    const match = /^populated\s+([01])\s*$/m.exec(events);
    if (match) populated = match[1] === "1";
    else error = "cgroup.events has no populated field";
  } catch {
    error = "cannot read cgroup.events";
  }

  let procs: number[] = [];
  try {
    procs = parseProcs(await readFile(`${path}/cgroup.procs`, "utf8"));
  } catch {
    if (error === null) error = "cannot read cgroup.procs";
  }
  return Object.freeze({
    control_group: controlGroup,
    path,
    present: true,
    populated,
    procs: Object.freeze(procs),
    error,
  });
}

export interface StartedUnitIdentity extends ExpectedUnitIdentity {
  readonly cgroup: CgroupState;
}

/**
 * Wait bounded for the transient unit to be active with a real MainPID that is
 * present in the unit cgroup. No guessed unit is ever attached.
 */
export async function waitForUserUnit(
  unitName: string,
  timeoutMs: number = DEFAULT_UNIT_TIMEOUT_MS,
): Promise<StartedUnitIdentity> {
  const name = assertUnitName(unitName);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new SystemdLifecycleError("unit_start_timeout", "invalid unit timeout");
  }
  const deadline = Date.now() + timeoutMs;
  let lastDetail = "unit did not become active";
  while (true) {
    try {
      const identity = await queryUserUnit(name);
      if (
        identity.load_state === "loaded" &&
        identity.active_state === "active" &&
        identity.main_pid !== null &&
        identity.main_pid > 0 &&
        identity.invocation_id !== null &&
        identity.control_group !== null
      ) {
        const cgroup = await readUnitCgroup(identity.control_group, name);
        const startId = cgroup.procs.includes(identity.main_pid)
          ? await readMainPidStartId(identity.main_pid)
          : null;
        if (cgroup.present && cgroup.populated === true && startId !== null) {
          return Object.freeze({
            unit_name: name,
            invocation_id: identity.invocation_id,
            control_group: identity.control_group,
            main_pid: identity.main_pid,
            main_pid_start_id: startId,
            cgroup,
          });
        }
        lastDetail = "MainPID is not yet present in the owned cgroup";
      } else {
        lastDetail = `unit state ${identity.load_state}/${identity.active_state}/${identity.sub_state}`;
      }
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline) {
      throw new SystemdLifecycleError("unit_start_timeout", lastDetail);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function readMainPidStartId(pid: number): Promise<string | null> {
  try {
    const text = await readFile(`/proc/${pid}/stat`, "utf8");
    const close = text.lastIndexOf(")");
    if (close < 0) return null;
    const fields = text.slice(close + 2).trim().split(/\s+/);
    const startId = fields[19];
    return startId && /^\d+$/.test(startId) ? startId : null;
  } catch {
    return null;
  }
}

/** Fail explicit when user systemd is unavailable; no direct-spawn fallback. */
export async function assertUserSystemdAvailable(): Promise<"running" | "degraded"> {
  try {
    const result = await execFileAsync(SYSTEMCTL_BIN, ["--user", "is-system-running"], {
      shell: false,
      timeout: QUERY_TIMEOUT_MS,
      maxBuffer: QUERY_MAX_BUFFER,
      encoding: "utf8",
    });
    const state = result.stdout.trim();
    if (state === "running" || state === "degraded") return state;
    throw new SystemdLifecycleError("systemd_unavailable", `user systemd state ${state}`);
  } catch (error) {
    if (error instanceof SystemdLifecycleError) throw error;
    const stdout =
      typeof (error as { stdout?: unknown }).stdout === "string"
        ? (error as { stdout: string }).stdout.trim()
        : "";
    if (stdout === "running" || stdout === "degraded") return stdout;
    throw new SystemdLifecycleError(
      "systemd_unavailable",
      `user systemd is not available: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Exact owned-unit + kernel-cgroup stop proof. Never signals anything. */
export async function proveOwnedUnitStopped(
  expected: ExpectedUnitIdentity,
): Promise<UnitStopProof> {
  assertUnitName(expected.unit_name);
  if (!isValidInvocationId(expected.invocation_id)) {
    throw new SystemdLifecycleError("invalid_invocation", "invalid expected InvocationID");
  }
  const identity = await queryUserUnit(expected.unit_name);
  const cgroup = await readUnitCgroup(expected.control_group, expected.unit_name);

  let owned = false;
  let detail: string | null = null;
  if (identity.load_state === "not-found") {
    // --collect unloads the unique unit after stop. The recorded cgroup path
    // must also be gone; otherwise ownership is not proven.
    owned = !cgroup.present;
    if (!owned) detail = "unit is unloaded but the recorded cgroup still exists";
  } else {
    owned =
      identity.invocation_id === expected.invocation_id &&
      identity.control_group === expected.control_group;
    if (!owned) {
      detail = "unit InvocationID/ControlGroup does not match the recorded identity";
    } else if (
      identity.main_pid !== null &&
      identity.main_pid !== 0 &&
      identity.main_pid !== expected.main_pid
    ) {
      // A restarted service would have a different MainPID under the same unit.
      owned = false;
      detail = "unit MainPID does not match the recorded MainPID";
    } else if (
      owned &&
      identity.main_pid !== null &&
      identity.main_pid > 0 &&
      expected.main_pid_start_id.length > 0
    ) {
      const startId = await readMainPidStartId(identity.main_pid);
      if (startId !== expected.main_pid_start_id) {
        owned = false;
        detail = "unit MainPID start identity does not match the recorded start id";
      }
    }
  }

  const absentCgroupProven =
    identity.load_state === "not-found" ||
    identity.active_state === "inactive" ||
    identity.active_state === "failed";
  const cgroupQuiescent = cgroup.present
    ? cgroup.error === null && cgroup.populated === false && cgroup.procs.length === 0
    : absentCgroupProven;
  const quiescent = owned && cgroupQuiescent;
  if (detail === null && !quiescent) {
    detail = cgroup.present
      ? cgroup.populated === true || cgroup.procs.length > 0
        ? "owned cgroup still contains processes"
        : "owned cgroup populated state is unknown"
      : "owned unit/cgroup proof incomplete";
  }
  return Object.freeze({
    unit_name: expected.unit_name,
    expected_invocation_id: expected.invocation_id,
    expected_control_group: expected.control_group,
    identity,
    cgroup,
    owned,
    quiescent,
    detail,
  });
}
