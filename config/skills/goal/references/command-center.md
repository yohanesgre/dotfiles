# Command center: H2H contract

Use this reference only for explicitly approved multi-plan `/goal` execution.
The center is the active session; each executing plan has one separate
coordinator harness. A coordinator uses its own native subagents for lanes.
Ordinary work-plans remains standalone. One-plan `/goal` normally hands off
inline without another harness.

## Boundary and installation

Both OMP and OpenCode expose the native `h2h_control` tool. Pass one object:

```json
{"request":{"action":"status","goal_id":"checkout"}}
```

OpenCode may expose custom tools through Code Mode; use its actual discovered
tool namespace, not invented MCP or shell syntax. The two host bindings load
the same `goal/runtime/command-center.ts`. ACP v1 is the shared wire protocol,
not the orchestration policy. OMP→OMP, OMP→OpenCode, OpenCode→OMP and
OpenCode→OpenCode use the same core.

OMP interactive/RPC intake routes `/goal` and `/goal <objective>` to the goal
skill. Explicit `set`, `show`, `pause`, `resume`, `drop` and `budget` subcommands
retain native OMP goal-mode behavior; that mode is separate from this workflow.
OMP ACP does not emit input hooks: an ACP-driven center must load the goal
skill explicitly. This does not affect its native `h2h_control` tool.

The runtime requires Bun, Git, Bash, flock, Linux process identity/cgroup
facilities and a running user-systemd manager for managed lifecycle containment.
Install the committed pinned dependencies with `bun install --frozen-lockfile
--ignore-scripts` in `config/skills/goal/runtime`. Home Manager performs this
installation before using the deployed shared runtime. It does not activate
an uncommitted worktree automatically.

Dependency activation fails if its manifest, lockfile or entrypoint is absent,
or the effective installed runtime resolves somewhere other than the intended
canonical checkout. Preserved real skill directories are never overwritten.

`WORK_PLANS_H2H_RUNTIME` is an operator-controlled runtime-directory override
for isolated testing or approved activation, never an LLM request field.
Otherwise bindings use `~/.agents/skills/goal/runtime`. Managed child launches
set `WORK_PLANS_H2H_ROLE=coordinator`; that role cannot invoke center operations.
Managed OMP coordinators also withhold the external `opencode_peer` helper;
ordinary sessions retain it. Lanes still require discovered native subagents.
This capability guard is not an OS execution or filesystem sandbox.

## Before creating a goal

1. Use design-thinking to bound outcomes, dependencies and acceptance.
2. Prepare external work-plans artifacts for every plan. A status query never
   creates tracking state. Do not duplicate child task lists in the center.
3. Freeze the approved scope/revision, harness/profile and any model pin for
   each plan. Prepare its exact worktree through the existing git/setup rules;
   branch/worktree creation needs explicit named approval. H2H start does not
   create branches or silently substitute the control checkout.
4. Obtain actual user approval for the execution envelope. An approval-revision
   string supplied by a model is not independent proof of human approval.
   `/goal` and the host's permission policy still govern the gate.
5. Include explicit `launch` and `stop` lifecycle permissions for managed
   execution. Start requires both so startup cleanup is authorized. This does
   not authorize commit, publish, PR, merge, deployment or destructive cleanup.

## Request shape

Every request has `action` and safe-basename `goal_id`. Plan actions also
identify `plan_id`. `start`, `send`, `permission`, `cancel` and `stop` require
an explicit `request_id` stable across retries of the same operation.
Optional arguments belong in `payload`; unknown fields are rejected.

Request IDs are application correlation keys, not native session IDs. Reusing
one for different input is an error. A recorded unknown outcome is not a
license to resend potentially executed work with another ID.

