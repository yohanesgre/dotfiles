import { describe, expect, test } from "bun:test";

import {
  type AcpExitEvent,
  type AcpSpawnEvent,
  AcpConfigObservation,
  AcpCoordinator,
  AcpSessionConfigSettlement,
  AcpStartupError,
  classifySessionNotificationIdentity,
  classifyUpdateIdentity,
  resolveSessionConfigSelection,
  sessionConfigCurrentValue,
} from "./acp-client";
import { ControlValidationError, createAckEnvelope } from "./control-message";
import { LaunchProfileError, resolveExecutablePath } from "./launch-profiles";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";

const BINDING = {
  goal_id: "goal-1",
  plan_id: "plan-1",
  revision: "r1",
  attempt: 1,
} as const;

describe("session update identity filtering", () => {
  test("accepts the bound session with no identity metadata", () => {
    expect(
      classifyUpdateIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
      }),
    ).toBeNull();
  });

  test("rejects a different session", () => {
    expect(
      classifyUpdateIdentity({
        session_id: "ses_2",
        bound_session_id: "ses_1",
        attempt: 1,
      }),
    ).toBe("session_mismatch");
  });

  test("rejects explicitly identified child or subagent metadata", () => {
    expect(
      classifyUpdateIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
        meta: { childSessionId: "ses_child" },
      }),
    ).toBe("child_inlined");
    expect(
      classifyUpdateIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
        meta: { parent_session_id: "ses_parent" },
      }),
    ).toBe("child_inlined");
    expect(
      classifyUpdateIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
        meta: { "opencode/child-session-updates": true },
      }),
    ).toBe("child_inlined");
  });

  test("rejects a mismatched attempt but accepts a matching one", () => {
    expect(
      classifyUpdateIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
        meta: { attempt_id: 2 },
      }),
    ).toBe("attempt_mismatch");
    expect(
      classifyUpdateIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
        meta: { attempt_id: 1 },
      }),
    ).toBeNull();
  });

  test("checks notification metadata as well as update metadata", () => {
    expect(
      classifySessionNotificationIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
        notification_meta: { childSessionId: "ses_child" },
      }),
    ).toBe("child_inlined");
    expect(
      classifySessionNotificationIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
        update_meta: { childSessionId: "ses_child" },
      }),
    ).toBe("child_inlined");
    expect(
      classifySessionNotificationIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
        notification_meta: { attempt_id: 2 },
      }),
    ).toBe("attempt_mismatch");
    expect(
      classifySessionNotificationIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
        notification_meta: { "opencode/retry": { attempt: 2 } },
        update_meta: { "opencode/retry": { attempt: 2 } },
      }),
    ).toBeNull();
    expect(
      classifySessionNotificationIdentity({
        session_id: "ses_2",
        bound_session_id: "ses_1",
        attempt: 1,
        notification_meta: { childSessionId: "ses_child" },
      }),
    ).toBe("session_mismatch");
  });

  test("accepts vendor retry metadata and session ids equal to the bound one", () => {
    expect(
      classifyUpdateIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
        meta: { "opencode/retry": { attempt: 9, nextRetryAt: "later" } },
      }),
    ).toBeNull();
    expect(
      classifyUpdateIdentity({
        session_id: "ses_1",
        bound_session_id: "ses_1",
        attempt: 1,
        meta: { session_id: "ses_1" },
      }),
    ).toBeNull();
  });
});

