---
name: design-graph
description: 'Graph-first interface method (r17x): draw the user-flow graph BEFORE building UI — a surface is a node with three channels Surface<C,V,N> (C=happy-path content flow, V=void states empty/loading/partial/error/denied, N=needs: data/permission/prior-step/viewport). Use when designing screens, components, layouts, user flows, or empty/error states where structure must be drawn as a graph. Indonesian: "desain flow/layar dulu sebelum bikin UI", "empty/error state". Prefer over generic frontend/UI design when the flow graph must be enforced — generic UI skills do not enforce graph shape. Part of the r17x paradigm: program code → `design-thinking`, trace answers → `call-graph`.'
---

# Design Graph

The r17x method turned on the interface. A screen is not a picture — it is a node with three channels; the layout you draw is the graph the user walks.

## Router

| Task | Read |
|------|------|
| Surfaces, happy-path flow graph (C), cardinality, void states (V), needs (N), craft | `references/design-graph.md` |

## Shared rule

If a surface can render a state the graph cannot name, the interface is lying.

## Pipeline

Job → name surfaces → draw happy-path flow graph (C) → mark cardinality (detail/list/live) → annotate void states (V) → mark needs on edges (N) → validate at the field → layer motion and feedback → scope attention (overlays release focus) → swap N and re-walk the graph → tree = C, variants = V.

## Sources

- r17x gist (`OPT_DESIGN_GRAPH.md`)