| Action | Payload | Effect |
|---|---|---|
| `create_goal` | `spec` | Persist approved plan graph; no launch |
| `revise_goal` | `spec` with new `approval_revision` | Explicit graph revision; preserve unaffected outcomes; reject changes to active/unknown owners |
| `start` | Empty | Reserve, launch and obtain exact no-work ACK; execution has not started |
| `send` | `message`, optional `timeout_ms` | Deliver one bounded instruction to the bound coordinator asynchronously |
| `status` | Optional `review_permissions: true` | Read progress/readiness, lifecycle, actual runtime and pending approvals |
| `wait` | Optional `timeout_ms` | Wait for a meaningful observed change, pending permission or deadline; no model polling |
| `permission` | `permission_id`, either `deny: true` or `option_id`; allowing also needs `review_digest` | Respond to one actual pending native request |
| `cancel` | Empty | Cancel parent turn; children may continue and ownership stays reserved |
| `stop` | Optional `timeout_ms` | Graceful owned-runtime shutdown; release only after verified quiescence |
| `reconcile` | Empty | Inspect recorded ownership; release only after exact owned-unit/cgroup quiescence is proven; never live-reattach or respawn |
| `verify` | `revision`, `evidence`, `report_path` | Explicit manager attestation after acceptance checks; not automatic from DONE |
| `reopen_plan` | `finding`, `evidence` | Explicitly reopen a verified, stopped/released outcome in the same plan; preserve history and counters |
| `complete_goal` | `approval_revision`, `evidence` | Accept overall goal only after all required child outcomes verified/released |

`send` returns an accepted request, not a completed plan. Its eventual provider
turn result appears in status. Conflicting work is not interleaved; busy,
interrupted or reconciling coordinators must be reconciled/stopped rather
than blindly retried. `wait` defaults to 120 seconds and accepts 0–600000 ms.
`send` defaults to one hour and accepts 1000–86400000 ms; timeout is uncertain,
not proof work stopped. Stop defaults to 120000 ms and accepts 1–600000 ms.
Caller cancellation of status/wait does not cancel plan work.

## Goal specification

`payload.spec` contains:

- `goal`: original goal text; `acceptance`: frozen overall criteria.
- `approval_revision`: unique approved graph revision.
- `max_running_coordinators`: approved concurrent coordinator limit.
- `plans`: the required outcome plans below.

Each plan contains:

- `plan_id`, `approved_revision`, `scope: {in: string[], out: string[]}`,
  `acceptance: string[]`.
- `runtime: {harness: "omp"|"opencode", runtime_version: string|null,
  model: string|null, effort?: string|null}`. Profiles pin OMP 18.13.3 and
  OpenCode 2.2.0. Null/omitted selections retain native defaults. Explicit
  model/effort values must be advertised ACP choices: startup applies them
  to that new session through `session/set_config_option` and verifies exact
  readback before ACK. Model is the native opaque ID; put reasoning effort
  in its separate field, not a CLI `#high` suffix. Actual values are recorded;
  unsupported, unknown or mismatched settings fail closed without substitution.
  No account or global configuration is changed.
- `worktree`: exact prepared absolute path; optional `branch`: approved
  branch name. The worktree must belong to this repository.
- `lifecycle_permissions`: explicitly approved `launch`/`stop` actions.
- Optional `predecessors: [{plan_id, required_evidence: string[]}]`,
  `resources: string[]`, `conflicts: string[]`.
- Optional explicit completed-outcome adoption:
  `adoption: {state: "DONE", evidence: string[], report_path: string}`.
  Inspect the original report/acceptance before adoption; it is not a claim
  that an unknown live coordinator is safe to replace.

Untracked existing WORKING, WAIT, terminal or malformed heartbeats do not grant
launch ownership. Verify and stop any legacy owner before explicitly restoring
a fresh PLAN state, or adopt its inspected completed outcome. Reopening requires
an actual verified outcome; it cannot bypass unknown legacy ownership.

Shared resource/conflict tokens serialize work across goals in this repository.
A branch/worktree does not isolate a shared migration, lockfile or service.
A dependency is ready only after explicit verification of its required current
revision/evidence. A parked or failed outcome does not satisfy it.

## Progress and permission review

Track three independent dimensions:

- **Coordinator lifecycle:** QUEUED, LAUNCHING, RUNNING, RECONCILING, STOPPED.
- **Plan state:** existing PLAN, WAIT, WORKING, DONE, FAILED heartbeat enum.
- **Observation freshness:** last runtime event, artifact read and meaningful
  progress. Unknown is not fresh; activity is not completed work.

