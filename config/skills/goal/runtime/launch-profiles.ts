/**
 * Verified ACP launch profiles and their real-process identity.
 *
 * Only the two harnesses proved against the ACP stable-v1 endpoint are
 * launchable. The executable and argv are fixed arrays; there is no shell
 * string, no model/account flag, and no caller-supplied command. A launch
 * probes the installed CLI version first and fails closed when the observed
 * version drifts from the pinned set.
 */

import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { readFile, readlink, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_VERSION_TIMEOUT_MS = 10_000;
const MAX_VERSION_BUFFER = 64 * 1024;
const MAX_VERSION_OUTPUT = 512;
const VERSION_RE = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/;

export type LaunchProfileId = "omp" | "opencode";

export interface LaunchProfile {
  readonly id: LaunchProfileId;
  readonly executable: "omp" | "opencode";
  readonly argv: readonly ["acp"];
  readonly version_argv: readonly ["--version"];
  /** Exact versions proved against the stable-v1 ACP endpoint. */
  readonly allowed_versions: readonly string[];
  /** Initialize identities accepted for this profile. */
  readonly expected_agent_names: readonly string[];
  /**
   * No MCP server is requested in session/new. This does NOT disable globally
   * configured MCP servers; the harness may load them and spawn descendants.
   */
  readonly session_mcp_servers: readonly never[];
  readonly external_service_policy: {
    readonly requested_mcp_servers: "none";
    readonly global_configured_mcp_servers_may_load: true;
    readonly isolation_claimed: false;
  };
}

export const LAUNCH_PROFILES: Readonly<Record<LaunchProfileId, LaunchProfile>> =
  Object.freeze({
    omp: Object.freeze({
      id: "omp",
      executable: "omp",
      argv: Object.freeze(["acp"]) as readonly ["acp"],
      version_argv: Object.freeze(["--version"]) as readonly ["--version"],
      allowed_versions: Object.freeze(["18.12.6"]),
      expected_agent_names: Object.freeze(["omp"]),
      session_mcp_servers: Object.freeze([]) as readonly never[],
      external_service_policy: Object.freeze({
        requested_mcp_servers: "none" as const,
        global_configured_mcp_servers_may_load: true,
        isolation_claimed: false,
      }),
    }),
    opencode: Object.freeze({
      id: "opencode",
      executable: "opencode",
      argv: Object.freeze(["acp"]) as readonly ["acp"],
      version_argv: Object.freeze(["--version"]) as readonly ["--version"],
      allowed_versions: Object.freeze(["2.1.3"]),
      expected_agent_names: Object.freeze(["OpenCode", "opencode"]),
      session_mcp_servers: Object.freeze([]) as readonly never[],
      external_service_policy: Object.freeze({
        requested_mcp_servers: "none" as const,
        global_configured_mcp_servers_may_load: true,
        isolation_claimed: false,
      }),
    }),
  });

export type LaunchProfileErrorCode =
  | "unknown_profile"
  | "executable_missing"
  | "version_probe_failed"
  | "version_unparseable"
  | "version_drift"
  | "invalid_cwd";

export class LaunchProfileError extends Error {
  readonly code: LaunchProfileErrorCode;
  readonly profile_id: LaunchProfileId | null;
  readonly detail: string;
  readonly resolved_executable: string | null;
  readonly observed_version: string | null;
  readonly expected_versions: readonly string[];

  constructor(
    code: LaunchProfileErrorCode,
    detail: string,
    context: {
      profileId?: LaunchProfileId;
      resolvedExecutable?: string | null;
      observedVersion?: string | null;
      expectedVersions?: readonly string[];
    } = {},
  ) {
    super(`${code}: ${detail}`);
    this.name = "LaunchProfileError";
    this.code = code;
    this.profile_id = context.profileId ?? null;
    this.resolved_executable = context.resolvedExecutable ?? null;
    this.observed_version = context.observedVersion ?? null;
    this.expected_versions = context.expectedVersions ?? Object.freeze([]);
    this.detail = detail;
  }
}

export interface LaunchProfileProbeBase {
  readonly profile_id: LaunchProfileId;
  readonly executable: string;
  readonly resolved_executable: string | null;
  readonly expected_versions: readonly string[];
  readonly observed_version: string | null;
  /** Bounded diagnostic copy of the version command's stdout. */
  readonly version_output: string;
}

export type LaunchProfileProbe =
  | (LaunchProfileProbeBase & { readonly status: "pinned" })
  | (LaunchProfileProbeBase & { readonly status: "drift" })
  | (LaunchProfileProbeBase & { readonly status: "unparseable"; readonly detail: string })
  | (LaunchProfileProbeBase & { readonly status: "probe_failed"; readonly detail: string })
  | (LaunchProfileProbeBase & { readonly status: "missing"; readonly detail: string });

export interface PrepareLaunchOptions {
  readonly cwd: string;
  readonly version_timeout_ms?: number;
}

export interface PreparedLaunch {
  readonly profile: LaunchProfile;
  readonly probe: Extract<LaunchProfileProbe, { status: "pinned" }>;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly prepared_at: string;
}

export interface ProcessStartIdentity {
  readonly pid: number;
  /** Field 22 of /proc/<pid>/stat, preserved as a decimal string. */
  readonly start_time_ticks: string | null;
  /** Read-only /proc/<pid>/exe link, when resolvable. */
  readonly exe_path: string | null;
  readonly source: "proc" | "unavailable";
}

function profileOrThrow(id: string): LaunchProfile {
  if (id === "omp" || id === "opencode") return LAUNCH_PROFILES[id];
  throw new LaunchProfileError("unknown_profile", `unknown launch profile ${JSON.stringify(id)}`);
}

/** Resolve a profile by id. No arbitrary executable is accepted. */
export function resolveLaunchProfile(id: string): LaunchProfile {
  return profileOrThrow(id);
}

/**
 * Resolve a fixed profile executable against PATH. Absolute paths and shell
 * metacharacters are never accepted; the result is an existing executable.
 */
export function resolveExecutablePath(
  executable: string,
  pathValue: string | undefined = process.env.PATH,
): string | null {
  if (executable.includes("/") || executable.includes("\\") || executable.includes("\0")) {
    return null;
  }
  if (!pathValue) return null;
  for (const directory of pathValue.split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = join(directory, executable);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return null;
}

/** Require an absolute existing directory; return its canonical path. */
export async function assertLaunchCwd(cwd: unknown): Promise<string> {
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.includes("\0") || !isAbsolute(cwd)) {
    throw new LaunchProfileError("invalid_cwd", "launch cwd must be an absolute path");
  }
  let resolved: string;
  try {
    resolved = await realpath(cwd);
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new LaunchProfileError("invalid_cwd", `launch cwd is not a directory: ${resolved}`);
    }
  } catch (error) {
    if (error instanceof LaunchProfileError) throw error;
    throw new LaunchProfileError("invalid_cwd", `cannot resolve launch cwd: ${cwd}`);
  }
  return resolved;
}

