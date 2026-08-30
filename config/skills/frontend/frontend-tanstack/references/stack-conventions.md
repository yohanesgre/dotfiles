# Stack Conventions — React + TanStack Start + Tailwind v4

Project conventions. Read section relevant to task; skim rest.

## Layout

```
app/
├── routes/          # file-based routing — one file per route
│   └── $slug/       # dynamic segments; nested route folders
├── components/
│   ├── ui/          # reusable primitives
│   └── <domain>/    # feature components
├── lib/             # hooks + data layer
│   ├── queries.ts   # all query/mutation hooks (useXxx())
│   ├── api.ts       # typed API client (plain functions, no React)
│   └── ...
└── styles/          # Tailwind v4 CSS entry + design tokens
```

## Routes

- One file per route in `app/routes/`, exported `Route = createFileRoute("/path")({...})`.
- **Validate search params** with `validateSearch` — never raw `location.search`. Type search state; components get it from `Route.useSearch()`.
- Thin route components: layout + delegate to components/hooks.
- Navigate with `useNavigate()` / `<Link>`, never raw `<a>` for internal links.
- Server-only work in server functions (`createServerFn`) — out of client bundles.

## Data

- All server state via hooks in queries lib (`useProjects()`, `useCreateProject()`, ...). Components never call API client directly.
- **Flat string-array query keys**: `["projects"]`, `["board", slug]`, `["wikiPage", slug]`. Stable keys, documented by owning hook.
- **Mutations**: success → `qc.setQueryData(...)` (optimistic or on-success), then toast. Error → toast with error message.
- Hooks grouped per domain file; naming: `useXxx` reads, `useCreateXxx`/`useUpdateXxx`/`useDeleteXxx` writes.

## Components

- Small, single-purpose.
- Reuse UI kit before hand-rolling.
- Icons from icon set app already uses — match sibling files.
- Class merging via `cn()` helper (or equivalent) — no manual conditional class concat.
- Co-locate tests: `Component.test.tsx` next to `Component.tsx`.

## Styling

- Tailwind v4 via Vite plugin; CSS entry starts with `@import "tailwindcss"`.
- **Never hardcode colors/fonts.** Route through semantic tokens in `app/styles/` (CSS custom properties). Tokens cover surfaces, borders, text, status colors.
- Tailwind utilities for layout/spacing; token-backed classes for meaning.
- Pattern repeated 3+ times → shared utility class or component.
- Dark mode via token system (default); light mode = token swap, not restyle.
- Animations: 150–250ms ease-out; respect `prefers-reduced-motion`.

## Testing

- Vitest + jsdom + @testing-library/react + user-event.
- Co-located `*.test.tsx`.
- Role + accessible-name queries — never class/test-id when role exists.
- `userEvent.setup()` + `await user.click(...)` — no fireEvent for user interactions.
- Shared `renderXxx()` helper per test file.
- Cover behavior: renders, interactions, empty/loading states, validation.

## Quality gates

- Project typecheck script (e.g. `bun run typecheck`) — no errors.
- Project test script (e.g. `bun run test`) — all pass; new logic tested.
- Project build script (e.g. `bun run build`) — succeeds.
- Run app, manually exercise changed flow before claiming done.
