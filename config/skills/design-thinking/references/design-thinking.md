# Design Thinking — Programs

```
X → Graph → Effect<A, E, R>
│              │   │  │  │
│              │   │  │  └─ what each node needs     (§5)
│              │   │  └──── where the graph breaks   (§4)
│              │   └─────── what flows through nodes  (§2)
│              │
│              └─ nodes = functions, edges = data flow
│
└─ the problem: what you’re trying to build

§1  Shapes       the nouns: records, IDs, variants, errors
§2  A            happy path as call graph
§3  Cardinality  one-shot (Effect) or many (Stream)
§4  E            break points: retry, escape, die
§5  R            dependencies: compile-time proof
§6  Boundary     Schema: unknown → trusted at edges
§7  Behavior     .pipe() wraps without changing the graph
§8  Scope        acquire/release tied to lifecycle
§9  Test         swap R, same graph shape
§10 Code         gen body = A, .pipe() = E
```

## 1. Name the shapes

Define the domain language before drawing the graph.

- **Records** — entities flowing through nodes. User, Product, Order.
- **IDs** — branded, constrained identity. Never a bare string.
- **Variants** — internal state transitions. Pending, Active, Cancelled.
- **Errors** — named failure modes. Tagged, structured, carrying context. Not strings.

Nouns first. Graph is the verbs.

## 2. Think A first

Map the happy path as a call graph before writing code. `F1(A) -> F2(A) -> F3(A)`. What goes in, what comes out, what transforms between. This graph IS the program structure.

## 3. One or many?

- **One value** — node runs, produces A, done. Effect.
- **Many values over time** — events, subscriptions, paginated pulls. Stream.
- **Time-bounded** — result valid for a window. Cache it, deduplicate concurrent lookups.

Same three channels (A, E, R). Different cardinality. Mark it on the graph.

## 4. Think E second

Each break point is one of three:

- **Retry** — transient failure. Timeout, rate limit, connection reset.
- **Escape hatch** — recoverable, return alternative. Fallback value, cached result, default.
- **Die** — defect, invariant violation, programmer bug. NOT a domain error.

Errors are VALUES in the E channel until truly unhandleable. Decide per node: retry, escape, or propagate. Only `die` when program assumptions are violated.

## 5. Think R third

Mark what each node needs to exist. "Cannot do X without Y." R is compile-time proof: database connection, config value, HTTP client. R shrinks as layers are provided. Empty R (`never`) means runnable. Non-empty R means the compiler names exactly what is missing.

## 6. Trust at boundary

Untrusted data enters at HTTP requests, file reads, env vars, user input, third-party responses. Schema converts `unknown → trusted` at the edges: one definition = type + validator + transformer. Parse only at the boundary. Trust nothing there, trust everything inside.

## 7. Layer behavior

Retry policies, timeouts, logging, tracing, caching wrap via `.pipe()` WITHOUT changing the core graph. Graph says WHAT happens. Layers say HOW it behaves under pressure.

## 8. Scope resources

Connections, file handles, sockets, child processes: acquire/release is a type guarantee. Cleanup is structural — survives error and interrupt, never a TODO comment.

## 9. Swap R to prove it

Production and tests share the call graph shape. Only R changes. Same A, same E, different layer behind R. Graph that cannot run with a test R has hidden dependencies. Node needing the world mocked is doing too much.

## 10. gen is A, pipe is E

- **`Effect.gen` body** — happy path. Every `yield*` is an A. No error handling inside.
- **`.pipe()` after gen** — complete E enumeration. Read the actual E type of every yielded effect first, then catch, retry, or transform each one.

Tangled gen body means the A path and E path cannot be read separately.

### E scoping at graph layers

Each layer scopes its own E before passing up:

```
Services  →  Auth  →  Handlers
E=SqlError    E=DatabaseError    E=AuthError    E=RPC errors
  ↓ scope       ↓ scope            ↓ scope
DatabaseError  AuthError          RPC errors
```

Consumers never see implementation errors from deeper layers.

### Divergent strategies

Two effects in one gen body needing different E handling (one fails hard, one falls back) is a **divergent strategy** — the ONE exception allowing inline handling in gen. Mark it clearly. Rare by design.

## The Pipeline

```
PROBLEM
  -> "What are the shapes?"                         -> define the domain language
  -> "What is the happy path?"                      -> draw the call graph (A)
  -> "Is each node one-shot or a flow?"             -> mark cardinality
  -> "Where can it break?"                          -> annotate errors (E)
  -> "What does each node need?"                    -> annotate requirements (R)
  -> "Where does untrusted data enter?"             -> Schema at boundaries
  -> "What wraps nodes without changing them?"      -> pipe behavior orthogonally
  -> "What resources need cleanup?"                 -> scope lifecycle
  -> "Can I swap R and the graph still works?"      -> verify with test layers
  -> "Does my code separate A from E structurally?" -> gen body = A, pipe = E
  -> CODE                                           -> the code IS the graph
```

**If the code doesn't match the call graph, the implementation is wrong.**
