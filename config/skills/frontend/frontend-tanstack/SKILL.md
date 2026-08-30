---
name: frontend-tanstack
description: 'Stack conventions for React + TanStack Start/Router/Query + Tailwind CSS v4 (Vite-based). Load whenever doing frontend work in project using @tanstack/react-start, @tanstack/react-router, @tanstack/react-query, tailwindcss, vite — carries framework conventions (routes, search params, query hooks, tokens, testing setup) generic `frontend` skill defers to. Triggers on "how does this app structure routes/queries/styles", "add a route", "new query hook", changes to app/routes, queries lib, app/styles, vite config. Different stack → load that stack skill.'
---

# TanStack Frontend Conventions

React 19 + TanStack Start (file routing, server functions) + TanStack Query (server state) + Tailwind CSS v4 (Vite plugin, token theming).

Read `references/stack-conventions.md` for full detail. Essentials:

## Layout

- `app/routes/` — one file per route via `createFileRoute`. Dynamic segments as `$slug/` folders.
- `app/components/ui/` — primitives; `app/components/<domain>/` — feature components.
- `app/lib/` — data layer: queries (hooks), api (typed client, no React).
- `app/styles/` — Tailwind v4 CSS entry + semantic tokens.

## Routes

- Validate search params with `validateSearch`, read via `Route.useSearch()` — never raw `location.search`.
- Thin route components: delegate to components + hooks. `useNavigate()` / `<Link>` for internal nav.
- Server-only work in server functions (`createServerFn`), out of client bundles.

## Data

- All server state via typed hooks (`useXxx()`, `useCreateXxx()`, ...) in queries lib — components never call API client directly.
- Flat string-array query keys (`["projects"]`, `["board", slug]`).
- Mutations: `setQueryData` cache updates + toast on success/error.

## Styling

- Tailwind v4 via Vite plugin; CSS entry starts with `@import "tailwindcss"`.
- Never hardcode colors — route through semantic tokens in app styles (CSS custom properties).
- Recurring class patterns → shared utility class or component.
- Animations: 150–250ms ease-out; respect `prefers-reduced-motion`.

## Tooling (Vite)

- Vite powers dev/build (`vite.config.ts`). TanStack Start handles server/client split — don't hand-roll SSR.
- Tailwind v4 via `@tailwindcss/vite` plugin.
- Env vars via Vite env system (`import.meta.env` / env files).

## Testing

- Vitest + jsdom + @testing-library/react + user-event.
- Co-located `*.test.tsx`; role-based queries; `userEvent.setup()` + `await user.click(...)`.
- Cover behavior: renders, interactions, empty/loading states, validation.

## Quality gates

Run project's typecheck, test, build scripts (whatever package.json defines), then manually exercise changed flow.
