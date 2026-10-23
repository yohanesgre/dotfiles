# Plan: <name>
created: YYYY-MM-DD
source: <origin, if migrated — else omit>
state: PLAN | WAIT | WORKING | DONE | FAILED
gate: <ISO8601 approved + who + branch, after execution gate — else omit>
iter: <W<n>i<m> current position>

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
- memory: `mem_current_project` + `mem_context` at open · `mem_save` on DONE (summary + plan.md/report.md paths)

## Lanes (only when parallel — else delete this section)
- <lane>: <files touched> — <content owned>

## Tasks (only when a lane splits into crumbs — else delete this section)
One table per splitting lane; the lane name is the `###` heading above its table.
Rules: `id` unique per lane (`T1`…); `files` comma-separated real paths (never `—`); `resources`
`—` or space-/comma-separated tokens (lockfiles/artifacts/env/ports); `acceptance` non-empty; `gate` exact
command; `edges` `—` or comma-separated predecessor ids (DIRECT dependency only). Two crumbs in
one lane without a direct edge between them must stay file- and resource-disjoint (that is what
makes them parallelizable).

### <lane>
| id | owner | files | resources | acceptance | gate | edges |
|---|---|---|---|---|---|---|
| T1 | <owner> | <paths> | — | <criterion> | <gate cmd> | — |

## Memory
- `mem_save` on DONE: summary + paths to plan.md and report.md
