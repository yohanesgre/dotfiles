---
name: backend
description: 'Generic backend work — workflow, definition, standards for any server-side task. Use whenever user asks to build, change, fix, or review server code: API endpoints, routes, services, data access, database, migrations, auth, webhooks, background jobs, anything running server-side. Also trigger on "add an endpoint", "fix this API bug", "500 error", "database query", "migration", "service layer". Browser UI task → `frontend` skill; terminal tool → `cli` skill.'
---

# Backend Work

## What backend work is

Server-side code: endpoints, services, data access, migrations, auth, webhooks, background jobs. Judged by contract correctness (valid inputs in, typed outputs out, consistent errors), safety (auth everywhere, no secret leaks), reliability (idempotent side effects, no silent failures) — not compile.

## Load stack skill first

Runtime conventions in stack skills. Identify stack from server entry + package config, load matching:

| Stack | Skill |
|-------|-------|
| Bun + Effect-TS (services, layers, error catalog, typed REST, SQLite) | `backend-effect-bun` |
| Other | matching `backend-*` skill if exists, else repo conventions |

## Workflow

### 1. Understand before code

- Read task. Project docs covering area (schema, API contract, layer/service docs) → read first; they're authority.
- Read existing endpoint/service + its test. See how errors, validation, auth handled.
- Existing pattern (service, repository, error type, middleware)? Reuse before inventing.

### 2. Build it

Follow stack skill conventions. Universal non-negotiables:

- **Contract discipline**: validate all inputs at the boundary; typed, stable responses; one consistent error shape.
- **Structured errors**: categorized error types; never leak internals (stack traces, SQL) to clients.
- **Auth on every route** unless explicitly public. No secrets in code.
- **Data**: schema/migrations are source of truth — change via migration, not ad-hoc.
- **DB work is backend work**: schema, migrations, queries follow the stack skill's data conventions — no separate database skill.
- **Idempotent side effects**: retries safe; duplicate requests don't double-apply.
- **Fail loudly**: invalid input → clear 4xx; unexpected → 5xx + log, never silent success.

### 3. Verify

- Co-located test for new logic (validation, handlers, services, error paths).
- Project verification: typecheck, tests, build. Fix failures.
- Exercise each endpoint: success, validation failure, auth failure, error path.

### 4. Review before done

- Self-review: matches existing patterns? Auth present? Errors consistent? Migration correct + reversible?
- Forgotten details: empty states, pagination limits, rate limits, idempotency keys, logging on failures.

## Design principles

- **Consistency beats cleverness.** Mimic existing services/endpoints.
- **Fail loudly + early.** Bad input fails at boundary, not mid-write.
- **Least surprise.** Same error shape everywhere, documented codes.
- **Small changes.** Smallest correct step over speculative rewrite.

## Ambiguity

Check stack skill conventions, then existing code in area. Docs conflict with code, or task contradicts documented contract → stop, report to user. Never resolve silently.
