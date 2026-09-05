# Design Graph — Interfaces

Same method, turned on the interface. A screen is not a picture — it is a node with three channels, and the layout is the graph the user walks.

```
Job → Flow → Surface<C, V, N>
│      │      │  │  │
│      │      │  │  └─ what the surface needs to exist   (§5)
│      │      │  └──── every way the content is absent   (§4)
│      │      └─────── what the person reads and does    (§2)
│      │
│      └─ nodes = surfaces, edges = the moves between them
│
└─ the job: what the person came here to get done

§1  Surfaces     the nouns: screens, panes, rows, fields, controls
§2  C            happy path as flow graph
§3  Cardinality  one record (Detail) or many (List / live)
§4  V            void states: empty, loading, partial, error, denied
§5  N            needs: data, permission, prior step, viewport
§6  Boundary     validate at the field, not at submit
§7  Behavior     motion and feedback wrap a surface, never reshape it
§8  Scope        attention is acquired and must be released
§9  Proof        swap N, same flow shape
§10 Craft        markup = C, state styles = V
```

## 1. Name the surfaces

- **Surfaces** — addressable places. Rail, list, detail pane, drawer. Each has a name and an owner.
- **Units** — repeated shape inside a surface. Row, field, metric. Named once, reused everywhere.
- **States** — what a unit can be. Rest, hover, selected, disabled, stale. Enumerated, never improvised at build time.
- **Moves** — what the person can do. Open, select, dismiss, commit, undo.

A design system naming colours but not surfaces has a palette, no vocabulary.

## 2. Think C first

Map the successful job as a flow graph before drawing a frame. `Rail(scope) -> List(C) -> Detail(C) -> Commit`. Nodes are surfaces, edges are moves. Every screen off this graph is a screen nobody asked for. Shared surface = component. One edge in and one out = maybe not a screen at all.

## 3. One or many?

Decide cardinality before layout — wrong call here reshapes the surface, not its styling.

- **One record** — detail surface. Reading measure, full metadata, one primary action.
- **Many records** — list surface. Scannable uniform rows, selection as wash. Must survive 0, 1, and 10,000.
- **Live** — values changing while read. Show timestamp, never move the row under the cursor.

Never let a list masquerade as a card, never let a live value pretend static.

## 4. Think V second

V is the void channel: every way content can be absent. Each is a designed surface, not a fallback.

- **Empty** — nothing yet, and that is fine. One grey sentence saying what appears here.
- **Loading** — shape known, values not. Flat skeleton in the layout content will occupy.
- **Partial** — some arrived. Show what you have, mark what is missing. Never block the whole surface for one field.
- **Error** — it broke and the person can act. Say what failed, in their words, next to the thing that failed.
- **Denied** — they may not see it. Prefer never routing here over explaining refusal.

One designed state out of five means 20% designed. Void states earn trust — the person meets them on their worst day.

## 5. Think N third

Mark what each surface needs before it may exist. "Cannot show X without Y."

- **Data** — record must be selected. No selection is a different node, not an empty pane.
- **Permission** — if they cannot act, draw no affordance. Disabled button is a last resort.
- **Prior step** — step 3 requires step 2. Unreachable beats reachable-and-broken.
- **Viewport** — three panes need width. Below it the graph re-routes: detail becomes drawer, not squeeze.

A screen reachable without its needs met is a hole in the flow graph — a design bug, not an engineering case.

## 6. Trust at boundary

Input enters at fields, uploads, pastes, drags, typed URLs. Validate at the field, not at submit. One field definition gives label, constraint, and error sentence together. A form failing only on submit put its boundary in the wrong place and made the person pay for the move.

## 7. Layer behavior

Motion, focus, feedback, density, keyboard affordance, reduced-motion wrap a node, never edit it. Removing the animation must not remove learnable content — if it does, the animation carried content and the layout was underbuilt.

## 8. Scope attention

Modals, drawers, menus, toasts acquire attention and must release it: whatever takes focus returns it on confirm, cancel, escape, interrupt. Overlay with no defined release is a leak.

## 9. Swap N to prove it

Flow graph holds across contexts; only N changes. Re-walk four times:

- **Day one** — empty account. Every list empty, graph still legible.
- **Year three** — 40,000 records, titles twice the mock length. Nothing reflows into nonsense.
- **Least access** — read-only member. Affordances vanish, layout survives.
- **Small and slow** — one hand, poor network, reduced motion. Graph re-routes, never degrades.

Design working only with ideal data is a screenshot, not a design.

## 10. Markup is C, state styles are V

- **Component tree** — happy path. Content flowing through the graph. No state branching inside.
- **Recipe variants** — complete V enumeration. Every state named and styled, none left to browser default.

Tangled tree means nobody can tell which states were designed and which were merely reached.

### One method, two materials

| § | DESIGN THINKING | DESIGN GRAPH |
|---|-----------------|--------------|
| X | the problem to build | the job to get done |
| graph | functions and data flow | surfaces and moves |
| 1 | records, IDs, variants, errors | surfaces, units, states, moves |
| 2 | A — what flows | C — what is read and done |
| 3 | Effect or Stream | detail, list, or live |
| 4 | E — retry, escape, die | V — empty, loading, partial, error, denied |
| 5 | R — dependencies, proven | N — needs, satisfied on the edge |
| 6 | parse at the transport edge | validate at the field |
| 7 | pipe wraps the node | motion wraps the surface |
| 8 | scope the resource | scope the attention |
| 9 | swap R in tests | swap N in review |
| 10 | gen body = A, pipe = E | tree = C, variants = V |

## The Craft Pipeline

```
JOB
  -> "What are the surfaces?"                        -> define the interface language
  -> "What is the successful path?"                  -> draw the flow graph (C)
  -> "One record, many, or live?"                    -> mark cardinality per surface
  -> "How can the content be absent?"                -> annotate void states (V)
  -> "What must be true to show this?"               -> annotate needs on the edges (N)
  -> "Where does their input enter?"                 -> validate at the field
  -> "What wraps a surface without reshaping it?"    -> layer motion and feedback
  -> "What takes attention, how is it given back?"   -> scope every overlay
  -> "Does it hold on day one and year three?"       -> swap N and re-walk the graph
  -> "Does the build separate C from V?"             -> tree = C, variants = V
  -> INTERFACE                                       -> the interface IS the graph
```

**If a surface can render a state the graph cannot name, the design is wrong.**
