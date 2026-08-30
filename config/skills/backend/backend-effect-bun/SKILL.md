---
name: backend-effect-bun
description: 'Conventions for Bun + Effect-TS servers — Effect services/layers, typed error catalog, boundary validation, SQLite, webhooks, REST. Load whenever backend work in project whose server runs on bun with Effect-TS (e.g. `bun server/entry.ts` + Effect programs), or adding endpoints, services, error types, validation, auth, webhooks to such server. Generic `backend` skill defers stack details here. Different runtime/framework → load or create that stack''s `backend-*` variant.'
---

# Bun + Effect-TS Server Conventions

Bun runtime + Effect-TS services. Covers this combo; other stacks (node + express, go, ...) get own `backend-*` variant.

## Tools

- Effect patterns (services, layers, schemas, error handling) → also load `effect-ts` skill.
- Diff review before merge → load `code-review`.

## Layout

- Server entry run directly (e.g. `bun --env-file=.env run server/entry.ts`); prod via container.
- Services grouped per domain; each service = Effect layer, provided at composition root.
- Migrations in dedicated dir; schema docs are source of truth for SQL invariants.
- Types shared between server + client live in shared module.

## Services & effects

- Effect program boundary: services via layers, config at the edge.
- Typed error catalog: every failure mode a named error; handler maps to HTTP status.
- Validation at the boundary with schemas — never trust raw input.
- Webhooks/auth flows follow project's documented patterns; verify signatures/tokens.

## Data

- SQLite via project's data layer; SQL invariants copied from schema docs verbatim.
- Schema changes via migration files — never ad-hoc DDL. Migration workflow: write → run → verify against schema docs → test. Destructive changes (drops, rewrites) flagged in review.
- Queries typed; no string-built SQL with user input.
- Indexes for repeated query patterns; follow existing index conventions, avoid over-indexing writes.
- DB tests use in-memory/temp DB or project fixtures — never prod/dev data.

## API

- REST endpoints thin: validate → call service → map errors → typed response.
- Consistent error shape: status + code + message; no internal details leaked.
- Auth on every route unless explicitly public.

## Testing

- Co-located tests; cover validation, success paths, error paths, auth.
- Run with project test script.

## Quality gates

Typecheck, tests, build, then exercise each changed endpoint (success, validation fail, auth fail, error path).
