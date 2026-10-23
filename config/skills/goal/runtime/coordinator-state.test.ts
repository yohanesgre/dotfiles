import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";

import {
  CoordinatorStateError,
  CoordinatorStore,
  type GoalPlanSpec,
  type GoalSpec,
  type LifecyclePermission,
  type ManagerIdentity,
  type ObservationInput,
  type RuntimeProfile,
} from "./coordinator-state";

const cleanupDirectories: string[] = [];

afterEach(() => {
  while (cleanupDirectories.length > 0) {
    const directory = cleanupDirectories.pop() as string;
    rmSync(directory, { recursive: true, force: true });
  }
});

interface World {
  base: string;
  repo: string;
  planRoot: string;
  worktree: string;
  manager: ManagerIdentity;
}

function makeWorld(planIds: string[]): World {
  const base = mkdtempSync(join(tmpdir(), "goal-runtime-"));
  cleanupDirectories.push(base);
  const repo = join(base, "repo");
  mkdirSync(repo, { recursive: true });
  const planRoot = join(base, "state", "work-plans", "repo-abc123");
  mkdirSync(planRoot, { recursive: true });
  for (const planId of planIds) {
    mkdirSync(join(planRoot, planId), { recursive: true });
  }
  const worktree = join(base, "worktree");
  mkdirSync(worktree, { recursive: true });
  return {
    base,
    repo,
    planRoot,
    worktree,
    manager: { harness: "opencode", session_id: "ses-manager-1" },
  };
}

function storeFor(
  world: World,
  goalId = "goal-one",
  manager: ManagerIdentity = world.manager,
  now?: () => number,
): CoordinatorStore {
  return new CoordinatorStore({
    repo_root: world.repo,
    plan_root: world.planRoot,
    goal_id: goalId,
    manager,
    now,
  });
}

function planSpec(
  planId: string,
  overrides: Partial<GoalPlanSpec> = {},
): GoalPlanSpec {
  return {
    plan_id: planId,
    approved_revision: "rev-1",
    acceptance: [`${planId} acceptance`],
    scope: { in: ["in scope"], out: ["out of scope"] },
    runtime: { harness: "opencode", runtime_version: null, model: null },
    predecessors: [],
    resources: [],
    conflicts: [],
    lifecycle_permissions: ["launch", "stop"],
    ...overrides,
  };
}

function goalSpec(
  plans: GoalPlanSpec[],
  overrides: Partial<GoalSpec> = {},
): GoalSpec {
  return {
    goal: "ship the command center",
    acceptance: ["goal acceptance"],
    approval_revision: "approval-1",
    max_running_coordinators: 2,
    plans,
    ...overrides,
  };
}

