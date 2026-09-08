---
name: design-thinking
description: 'Graph-first design paradigm (r17x): read the problem, draw the graph, build what IS the graph (X→Graph→Effect<A,E,R>). Governs Effect-TS/backend code (A=happy-path call graph, E=break points, R=dependencies) and subagent task graphs (delegated subgraph vs implemented graph). Indonesian: "gambar graph dulu sebelum ngoding", "bangun service/pipeline", "gen body = A, pipe = E". Interface/user-flow structure → `design-graph` skill; how-it-works/caller/trace answers → `call-graph` skill. Prefer when work needs a drawn graph or graph-shaped structure — generic Effect/design/delegation skills do not enforce graph shape.'
---

# Design Thinking

Graph-first method (r17x): read the problem, draw the graph, build what IS the graph. One discipline, three materials.

## Router

| Task | Read |
|------|------|
| Effect-TS service, API, data flow, errors, layers, tests | `references/design-thinking.md` |
| Multi-step work for subagents, parallel waves, delegation | `references/graph-protocol.md` |

Sibling skills in the same paradigm (standalone):
- `call-graph` — how-it-works, caller, request-path, trace answers (verified ts-fence call graph, path:line evidence)
- `design-graph` — screen, layout, user flow, empty/error states (Surface<C,V,N>)

## Shared rule

Code that does not match the drawn graph is wrong. Fix the code or fix the graph. Never leave them disagreeing.

## Pipelines

Backend: shapes, happy-path graph (A), cardinality, break points (E), requirements (R), Schema at boundary, pipe behavior, scoped resources, swap R in tests, gen body = A and pipe = E.

Orchestration: task nodes, execution graph (A), one or many workers, break points (E), worker requirements (R), structured boundary, observe, scope attention, compare delegated vs implemented, prompt = subgraph and return = implemented graph.

## Common mistakes

- Writing code before drawing the graph.
- Error handling tangled inside the happy path (gen body, component tree).
- Untrusted data parsed deep inside instead of at the boundary.
- Test graph invented instead of verified against real test wiring.
- Disabled affordance drawn where the flow should never route.

## Sources

- `https://gist.github.com/r17x/90eb2f7be93932b5693753aedb09c01a`
