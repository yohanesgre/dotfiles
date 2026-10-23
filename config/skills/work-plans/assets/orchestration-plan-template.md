# Plan: <name>
created: YYYY-MM-DD
source: <origin, if migrated — else omit>
state: PLAN | WAIT | WORKING | DONE | FAILED
gate: <ISO8601 approved + who + branch, after execution gate — else omit>
iter: <W<n>i<m> current position>
next_action:

## X (problem)
1–3 sentences: what + why. No background essay — link artifacts instead.

## Scope
- In: ...
- Out (explicit non-scope): ...

## Acceptance
- <criterion> — verify: <runnable command>

## Graph A (happy path)
```ts
step 1 → step 2 → DONE
```

## E (break points)
| Node | Break | Treatment |
|---|---|---|

## R
{what each step needs: files, sessions, accounts, approvals}
- memory: `mem_current_project` + `mem_context` at open · `mem_save` on DONE
  (summary + resolved `$PLAN_DIR/plan.md` / `$PLAN_DIR/report.md` paths)

## Lanes (only when parallel — else delete this section)
- <lane>: <role + resolved model> — <files touched> — <content owned> —
  worktree `.worktrees/<plan>-<lane>`, branch `<branch>`

Each lane is a native worker of THIS coordinator's harness instance (one
harness instance per plan); never a second harness/pane per lane. The
coordinator persists the result with `plan` + `lane` + `attempt` identity.

## Tasks (only when a lane splits into crumbs — else delete this section)
One table per splitting lane; the lane name is the `###` heading above its table.
Rules: `id` unique per lane (`T1`…); `files` comma-separated real paths (never `—`); `resources`
`—` or space-/comma-separated tokens (lockfiles/artifacts/env/ports); `acceptance` non-empty; `gate` exact
command; `edges` `—` or comma-separated predecessor ids (DIRECT dependency only). Two crumbs in
one lane without a direct edge between them must stay file- and resource-disjoint (that is what
makes them parallelizable). Crumb workers are bounded native subagents assigned the lane's
worktree/branch; they never commit, and the coordinator commits each verified set before the
next set fires.

### <lane>
| id | owner | files | resources | acceptance | gate | edges |
|---|---|---|---|---|---|---|
| T1 | <owner> | <paths> | — | <criterion> | <gate cmd> | — |

## Findings
Append one row per failed check, review, CI run, or smoke scenario; fix steps
stay in this plan, never a new folder. Preserve completed steps, merged lanes,
worktrees, and open PRs.

| id | source | evidence | affected lanes/files | fix steps | depends on | verify | resolution |
|---|---|---|---|---|---|---|---|
| F1 | <check/review/CI/smoke> | <command + short output> | <lane/paths> | <ordered steps> | <finding/step> | <runnable command> | <evidence + date> |

## Memory
- `mem_save` on DONE: summary + resolved paths to `$PLAN_DIR/plan.md` and
  `$PLAN_DIR/report.md`
