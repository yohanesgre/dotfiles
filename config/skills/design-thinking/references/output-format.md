# Call-Graph Output Contract

Use for call graphs, execution flows, request paths, architecture traces, function callers, upstream and downstream behavior, "How does X work?", "What calls X?", "Where does X go?", and production/test flow comparisons.

Do NOT graph trivial single facts: ports, versions, simple definitions, text edits, rename-only changes.

## Format

~~~
graph: <short title>

Production:
```ts
EntryPoint
  → ComponentA
    → ComponentA.method
      → [condition] ComponentB
        → {queue_or_store}
```

Tests:
```ts
TestEntryPoint
  → ComponentATestLayer
    → ComponentA.method
      → ComponentBTestLayer
```

src:
  EntryPoint → path/to/file.ts:LINE
  ComponentA → path/to/component.ts:LINE
  ComponentA.method → path/to/component.ts:LINE
  ComponentB → path/to/other.ts:LINE
~~~

## Rules

- Plain text only. No Mermaid, no rendered diagrams.
- `ts` fence, two-space-indented `→` children. Root has no arrow; indentation is the hierarchy.
- Real symbol names only: actual functions, methods, services, jobs, queues, stores. Conditions in `[brackets]`, external systems in `{braces}`, planned nodes marked `[new]` with no invented line numbers.
- Production always. Tests only when the test graph differs. Never invent a test graph — inspect test wiring first, omit the section when identical.
- Verified `path:line` evidence for every unique node. No guessed paths, symbols, callers, or line numbers.
- Below the graph, explain only what the graph cannot show: conditions, retries, errors, gotchas.
- Skip the graph for trivial single-fact questions; answer directly.

## Workflow

1. Determine requested scope.
2. Find the real entry point, callers, and callees with focused source navigation (language server, `rg`, compiler, type checker).
3. Inspect production wiring; inspect tests only when the test graph may differ.
4. Build the hierarchical graph from real symbol names.
5. Verify every node, attach `path:line` evidence.
6. Stop when the requested scope is covered.
