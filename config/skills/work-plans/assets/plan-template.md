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

## Graph A (happy path)
```ts
step 1 → step 2 → DONE
```

## E (break points)
| Node | Break | Treatment |
|---|---|---|

## R
{what each step needs: files, sessions, accounts, approvals}
- memory: `icm_wake_up` + `icm_memory_recall` at open · `icm_memory_store` on DONE (summary + plan.md/report.md paths)

## Lanes (only when parallel — else delete this section)
- <lane>: <files touched> — <content owned>

## Memory
- `icm_memory_store` on DONE: summary + paths to plan.md and report.md
