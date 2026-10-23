import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CoordinatorStateError,
  CoordinatorStore,
  type GoalPlanSpec,
  type GoalSpec,
  type ManagerIdentity,
  type PlanHeartbeatState,
  type RuntimeProfile,
} from "./coordinator-state";
import {
  CoordinatorProgress,
  parseHeartbeat,
} from "./progress";

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

interface Clock {
  value: number;
}

function makeWorld(planIds: string[]): World {
  const base = mkdtempSync(join(tmpdir(), "goal-progress-"));
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

function planSpec(planId: string, overrides: Partial<GoalPlanSpec> = {}): GoalPlanSpec {
  return {
    plan_id: planId,
    approved_revision: "rev-1",
    acceptance: [`${planId} acceptance`],
    scope: { in: ["in scope"], out: ["out of scope"] },
    runtime: { harness: "opencode", runtime_version: null, model: null } as RuntimeProfile,
    predecessors: [],
    resources: [],
    conflicts: [],
    lifecycle_permissions: ["launch", "stop"],
    ...overrides,
  };
}

function goalSpec(plans: GoalPlanSpec[]): GoalSpec {
  return {
    goal: "ship the command center",
    acceptance: ["goal acceptance"],
    approval_revision: "approval-1",
    max_running_coordinators: 2,
    plans,
  };
}

interface Setup {
  world: World;
  store: CoordinatorStore;
  progress: CoordinatorProgress;
  clock: Clock;
}

function setup(planIds: string[] = ["alpha"]): Setup {
  const clock: Clock = { value: 1_000_000 };
  const world = makeWorld(planIds);
  const store = new CoordinatorStore({
    repo_root: world.repo,
    plan_root: world.planRoot,
    goal_id: "goal-one",
    manager: world.manager,
    now: () => clock.value,
  });
  store.createGoal(goalSpec(planIds.map((planId) => planSpec(planId))));
  const progress = new CoordinatorProgress({
    store,
    now: () => clock.value,
  });
  return { world, store, progress, clock };
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

function writeHeartbeat(
  planRoot: string,
  planId: string,
  state: PlanHeartbeatState,
  message: string,
  tsSeconds = 1_000,
): string {
  const path = join(planRoot, planId, "status.md");
  writeFileSync(path, `state: ${state}\nts: ${tsSeconds}\nmsg: ${message}\n`);
  return path;
}

function writePlanDocument(
  planRoot: string,
  planId: string,
  options: { wave?: string; next?: string } = {},
): string {
  const wave = options.wave ?? "W1i1";
  const next = options.next ?? "finish the plan";
  const path = join(planRoot, planId, "plan.md");
  writeFileSync(
    path,
    `# Plan: ${planId}\ncreated: 2026-10-22\niter: ${wave}\nnext_action: ${next}\n\n## Acceptance\n- plan acceptance — verify: bun test\n\n## Steps\n### W1: work\n- [ ] ${next}\n`,
  );
  return path;
}

function writeLanes(
  planRoot: string,
  planId: string,
  lanes: Record<string, [PlanHeartbeatState, string, number]>,
): void {
  const directory = join(planRoot, planId, "lanes");
  mkdirSync(directory, { recursive: true });
  for (const [name, [state, message, ts]] of Object.entries(lanes)) {
    writeFileSync(
      join(directory, `${name}.md`),
      `state: ${state}\nts: ${ts}\nmsg: ${message}\n`,
    );
  }
}

function writeReportFile(
  planRoot: string,
  planId: string,
  content = "# Report\nresult: implemented\ntests: pass\n",
): string {
  const path = join(planRoot, planId, "report.md");
  writeFileSync(path, content);
  return path;
}

async function asyncCodeOf(
  operation: () => Promise<unknown>,
): Promise<string | null> {
  try {
    await operation();
    return null;
  } catch (error) {
    if (error instanceof CoordinatorStateError) return error.code;
    throw error;
  }
}

describe("progress parsing", () => {
  test("preserves valid heartbeat fields and rejects extra records", () => {
    const heartbeat = parseHeartbeat(
      "state: WAIT\nts: 1000\nmsg: blocked on approval\n",
    );
    expect(heartbeat.state).toBe("WAIT");
    expect(heartbeat.ts).toBe(1_000_000);
    expect(heartbeat.msg).toBe("blocked on approval");
    expect(heartbeat.valid).toBe(true);
    expect(heartbeat.line_count).toBe(3);

    const invalid = parseHeartbeat(
      "state: WORKING\nts: 1000\nmsg: one\nextra: line\n",
    );
    expect(invalid.valid).toBe(false);
    expect(parseHeartbeat(null).state).toBeNull();

  });
});

describe("CoordinatorProgress observation", () => {
  test("projects bound plan/status/lane state without writing child artifacts", async () => {
    const { world, store, progress } = setup();
    const attempt = startCoordinator(world, store, "alpha", "req-1");
    const statusPath = writeHeartbeat(
      world.planRoot,
      "alpha",
      "WORKING",
      "W1i1 working alpha",
    );
    writePlanDocument(world.planRoot, "alpha", {
      wave: "W1i1",
      next: "finish alpha",
    });
    writeLanes(world.planRoot, "alpha", {
      "lane-a": ["WORKING", "lane a green", 1_001],
      "lane-b": ["DONE", "lane b merged", 1_002],
    });
    const statusBefore = readFileSync(statusPath, "utf8");

    const snapshot = await progress.refresh("alpha");
    expect(snapshot.plan_id).toBe("alpha");
    expect(snapshot.binding.attempt).toBe(attempt);
    expect(snapshot.binding.runtime?.session_id).toBe("ses-req-1");
    expect(snapshot.observed.state).toBe("WORKING");
    expect(snapshot.observed.wave).toBe("W1i1");
    expect(snapshot.observed.next_action).toBe("finish alpha");
    expect(snapshot.observed.heartbeat_valid).toBe(true);
    expect(snapshot.observed.lanes?.map((lane) => lane.name)).toEqual([
      "lane-a",
      "lane-b",
    ]);
    expect(snapshot.observed.lanes?.[1]?.state).toBe("DONE");
    expect(snapshot.observation.applied).toBe(true);
    expect(snapshot.observation.reason).toBe("accepted");
    expect(snapshot.freshness.status).toBe("fresh");
    expect(readFileSync(statusPath, "utf8")).toBe(statusBefore);

    const state = store.read();
    expect(state.record.plans[0]?.last_observation?.state).toBe("WORKING");
    expect(
      store.listEvents().filter((event) => event.kind === "plan.observation"),
    ).toHaveLength(1);
  });

  test("reports only the declared next action, not an unchecked future task", async () => {
    const { world, store, progress } = setup();
    startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(world.planRoot, "alpha", "WORKING", "reviewing the contract");
    const path = join(world.planRoot, "alpha", "plan.md");
    writeFileSync(path, "# Plan: alpha\niter: W2i3\nnext_action: verify the approved contract\n\n## Steps\n- [ ] blocked deployment\n");
    const declared = await progress.refresh("alpha");
    expect(declared.observed.wave).toBe("W2i3");
    expect(declared.observed.next_action).toBe("verify the approved contract");

    writeFileSync(path, "# Plan: alpha\niter: W2i3\nnext_action:\n\n## Steps\n- [ ] blocked deployment\n\n```text\nnext_action: unapproved future example\n```\n");
    const unknown = await progress.refresh("alpha", { force: true });
    expect(unknown.observed.next_action).toBeNull();
  });

  test("lane and status timestamp-only updates do not journal semantic progress", async () => {
    const { world, store, progress, clock } = setup();
    startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(
      world.planRoot,
      "alpha",
      "WORKING",
      "W1i1 working alpha",
      1_000,
    );
    writePlanDocument(world.planRoot, "alpha");
    writeLanes(world.planRoot, "alpha", {
      "lane-a": ["WORKING", "lane a green", 1_001],
    });
    const first = await progress.refresh("alpha");
    expect(first.observation.applied).toBe(true);
    const meaningful = first.freshness.meaningful_progress_at;
    expect(meaningful).not.toBeNull();
    const seqBefore = store.read().journal.last_seq;

    writeHeartbeat(
      world.planRoot,
      "alpha",
      "WORKING",
      "W1i1 working alpha",
      2_000,
    );
    writeLanes(world.planRoot, "alpha", {
      "lane-a": ["WORKING", "lane a green", 3_000],
    });
    clock.value += 5_000;
    const timestampOnly = await progress.refresh("alpha", { force: true });
    expect(timestampOnly.observation.applied).toBe(false);
    expect(timestampOnly.observation.reason).toBe("duplicate");
    expect(timestampOnly.freshness.meaningful_progress_at).toBe(meaningful);
    expect(store.read().journal.last_seq).toBe(seqBefore);
    expect(
      store.read().record.plans[0]?.last_observation
        ?.meaningful_progress_at,
    ).toBe(meaningful);
    expect(timestampOnly.observed.lanes?.[0]?.updated_at).toBe(3_000_000);
  });

  test("coalesces unchanged snapshots, throttles automatic reads, and forces status reads", async () => {
    const { world, store, progress, clock } = setup();
    startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(world.planRoot, "alpha", "WORKING", "W1i1 working alpha");
    writePlanDocument(world.planRoot, "alpha");

    const first = await progress.refresh("alpha");
    expect(first.observation.reason).toBe("accepted");
    const afterFirst = store.read().journal.last_seq;

    const duplicate = await progress.refresh("alpha", { force: true });
    expect(duplicate.observation.reason).toBe("duplicate");
    expect(duplicate.observation.applied).toBe(false);
    expect(store.read().journal.last_seq).toBe(afterFirst);

    writeHeartbeat(world.planRoot, "alpha", "WAIT", "blocked on approval");
    clock.value += 1_000;
    const throttled = await progress.refresh("alpha");
    expect(throttled.observed.state).toBe("WORKING");
    expect(throttled.observed.blocker).toBeNull();

    const forced = await progress.refresh("alpha", { force: true });
    expect(forced.observed.state).toBe("WAIT");
    expect(forced.observed.blocker?.text).toBe("blocked on approval");
    expect(forced.observation.applied).toBe(true);
  });

  test("marks unsafe or missing artifacts unknown and journals nothing", async () => {
    const { world, store, progress } = setup(["alpha", "beta"]);
    startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(world.planRoot, "alpha", "WORKING", "working alpha");
    writePlanDocument(world.planRoot, "alpha");
    await progress.refresh("alpha");
    const afterGood = store.read().journal.last_seq;

    const outside = join(world.base, "outside-status.txt");
    writeFileSync(outside, "state: DONE\nts: 1\nmsg: forged\n");
    const statusPath = join(world.planRoot, "alpha", "status.md");
    rmSync(statusPath);
    symlinkSync(outside, statusPath, "file");
    const unsafe = await progress.refresh("alpha", { force: true });
    expect(unsafe.observation.inconsistent).toBe(true);
    expect(unsafe.observation.applied).toBe(false);
    expect(unsafe.observed.state).toBeNull();
    expect(unsafe.observation.reason).toContain("regular file");
    expect(store.read().journal.last_seq).toBe(afterGood);

    startCoordinator(world, store, "beta", "req-b");
    const empty = await progress.refresh("beta", { force: true });
    expect(empty.observed.state).toBeNull();
    expect(empty.observation.applied).toBe(false);
    expect(empty.observation.reason).toBe("no_artifacts");
    expect(
      store.listEvents().filter(
        (event) => event.kind === "plan.observation" && event.plan_id === "beta",
      ),
    ).toHaveLength(0);

    rmSync(join(world.planRoot, "beta"), { recursive: true, force: true });
    const missing = await progress.refresh("beta", { force: true });
    expect(missing.observed.state).toBeNull();
    expect(missing.observation.reason).toBe("plan_missing");
  });

  test("labels observation gaps without inventing events", async () => {
    const { world, store, progress, clock } = setup();
    startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(world.planRoot, "alpha", "WORKING", "working alpha");
    writePlanDocument(world.planRoot, "alpha");
    await progress.refresh("alpha");

    clock.value += 60_000;
    const afterGap = await progress.refresh("alpha", { force: true });
    expect(afterGap.activity_gap).not.toBeNull();
    expect(afterGap.activity_gap?.since).toBe(1_000_000);
    expect(afterGap.activity_gap?.until).toBe(clock.value);
    expect(afterGap.observation.reason).toBe("duplicate");
    expect(afterGap.observed.state).toBe("WORKING");
  });

  test("runtime activity updates freshness only and respects the active binding", async () => {
    const { world, store, progress, clock } = setup();
    const attempt = startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(world.planRoot, "alpha", "WORKING", "working alpha");
    writePlanDocument(world.planRoot, "alpha");
    const snapshot = await progress.refresh("alpha");
    const eventsBefore = store.listEvents().length;
    const meaningfulBefore = snapshot.freshness.meaningful_progress_at;

    expect(
      progress.noteRuntimeActivity("alpha", {
        request_id: "req-1",
        attempt,
      }),
    ).toBe(true);
    const noted = progress.snapshot("alpha");
    expect(noted.freshness.runtime_event_at).toBe(clock.value);
    expect(noted.freshness.meaningful_progress_at).toBe(meaningfulBefore);
    expect(store.listEvents().length).toBe(eventsBefore);

    expect(
      progress.noteRuntimeActivity("alpha", {
        request_id: "req-1",
        attempt: attempt + 1,
      }),
    ).toBe(false);
    expect(
      progress.noteRuntimeActivity("alpha", {
        request_id: "req-other",
        attempt,
      }),
    ).toBe(false);
  });

  test("redacts credential-looking values before journaling", async () => {
    const { world, store, progress } = setup();
    startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(
      world.planRoot,
      "alpha",
      "WAIT",
      "blocked token=abc123secret",
    );
    writePlanDocument(world.planRoot, "alpha");
    const snapshot = await progress.refresh("alpha");
    expect(snapshot.observed.blocker?.text).toContain("[redacted]");
    expect(snapshot.observed.blocker?.text).not.toContain("abc123secret");
    expect(readFileSync(store.events_path, "utf8")).not.toContain(
      "abc123secret",
    );
  });

  test("binds observations to the current attempt and rejects old attempts", async () => {
    const { world, store, progress } = setup();
    const firstAttempt = startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(world.planRoot, "alpha", "WORKING", "working alpha");
    writePlanDocument(world.planRoot, "alpha");
    await progress.refresh("alpha");

    store.release("alpha", {
      request_id: "req-1",
      attempt: firstAttempt,
      stop_evidence: "verified: owned process stopped",
    });
    const secondAttempt = startCoordinator(world, store, "alpha", "req-2");
    expect(secondAttempt).toBe(firstAttempt + 1);
    writeHeartbeat(world.planRoot, "alpha", "WORKING", "working alpha again");
    const rebound = await progress.refresh("alpha", { force: true });
    expect(rebound.binding.attempt).toBe(secondAttempt);
    expect(rebound.observation.applied).toBe(true);

    const oldObservation = store.appendObservation({
      plan_id: "alpha",
      request_id: "req-1",
      attempt: firstAttempt,
      state: "WORKING",
      wave: null,
      lanes: null,
      blocker: null,
      next_action: null,
      evidence_report: null,
      heartbeat_ts: 1_000_000,
      meaningful_progress_at: 1_000_000,
      observed_at: 1_000_000,
      source: "status.md",
      fingerprint: "a".repeat(64),
    });
    expect(oldObservation.accepted).toBe(false);
    expect(oldObservation.reason).toBe("stale_attempt");
  });

  test("does not accept pre-ACK DONE artifacts as current-attempt progress", async () => {
    const { world, store, progress } = setup();
    const bootstrap = startCoordinator(
      world,
      store,
      "alpha",
      "req-bootstrap",
    );
    store.release("alpha", {
      request_id: "req-bootstrap",
      attempt: bootstrap,
      stop_evidence: "verified: bootstrap stopped",
    });
    writeHeartbeat(world.planRoot, "alpha", "DONE", "old completion", 1_000);
    writeReportFile(world.planRoot, "alpha", "# old report\nresult: old\n");
    startCoordinator(world, store, "alpha", "req-1");
    const eventsBefore = store.listEvents().length;

    const unproven = await progress.refresh("alpha");
    expect(unproven.observation.inconsistent).toBe(true);
    expect(unproven.observation.reason).toBe("unproven_done");
    expect(unproven.observed.state).toBeNull();
    expect(store.listEvents().length).toBe(eventsBefore);

    writeHeartbeat(world.planRoot, "alpha", "DONE", "fresh completion", 1_001);
    writeReportFile(
      world.planRoot,
      "alpha",
      "# fresh report\nresult: implemented\ntests: pass\n",
    );
    const proven = await progress.refresh("alpha", { force: true });
    expect(proven.observed.state).toBe("DONE");
    expect(proven.observation.applied).toBe(true);
  });

  test("malformed status or lane heartbeats are unknown and not journaled", async () => {
    const { world, store, progress } = setup(["alpha", "beta"]);
    startCoordinator(world, store, "alpha", "req-1");
    writeFileSync(
      join(world.planRoot, "alpha", "status.md"),
      "state: DONE\nts: 1000\nmsg: done\nextra: line\n",
    );
    writeReportFile(world.planRoot, "alpha");
    const alphaEvents = store.listEvents().length;
    const malformedStatus = await progress.refresh("alpha");
    expect(malformedStatus.observation.inconsistent).toBe(true);
    expect(malformedStatus.observation.reason).toBe("invalid_heartbeat");
    expect(malformedStatus.observed.state).toBeNull();
    expect(store.listEvents().length).toBe(alphaEvents);

    startCoordinator(world, store, "beta", "req-b");
    writeHeartbeat(world.planRoot, "beta", "WORKING", "working beta");
    const lanes = join(world.planRoot, "beta", "lanes");
    mkdirSync(lanes, { recursive: true });
    writeFileSync(join(lanes, "bad.md"), "state: DONE\n");
    const betaEvents = store.listEvents().length;
    const malformedLane = await progress.refresh("beta");
    expect(malformedLane.observation.inconsistent).toBe(true);
    expect(malformedLane.observed.state).toBeNull();
    expect(malformedLane.observation.reason).toContain("heartbeat");
    expect(store.listEvents().length).toBe(betaEvents);
  });

  test("invalidates cached snapshots on coordinator lifecycle changes", async () => {
    const { world, store, progress } = setup();
    const attempt = startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(world.planRoot, "alpha", "WORKING", "working alpha");
    writePlanDocument(world.planRoot, "alpha");
    await progress.refresh("alpha");

    store.transition("alpha", {
      request_id: "req-1",
      attempt,
      lifecycle: "RECONCILING",
    });
    const cached = progress.snapshot("alpha");
    expect(cached.binding.lifecycle).toBe("RECONCILING");
    const refreshed = await progress.refresh("alpha");
    expect(refreshed.binding.lifecycle).toBe("RECONCILING");
    expect(refreshed.observed.state).toBe("WORKING");
  });

  test("timestamp-only heartbeat refresh keeps prior meaningful progress", async () => {
    const { world, store, progress, clock } = setup();
    startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(world.planRoot, "alpha", "WORKING", "working alpha", 1_000);
    writePlanDocument(world.planRoot, "alpha");
    const first = await progress.refresh("alpha");
    const firstMeaningful = first.freshness.meaningful_progress_at;
    expect(firstMeaningful).toBe(1_000_000);

    writeHeartbeat(world.planRoot, "alpha", "WORKING", "working alpha", 1_001);
    clock.value += 5_000;
    const duplicate = await progress.refresh("alpha", { force: true });
    expect(duplicate.observation.reason).toBe("duplicate");
    expect(duplicate.observed.heartbeat_ts).toBe(1_001_000);
    expect(duplicate.freshness.meaningful_progress_at).toBe(
      firstMeaningful,
    );
  });

  test("rebuilds the projection from the journal after a torn append", async () => {
    const { world, store, clock } = setup();
    startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(world.planRoot, "alpha", "WORKING", "working alpha");
    writePlanDocument(world.planRoot, "alpha");
    const progress = new CoordinatorProgress({
      store,
      now: () => clock.value,
    });
    await progress.refresh("alpha");
    appendFileSync(store.events_path, '{"schema_version":1,"seq":');

    const recoveredProgress = new CoordinatorProgress({
      store,
      now: () => clock.value,
    });
    const recovery = await recoveredProgress.recover();
    expect(recovery.repaired_tail_bytes).toBeGreaterThan(0);
    expect(recovery.snapshots).toHaveLength(1);
    expect(recovery.snapshots[0]?.observed.state).toBe("WORKING");
    expect(store.read().journal.pending).toBe(0);
  });

  test("recovery rejects interior journal corruption", async () => {
    const { world, store, clock } = setup();
    startCoordinator(world, store, "alpha", "req-1");
    writeHeartbeat(world.planRoot, "alpha", "WORKING", "working alpha");
    writePlanDocument(world.planRoot, "alpha");
    const progress = new CoordinatorProgress({
      store,
      now: () => clock.value,
    });
    await progress.refresh("alpha");
    appendFileSync(
      store.events_path,
      `${JSON.stringify({
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
      })}\n`,
    );
    expect(await asyncCodeOf(() => progress.recover())).toBe(
      "journal_corruption",
    );
  });
});