function trimVersionOutput(text: string): string {
  return text.trim().slice(0, MAX_VERSION_OUTPUT);
}

/**
 * Probe the installed CLI version with a fixed argv and no shell. A missing
 * executable, unparseable output, and a version outside the pinned set are
 * all explicit results; none is silently accepted.
 */
export async function probeLaunchProfile(
  id: LaunchProfileId,
  options: { readonly timeout_ms?: number } = {},
): Promise<LaunchProfileProbe> {
  const profile = profileOrThrow(id);
  const resolved = resolveExecutablePath(profile.executable);
  const base = {
    profile_id: profile.id,
    executable: profile.executable,
    resolved_executable: resolved,
    expected_versions: profile.allowed_versions,
  } as const;

  if (resolved === null) {
    return {
      ...base,
      status: "missing",
      observed_version: null,
      version_output: "",
      detail: `${profile.executable} was not found as an executable on PATH`,
    };
  }

  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(resolved, [...profile.version_argv], {
      shell: false,
      windowsHide: true,
      timeout: options.timeout_ms ?? DEFAULT_VERSION_TIMEOUT_MS,
      maxBuffer: MAX_VERSION_BUFFER,
      encoding: "utf8",
    });
    stdout = typeof result.stdout === "string" ? result.stdout : "";
    stderr = typeof result.stderr === "string" ? result.stderr : "";
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      status: "probe_failed",
      observed_version: null,
      version_output: trimVersionOutput(stderr),
      detail: `version probe failed: ${detail}`,
    };
  }

  const match = VERSION_RE.exec(stdout) ?? VERSION_RE.exec(stderr);
  if (!match) {
    return {
      ...base,
      status: "unparseable",
      observed_version: null,
      version_output: trimVersionOutput(stdout || stderr),
      detail: "version probe produced no parseable semantic version",
    };
  }

  const observed = match[1];
  const version_output = trimVersionOutput(stdout || stderr);
  if (!profile.allowed_versions.includes(observed)) {
    return {
      ...base,
      status: "drift",
      observed_version: observed,
      version_output,
    };
  }
  return {
    ...base,
    status: "pinned",
    observed_version: observed,
    version_output,
  };
}

