---
name: call-graph
description: 'Answer how-it-works, caller/callee, request-path, execution-flow, and architecture-trace questions with a verified plain-text hierarchical call graph in a `ts` fence (two-space-indented `→` children, path:line evidence per node). Trigger on "how does X work", "what calls X", "where does X go", trace, flow, upstream/downstream; Indonesian: "gimana cara kerja X", "siapa manggil X", "alur/request path/trace". Do NOT graph trivial single facts (ports, versions, simple definitions, text edits, rename-only). Part of the r17x graph-first paradigm; to draw a design/flow graph before coding use `design-thinking` / `design-graph`.'
---

# Call Graph

Answer call-graph questions with plain-text hierarchical call graphs. Show Production always; Tests only when the graph differs.

## Output contract

Full contract in `references/output-format.md`.

Rules:
- Plain text only; no Mermaid.
- `ts` fence, two-space-indented `→` children. Root has no arrow.
- Use actual functions, methods, services, jobs, queues, stores.
- Verified `path:line` evidence per unique node. Never invent line numbers.
- Skip graph for trivial single-fact questions.

## Workflow

1. Determine the requested scope.
2. Find the real entry point, callers, and callees (language server, `rg`, ast-grep, compiler, targeted tests).
3. Inspect production wiring; tests only when the test graph may differ.
4. Build the hierarchical graph with real symbol names; verify every node and add `path:line` evidence.
5. Explain conditions, retries, errors, and gotchas the graph cannot show.
6. Stop when the scope is covered.

## Sources

- r17x gist (`ECALL_GRAPH_IN_YOUR_AGENTS.md` + "Build a Call-Graph Skill" spec)
