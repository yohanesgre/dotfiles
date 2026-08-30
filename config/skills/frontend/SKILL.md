---
name: frontend
description: 'Generic frontend work — workflow, definition, standards for any web UI task. Use whenever user asks to build, change, fix, style, or review any UI: pages, routes, components, modals, forms, lists, tables, drag-and-drop, interactions, anything rendering in browser. Also trigger on "make this look better", "add a page for X", "fix this broken UI", "create a component", "style this", any frontend bug report — even one-line CSS tweak. Points to matching stack skill (frontend-*) for framework conventions. Load before touching frontend code.'
---

# Frontend Work

## What frontend work is

Anything rendering in browser: pages, routes, components, data hooks, styling, interactions, tests. Judged by what user sees + how it behaves, not just compile. Bar: polish consistent with app design system, accessible, tested where logic exists, fast.

## Load stack skill first

Framework conventions live in stack skills, not here. Identify stack from package.json + configs, load matching skill:

| Stack | Skill |
|-------|-------|
| React + TanStack (Start/Router/Query) + Tailwind (Vite-based) | `frontend-tanstack` |
| Other | matching `frontend-*` skill if exists |

No stack skill → read existing code in area; ask if stuck.

## Workflow

### 1. Understand before code

- Read task. Design docs/specs/wireframes covering area → read first; they're authority on visuals.
- Read existing route/component + co-located test.
- Existing pattern for this (query hook, modal, toast, dropdown)? Reuse before inventing.

### 2. Pick tools

Load matching skill(s) from dispatch before writing. Not ceremony — skills carry framework details easy to get wrong from memory.

| Task | Skill |
|------|-------|
| Framework conventions | matching `frontend-*` stack skill |
| Data fetching, mutations, caching, optimistic updates | `tanstack-query-best-practices` (or equivalent) |
| Routing, links, navigation, search params, loaders | `tanstack-router-best-practices` (or equivalent) |
| Server functions, SSR, full-stack boundaries | `tanstack-start-best-practices` (or equivalent) |
| Data lib + router together | `tanstack-integration-best-practices` (or equivalent) |
| CSS framework utilities, config, theming | `tailwind-4-docs` (or equivalent) |
| Visual design, layout, color, typography, polish | `frontend-design` or `design` |
| Accessibility, WCAG, UX review | `web-design-guidelines` |
| Finishing feature — lint, a11y, bundle, architecture | `react-doctor` |
| Reviewing diff before merge | `code-review` |
| Claiming work done | `verification-before-completion` |

### 3. Build it

Follow stack skill conventions. Universal non-negotiables:

- Data via typed hooks or app data layer — no raw fetches in components.
- Styling via app design tokens + utility system. No hardcoded colors, no invented spacing outside tokens.
- Small single-purpose components; reuse app UI kit before custom.
- Co-located tests covering behavior, not implementation.

### 4. Verify

- Co-located test for new logic (rendering, hooks, validation).
- Project verification: typecheck, tests, build. Fix failures.
- Run app, exercise changed flow. UI matches design intent — states, empty states, loading, error, focus.

### 5. Review before done

- Self-review diff: follows existing patterns? Dead code? Smallest change that works?
- Forgotten details: keyboard focus in modals, disabled/loading button states, empty states, reduced-motion, error toasts on failed mutations.

## Design principles

- **Consistency beats cleverness.** Mimic existing components over "better" ones that look different.
- **Color is signal.** Semantic tokens — accent focus/active, green success, red danger. No decorative rainbows.
- **Density matters.** Tool screens: compact layouts, every pixel carries state.
- **Motion is state machine.** 150–250ms ease-out transitions answering "what happened?", no bounces.
- **Type does the work.** Hierarchy via weight + color, not all-caps.

## Ambiguity

Check stack skill conventions, then existing code in area. Docs conflict with code, or task contradicts design doc → stop, report conflict to user. Never resolve silently.