function sha(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

function codeOf(operation: () => unknown): string | null {
  try {
    operation();
    return null;
  } catch (error) {
    if (error instanceof CoordinatorStateError) return error.code;
    throw error;
  }
}

function expectCode(operation: () => unknown, code: string): void {
  expect(codeOf(operation)).toBe(code);
}

function writeReport(planRoot: string, planId: string, extra = ""): string {
  const path = join(planRoot, planId, "report.md");
  writeFileSync(
    path,
    `# Report: ${planId}\ncreated: 2026-10-22\nsessions: ses-1\nresult: implemented and verified\ntests: bun test -> 1 pass\ndeviations: none\n${extra}`,
  );
  return path;
}

function writeStatus(
  planRoot: string,
  planId: string,
  state: string,
  message: string,
  ts = 1_000,
): string {
  const path = join(planRoot, planId, "status.md");
  writeFileSync(path, `state: ${state}\nts: ${ts}\nmsg: ${message}\n`);
  return path;
}

function writeDoneStatus(
  planRoot: string,
  planId: string,
  message = "verified complete",
  ts = 2_000,
): string {
  const path = join(planRoot, planId, "status.md");
  writeFileSync(path, `state: DONE\nts: ${ts}\nmsg: ${message}\n`);
  return path;
}

function startCoordinator(
  world: World,
  store: CoordinatorStore,
  planId: string,
  requestId: string,
): number {
  const reservation = store.reserve(planId, requestId);
  if (reservation.status !== "reserved") {
    throw new Error(
      `expected reserved for ${planId}: ${JSON.stringify(reservation)}`,
    );
  }
  const attempt = reservation.coordinator.attempt;
  store.transition(planId, {
    request_id: requestId,
    attempt,
    lifecycle: "LAUNCHING",
  });
  store.recordSpawn(planId, {
    request_id: requestId,
    attempt,
    process: { pid: 4_242, start_id: `start-${requestId}` },
    working_directory: world.worktree,
  });
  store.acknowledge(planId, {
    request_id: requestId,
    attempt,
    runtime: { harness: "opencode", session_id: `ses-${requestId}` },
    runtime_version: "2.1.3",
    model: null,
    working_directory: world.worktree,
  });
  return attempt;
}

function observation(
  planId: string,
  requestId: string,
  attempt: number,
  overrides: Partial<ObservationInput> = {},
): ObservationInput {
  const fingerprintLabel =
    typeof overrides.fingerprint === "string"
      ? overrides.fingerprint
      : `${planId}:${requestId}:${attempt}:${JSON.stringify(overrides)}`;
  return {
    plan_id: planId,
    request_id: requestId,
    attempt,
    state: "WORKING",
    wave: "W1i1",
    lanes: [],
    blocker: null,
    next_action: "continue",
    evidence_report: null,
    heartbeat_ts: 1_000_000,
    meaningful_progress_at: 1_000_000,
    observed_at: 1_000_000,
    source: "status.md",
    fingerprint: sha(fingerprintLabel),
    ...overrides,
  };
}

describe("CoordinatorStore registry", () => {
  test("persists the goal registry under repo-scoped .goals with private files", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    const state = store.createGoal(goalSpec([planSpec("alpha")]));

    expect(state.record.goal_id).toBe("goal-one");
    expect(store.goal_path).toBe(
      join(
        dirname(store.plan_root),
        ".goals",
        basename(store.plan_root),
        "goal-one",
        "goal.json",
      ),
    );
    expect(store.goal_path.startsWith(store.plan_root)).toBe(false);
    expect(state.record.repository.plan_root).toBe(store.plan_root);
    expect(state.record.plans[0]?.plan_path).toBe(
      join(store.plan_root, "alpha"),
    );
    expect(state.journal.last_seq).toBe(1);
    expect(state.journal.applied_seq).toBe(1);
    expect(statSync(store.goal_path).mode & 0o777).toBe(0o600);
    expect(statSync(store.events_path).mode & 0o777).toBe(0o600);
    expect(statSync(store.goal_dir).mode & 0o777).toBe(0o700);
    expect(store.exists()).toBe(true);

    const missing = storeFor(world, "goal-missing");
    expect(missing.exists()).toBe(false);
    expectCode(() => missing.read(), "not_found");
    const missingDirectory = join(
      dirname(store.plan_root),
      ".goals",
      basename(store.plan_root),
      "goal-missing",
    );
    expect(existsSync(missingDirectory)).toBe(false);

    const reread = store.read();
    expect(reread.record.plans[0]?.plan_id).toBe("alpha");
    expect(store.listEvents().map((event) => event.kind)).toEqual([
      "goal.created",
    ]);
  });

  test("rejects unsafe repository, state and plan paths", () => {
    const world = makeWorld(["alpha"]);

    const insideRepo = join(world.repo, "state");
    mkdirSync(insideRepo, { recursive: true });
    expectCode(
      () =>
        new CoordinatorStore({
          repo_root: world.repo,
          plan_root: insideRepo,
          goal_id: "goal-x",
          manager: world.manager,
        }),
      "invalid_path",
    );

    const planLink = join(world.base, "plan-root-link");
    symlinkSync(world.planRoot, planLink, "dir");
    expectCode(
      () =>
        new CoordinatorStore({
          repo_root: world.repo,
          plan_root: planLink,
          goal_id: "goal-x",
          manager: world.manager,
        }),
      "invalid_path",
    );

    expectCode(() => storeFor(world, "../goal-x"), "invalid_name");

    const outside = join(world.base, "outside-plan");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(world.planRoot, "beta"), "dir");
    const store = storeFor(world);
    expectCode(
      () => store.createGoal(goalSpec([planSpec("beta")])),
      "invalid_path",
    );
    expectCode(
      () => store.createGoal(goalSpec([planSpec("missing")])),
      "invalid_path",
    );
    expectCode(
      () => store.createGoal(goalSpec([planSpec("../alpha")])),
      "invalid_name",
    );

    const symlinkWorld = makeWorld(["alpha"]);
    const goalsDirectory = join(dirname(symlinkWorld.planRoot), ".goals");
    const elsewhere = join(symlinkWorld.base, "goals-elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, goalsDirectory, "dir");
    const symlinkStore = storeFor(symlinkWorld);
    expectCode(
      () => symlinkStore.createGoal(goalSpec([planSpec("alpha")])),
      "invalid_path",
    );
  });

  test("reservation is repo-wide; duplicate request IDs are idempotent", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));

    const first = store.reserve("alpha", "req-1");
    expect(first.status).toBe("reserved");
    if (first.status !== "reserved") throw new Error("unreachable");
    const attempt = first.coordinator.attempt;

    const otherManager = new CoordinatorStore({
      repo_root: world.repo,
      plan_root: world.planRoot,
      goal_id: "goal-one",
      manager: { harness: "omp", session_id: "ses-manager-2" },
    });
    expectCode(
      () => otherManager.reserve("alpha", "req-2"),
      "permission",
    );
    expectCode(
      () =>
        otherManager.reviseGoal(
          goalSpec([planSpec("alpha")], { approval_revision: "approval-x" }),
        ),
      "permission",
    );
    expectCode(
      () =>
        otherManager.completeGoal({
          approval_revision: "approval-1",
          evidence: ["foreign completion"],
        }),
      "permission",
    );
    expectCode(
      () =>
        otherManager.release("alpha", {
          request_id: "req-1",
          attempt,
          stop_evidence: "foreign release",
        }),
      "permission",
    );
    const otherView = otherManager.read();
    expect(
      otherView.record.plans[0]?.coordinator?.request_id,
    ).toBe("req-1");

    const eventsBeforeDuplicate = store.listEvents().length;
    const duplicate = store.reserve("alpha", "req-1");
    expect(duplicate.status).toBe("duplicate");
    if (duplicate.status !== "duplicate") throw new Error("unreachable");
    expect(duplicate.coordinator.attempt).toBe(attempt);
    expect(store.listEvents().length).toBe(eventsBeforeDuplicate);

    const ledger = JSON.parse(
      readFileSync(store.ledger_path, "utf8"),
    ) as { entries: Array<{ active: boolean }> };
    expect(ledger.entries.filter((entry) => entry.active)).toHaveLength(1);

    const crossGoal = storeFor(world, "goal-two");
    expectCode(
      () => crossGoal.createGoal(goalSpec([planSpec("alpha")])),
      "conflict",
    );

    expectCode(
      () =>
        store.release("alpha", {
          request_id: "req-1",
          attempt,
          stop_evidence: "",
        }),
      "invalid_schema",
    );
    const released = store.release("alpha", {
      request_id: "req-1",
      attempt,
      stop_evidence: "verified: no owned process was created",
    });
    expect(released.lifecycle).toBe("STOPPED");
    expect(released.stop_evidence).toBe(
      "verified: no owned process was created",
    );

    const next = store.reserve("alpha", "req-3");
    expect(next.status).toBe("reserved");
    if (next.status !== "reserved") throw new Error("unreachable");
    expect(next.coordinator.attempt).toBe(attempt + 1);
  });

  test("records spawn evidence and enforces the frozen runtime profile", () => {
    const world = makeWorld(["alpha"]);
    const otherWorkingDirectory = join(world.base, "other-worktree");
    mkdirSync(otherWorkingDirectory, { recursive: true });
    const store = storeFor(world);
    store.createGoal(
      goalSpec([
        planSpec("alpha", {
          runtime: {
            harness: "opencode",
            runtime_version: "2.1.3",
            model: "model-x",
            effort: "high",
          },
        }),
      ]),
    );
    const reservation = store.reserve("alpha", "req-1");
    expect(reservation.status).toBe("reserved");
    if (reservation.status !== "reserved") throw new Error("unreachable");
    const attempt = reservation.coordinator.attempt;

    expectCode(
      () =>
        store.recordSpawn("alpha", {
          request_id: "req-1",
          attempt,
          process: { pid: 4_242, start_id: "start-1" },
          working_directory: world.worktree,
        }),
      "lifecycle",
    );

    store.transition("alpha", {
      request_id: "req-1",
      attempt,
      lifecycle: "LAUNCHING",
    });
    expectCode(
      () =>
        store.transition("alpha", {
          request_id: "req-1",
          attempt,
          lifecycle: "RUNNING",
        }),
      "lifecycle",
    );
    expectCode(
      () =>
        store.recordSpawn("alpha", {
          request_id: "req-1",
          attempt,
          process: { pid: 4_242, start_id: "start-1" },
          working_directory: join(world.planRoot, "alpha"),
        }),
      "invalid_path",
    );

    const spawned = store.recordSpawn("alpha", {
      request_id: "req-1",
      attempt,
      process: { pid: 4_242, start_id: "start-1" },
      working_directory: world.worktree,
    });
    expect(spawned.lifecycle).toBe("LAUNCHING");
    expect(spawned.process).toEqual({ pid: 4_242, start_id: "start-1" });
    const spawnEvents = store.listEvents().length;

    const repeatedSpawn = store.recordSpawn("alpha", {
      request_id: "req-1",
      attempt,
      process: { pid: 4_242, start_id: "start-1" },
      working_directory: world.worktree,
    });
    expect(repeatedSpawn.process).toEqual({ pid: 4_242, start_id: "start-1" });
    expect(store.listEvents().length).toBe(spawnEvents);
    expectCode(
      () =>
        store.recordSpawn("alpha", {
          request_id: "req-1",
          attempt,
          process: { pid: 4_243, start_id: "start-2" },
          working_directory: world.worktree,
        }),
      "conflict",
    );
    expectCode(
      () =>
        store.recordSpawn("alpha", {
          request_id: "req-1",
          attempt,
          process: { pid: 4_242, start_id: "start-1" },
          working_directory: otherWorkingDirectory,
        }),
      "conflict",
    );

    const acknowledge = (
      overrides: Partial<{
        harness: "omp" | "opencode";
        runtime_version: string;
        model: string | null;
        effort: string | null;
        working_directory: string;
      }> = {},
    ) =>
      store.acknowledge("alpha", {
        request_id: "req-1",
        attempt,
        runtime: {
          harness: overrides.harness ?? "opencode",
          session_id: "ses-1",
        },
        runtime_version: overrides.runtime_version ?? "2.1.3",
        model: overrides.model === undefined ? "model-x" : overrides.model,
        effort: overrides.effort === undefined ? "high" : overrides.effort,
        working_directory: overrides.working_directory ?? world.worktree,
      });

    expectCode(() => acknowledge({ harness: "omp" }), "conflict");
    expectCode(() => acknowledge({ runtime_version: "2.1.2" }), "conflict");
    expectCode(() => acknowledge({ model: "model-y" }), "conflict");
    expectCode(() => acknowledge({ effort: "low" }), "conflict");
    expectCode(() => acknowledge({ effort: null }), "conflict");
    expectCode(
      () => acknowledge({ working_directory: otherWorkingDirectory }),
      "conflict",
    );
    expectCode(
      () => acknowledge({ working_directory: join(world.planRoot, "alpha") }),
      "invalid_path",
    );

    const acknowledged = acknowledge();
    expect(acknowledged.lifecycle).toBe("RUNNING");
    expect(acknowledged.runtime?.session_id).toBe("ses-1");
    expect(acknowledged.runtime_version).toBe("2.1.3");
    expect(acknowledged.runtime_effort).toBe("high");
    expect(acknowledged.runtime_profile.effort).toBe("high");
    expect(acknowledged.working_directory).toBe(world.worktree);
    const persisted = store.read().record.plans.find(
      (plan) => plan.plan_id === "alpha",
    );
    expect(persisted?.coordinator?.runtime_effort).toBe("high");
    expect(persisted?.runtime.effort).toBe("high");
    expect(store.acknowledge("alpha", {
      request_id: "req-1",
      attempt,
      runtime: { harness: "opencode", session_id: "ses-1" },
      runtime_version: "2.1.3",
      model: "model-x",
      effort: "high",
      working_directory: world.worktree,
    }).lifecycle).toBe("RUNNING");

    store.transition("alpha", {
      request_id: "req-1",
      attempt,
      lifecycle: "RECONCILING",
    });
    const reattached = acknowledge();
    expect(reattached.lifecycle).toBe("RUNNING");

    expectCode(
      () =>
        store.release("alpha", {
          request_id: "req-1",
          attempt,
          stop_evidence: "",
        }),
      "invalid_schema",
    );
    const stopped = store.release("alpha", {
      request_id: "req-1",
      attempt,
      stop_evidence: "verified: owned process 4242 exited and was reaped",
    });
    expect(stopped.lifecycle).toBe("STOPPED");
  });

  test("records the observed effort when no effort was approved", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    const reservation = store.reserve("alpha", "req-effort");
    if (reservation.status !== "reserved") throw new Error("unreachable");
    const attempt = reservation.coordinator.attempt;
    expect(reservation.coordinator.runtime_profile.effort).toBeNull();
    store.transition("alpha", {
      request_id: "req-effort",
      attempt,
      lifecycle: "LAUNCHING",
    });
    store.recordSpawn("alpha", {
      request_id: "req-effort",
      attempt,
      process: { pid: 4_242, start_id: "start-effort" },
      working_directory: world.worktree,
    });
    const acknowledged = store.acknowledge("alpha", {
      request_id: "req-effort",
      attempt,
      runtime: { harness: "opencode", session_id: "ses-effort" },
      runtime_version: "2.1.3",
      model: null,
      effort: "high",
      working_directory: world.worktree,
    });
    expect(acknowledged.lifecycle).toBe("RUNNING");
    expect(acknowledged.runtime_profile.effort).toBeNull();
    expect(acknowledged.runtime_effort).toBe("high");
    expect(
      store.read().record.plans[0]?.coordinator?.runtime_effort,
    ).toBe("high");

    const rawGoal = JSON.parse(readFileSync(store.goal_path, "utf8")) as {
      plans: Array<{ runtime: { effort?: string | null } }>;
    };
    const rawPlan = rawGoal.plans[0];
    if (!rawPlan) throw new Error("missing tampered plan");
    rawPlan.runtime.effort = "high";
    writeFileSync(store.goal_path, JSON.stringify(rawGoal));
    expectCode(() => store.read(), "invalid_schema");
  });

  test("treats omitted and explicit null effort as the same approval", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    const revised = store.reviseGoal(
      goalSpec(
        [
          planSpec("alpha", {
            runtime: {
              harness: "opencode",
              runtime_version: null,
              model: null,
              effort: null,
            },
          }),
        ],
        { approval_revision: "approval-2" },
      ),
    );
    expect(revised.record.plans[0]?.runtime.effort).toBeNull();
    const revision = store
      .listEvents()
      .find((event) => event.kind === "goal.revised");
    const changed = revision?.data?.changed;
    expect(Array.isArray(changed) ? changed : null).toEqual([]);
  });

  test("freezes an approved effort and preserves verified outcomes across revisions", () => {
    const world = makeWorld(["done"]);
    const reportPath = writeReport(world.planRoot, "done");
    const store = storeFor(world);
    const pinned: RuntimeProfile = {
      harness: "opencode",
      runtime_version: null,
      model: null,
      effort: "high",
    };
    const adoptedDone = (runtime: RuntimeProfile): GoalPlanSpec =>
      planSpec("done", {
        runtime,
        adoption: {
          state: "DONE",
          evidence: ["report"],
          report_path: reportPath,
        },
      });
    store.createGoal(goalSpec([adoptedDone(pinned)]));

    expectCode(
      () =>
        store.reviseGoal(
          goalSpec([adoptedDone({ ...pinned, effort: "low" })], {
            approval_revision: "approval-2",
          }),
        ),
      "conflict",
    );
    expectCode(
      () =>
        store.reviseGoal(
          goalSpec([adoptedDone({ ...pinned, effort: null })], {
            approval_revision: "approval-2",
          }),
        ),
      "conflict",
    );

    const revised = store.reviseGoal(
      goalSpec([adoptedDone(pinned)], { approval_revision: "approval-2" }),
    );
    const done = revised.record.plans.find((plan) => plan.plan_id === "done");
    expect(done?.runtime.effort).toBe("high");
    expect(done?.approved_revision).toBe("rev-1");
    expect(done?.verification?.evidence).toEqual(["report"]);
    expect(done?.last_observation?.state).toBe("DONE");
  });

  test("revises the goal under a new approval revision with frozen acceptance", () => {
    const world = makeWorld(["alpha", "beta", "gamma"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha"), planSpec("beta")]));

    const revised = store.reviseGoal(
      goalSpec(
        [
          planSpec("alpha"),
          planSpec("beta", {
            runtime: {
              harness: "omp",
              runtime_version: "18.12.6",
              model: null,
            },
          }),
          planSpec("gamma"),
        ],
        { approval_revision: "approval-2" },
      ),
    );
    expect(revised.record.approval_revision).toBe("approval-2");
    expect(revised.record.plans.map((plan) => plan.plan_id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(
      revised.record.plans.find((plan) => plan.plan_id === "beta")?.runtime
        .harness,
    ).toBe("omp");
    const revisionEvents = store
      .listEvents()
      .filter((event) => event.kind === "goal.revised");
    expect(revisionEvents).toHaveLength(1);
    const revisionData = revisionEvents[0]?.data as Record<string, unknown>;
    expect(revisionData.previous_approval_revision).toBe("approval-1");
    expect(revisionData.added).toEqual([
      expect.objectContaining({ plan_id: "gamma" }),
    ]);

    const samePlans = [
      planSpec("alpha"),
      planSpec("beta", {
        runtime: {
          harness: "omp",
          runtime_version: "18.12.6",
          model: null,
        },
      }),
      planSpec("gamma"),
    ];
    expectCode(
      () =>
        store.reviseGoal(
          goalSpec(samePlans, { approval_revision: "approval-2" }),
        ),
      "conflict",
    );
    expectCode(
      () =>
        store.reviseGoal(
          goalSpec(samePlans, { approval_revision: "approval-1" }),
        ),
      "conflict",
    );
    expectCode(
      () =>
        store.reviseGoal(
          goalSpec(samePlans, {
            approval_revision: "approval-3",
            acceptance: ["different goal acceptance"],
          }),
        ),
      "conflict",
    );

    const attempt = startCoordinator(world, store, "alpha", "req-a");
    expectCode(
      () =>
        store.reviseGoal(
          goalSpec(
            [
              planSpec("alpha", { acceptance: ["changed while live"] }),
              samePlans[1] as GoalPlanSpec,
              samePlans[2] as GoalPlanSpec,
            ],
            { approval_revision: "approval-3" },
          ),
        ),
      "conflict",
    );

    store.release("alpha", {
      request_id: "req-a",
      attempt,
      stop_evidence: "verified: owned process stopped",
    });
    const revisedAfterStop = store.reviseGoal(
      goalSpec(
        [
          planSpec("alpha", {
            approved_revision: "rev-2",
            runtime: {
              harness: "omp",
              runtime_version: "18.12.6",
              model: null,
            },
          }),
          planSpec("beta", {
            runtime: {
              harness: "omp",
              runtime_version: "18.12.6",
              model: null,
            },
          }),
          planSpec("gamma"),
        ],
        { approval_revision: "approval-3" },
      ),
    );
    const alpha = revisedAfterStop.record.plans.find(
      (plan) => plan.plan_id === "alpha",
    );
    expect(alpha?.approved_revision).toBe("rev-2");
    expect(alpha?.runtime.harness).toBe("omp");
    expect(alpha?.coordinator?.lifecycle).toBe("STOPPED");
    expect(alpha?.coordinator?.approved_revision).toBe("rev-1");

    const next = store.reserve("alpha", "req-a2");
    expect(next.status).toBe("reserved");
    if (next.status !== "reserved") throw new Error("unreachable");
    expect(next.coordinator.attempt).toBe(2);
    expect(next.coordinator.approved_revision).toBe("rev-2");
    expect(next.coordinator.runtime_profile.harness).toBe("omp");

    const rawGoal = JSON.parse(
      readFileSync(store.goal_path, "utf8"),
    ) as Record<string, unknown>;
    rawGoal.applied_seq = 1;
    writeFileSync(store.goal_path, JSON.stringify(rawGoal));
    const pending = store.read();
    expect(pending.record.approval_revision).toBe("approval-3");
    expect(pending.journal.pending).toBeGreaterThan(0);
    expect(pending.record.plans.map((plan) => plan.plan_id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    store.recoverJournal();
    expect(store.read().record.approval_revision).toBe("approval-3");
  });

  test("revision preserves verified outcomes and rejects removing launched plans", () => {
    const world = makeWorld(["alpha", "beta", "gamma", "done"]);
    const reportPath = writeReport(world.planRoot, "done");
    const store = storeFor(world);
    store.createGoal(
      goalSpec([
        planSpec("alpha"),
        planSpec("beta"),
        planSpec("gamma"),
        planSpec("done", {
          adoption: {
            state: "DONE",
            evidence: ["report"],
            report_path: reportPath,
          },
        }),
      ]),
    );

    const removed = store.reviseGoal(
      goalSpec(
        [planSpec("alpha"), planSpec("beta"), planSpec("done", {
          adoption: {
            state: "DONE",
            evidence: ["report"],
            report_path: reportPath,
          },
        })],
        { approval_revision: "approval-2" },
      ),
    );
    expect(removed.record.plans.map((plan) => plan.plan_id)).toEqual([
      "alpha",
      "beta",
      "done",
    ]);
    expect(
      removed.record.plans.find((plan) => plan.plan_id === "done")?.verification
        ?.evidence,
    ).toEqual(["report"]);

    expectCode(
      () =>
        store.reviseGoal(
          goalSpec(
            [
              planSpec("alpha"),
              planSpec("beta"),
              planSpec("done", {
                acceptance: ["changed completed plan"],
                adoption: {
                  state: "DONE",
                  evidence: ["report"],
                  report_path: reportPath,
                },
              }),
            ],
            { approval_revision: "approval-3" },
          ),
        ),
      "conflict",
    );

    const reservation = store.reserve("alpha", "req-a");
    if (reservation.status !== "reserved") throw new Error("unreachable");
    store.release("alpha", {
      request_id: "req-a",
      attempt: reservation.coordinator.attempt,
      stop_evidence: "verified: process stopped",
    });
    expectCode(
      () =>
        store.reviseGoal(
          goalSpec(
            [planSpec("beta"), planSpec("done", {
              adoption: {
                state: "DONE",
                evidence: ["report"],
                report_path: reportPath,
              },
            })],
            { approval_revision: "approval-4" },
          ),
        ),
      "conflict",
    );
  });

  test("completes the goal only after every plan is verified and released", () => {
    const world = makeWorld(["alpha", "beta"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha"), planSpec("beta")]));

    const alphaAttempt = startCoordinator(world, store, "alpha", "req-a");
    const alphaReport = writeReport(world.planRoot, "alpha");
    writeDoneStatus(world.planRoot, "alpha");
    expect(
      store.appendObservation(
        observation("alpha", "req-a", alphaAttempt, {
          state: "DONE",
          heartbeat_ts: 2_000_000,
          fingerprint: sha("alpha-done"),
        }),
      ).accepted,
    ).toBe(true);
    store.recordVerification("alpha", {
      request_id: "req-a",
      attempt: alphaAttempt,
      revision: "rev-1",
      evidence: ["report"],
      report_path: alphaReport,
    });

    expectCode(
      () =>
        store.completeGoal({
          approval_revision: "approval-1",
          evidence: ["goal-level review"],
        }),
      "conflict",
    );
    store.release("alpha", {
      request_id: "req-a",
      attempt: alphaAttempt,
      stop_evidence: "verified: process stopped",
    });
    expectCode(
      () =>
        store.completeGoal({
          approval_revision: "approval-1",
          evidence: ["goal-level review"],
        }),
      "not_ready",
    );

    const betaAttempt = startCoordinator(world, store, "beta", "req-b");
    const betaReport = writeReport(world.planRoot, "beta");
    writeDoneStatus(world.planRoot, "beta");
    expect(
      store.appendObservation(
        observation("beta", "req-b", betaAttempt, {
          state: "DONE",
          heartbeat_ts: 2_000_000,
          fingerprint: sha("beta-done"),
        }),
      ).accepted,
    ).toBe(true);
    store.recordVerification("beta", {
      request_id: "req-b",
      attempt: betaAttempt,
      revision: "rev-1",
      evidence: ["report"],
      report_path: betaReport,
    });
    expectCode(
      () =>
        store.completeGoal({
          approval_revision: "approval-1",
          evidence: ["goal-level review"],
        }),
      "conflict",
    );

    store.release("beta", {
      request_id: "req-b",
      attempt: betaAttempt,
      stop_evidence: "verified: process stopped",
    });
    const result = store.completeGoal({
      approval_revision: "approval-1",
      evidence: ["goal-level review", "all child reports inspected"],
    });
    expect(result.report_path.startsWith(store.goal_dir)).toBe(true);
    expect(existsSync(result.report_path)).toBe(true);
    const report = readFileSync(result.report_path, "utf8");
    expect(report).toContain(alphaReport);
    expect(report).toContain(betaReport);
    expect(report).toContain("approval-1");
    expect(result.completion.plan_reports.map((item) => item.plan_id)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(store.read().record.completion?.approval_revision).toBe(
      "approval-1",
    );
    expect(
      store.listEvents().filter((event) => event.kind === "goal.completed"),
    ).toHaveLength(1);

    const eventsBefore = store.listEvents().length;
    const repeated = store.completeGoal({
      approval_revision: "approval-1",
      evidence: ["goal-level review", "all child reports inspected"],
    });
    expect(repeated.report_path).toBe(result.report_path);
    expect(store.listEvents().length).toBe(eventsBefore);
    expectCode(
      () =>
        store.completeGoal({
          approval_revision: "approval-1",
          evidence: ["different evidence"],
        }),
      "conflict",
    );
    expectCode(
      () =>
        store.completeGoal({
          approval_revision: "approval-0",
          evidence: ["goal-level review"],
        }),
      "stale_evidence",
    );

    const rawGoal = JSON.parse(
      readFileSync(store.goal_path, "utf8"),
    ) as Record<string, unknown>;
    rawGoal.applied_seq = 1;
    writeFileSync(store.goal_path, JSON.stringify(rawGoal));
    const pending = store.read();
    expect(pending.record.completion?.approval_revision).toBe("approval-1");
    expect(pending.journal.pending).toBeGreaterThan(0);
    store.recoverJournal();
    expect(store.read().record.completion?.report_path).toBe(
      result.report_path,
    );
  });

  test("revision clears goal acceptance state but preserves prior completion artifacts", () => {
    const world = makeWorld(["alpha", "gamma"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    const alphaAttempt = startCoordinator(world, store, "alpha", "req-a");
    const alphaReport = writeReport(world.planRoot, "alpha");
    writeDoneStatus(world.planRoot, "alpha");
    store.appendObservation(
      observation("alpha", "req-a", alphaAttempt, {
        state: "DONE",
        heartbeat_ts: 2_000_000,
        fingerprint: sha("alpha-done"),
      }),
    );
    store.recordVerification("alpha", {
      request_id: "req-a",
      attempt: alphaAttempt,
      revision: "rev-1",
      evidence: ["report"],
      report_path: alphaReport,
    });
    store.release("alpha", {
      request_id: "req-a",
      attempt: alphaAttempt,
      stop_evidence: "verified: process stopped",
    });
    const firstCompletion = store.completeGoal({
      approval_revision: "approval-1",
      evidence: ["first goal evidence"],
    });

    const revised = store.reviseGoal(
      goalSpec([planSpec("alpha"), planSpec("gamma")], {
        approval_revision: "approval-2",
      }),
    );
    expect(revised.record.completion).toBeNull();
    expect(existsSync(firstCompletion.report_path)).toBe(true);
    expect(
      store.listEvents().some((event) => event.kind === "goal.completed"),
    ).toBe(true);
    expectCode(
      () =>
        store.completeGoal({
          approval_revision: "approval-1",
          evidence: ["first goal evidence"],
        }),
      "stale_evidence",
    );

    const gammaAttempt = startCoordinator(world, store, "gamma", "req-g");
    const gammaReport = writeReport(world.planRoot, "gamma");
    writeDoneStatus(world.planRoot, "gamma");
    store.appendObservation(
      observation("gamma", "req-g", gammaAttempt, {
        state: "DONE",
        heartbeat_ts: 2_000_000,
        fingerprint: sha("gamma-done"),
      }),
    );
    store.recordVerification("gamma", {
      request_id: "req-g",
      attempt: gammaAttempt,
      revision: "rev-1",
      evidence: ["report"],
      report_path: gammaReport,
    });
    store.release("gamma", {
      request_id: "req-g",
      attempt: gammaAttempt,
      stop_evidence: "verified: process stopped",
    });
    const secondCompletion = store.completeGoal({
      approval_revision: "approval-2",
      evidence: ["second goal evidence"],
    });
    expect(secondCompletion.report_path).not.toBe(
      firstCompletion.report_path,
    );
    expect(existsSync(firstCompletion.report_path)).toBe(true);
    expect(existsSync(secondCompletion.report_path)).toBe(true);
  });

  test("release enforces the plan's lifecycle permissions", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(
      goalSpec([
        planSpec("alpha", { lifecycle_permissions: ["launch"] }),
      ]),
    );
    const reservation = store.reserve("alpha", "req-1");
    if (reservation.status !== "reserved") throw new Error("unreachable");
    expectCode(
      () =>
        store.release("alpha", {
          request_id: "req-1",
          attempt: reservation.coordinator.attempt,
          stop_evidence: "verified stopped",
        }),
      "permission",
    );
  });

  test("readiness requires verified approved-revision evidence and valid DAGs", () => {
    const world = makeWorld(["a", "b", "c", "d", "e", "f"]);
    const store = storeFor(world);
    store.createGoal(
      goalSpec(
        [
          planSpec("a"),
          planSpec("b", {
            predecessors: [
              { plan_id: "a", required_evidence: ["report", "tests"] },
            ],
          }),
          planSpec("c", {
            predecessors: [{ plan_id: "ghost", required_evidence: [] }],
          }),
          planSpec("d", {
            predecessors: [{ plan_id: "d", required_evidence: [] }],
          }),
          planSpec("e", {
            predecessors: [{ plan_id: "f", required_evidence: [] }],
          }),
          planSpec("f", {
            predecessors: [{ plan_id: "e", required_evidence: [] }],
          }),
        ],
        { max_running_coordinators: 4 },
      ),
    );

    const initial = store.readyPlans();
    expect(initial.ready).toEqual(["a"]);
    const kinds = (planId: string): string[] => {
      const entry = initial.blocked.find((item) => item.plan_id === planId);
      return entry ? entry.reasons.map((reason) => reason.kind) : [];
    };
    expect(kinds("c")).toContain("missing_dependency");
    expect(kinds("d")).toContain("self_dependency");
    expect(kinds("e")).toContain("dependency_cycle");
    expect(kinds("f")).toContain("dependency_cycle");

    const attempt = startCoordinator(world, store, "a", "req-a");
    const reportPath = writeReport(world.planRoot, "a");
    writeDoneStatus(world.planRoot, "a");
    const done = store.appendObservation(
      observation("a", "req-a", attempt, {
        state: "DONE",
        heartbeat_ts: 2_000_000,
        fingerprint: sha("a-done"),
      }),
    );
    expect(done.accepted).toBe(true);

    const unverified = store.readyPlans();
    expect(unverified.ready).not.toContain("b");
    const bBlocked = unverified.blocked.find((item) => item.plan_id === "b");
    expect(
      bBlocked?.reasons.some(
        (reason) =>
          reason.kind === "dependency_not_verified" &&
          reason.missing_evidence.includes("report"),
      ),
    ).toBe(true);

    expectCode(
      () =>
        store.recordVerification("a", {
          request_id: "req-a",
          attempt,
          revision: "rev-stale",
          evidence: ["report", "tests"],
          report_path: reportPath,
        }),
      "stale_evidence",
    );
    const verification = store.recordVerification("a", {
      request_id: "req-a",
      attempt,
      revision: "rev-1",
      evidence: ["report", "tests"],
      report_path: reportPath,
    });
    expect(verification.revision).toBe("rev-1");
    expect(verification.attempt).toBe(attempt);

    const verified = store.readyPlans();
    expect(verified.completed).toContain("a");
    expect(verified.ready).toContain("b");
    expect(verified.ready).not.toContain("c");
    expect(verified.ready).not.toContain("d");
    expect(verified.ready).not.toContain("e");

    const regression = store.appendObservation(
      observation("a", "req-a", attempt, {
        state: "WORKING",
        heartbeat_ts: 3_000_000,
        fingerprint: sha("a-regression"),
      }),
    );
    expect(regression.accepted).toBe(false);
    expect(regression.reason).toBe("terminal_regression");
    expect(store.read().record.plans.find((plan) => plan.plan_id === "a")
      ?.last_observation?.state).toBe("DONE");
  });

  test("preserves an explicitly adopted completed outcome", () => {
    const world = makeWorld(["done"]);
    const reportPath = writeReport(world.planRoot, "done");
    const store = storeFor(world);
    const state = store.createGoal(
      goalSpec([
        planSpec("done", {
          adoption: {
            state: "DONE",
            evidence: ["report"],
            report_path: reportPath,
          },
        }),
      ]),
    );
    const plan = state.record.plans[0];
    expect(plan?.verification?.revision).toBe("rev-1");
    expect(plan?.last_observation?.state).toBe("DONE");
    expect(store.readyPlans().completed).toContain("done");
    const reservation = store.reserve("done", "req-new");
    expect(reservation.status).toBe("blocked");
    if (reservation.status !== "blocked") throw new Error("unreachable");
    expect(
      reservation.reasons.some((reason) => reason.kind === "already_verified"),
    ).toBe(true);
  });

  test("reopen provenance allows one reservation of an adopted completed plan", () => {
    const world = makeWorld(["done", "legacy"]);
    const reportPath = writeReport(world.planRoot, "done");
    writeDoneStatus(world.planRoot, "done", "explicitly adopted done");
    writeDoneStatus(world.planRoot, "legacy", "untracked legacy done");
    const store = storeFor(world);
    store.createGoal(
      goalSpec([
        planSpec("done", {
          adoption: {
            state: "DONE",
            evidence: ["report"],
            report_path: reportPath,
          },
        }),
        planSpec("legacy"),
      ]),
    );

    store.reopenPlan("done", {
      finding: "same-plan regression after adoption",
      evidence: ["manager review"],
    });
    expect(store.readyPlans().ready).toContain("done");
    const legacy = store.readyPlans().blocked.find(
      (item) => item.plan_id === "legacy",
    );
    expect(
      legacy?.reasons.some(
        (reason) => reason.kind === "untracked_plan_state",
      ),
    ).toBe(true);
    const reservation = store.reserve("done", "req-reopen");
    expect(reservation.status).toBe("reserved");
    if (reservation.status !== "reserved") throw new Error("unreachable");
    expect(reservation.coordinator.attempt).toBe(1);
  });

  test("serializes declared resources and conflict tokens across goals", () => {
    const world = makeWorld(["alpha", "beta"]);
    const first = storeFor(world, "goal-one");
    const second = storeFor(world, "goal-two");
    first.createGoal(
      goalSpec([
        planSpec("alpha", {
          resources: ["port:3000"],
          conflicts: ["src/shared.ts"],
        }),
      ]),
    );
    second.createGoal(
      goalSpec([
        planSpec("beta", {
          resources: ["port:3000"],
          conflicts: ["src/shared.ts"],
        }),
      ]),
    );

    const reservation = first.reserve("alpha", "req-a");
    expect(reservation.status).toBe("reserved");
    if (reservation.status !== "reserved") throw new Error("unreachable");

    const readiness = second.readyPlans();
    expect(readiness.ready).not.toContain("beta");
    const blocked = readiness.blocked.find((item) => item.plan_id === "beta");
    expect(
      blocked?.reasons.some(
        (reason) =>
          reason.kind === "resource_conflict" &&
          reason.with_plan_id === "alpha",
      ),
    ).toBe(true);
    expect(
      blocked?.reasons.some(
        (reason) =>
          reason.kind === "conflict_token" &&
          reason.with_plan_id === "alpha",
      ),
    ).toBe(true);

    const competing = second.reserve("beta", "req-b");
    expect(competing.status).toBe("blocked");
    if (competing.status !== "blocked") throw new Error("unreachable");
    expect(
      competing.reasons.some((reason) => reason.kind === "resource_conflict"),
    ).toBe(true);

    first.release("alpha", {
      request_id: "req-a",
      attempt: reservation.coordinator.attempt,
      stop_evidence: "verified: no process was created",
    });
    expect(second.readyPlans().ready).toContain("beta");
    expect(second.reserve("beta", "req-b2").status).toBe("reserved");
  });

  test("enforces the per-goal concurrency limit", () => {
    const world = makeWorld(["alpha", "beta"]);
    const store = storeFor(world);
    store.createGoal(
      goalSpec([planSpec("alpha"), planSpec("beta")], {
        max_running_coordinators: 1,
      }),
    );
    const first = store.reserve("alpha", "req-a");
    expect(first.status).toBe("reserved");
    if (first.status !== "reserved") throw new Error("unreachable");

    const blocked = store.reserve("beta", "req-b");
    expect(blocked.status).toBe("blocked");
    if (blocked.status !== "blocked") throw new Error("unreachable");
    expect(
      blocked.reasons.some((reason) => reason.kind === "concurrency_limit"),
    ).toBe(true);

    store.release("alpha", {
      request_id: "req-a",
      attempt: first.coordinator.attempt,
      stop_evidence: "verified: no process was created",
    });
    expect(store.reserve("beta", "req-b2").status).toBe("reserved");
  });

  test("fails closed on untracked active plans but allows fresh PLAN and tracked releases", () => {
    const world = makeWorld([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
    ]);
    const store = storeFor(world);
    store.createGoal(
      goalSpec([
        planSpec("alpha"),
        planSpec("beta"),
        planSpec("gamma"),
        planSpec("delta"),
        planSpec("epsilon"),
      ], { max_running_coordinators: 3 }),
    );
    writeStatus(world.planRoot, "alpha", "WORKING", "legacy active");
    writeStatus(world.planRoot, "beta", "WAIT", "legacy blocked");
    writeFileSync(
      join(world.planRoot, "gamma", "status.md"),
      "state: WORKING\nts: 1000\nmsg: malformed\nextra: line\n",
    );
    writeDoneStatus(world.planRoot, "epsilon", "legacy completed", 1_000);

    const initial = store.readyPlans();
    const reasonsFor = (planId: string): string[] => {
      const entry = initial.blocked.find((item) => item.plan_id === planId);
      return entry ? entry.reasons.map((reason) => reason.kind) : [];
    };
    expect(reasonsFor("alpha")).toContain("untracked_plan_state");
    expect(reasonsFor("beta")).toContain("untracked_plan_state");
    expect(reasonsFor("gamma")).toContain("untracked_plan_state");
    expect(reasonsFor("epsilon")).toContain("untracked_plan_state");
    expect(initial.ready).toContain("delta");

    const alphaStatusPath = join(world.planRoot, "alpha", "status.md");
    const alphaStatusBefore = readFileSync(alphaStatusPath, "utf8");
    const blockedAlpha = store.reserve("alpha", "req-alpha");
    expect(blockedAlpha.status).toBe("blocked");
    if (blockedAlpha.status !== "blocked") throw new Error("unreachable");
    expect(
      blockedAlpha.reasons.some(
        (reason) =>
          reason.kind === "untracked_plan_state" &&
          reason.reason === "active" &&
          reason.observed_state === "WORKING",
      ),
    ).toBe(true);
    expect(readFileSync(alphaStatusPath, "utf8")).toBe(alphaStatusBefore);
    const ledgerAfterBlocks = JSON.parse(
      readFileSync(store.ledger_path, "utf8"),
    ) as { entries: unknown[] };
    expect(ledgerAfterBlocks.entries).toHaveLength(0);

    writeStatus(world.planRoot, "alpha", "PLAN", "freshly authored");
    expect(store.readyPlans().ready).toContain("alpha");
    expect(store.reserve("alpha", "req-alpha2").status).toBe("reserved");

    const bootstrap = startCoordinator(world, store, "delta", "req-delta");
    store.release("delta", {
      request_id: "req-delta",
      attempt: bootstrap,
      stop_evidence: "verified: bootstrap stopped",
    });
    writeStatus(world.planRoot, "delta", "WORKING", "stale released state");
    expect(store.readyPlans().ready).toContain("delta");
    const tracked = store.reserve("delta", "req-delta2");
    expect(tracked.status).toBe("reserved");
    if (tracked.status !== "reserved") throw new Error("unreachable");
    expect(tracked.coordinator.attempt).toBe(bootstrap + 1);
  });

  test("rejects a stale expected plan before writing any reservation", () => {
    const variants: Array<{
      label: string;
      override: Partial<GoalPlanSpec>;
    }> = [
      { label: "revision", override: { approved_revision: "rev-2" } },
      { label: "worktree", override: { worktree: null } },
      {
        label: "permissions",
        override: { lifecycle_permissions: ["launch"] },
      },
      {
        label: "effort",
        override: {
          runtime: {
            harness: "opencode",
            runtime_version: null,
            model: null,
            effort: "high",
          },
        },
      },
    ];
    for (const variant of variants) {
      const world = makeWorld(["alpha"]);
      const store = storeFor(world);
      store.createGoal(
        goalSpec([
          planSpec("alpha", {
            worktree: world.worktree,
            lifecycle_permissions: ["launch", "stop"],
          }),
        ]),
      );
      const original = store.read().record.plans[0] as GoalPlanSpec;
      const ledgerBefore = readFileSync(store.ledger_path, "utf8");

      store.reviseGoal(
        goalSpec(
          [
            planSpec("alpha", {
              worktree: world.worktree,
              lifecycle_permissions: ["launch", "stop"],
              ...variant.override,
            }),
          ],
          { approval_revision: "approval-2" },
        ),
      );
      expectCode(
        () => store.reserve("alpha", `req-stale-${variant.label}`, original),
        "conflict",
      );
      expect(readFileSync(store.ledger_path, "utf8")).toBe(ledgerBefore);
      expect(store.read().record.plans[0]?.coordinator).toBeNull();
      expect(
        store
          .listEvents()
          .filter((event) => event.kind === "plan.reserved"),
      ).toHaveLength(0);

      const current = store.read().record.plans[0] as GoalPlanSpec;
      const fresh = store.reserve(
        "alpha",
        `req-fresh-${variant.label}`,
        current,
      );
      expect(fresh.status).toBe("reserved");
      if (fresh.status !== "reserved") throw new Error("unreachable");
      expect(fresh.coordinator.approved_revision).toBe(
        variant.override.approved_revision ?? "rev-1",
      );
    }
  });

  test("shares the ownership ledger across linked repository roots", () => {
    const world = makeWorld(["alpha"]);
    const otherRoot = join(world.base, "linked-repo");
    mkdirSync(otherRoot, { recursive: true });
    const store = new CoordinatorStore({
      repo_root: world.repo,
      plan_root: world.planRoot,
      goal_id: "goal-one",
      manager: world.manager,
    });
    store.createGoal(goalSpec([planSpec("alpha")]));
    expect(store.reserve("alpha", "req-1").status).toBe("reserved");

    const linked = new CoordinatorStore({
      repo_root: otherRoot,
      plan_root: world.planRoot,
      goal_id: "goal-one",
      manager: { harness: "omp", session_id: "ses-linked" },
    });
    expectCode(() => linked.reserve("alpha", "req-2"), "permission");
    expect(linked.read().record.plans[0]?.coordinator?.request_id).toBe(
      "req-1",
    );
  });
});

describe("CoordinatorStore journal and validation", () => {
  test("repairs a torn final append, replays pending events, and rejects interior corruption", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    const reserved = store.reserve("alpha", "req-1");
    expect(reserved.status).toBe("reserved");
    const lastSeq = store.read().journal.last_seq;

    appendFileSync(store.events_path, '{"schema_version":1,"seq":');
    const repaired = store.read();
    expect(repaired.journal.last_seq).toBe(lastSeq);
    expect(repaired.journal.repaired_tail_bytes).toBeGreaterThan(0);
    const repairedContent = readFileSync(store.events_path, "utf8");
    expect(repairedContent.endsWith("\n")).toBe(true);

    const rawGoal = JSON.parse(
      readFileSync(store.goal_path, "utf8"),
    ) as Record<string, unknown>;
    rawGoal.applied_seq = 1;
    writeFileSync(store.goal_path, JSON.stringify(rawGoal));
    const pending = store.read();
    expect(pending.journal.pending).toBe(lastSeq - 1);
    expect(pending.record.plans[0]?.coordinator?.request_id).toBe("req-1");

    const recovery = store.recoverJournal();
    expect(recovery.pending).toBe(0);
    expect(recovery.applied_seq).toBe(recovery.last_seq);
    expect(store.read().journal.pending).toBe(0);

    const corruptLine = JSON.stringify({
      schema_version: 1,
      seq: 999,
      time: 1,
      kind: "goal.created",
      goal_id: store.goal_id,
      plan_id: null,
      origin: { harness: "opencode", session_id: "ses-x" },
      attempt: null,
      request_id: null,
      source: null,
      data: null,
    });
    appendFileSync(store.events_path, `${corruptLine}\n`);
    const preserved = readFileSync(store.events_path, "utf8");
    expect(codeOf(() => store.read())).toBe("journal_corruption");
    expect(readFileSync(store.events_path, "utf8")).toBe(preserved);
  });

  test("fails closed on unsupported or corrupt registry schemas", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    const rawGoal = JSON.parse(
      readFileSync(store.goal_path, "utf8"),
    ) as Record<string, unknown>;
    rawGoal.schema_version = 2;
    writeFileSync(store.goal_path, JSON.stringify(rawGoal));
    expectCode(() => store.read(), "unsupported_schema");

    const secondWorld = makeWorld(["alpha"]);
    const second = storeFor(secondWorld, "goal-two");
    second.createGoal(goalSpec([planSpec("alpha")]));
    writeFileSync(second.goal_path, "{not valid json");
    expectCode(() => second.read(), "invalid_schema");
  });

  test("rejects invalid goal specs, plan IDs, and observation inputs", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);

    expectCode(
      () =>
        store.createGoal({
          ...goalSpec([planSpec("alpha")]),
          acceptance: [],
        }),
      "invalid_schema",
    );
    expectCode(
      () =>
        store.createGoal(
          goalSpec([planSpec("alpha"), planSpec("alpha")]),
        ),
      "invalid_schema",
    );
    expectCode(
      () =>
        store.createGoal(
          goalSpec([
            planSpec("alpha", {
              runtime: undefined as unknown as RuntimeProfile,
            }),
          ]),
        ),
      "invalid_schema",
    );
    expectCode(
      () =>
        store.createGoal(
          goalSpec([
            planSpec("alpha", {
              lifecycle_permissions: ["merge" as LifecyclePermission],
            }),
          ]),
        ),
      "invalid_schema",
    );
    expectCode(
      () => store.createGoal(goalSpec([planSpec("Bad_ID")])),
      "invalid_name",
    );

    store.createGoal(goalSpec([planSpec("alpha")]));
    expectCode(() => store.reserve("Bad_ID", "req-1"), "invalid_name");
    expectCode(() => store.reserve("alpha", "bad request"), "invalid_schema");
    expectCode(() => store.reserve("missing", "req-1"), "not_found");

    const first = store.reserve("alpha", "req-1");
    if (first.status !== "reserved") throw new Error("unreachable");
    const attempt = first.coordinator.attempt;
    expectCode(
      () =>
        store.appendObservation(
          observation("alpha", "req-1", attempt, {
            fingerprint: "not-a-digest",
          }),
        ),
      "invalid_schema",
    );
    expectCode(
      () =>
        store.acknowledge("alpha", {
          request_id: "req-1",
          attempt,
          runtime: {
            harness: "opencode",
            session_id: "bad\nsession",
          },
          runtime_version: "2.1.3",
          model: null,
          working_directory: world.worktree,
        }),
      "invalid_schema",
    );
  });

  test("duplicate, stale-time, terminal and old-attempt observations are rejected", () => {
    const world = makeWorld(["alpha", "beta"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha"), planSpec("beta")]));

    const alphaAttempt = startCoordinator(world, store, "alpha", "req-a");
    const reportPath = writeReport(world.planRoot, "alpha");
    writeDoneStatus(world.planRoot, "alpha");
    const done = observation("alpha", "req-a", alphaAttempt, {
      state: "DONE",
      heartbeat_ts: 2_000_000,
      fingerprint: sha("alpha-done"),
    });
    expect(store.appendObservation(done).accepted).toBe(true);
    expect(store.appendObservation(done).reason).toBe("duplicate");

    const staleTime = store.appendObservation({
      ...done,
      state: "WORKING",
      heartbeat_ts: 1_000_000,
      fingerprint: sha("alpha-older"),
    });
    expect(staleTime.accepted).toBe(false);
    expect(staleTime.reason).toBe("stale_time");

    store.recordVerification("alpha", {
      request_id: "req-a",
      attempt: alphaAttempt,
      revision: "rev-1",
      evidence: ["report"],
      report_path: reportPath,
    });
    const regression = store.appendObservation({
      ...done,
      state: "WORKING",
      heartbeat_ts: 3_000_000,
      fingerprint: sha("alpha-regression"),
    });
    expect(regression.accepted).toBe(false);
    expect(regression.reason).toBe("terminal_regression");

    const betaAttempt = startCoordinator(world, store, "beta", "req-b");
    expect(
      store.appendObservation(
        observation("beta", "req-b", betaAttempt, {
          state: "WORKING",
          fingerprint: sha("beta-working"),
        }),
      ).accepted,
    ).toBe(true);
    store.release("beta", {
      request_id: "req-b",
      attempt: betaAttempt,
      stop_evidence: "verified: no owned process remains",
    });
    const betaNext = store.reserve("beta", "req-b2");
    expect(betaNext.status).toBe("reserved");
    if (betaNext.status !== "reserved") throw new Error("unreachable");
    const late = store.appendObservation(
      observation("beta", "req-b", betaAttempt, {
        state: "WORKING",
        fingerprint: sha("beta-late"),
      }),
    );
    expect(late.accepted).toBe(false);
    expect(late.reason).toBe("stale_attempt");
  });

  test("verification requires observed DONE and a report inside the plan", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    const attempt = startCoordinator(world, store, "alpha", "req-a");
    const outsideReport = join(world.base, "report.md");
    writeFileSync(outsideReport, "# Report\nresult: nope\n");
    const reportPath = writeReport(world.planRoot, "alpha");
    writeDoneStatus(world.planRoot, "alpha");

    expectCode(
      () =>
        store.recordVerification("alpha", {
          request_id: "req-a",
          attempt,
          revision: "rev-1",
          evidence: ["report"],
          report_path: outsideReport,
        }),
      "not_ready",
    );

    store.appendObservation(
      observation("alpha", "req-a", attempt, {
        state: "DONE",
        fingerprint: sha("alpha-done"),
      }),
    );
    expectCode(
      () =>
        store.recordVerification("alpha", {
          request_id: "req-a",
          attempt,
          revision: "rev-1",
          evidence: ["report"],
          report_path: outsideReport,
        }),
      "invalid_path",
    );
    expect(
      store.recordVerification("alpha", {
        request_id: "req-a",
        attempt,
        revision: "rev-1",
        evidence: ["report"],
        report_path: reportPath,
      }).report_path,
    ).toBe(reportPath);
  });

  test("fails closed when the ownership ledger disappears after initialization", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    expect(existsSync(store.ledger_path)).toBe(true);
    rmSync(store.ledger_path);
    expectCode(() => store.read(), "invalid_schema");
    const second = storeFor(world, "goal-two");
    expectCode(
      () => second.createGoal(goalSpec([planSpec("alpha")])),
      "invalid_schema",
    );
  });

  test("persists a verified systemd unit identity and requires spawn before ACK", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    const reservation = store.reserve("alpha", "req-1");
    if (reservation.status !== "reserved") throw new Error("unreachable");
    const attempt = reservation.coordinator.attempt;
    store.transition("alpha", {
      request_id: "req-1",
      attempt,
      lifecycle: "LAUNCHING",
    });
    expectCode(
      () =>
        store.acknowledge("alpha", {
          request_id: "req-1",
          attempt,
          runtime: { harness: "opencode", session_id: "ses-1" },
          runtime_version: "2.1.3",
          model: null,
          working_directory: world.worktree,
        }),
      "not_ready",
    );

    const unitName = "work-plans-h2h-abc123.service";
    const unitIdentity = {
      pid: process.pid,
      start_id: "12345",
      unit_name: unitName,
      invocation_id: "a".repeat(32),
      control_group: `/sys/fs/cgroup/user.slice/${unitName}`,
      main_pid: process.pid,
      main_pid_start_id: "12345",
    };
    const spawned = store.recordSpawn("alpha", {
      request_id: "req-1",
      attempt,
      process: unitIdentity,
      working_directory: world.worktree,
    });
    expect(spawned.process?.unit_name).toBe(unitName);
    expect(spawned.process?.control_group).toBe(
      `/sys/fs/cgroup/user.slice/${unitName}`,
    );
    expectCode(
      () =>
        store.recordSpawn("alpha", {
          request_id: "req-1",
          attempt,
          process: { ...unitIdentity, invocation_id: null },
          working_directory: world.worktree,
        }),
      "invalid_schema",
    );
    expectCode(
      () =>
        store.recordSpawn("alpha", {
          request_id: "req-1",
          attempt,
          process: { ...unitIdentity, main_pid: process.pid + 1 },
          working_directory: world.worktree,
        }),
      "invalid_schema",
    );
    const acknowledged = store.acknowledge("alpha", {
      request_id: "req-1",
      attempt,
      runtime: { harness: "opencode", session_id: "ses-1" },
      runtime_version: "2.1.3",
      model: null,
      working_directory: world.worktree,
    });
    expect(acknowledged.process?.unit_name).toBe(unitName);
    expect(acknowledged.artifact_baseline).not.toBeNull();
  });

  test("a durably stopped owner cannot be resurrected by a newer foreign owner", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    startCoordinator(world, store, "alpha", "req-a");

    const ledger = JSON.parse(
      readFileSync(store.ledger_path, "utf8"),
    ) as {
      entries: Array<{
        active: boolean;
        plan_id: string;
        updated_at: number;
        coordinator: {
          lifecycle: string;
          stopped_at: number | null;
          stop_evidence: string | null;
        };
      }>;
    };
    const entry = ledger.entries.find(
      (item) => item.plan_id === "alpha" && item.active,
    );
    if (!entry) throw new Error("active ledger entry missing");
    entry.active = false;
    entry.updated_at = 2;
    entry.coordinator.lifecycle = "STOPPED";
    entry.coordinator.stopped_at = 2;
    entry.coordinator.stop_evidence = "verified stop before crash";
    writeFileSync(store.ledger_path, JSON.stringify(ledger));

    const second = storeFor(world, "goal-two");
    second.createGoal(goalSpec([planSpec("alpha")]));
    const foreign = second.reserve("alpha", "req-foreign");
    expect(foreign.status).toBe("reserved");
    if (foreign.status !== "reserved") throw new Error("unreachable");

    const firstState = store.read();
    expect(firstState.record.plans[0]?.coordinator?.lifecycle).toBe(
      "STOPPED",
    );
    expect(
      firstState.record.plans[0]?.coordinator?.stop_evidence,
    ).toBe("verified stop before crash");
    expect(
      firstState.ownership_conflicts.some(
        (conflict) => conflict.goal_id === "goal-two",
      ),
    ).toBe(true);
    expect(
      second.read().record.plans[0]?.coordinator?.request_id,
    ).toBe("req-foreign");
  });

  test("request outcomes bind to the exact plan and attempt", () => {
    const world = makeWorld(["alpha", "beta"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha"), planSpec("beta")]));
    startCoordinator(world, store, "alpha", "req-a");
    startCoordinator(world, store, "beta", "req-b");

    const first = store.appendRequestOutcome({
      plan_id: "alpha",
      request_id: "shared-req",
      attempt: 1,
      action: "send",
      direction: "to_coordinator",
      outcome: "delivered",
      source: "acp",
    });
    const repeated = store.appendRequestOutcome({
      plan_id: "alpha",
      request_id: "shared-req",
      attempt: 1,
      action: "send",
      direction: "to_coordinator",
      outcome: "delivered",
      source: "acp",
    });
    expect(repeated.seq).toBe(first.seq);
    expectCode(
      () =>
        store.appendRequestOutcome({
          plan_id: "beta",
          request_id: "shared-req",
          attempt: 1,
          action: "send",
          direction: "to_coordinator",
          outcome: "delivered",
          source: "acp",
        }),
      "conflict",
    );
  });

  test("verification requires artifacts fresher than the ACK baseline", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    const bootstrap = startCoordinator(world, store, "alpha", "req-bootstrap");
    store.release("alpha", {
      request_id: "req-bootstrap",
      attempt: bootstrap,
      stop_evidence: "verified: bootstrap stopped",
    });
    const staleStatus = writeDoneStatus(
      world.planRoot,
      "alpha",
      "stale done",
      1_000,
    );
    const staleReportContent = "# stale report\nresult: old\n";
    const reportPath = join(world.planRoot, "alpha", "report.md");
    writeFileSync(reportPath, staleReportContent);
    const attempt = startCoordinator(world, store, "alpha", "req-a");

    writeDoneStatus(world.planRoot, "alpha", "fresh done", 1_001);
    writeFileSync(
      reportPath,
      "# fresh report\nresult: implemented\ntests: pass\n",
    );
    const observed = store.appendObservation(
      observation("alpha", "req-a", attempt, {
        state: "DONE",
        fingerprint: sha("fresh-done"),
      }),
    );
    expect(observed.accepted).toBe(true);

    writeFileSync(staleStatus, "state: DONE\nts: 1000\nmsg: stale done\n");
    writeFileSync(reportPath, staleReportContent);
    expectCode(
      () =>
        store.recordVerification("alpha", {
          request_id: "req-a",
          attempt,
          revision: "rev-1",
          evidence: ["report"],
          report_path: reportPath,
        }),
      "not_ready",
    );
  });

  test("verification rejects a malformed DONE heartbeat independently of observations", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    const attempt = startCoordinator(world, store, "alpha", "req-a");
    writeFileSync(
      join(world.planRoot, "alpha", "status.md"),
      "state: DONE\nts: 1000\nmsg: done\nextra: line\n",
    );
    const reportPath = writeReport(world.planRoot, "alpha");
    expect(
      store.appendObservation(
        observation("alpha", "req-a", attempt, {
          state: "DONE",
          fingerprint: sha("malformed-done"),
        }),
      ).accepted,
    ).toBe(true);
    expectCode(
      () =>
        store.recordVerification("alpha", {
          request_id: "req-a",
          attempt,
          revision: "rev-1",
          evidence: ["report"],
          report_path: reportPath,
        }),
      "not_ready",
    );
  });

  test("reopen refuses unverified legacy plans without touching journal or ledger", () => {
    const world = makeWorld(["working", "waiting", "malformed", "done"]);
    const statuses = new Map<string, string>();
    statuses.set(
      "working",
      writeStatus(world.planRoot, "working", "WORKING", "legacy active"),
    );
    statuses.set(
      "waiting",
      writeStatus(world.planRoot, "waiting", "WAIT", "legacy blocked"),
    );
    const malformed = join(world.planRoot, "malformed", "status.md");
    writeFileSync(
      malformed,
      "state: WORKING\nts: 1000\nmsg: malformed\nextra: line\n",
    );
    statuses.set("malformed", malformed);
    statuses.set(
      "done",
      writeDoneStatus(world.planRoot, "done", "unadopted DONE"),
    );
    const store = storeFor(world);
    store.createGoal(
      goalSpec([
        planSpec("working"),
        planSpec("waiting"),
        planSpec("malformed"),
        planSpec("done"),
      ]),
    );
    const eventsBefore = store.listEvents().length;
    const ledgerBefore = readFileSync(store.ledger_path, "utf8");
    const bytesBefore = new Map(
      [...statuses].map(([planId, path]) => [
        planId,
        readFileSync(path, "utf8"),
      ]),
    );

    for (const planId of statuses.keys()) {
      expectCode(
        () =>
          store.reopenPlan(planId, {
            finding: "unverified legacy reopen",
            evidence: ["manager inspection"],
          }),
        "not_ready",
      );
      expect(store.listEvents().length).toBe(eventsBefore);
      expect(readFileSync(store.ledger_path, "utf8")).toBe(ledgerBefore);
      expect(readFileSync(statuses.get(planId) as string, "utf8")).toBe(
        bytesBefore.get(planId),
      );
    }
    expect(
      store.listEvents().some((event) => event.kind === "plan.reopened"),
    ).toBe(false);
  });

  test("reopen clears verification/completion, preserves proof and invalidates old DONE", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    const attempt = startCoordinator(world, store, "alpha", "req-a");
    const reportPath = writeReport(world.planRoot, "alpha");
    writeDoneStatus(world.planRoot, "alpha");
    store.appendObservation(
      observation("alpha", "req-a", attempt, {
        state: "DONE",
        fingerprint: sha("alpha-done"),
      }),
    );
    store.recordVerification("alpha", {
      request_id: "req-a",
      attempt,
      revision: "rev-1",
      evidence: ["report"],
      report_path: reportPath,
    });

    expectCode(
      () =>
        store.reopenPlan("alpha", {
          finding: "same-plan regression",
          evidence: ["review"],
        }),
      "conflict",
    );
    store.release("alpha", {
      request_id: "req-a",
      attempt,
      stop_evidence: "verified: process stopped",
    });
    store.completeGoal({
      approval_revision: "approval-1",
      evidence: ["goal reviewed"],
    });

    const reopened = store.reopenPlan("alpha", {
      finding: "same-plan regression",
      evidence: ["review evidence"],
    });
    const plan = reopened.record.plans[0];
    expect(plan?.verification).toBeNull();
    expect(reopened.record.completion).toBeNull();
    expect(plan?.coordinator?.attempt).toBe(attempt);
    expect(plan?.coordinator?.lifecycle).toBe("STOPPED");
    expect(plan?.coordinator?.artifact_baseline?.status_sha256).not.toBeNull();
    expect(existsSync(reportPath)).toBe(true);
    const reopenEvent = store
      .listEvents()
      .find((event) => event.kind === "plan.reopened");
    const eventData = reopenEvent?.data as Record<string, unknown>;
    expect(eventData.finding).toBe("same-plan regression");
    expect(eventData.previous_verification).not.toBeNull();
    expect(eventData.previous_completion).not.toBeNull();

    expectCode(
      () =>
        store.recordVerification("alpha", {
          request_id: "req-a",
          attempt,
          revision: "rev-1",
          evidence: ["report"],
          report_path: reportPath,
        }),
      "not_ready",
    );
    const next = store.reserve("alpha", "req-a2");
    expect(next.status).toBe("reserved");
    if (next.status !== "reserved") throw new Error("unreachable");
    expect(next.coordinator.attempt).toBe(attempt + 1);
    const nextAttempt = next.coordinator.attempt;
    store.transition("alpha", {
      request_id: "req-a2",
      attempt: nextAttempt,
      lifecycle: "LAUNCHING",
    });
    store.recordSpawn("alpha", {
      request_id: "req-a2",
      attempt: nextAttempt,
      process: { pid: 5_555, start_id: "post-reopen" },
      working_directory: world.worktree,
    });
    store.acknowledge("alpha", {
      request_id: "req-a2",
      attempt: nextAttempt,
      runtime: { harness: "opencode", session_id: "ses-reopened" },
      runtime_version: "2.1.3",
      model: null,
      working_directory: world.worktree,
    });
    writeDoneStatus(world.planRoot, "alpha", "post-reopen verified", 3_000);
    writeFileSync(
      reportPath,
      "# Report: alpha\nresult: post-reopen fixed\ntests: pass\n",
    );
    expect(
      store.appendObservation(
        observation("alpha", "req-a2", nextAttempt, {
          state: "DONE",
          heartbeat_ts: 3_000_000,
          fingerprint: sha("alpha-post-reopen"),
        }),
      ).accepted,
    ).toBe(true);
    expect(
      store.recordVerification("alpha", {
        request_id: "req-a2",
        attempt: nextAttempt,
        revision: "rev-1",
        evidence: ["report"],
        report_path: reportPath,
      }).attempt,
    ).toBe(nextAttempt);
  });

  test("recompletion after reopen writes a new aggregate report and preserves old bytes", () => {
    const world = makeWorld(["alpha"]);
    const store = storeFor(world);
    store.createGoal(goalSpec([planSpec("alpha")]));
    const firstAttempt = startCoordinator(world, store, "alpha", "req-a");
    const childReport = writeReport(world.planRoot, "alpha");
    writeDoneStatus(world.planRoot, "alpha");
    store.appendObservation(
      observation("alpha", "req-a", firstAttempt, {
        state: "DONE",
        heartbeat_ts: 2_000_000,
        fingerprint: sha("alpha-first-done"),
      }),
    );
    store.recordVerification("alpha", {
      request_id: "req-a",
      attempt: firstAttempt,
      revision: "rev-1",
      evidence: ["report"],
      report_path: childReport,
    });
    store.release("alpha", {
      request_id: "req-a",
      attempt: firstAttempt,
      stop_evidence: "verified: process stopped",
    });
    const first = store.completeGoal({
      approval_revision: "approval-1",
      evidence: ["first goal review"],
    });
    const oldBytes = readFileSync(first.report_path, "utf8");
    const oldPath = first.report_path;

    store.reopenPlan("alpha", {
      finding: "post-completion regression",
      evidence: ["manager review"],
    });
    const secondAttempt = startCoordinator(world, store, "alpha", "req-a2");
    writeDoneStatus(world.planRoot, "alpha", "second completion", 3_000);
    writeReport(world.planRoot, "alpha", "revision: second pass\n");
    store.appendObservation(
      observation("alpha", "req-a2", secondAttempt, {
        state: "DONE",
        heartbeat_ts: 3_000_000,
        fingerprint: sha("alpha-second-done"),
      }),
    );
    store.recordVerification("alpha", {
      request_id: "req-a2",
      attempt: secondAttempt,
      revision: "rev-1",
      evidence: ["report"],
      report_path: childReport,
    });
    store.release("alpha", {
      request_id: "req-a2",
      attempt: secondAttempt,
      stop_evidence: "verified: second process stopped",
    });
    const second = store.completeGoal({
      approval_revision: "approval-1",
      evidence: ["second goal review"],
    });
    expect(second.report_path).not.toBe(oldPath);
    expect(existsSync(second.report_path)).toBe(true);
    expect(readFileSync(oldPath, "utf8")).toBe(oldBytes);
    expect(
      store
        .listEvents()
        .filter((event) => event.kind === "goal.completed"),
    ).toHaveLength(2);

    const eventsBefore = store.listEvents().length;
    const repeated = store.completeGoal({
      approval_revision: "approval-1",
      evidence: ["second goal review"],
    });
    expect(repeated.report_path).toBe(second.report_path);
    expect(store.listEvents().length).toBe(eventsBefore);
  });

  test("reopen refuses while a verified dependent would consume invalidated evidence", () => {
    const world = makeWorld(["alpha", "beta"]);
    const store = storeFor(world);
    store.createGoal(
      goalSpec([
        planSpec("alpha"),
        planSpec("beta", {
          predecessors: [
            { plan_id: "alpha", required_evidence: ["report"] },
          ],
        }),
      ]),
    );
    const alphaAttempt = startCoordinator(world, store, "alpha", "req-a");
    const alphaReport = writeReport(world.planRoot, "alpha");
    writeDoneStatus(world.planRoot, "alpha");
    store.appendObservation(
      observation("alpha", "req-a", alphaAttempt, {
        state: "DONE",
        fingerprint: sha("alpha-done"),
      }),
    );
    store.recordVerification("alpha", {
      request_id: "req-a",
      attempt: alphaAttempt,
      revision: "rev-1",
      evidence: ["report"],
      report_path: alphaReport,
    });
    store.release("alpha", {
      request_id: "req-a",
      attempt: alphaAttempt,
      stop_evidence: "verified: process stopped",
    });

    const betaAttempt = startCoordinator(world, store, "beta", "req-b");
    const betaReport = writeReport(world.planRoot, "beta");
    writeDoneStatus(world.planRoot, "beta");
    store.appendObservation(
      observation("beta", "req-b", betaAttempt, {
        state: "DONE",
        fingerprint: sha("beta-done"),
      }),
    );
    store.recordVerification("beta", {
      request_id: "req-b",
      attempt: betaAttempt,
      revision: "rev-1",
      evidence: ["report"],
      report_path: betaReport,
    });
    store.release("beta", {
      request_id: "req-b",
      attempt: betaAttempt,
      stop_evidence: "verified: process stopped",
    });

    expectCode(
      () =>
        store.reopenPlan("alpha", {
          finding: "alpha finding",
          evidence: ["review"],
        }),
      "conflict",
    );
    const betaReopen = store.reopenPlan("beta", {
      finding: "beta finding",
      evidence: ["review"],
    });
    expect(
      betaReopen.record.plans.find((plan) => plan.plan_id === "beta")
        ?.verification,
    ).toBeNull();
    const alphaReopen = store.reopenPlan("alpha", {
      finding: "alpha finding",
      evidence: ["review"],
    });
    expect(
      alphaReopen.record.plans.find((plan) => plan.plan_id === "alpha")
        ?.verification,
    ).toBeNull();
  });
});
