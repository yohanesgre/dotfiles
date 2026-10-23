import { describe, expect, test } from "bun:test";
import { isAbsolute } from "node:path";

import {
  LAUNCH_PROFILES,
  LaunchProfileError,
  assertLaunchCwd,
  prepareLaunch,
  probeLaunchProfile,
  readProcessStartIdentity,
  resolveExecutablePath,
  resolveLaunchProfile,
  verifyProcessStartIdentity,
} from "./launch-profiles";

async function expectLaunchError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`expected LaunchProfileError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(LaunchProfileError);
    expect((error as LaunchProfileError).code).toBe(code);
  }
}

describe("launch profiles", () => {
  test("exposes only the two verified harnesses with fixed argv", () => {
    expect(Object.keys(LAUNCH_PROFILES).sort()).toEqual(["omp", "opencode"]);
    const omp = resolveLaunchProfile("omp");
    const opencode = resolveLaunchProfile("opencode");
    expect(Object.isFrozen(omp)).toBe(true);
    expect(omp.executable).toBe("omp");
    expect(omp.argv).toEqual(["acp"]);
    expect(omp.version_argv).toEqual(["--version"]);
    expect(omp.allowed_versions).toEqual(["18.12.6"]);
    expect(opencode.executable).toBe("opencode");
    expect(opencode.argv).toEqual(["acp"]);
    expect(opencode.allowed_versions).toEqual(["2.1.3"]);
    expect(opencode.expected_agent_names).toContain("OpenCode");
    expect(omp.session_mcp_servers).toEqual([]);
    expect(omp.external_service_policy).toEqual({
      requested_mcp_servers: "none",
      global_configured_mcp_servers_may_load: true,
      isolation_claimed: false,
    });
    expect(Object.isFrozen(omp.external_service_policy)).toBe(true);
  });

  test("rejects unknown profiles", () => {
    expect(() => resolveLaunchProfile("sh")).toThrow(LaunchProfileError);
    try {
      resolveLaunchProfile("sh");
    } catch (error) {
      expect((error as LaunchProfileError).code).toBe("unknown_profile");
    }
  });

  test("resolves only fixed executable names from absolute PATH entries", () => {
    const omp = resolveExecutablePath("omp");
    if (omp !== null) expect(isAbsolute(omp)).toBe(true);
    expect(resolveExecutablePath("/bin/sh")).toBeNull();
    expect(resolveExecutablePath("omp;sh")).toBeNull();
    expect(resolveExecutablePath("omp\\sh")).toBeNull();
    expect(resolveExecutablePath("omp\0sh")).toBeNull();
    expect(resolveExecutablePath("definitely-not-an-installed-harness")).toBeNull();
    expect(resolveExecutablePath("omp", "")).toBeNull();
    expect(resolveExecutablePath("omp", "relative/bin")).toBeNull();
  });

  test("requires an absolute existing directory cwd", async () => {
    await expectLaunchError(assertLaunchCwd("relative"), "invalid_cwd");
    await expectLaunchError(assertLaunchCwd("/definitely/not/a/directory"), "invalid_cwd");
    const cwd = await assertLaunchCwd(process.cwd());
    expect(isAbsolute(cwd)).toBe(true);
  });

  test("prepareLaunch rejects a relative cwd before spawning", async () => {
    await expectLaunchError(prepareLaunch("omp", { cwd: "relative" }), "invalid_cwd");
  });

  test("records and verifies the real process start identity", async () => {
    const identity = await readProcessStartIdentity(process.pid);
    expect(identity.source).toBe("proc");
    expect(identity.pid).toBe(process.pid);
    expect(identity.start_time_ticks).toMatch(/^\d+$/);
    expect(await verifyProcessStartIdentity(identity)).toBe(true);

    const invalid = await readProcessStartIdentity(0);
    expect(invalid.source).toBe("unavailable");
    expect(await verifyProcessStartIdentity(invalid)).toBe(false);
  });

  const hasOmp = resolveExecutablePath("omp") !== null;
  test.skipIf(!hasOmp)("probes the installed OMP version as pinned", async () => {
    const probe = await probeLaunchProfile("omp");
    if (probe.status !== "pinned") throw new Error(JSON.stringify(probe));
    expect(probe.observed_version).toBe("18.12.6");
    expect(probe.resolved_executable === null).toBe(false);
  });

  const hasOpenCode = resolveExecutablePath("opencode") !== null;
  test.skipIf(!hasOpenCode)("probes the installed OpenCode version as pinned", async () => {
    const probe = await probeLaunchProfile("opencode");
    if (probe.status !== "pinned") throw new Error(JSON.stringify(probe));
    expect(probe.observed_version).toBe("2.1.3");
  });

  test.skipIf(!hasOmp)("prepareLaunch returns the exact fixed spawn command", async () => {
    const prepared = await prepareLaunch("omp", { cwd: process.cwd() });
    expect(prepared.profile.id).toBe("omp");
    expect(prepared.executable).toBe(resolveExecutablePath("omp"));
    expect(prepared.argv).toEqual(["acp"]);
    expect(isAbsolute(prepared.cwd)).toBe(true);
    expect(prepared.probe.observed_version).toBe("18.12.6");
  });
});