The read-only observer coalesces active-plan artifact refreshes at five-second
intervals. It reads the coordinator's `plan.md`, `status.md`, lane heartbeats
and report. It never injects a prompt per poll or writes a child's tracking.
Only explicit semantic wave/next-action/blocker/evidence data is projected;
unknown fields stay unknown. Do not calculate fictitious percent completion.
The coordinator maintains `iter: W<n>i<m>` and `next_action: ...` in the plan
header before its body. Blank/missing next action stays unknown; unchecked
tasks and example text are not interpreted as the current approved action.

The center-owned event journal contains significant observations and request
outcomes, not token streams or full transcripts. Local sequence numbers are
not ACP replay cursors. After a gap, re-read artifacts and reconcile actual
identity; do not manufacture missed activity or completion.

For pending permissions, request status with `review_permissions: true` to
inspect the original native locations/input and receive its `review_digest`.
Review only operations covered by the approved scope. Select the actual
native option whose kind is `allow_once` and return that digest when allowing;
deny anything outside scope or needing additional approval. Never guess option IDs or
implicitly choose `allow_always`. Review output can be recorded by the host's
own transcript policy; it is not written into the center's durable journal.
Do not put credentials into tool arguments or review output.

Callbacks govern only the requests the native harness emits. Inherited
OpenCode `permission: allow` can bypass callbacks; OMP ordinary write/edit are
not universally gated by ACP. Configured MCPs may load even with an empty ACP
MCP array. These are explicit native-policy limits, not a filesystem sandbox.

## Ownership, recovery and stopping

State lives beside, not inside, the active plan root:

```text
<parent-of-PLAN_ROOT>/.goals/<repo-id>/
  ownership.json
  .lock
  <goal-id>/goal.json
  <goal-id>/events.jsonl
  <goal-id>/report-<revision-hash>.md
```

The manager is bound to its real harness/session identity. Another session
may inspect status but cannot mutate or take over its goal. After verified
ACK, only the child coordinator writes its plan runtime artifacts. Requests
and findings go through H2H, not cross-plan file edits.

Persist intent before launch and real process/unit/session identity when
observed. A lost ACK or manager crash leaves ownership reserved. Do not use
`--continue`, latest-session guesses or loading stored history to adopt a live
coordinator. OMP can fork a live-loaded history and emit a different session
ID; identity drift is an error, not a new owner.

After a manager restart, only the same actual native manager session may
reconcile its registry. Missing local ACP handles remain unknown; history load
does not reattach a live coordinator. `reconcile` can safely release a recorded
owner only when its exact unit invocation and cgroup are proven quiescent and
stop is authorized. A new attempt still requires an explicit `start`.

Managed Linux execution uses a uniquely owned transient user-systemd unit and
kernel cgroup. This addresses late forks that a process-tree snapshot misses;
it is lifecycle containment, not an OS security sandbox. Deliberate migration
or execution through an external service is not implicitly authorized. No
unmanaged fallback is allowed when the lifecycle prerequisite is unavailable.

Cancel affects the current parent turn and may leave native children active.
Graceful stop and actual unit/cgroup quiescence are different from an ended
turn or closed ACP session. Hung/unreadable/unknown work retains ownership
and resources as RECONCILING. No broad process-name killing, forced SIGKILL,
automatic respawn or worktree deletion is authorized by recovery.

## Findings and final acceptance

Send findings to the owning coordinator. It appends evidence, affected work,
fix steps and verification to the same plan, then restarts its planning step.
Preserve completed work, original acceptance, PRs and loop counters. Cross-plan
contract/scope changes return to the center and renewed approval. Revisions
cannot mutate an active unknown owner or silently erase verified outcomes.

A verified outcome cannot receive more work directly. First stop/release its
owner, then use `reopen_plan` with the finding and evidence. Reconcile or reopen
dependent outcomes first if their accepted work would otherwise become stale.
The center records the finding and prior verification without editing child
artifacts. On the next explicit attempt, send the finding to its coordinator;
the coordinator updates the existing plan and starts again from planning.

Inspect actual current-attempt reports and acceptance evidence before `verify`.
That operation records the manager's attestation; H2H does not invent test
results or run arbitrary shell gates supplied by a model. Stop/release a
finished coordinator only after proven shutdown. Then `complete_goal` records
explicit goal-level acceptance and an aggregate report referencing child
reports. All child DONE labels alone are insufficient. Preserve integration
state in the report: uncommitted/awaiting integration is not shipped.
