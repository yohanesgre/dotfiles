---
name: design-thinking
description: 'Use when structuring Effect-TS code, designing screens and user flows, planning subagent delegation, or answering how-it-works, caller, request-path, and architecture-trace questions.'
---

# Design Thinking

Graph-first method (r17x): read the problem, draw the graph, build what IS the graph. One discipline, three materials.

## Router

| Task | Read |
|------|------|
| Effect-TS service, API, data flow, errors, layers, tests | `references/design-thinking.md` |
| Screen, layout, component, user flow, empty and error states | `references/design-graph.md` |
| Multi-step work for subagents, parallel waves, delegation | `references/graph-protocol.md` |
| Showing a call graph, execution flow, request path, trace | `references/output-format.md` |

## Shared rule

Code that does not match the drawn graph is wrong. Fix the code or fix the graph. Never leave them disagreeing.

## Pipelines

Backend: shapes, happy-path graph (A), cardinality, break points (E), requirements (R), Schema at boundary, pipe behavior, scoped resources, swap R in tests, gen body = A and pipe = E.

Interface: surfaces, flow graph (C), cardinality, void states (V), needs (N), field validation, motion layers, scoped attention, swap N in review, tree = C and variants = V.

Orchestration: task nodes, execution graph (A), one or many workers, break points (E), worker requirements (R), structured boundary, observe, scope attention, compare delegated vs implemented, prompt = subgraph and return = implemented graph.

## Call-graph answers

Lead with plain-text hierarchical graph in a `ts` fence, two-space-indented children. Production always, Tests only when different. Verified `path:line` evidence per node. Skip graph for trivial single-fact questions. Full contract in `references/output-format.md`.

## Common mistakes

- Writing code before drawing the graph.
- Error handling tangled inside the happy path (gen body, component tree).
- Untrusted data parsed deep inside instead of at the boundary.
- Test graph invented instead of verified against real test wiring.
- Disabled affordance drawn where the flow should never route.

## Sources

- `https://gist.github.com/r17x/90eb2f7be93932b5693753aedb09c01a`
