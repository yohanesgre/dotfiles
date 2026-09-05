# Graph Protocol — Orchestration

Same method, turned on orchestration. A task is not a checklist — it is a graph, and the delegation is the subgraph the worker walks.

```
X → Graph → Delegation<A, E, R>
│              │       │  │  │
│              │       │  │  └─ what each agent needs            (§5)
│              │       │  └──── where the delegation breaks      (§4)
│              │       └─────── what flows through agents        (§2)
│              │
│              └─ nodes = tasks, edges = data dependencies
│
└─ the problem: what you're trying to build

§1  Task Nodes    the nouns: files, modules, domains, workers
§2  A             happy path as execution graph
§3  Cardinality   one worker (SMALL) or many (MEDIUM/LARGE)
§4  E             break points: wrong context, missing input, misinterpretation
§5  R             requirements: subgraph, design method, verification, WHY
§6  Boundary      subgraph in, implemented graph out — structured at edges
§7  Behavior      observe wraps delegation without changing the graph
§8  Scope         worker attention is acquired and must be released
§9  Proof         compare delegated subgraph vs implemented graph
§10 Structure     prompt = subgraph, return = implemented graph
```

## 1. Name the task nodes

- **Nodes** — discrete units of work. Service change, component update, config edit. Each has a domain and a worker.
- **Domains** — who owns the node. One node, one owner.
- **Edges** — data dependencies. Node C needs outputs of A and B. No edge means independent.
- **Waves** — independent nodes running in parallel. Edges between waves create gates.

## 2. Think A first

Map the task as an execution graph before spawning any worker. `wave1[A∥B] → gate → wave2[C] → wave3[D]`. Independent nodes go parallel, dependent nodes go sequential. This graph IS the delegation plan.

## 3. One or many?

- **One worker** — small or trivial task. Single node, inline the task in the prompt.
- **Many workers** — medium or large task. Draw the execution graph, each worker gets its subgraph.
- **Waves** — independent nodes in one wave spawn in parallel; the gate waits for all prior nodes.

## 4. Think E second

Delegation breaks three ways — all coordinator failures, never worker failures:

- **Wrong context** — worker lacks files, WHY, or constraints.
- **Missing input** — wave-2 node needs wave-1 output the coordinator never passed. Invisible edge.
- **Misinterpretation** — worker implements the LETTER, not the INTENT. Ambiguous subgraph.

The coordinator controls the prompt. Worker misunderstanding means the prompt was wrong.

## 5. Think R third

Every worker needs four things in the prompt:

- **Subgraph** — what to implement, in the notation the worker's domain expects.
- **Design method** — which methodology applies, which sections govern.
- **Verification command** — how the worker proves correctness.
- **WHY** — the reason the node exists, not just what to change.

Missing R means the worker guesses. Guessing is the source of misinterpretation (§4).

## 6. Trust at boundary

Coordinator sends prompt, worker sends result — structure both. Prompt carries the subgraph (not prose, not "fix the thing"). Return carries the implemented graph (not a bare "done"). Boundary is the only transfer point; inside it, the worker owns its subgraph.

## 7. Layer behavior

Coordinator records the delegated subgraph BEFORE spawning; worker records the implemented graph AFTER implementing. Observations wrap delegation without changing what the worker does.

## 8. Scope attention

A worker is acquired (spawned) and must be released (completed with structured data). Between acquire and release the worker owns its subgraph — the coordinator waits at the gate, never interferes. Spawned-without-subgraph wastes attention; completed-without-graph loses data.

## 9. Compare to prove it

Delegated subgraph and implemented graph must match. Extra nodes in the implemented graph = worker off-script. Missing nodes = worker skipped something. Comparison is the payoff of structuring at the boundary.

## 10. Prompt is subgraph, return is implemented graph

Prose subgraph plus bare-string return tangles delegation with verification: unreadable ask, unverifiable result. The prompt IS the delegated graph. The return IS the implemented graph.

## The Protocol Pipeline

```
TASK
  -> "What are the task nodes?"                      -> define nodes, domains, edges
  -> "What is the happy path?"                       -> draw the execution graph (A)
  -> "One worker or many?"                            -> mark cardinality
  -> "Where can the delegation break?"                -> annotate break points (E)
  -> "What does each worker need?"                    -> annotate requirements (R)
  -> "Where does the graph cross boundaries?"         -> subgraph in, implemented graph out
  -> "What wraps delegation without changing it?"     -> observe before and after
  -> "What resources need release?"                   -> scope worker attention
  -> "Does the implemented graph match?"              -> compare delegated vs implemented
  -> "Does my prompt separate subgraph from prose?"   -> prompt = subgraph, return = graph
  -> DELEGATION                                       -> the delegation IS the subgraph
```

**If the implemented graph does not match the delegated subgraph, the delegation is wrong.**