/** Throw an explicit drift/unavailable error unless the probe is pinned. */
export function assertPinnedProbe(
  probe: LaunchProfileProbe,
): Extract<LaunchProfileProbe, { status: "pinned" }> {
  if (probe.status === "pinned") return probe;
  if (probe.status === "drift") {
    throw new LaunchProfileError(
      "version_drift",
      `${probe.profile_id} version drift: expected ${probe.expected_versions.join(", ")}, observed ${probe.observed_version}`,
      {
        profileId: probe.profile_id,
        resolvedExecutable: probe.resolved_executable,
        observedVersion: probe.observed_version,
        expectedVersions: probe.expected_versions,
      },
    );
  }
  const code =
    probe.status === "unparseable"
      ? "version_unparseable"
      : probe.status === "probe_failed"
        ? "version_probe_failed"
        : "executable_missing";
  throw new LaunchProfileError(
    code,
    probe.detail,
    {
      profileId: probe.profile_id,
      resolvedExecutable: probe.resolved_executable,
      observedVersion: probe.observed_version,
      expectedVersions: probe.expected_versions,
    },
  );
}

/**
 * Validate the cwd, probe the pinned version, and return the exact spawn
 * command. Launching remains the coordinator's owned-process operation.
 */
export async function prepareLaunch(
  id: LaunchProfileId,
  options: PrepareLaunchOptions,
): Promise<PreparedLaunch> {
  const profile = profileOrThrow(id);
  const cwd = await assertLaunchCwd(options.cwd);
  const probe = assertPinnedProbe(
    await probeLaunchProfile(id, { timeout_ms: options.version_timeout_ms }),
  );
  if (probe.resolved_executable === null) {
    throw new LaunchProfileError("executable_missing", `${profile.executable} has no resolved path`, {
      profileId: profile.id,
      expectedVersions: profile.allowed_versions,
    });
  }
  return Object.freeze({
    profile,
    probe,
    executable: probe.resolved_executable,
    argv: Object.freeze([...profile.argv]),
    cwd,
    prepared_at: new Date().toISOString(),
  });
}

/**
 * Record the real process identity needed to distinguish this owned launch
 * from a later PID reuse. Never signals the PID.
 */
export async function readProcessStartIdentity(pid: number): Promise<ProcessStartIdentity> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return Object.freeze({ pid, start_time_ticks: null, exe_path: null, source: "unavailable" as const });
  }
  let text: string;
  try {
    text = await readFile(`/proc/${pid}/stat`, "utf8");
  } catch {
    return Object.freeze({ pid, start_time_ticks: null, exe_path: null, source: "unavailable" as const });
  }
  const close = text.lastIndexOf(")");
  if (close < 0) {
    return Object.freeze({ pid, start_time_ticks: null, exe_path: null, source: "unavailable" as const });
  }
  const fields = text.slice(close + 2).trim().split(/\s+/);
  const startTime = fields[19];
  let exePath: string | null = null;
  try {
    exePath = await readlink(`/proc/${pid}/exe`);
  } catch {
    exePath = null;
  }
  return Object.freeze({
    pid,
    start_time_ticks: startTime && /^\d+$/.test(startTime) ? startTime : null,
    exe_path: exePath,
    source: "proc" as const,
  });
}

export type ProcessIdentityState = "alive" | "gone" | "unknown";

/**
 * Check one captured identity without signaling it. A mismatched start time is
 * `gone` (the PID was reused); an unreadable /proc is `unknown`, never `gone`.
 */
export async function processStartIdentityState(
  identity: ProcessStartIdentity,
): Promise<ProcessIdentityState> {
  if (
    identity.source !== "proc" ||
    identity.start_time_ticks === null ||
    !Number.isSafeInteger(identity.pid) ||
    identity.pid <= 0
  ) {
    return "unknown";
  }
  let text: string;
  try {
    text = await readFile(`/proc/${identity.pid}/stat`, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "gone" : "unknown";
  }
  const close = text.lastIndexOf(")");
  if (close < 0) return "unknown";
  const fields = text.slice(close + 2).trim().split(/\s+/);
  const current = fields[19];
  if (!current || !/^\d+$/.test(current)) return "unknown";
  return current === identity.start_time_ticks ? "alive" : "gone";
}

/** True only when the same PID still carries the same kernel start time. */
export async function verifyProcessStartIdentity(
  identity: ProcessStartIdentity,
): Promise<boolean> {
  return (await processStartIdentityState(identity)) === "alive";
}