describe("coordinator fail-closed construction", () => {
  test("rejects an unknown launch profile before any spawn", async () => {
    try {
      await AcpCoordinator.launch("sh" as never, { cwd: process.cwd(), binding: BINDING });
      throw new Error("expected launch rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(LaunchProfileError);
      expect((error as LaunchProfileError).code).toBe("unknown_profile");
    }
  });

  test("rejects a relative cwd before any spawn", async () => {
    try {
      await AcpCoordinator.launch("omp", { cwd: "relative", binding: BINDING });
      throw new Error("expected launch rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(LaunchProfileError);
      expect((error as LaunchProfileError).code).toBe("invalid_cwd");
    }
  });

  const hasOmp = resolveExecutablePath("omp") !== null;
  test.skipIf(!hasOmp)("rejects an invalid binding before any spawn", async () => {
    try {
      await AcpCoordinator.launch("omp", {
        cwd: process.cwd(),
        binding: { ...BINDING, attempt: 0 },
      });
      throw new Error("expected launch rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ControlValidationError);
      expect((error as ControlValidationError).code).toBe("invalid_attempt");
    }
  });

  test.skipIf(!hasOmp)("rejects a malformed requested selection before any spawn", async () => {
    let spawns = 0;
    try {
      await AcpCoordinator.launch("omp", {
        cwd: process.cwd(),
        binding: BINDING,
        effort: "high\n",
        callbacks: {
          onSpawn: () => {
            spawns += 1;
          },
        },
      });
      throw new Error("expected launch rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AcpStartupError);
      expect((error as AcpStartupError).code).toBe("session_config_invalid");
      expect(spawns).toBe(0);
    }
  });
});

function configOptions(options: readonly unknown[]): readonly SessionConfigOption[] {
  return options as unknown as readonly SessionConfigOption[];
}

describe("per-session selection resolution", () => {
  test("resolves the advertised option id, including grouped choices", () => {
    const options = configOptions([
      {
        type: "select",
        id: "model",
        name: "Model",
        category: "model",
        currentValue: "m1",
        options: [{ value: "m1", name: "M1" }],
      },
      {
        type: "select",
        id: "thinking",
        name: "Thinking",
        category: "thought_level",
        currentValue: "low",
        options: [
          { group: "fast", name: "Fast", options: [{ value: "low", name: "Low" }] },
          { group: "deep", name: "Deep", options: [{ value: "high", name: "High" }] },
        ],
      },
    ]);
    expect(resolveSessionConfigSelection(options, "model", "m1")).toEqual({
      kind: "model",
      config_id: "model",
      value: "m1",
    });
    const effort = resolveSessionConfigSelection(options, "effort", "high");
    expect(effort).toEqual({ kind: "effort", config_id: "thinking", value: "high" });
    expect(Object.isFrozen(effort)).toBe(true);
  });

  test("matches by standard category when the option id is vendor-specific", () => {
    const options = configOptions([
      {
        type: "select",
        id: "mvp-model",
        name: "MVP Model",
        category: "model",
        currentValue: "a",
        options: [
          { value: "a", name: "A" },
          { value: "b", name: "B" },
        ],
      },
    ]);
    expect(resolveSessionConfigSelection(options, "model", "b").config_id).toBe("mvp-model");
  });

  test("fails closed on unknown, unsupported, ambiguous, or malformed selections", () => {
    const expectCode = (fn: () => unknown, code: string): void => {
      try {
        fn();
        throw new Error("expected selection failure");
      } catch (error) {
        expect(error).toBeInstanceOf(AcpStartupError);
        expect((error as AcpStartupError).code).toBe(code);
      }
    };

    expectCode(() => resolveSessionConfigSelection(null, "model", "m1"), "session_config_unavailable");
    expectCode(
      () =>
        resolveSessionConfigSelection(
          configOptions([{ type: "boolean", id: "model", name: "Model", currentValue: true }]),
          "model",
          "m1",
        ),
      "session_config_unavailable",
    );

    const effortOnly = configOptions([
      {
        type: "select",
        id: "thinking",
        name: "Thinking",
        category: "thought_level",
        currentValue: "low",
        options: [{ value: "low", name: "Low" }],
      },
    ]);
    expectCode(
      () => resolveSessionConfigSelection(effortOnly, "effort", "high"),
      "session_config_value_unadvertised",
    );
    expectCode(
      () =>
        resolveSessionConfigSelection(
          configOptions([
            {
              type: "select",
              id: "effort",
              name: "Effort",
              category: "thought_level",
              currentValue: "low",
              options: [{ value: "low", name: "Low" }],
            },
            {
              type: "select",
              id: "thinking",
              name: "Thinking",
              category: "thought_level",
              currentValue: "low",
              options: [{ value: "low", name: "Low" }],
            },
          ]),
          "effort",
          "low",
        ),
      "session_config_ambiguous",
    );
    for (const requested of ["", "bad\nvalue", "x".repeat(513), 7]) {
      expectCode(
        () => resolveSessionConfigSelection(effortOnly, "effort", requested),
        "session_config_invalid",
      );
    }
  });

});

function effortSnapshot(currentValue: string): readonly SessionConfigOption[] {
  return configOptions([
    {
      type: "select",
      id: "effort",
      name: "Effort",
      category: "thought_level",
      currentValue,
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
        { value: "default", name: "Default" },
      ],
    },
  ]);
}

function runtimeSnapshot(
  currentEffort: string,
  currentModel: string,
): readonly SessionConfigOption[] {
  return configOptions([
    {
      type: "select",
      id: "model",
      name: "Model",
      category: "model",
      currentValue: currentModel,
      options: [
        { value: "model-a", name: "Model A" },
        { value: "model-b", name: "Model B" },
      ],
    },
    {
      type: "select",
      id: "effort",
      name: "Effort",
      category: "thought_level",
      currentValue: currentEffort,
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
        { value: "default", name: "Default" },
      ],
    },
  ]);
}

function expectMismatch(settlement: AcpSessionConfigSettlement, returned: readonly SessionConfigOption[]): Promise<void> {
  return (async () => {
    try {
      await settlement.resolve(returned, 20);
      throw new Error("expected readback failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AcpStartupError);
      expect((error as AcpStartupError).code).toBe("session_config_readback_mismatch");
    }
  })();
}

describe("stateful selection settlement", () => {
  test("rejects a contradictory response with no post-request update", async () => {
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    await expectMismatch(settlement, effortSnapshot("low"));
  });

  test("rejects an unrelated no-change baseline update when the response contradicts", async () => {
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    settlement.observe(effortSnapshot("high"), effortSnapshot("high"));
    await expectMismatch(settlement, effortSnapshot("low"));
  });

  test("accepts a real transition observed during the request over a stale response", async () => {
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    settlement.observe(effortSnapshot("default"), effortSnapshot("high"));
    const resolved = (await settlement.resolve(effortSnapshot("default"), 20)).options;
    expect(sessionConfigCurrentValue(resolved, "effort")).toBe("high");
  });

  test("accepts a transition that arrives after a contradictory response", async () => {
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    const pending = settlement.resolve(effortSnapshot("default"), 500);
    settlement.observe(effortSnapshot("default"), effortSnapshot("high"));
    const resolved = (await pending).options;
    expect(sessionConfigCurrentValue(resolved, "effort")).toBe("high");
  });

  test("rejects a stale matching response contradicted by a post-request update", async () => {
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    settlement.observe(effortSnapshot("default"), effortSnapshot("low"));
    await expectMismatch(settlement, effortSnapshot("high"));
  });

  test("accepts a later transition after a conflicting update", async () => {
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    settlement.observe(effortSnapshot("default"), effortSnapshot("low"));
    settlement.observe(effortSnapshot("low"), effortSnapshot("high"));
    const resolved = (await settlement.resolve(effortSnapshot("high"), 20)).options;
    expect(sessionConfigCurrentValue(resolved, "effort")).toBe("high");
  });

  test("invalidates an earlier confirmation when a later update contradicts it", async () => {
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    settlement.observe(effortSnapshot("default"), effortSnapshot("high"));
    settlement.observe(effortSnapshot("high"), effortSnapshot("low"));
    await expectMismatch(settlement, effortSnapshot("low"));
  });

  test("returns the latest full snapshot when a matching update changes another option", async () => {
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    settlement.observe(runtimeSnapshot("default", "model-a"), runtimeSnapshot("high", "model-a"));
    settlement.observe(runtimeSnapshot("high", "model-a"), runtimeSnapshot("high", "model-b"));
    const resolved = (await settlement.resolve(runtimeSnapshot("default", "model-a"), 20)).options;
    expect(sessionConfigCurrentValue(resolved, "effort")).toBe("high");
    expect(sessionConfigCurrentValue(resolved, "model")).toBe("model-b");
  });

  test("accepts a matching response when no update arrived", async () => {
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    const resolved = (await settlement.resolve(effortSnapshot("high"), 20)).options;
    expect(sessionConfigCurrentValue(resolved, "effort")).toBe("high");
  });

  test("accepts a no-change update only when the response also matches", async () => {
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    settlement.observe(effortSnapshot("high"), effortSnapshot("high"));
    const resolved = (await settlement.resolve(effortSnapshot("high"), 20)).options;
    expect(sessionConfigCurrentValue(resolved, "effort")).toBe("high");
  });

  test("reads exact option ids and ignores boolean tombstones", () => {
    expect(sessionConfigCurrentValue(effortSnapshot("high"), "effort")).toBe("high");
    expect(
      sessionConfigCurrentValue(
        configOptions([{ type: "boolean", id: "effort", currentValue: true }]),
        "effort",
      ),
    ).toBeNull();
  });
});

describe("config observation handoff", () => {
  test("a settled response is not adopted after a queued contradiction", async () => {
    const observation = new AcpConfigObservation();
    observation.seed(effortSnapshot("default"));
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    const resolution = await settlement.resolve(
      effortSnapshot("high"),
      20,
      observation.generation,
    );
    // Notification B is queued after settlement fulfillment but before the
    // consumer continuation runs.
    expect(observation.record(effortSnapshot("low"))).toBe(1);
    try {
      observation.adopt(resolution, { config_id: "effort", value: "high" });
      throw new Error("expected superseded rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AcpStartupError);
      expect((error as AcpStartupError).code).toBe("session_config_readback_mismatch");
    }
    expect(sessionConfigCurrentValue(observation.options, "effort")).toBe("low");
  });

  test("a settled response is adopted only when no newer observation exists", async () => {
    const observation = new AcpConfigObservation();
    observation.seed(effortSnapshot("default"));
    const resolution = { options: effortSnapshot("high"), generation: observation.generation };
    const adopted = observation.adopt(resolution, { config_id: "effort", value: "high" });
    expect(sessionConfigCurrentValue(adopted, "effort")).toBe("high");
    expect(observation.options).toBe(adopted);
  });

  test("the latest matching observation wins over a stale resolution", async () => {
    const observation = new AcpConfigObservation();
    observation.seed(runtimeSnapshot("default", "model-a"));
    const settlement = new AcpSessionConfigSettlement("effort", "high");
    const generation = observation.record(runtimeSnapshot("high", "model-a"));
    settlement.observe(
      runtimeSnapshot("default", "model-a"),
      runtimeSnapshot("high", "model-a"),
      generation,
    );
    const resolution = await settlement.resolve(
      runtimeSnapshot("default", "model-a"),
      20,
      observation.generation,
    );
    observation.record(runtimeSnapshot("high", "model-b"));
    const adopted = observation.adopt(resolution, { config_id: "effort", value: "high" });
    expect(sessionConfigCurrentValue(adopted, "effort")).toBe("high");
    expect(sessionConfigCurrentValue(adopted, "model")).toBe("model-b");
  });

  test("startup rejects the latest canonical snapshot when it drifted", () => {
    const observation = new AcpConfigObservation();
    observation.seed(runtimeSnapshot("default", "model-a"));
    observation.record(runtimeSnapshot("high", "model-a"));
    // Contradiction delivered after settlement fulfillment, before startup ready.
    observation.record(runtimeSnapshot("low", "model-a"));
    try {
      observation.requireSelections([{ kind: "effort", value: "high" }]);
      throw new Error("expected startup rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AcpStartupError);
      expect((error as AcpStartupError).code).toBe("session_config_readback_mismatch");
    }
  });

  test("startup reads model and effort from the latest canonical snapshot", () => {
    const observation = new AcpConfigObservation();
    observation.seed(runtimeSnapshot("default", "model-a"));
    observation.record(runtimeSnapshot("high", "model-a"));
    observation.record(runtimeSnapshot("high", "model-b"));
    const selections = observation.requireSelections([{ kind: "effort", value: "high" }]);
    expect(selections.effort).toBe("high");
    expect(selections.model).toBe("model-b");
  });

  test("seeding session/new never overwrites an earlier notification", () => {
    const observation = new AcpConfigObservation();
    const latest = runtimeSnapshot("high", "model-b");
    observation.record(latest);
    observation.seed(runtimeSnapshot("default", "model-a"));
    expect(sessionConfigCurrentValue(observation.options, "effort")).toBe("high");
    expect(sessionConfigCurrentValue(observation.options, "model")).toBe("model-b");
  });
});

const SMOKE = process.env.GOAL_ACP_SMOKE === "1";

async function runRealSmoke(
  profileId: "omp" | "opencode",
  expectedVersion: string,
): Promise<void> {
  const exits: AcpExitEvent[] = [];
  const spawns: AcpSpawnEvent[] = [];
  const requestedModel = process.env.GOAL_ACP_MODEL?.trim() || null;
  const requestedEffort = process.env.GOAL_ACP_EFFORT?.trim() || null;
  const coordinator = await AcpCoordinator.launch(profileId, {
    cwd: process.cwd(),
    binding: BINDING,
    prompt_timeout_ms: 240_000,
    stop_timeout_ms: 30_000,
    model: requestedModel,
    effort: requestedEffort,
    callbacks: {
      onSpawn: (event) => {
        spawns.push(event);
      },
      onExit: (event) => {
        exits.push(event);
      },
    },
  });
  try {
      expect(coordinator.status.acked).toBe(false);
      const beforeAck = await coordinator.sendPrompt("this must not run before the ACK");
      expect(beforeAck.outcome).toBe("ack_required");

      const ack = createAckEnvelope(BINDING, "ack-smoke-1");
      const result = await coordinator.sendControl(ack, { timeout_ms: 180_000 });
      expect(result.outcome).toBe("acknowledged");
      expect(result.ack?.request_id).toBe("ack-smoke-1");
      expect(result.ack?.attempt).toBe(1);
      expect(coordinator.status.acked).toBe(true);

      const info = coordinator.capabilityInfo;
      expect(info?.protocol_version).toBe(1);
      expect(info?.cli_version).toBe(expectedVersion);
      if (requestedModel !== null) expect(info?.model).toBe(requestedModel);
      if (requestedEffort !== null) expect(info?.effort).toBe(requestedEffort);
      expect(spawns.length).toBe(1);
      expect(spawns[0]?.pid).toBe(coordinator.status.pid);
      expect(spawns[0]?.start_time_ticks).toMatch(/^\d+$/);
      expect(spawns[0]?.cli_version).toBe(expectedVersion);
      expect(spawns[0]?.unit_name).toMatch(/^work-plans-h2h-[a-z0-9]+\.service$/);
      expect(spawns[0]?.invocation_id).toMatch(/^[0-9a-f]{32}$/);
      expect(spawns[0]?.control_group).toMatch(/^\/sys\/fs\/cgroup\/user\.slice\//);
      expect(spawns[0]?.wrapper_pid).not.toBe(spawns[0]?.pid);
      expect(info?.launch.unit_name).toBe(spawns[0]?.unit_name);
      expect(Date.parse(spawns[0]!.started_at)).toBeLessThanOrEqual(
        Date.parse(info!.launch.started_at) + 1,
      );
      expect(info?.limitations.enforces_all_native_tools).toBe(false);
      expect(info?.limitations.cancel_stops_children).toBe(false);
      expect(info?.limitations.lifecycle).toBe("systemd_user_transient_service");
      expect(info?.limitations.cgroup_cleanup).toBe(true);
      expect(info?.limitations.filesystem_sandbox).toBe(false);
      expect(info?.limitations.network_sandbox).toBe(false);

      const missing = coordinator.respondPermission("perm_missing", { outcome: "cancelled" });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.code).toBe("unknown_permission");

      const stop = await coordinator.gracefulStop({ timeout_ms: 30_000 });
      expect(stop.outcome).toBe("stopped");
      expect(stop.quiescence_verified).toBe(true);
      expect(stop.ownership_retained).toBe(false);
      expect(stop.children_not_signaled_by_transport).toBe(true);
      expect(stop.children_cleanup).toBe("systemd_control_group");
      expect(stop.unit_name).toBe(spawns[0]?.unit_name);
      expect(stop.invocation_id).toBe(spawns[0]?.invocation_id);
      expect(stop.control_group).toBe(spawns[0]?.control_group);
      expect(stop.cgroup_present === false || stop.cgroup_populated === false).toBe(true);
      expect(stop.pid).toBe(spawns[0]?.pid);
      expect(stop.wrapper_pid).toBe(spawns[0]?.wrapper_pid);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(exits.length).toBe(1);
      expect(exits[0]?.identity?.pid).toBe(stop.pid);
      expect(exits[0]?.wrapper_pid).toBe(stop.wrapper_pid);
      expect(exits[0]?.unit_name).toBe(stop.unit_name);
      expect(exits[0]?.session_id).toBe(coordinator.status.session_id);
  } finally {
    await coordinator.gracefulStop({ timeout_ms: 60_000 }).catch(() => {});
  }
}

test.skipIf(!SMOKE || resolveExecutablePath("omp") === null)(
  "real OMP: ACK before work, structured echo, and graceful owned exit",
  async () => {
    await runRealSmoke("omp", "18.13.3");
  },
  300_000,
);

test.skipIf(!SMOKE || resolveExecutablePath("opencode") === null)(
  "real OpenCode: ACK before work, structured echo, and graceful owned exit",
  async () => {
    await runRealSmoke("opencode", "2.2.0");
  },
  300_000,
);
