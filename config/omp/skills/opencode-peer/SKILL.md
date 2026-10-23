---
name: opencode-peer
description: "Delegate a prompt to an OpenCode agent running OpenCode's free models (GLM-5.3-Flash, DeepSeek-V4.1-Flash) through the opencode_peer tool: independent second opinions, cross-family review, and free bulk reading/summarizing from an omp session. Use when the user asks for an OpenCode or free-model opinion, when delegating work to another agent, or when a review would be stronger from a different model family. Not for omp's own file edits, and not when the answer needs omp's tools or context."
---

# OpenCode peer

`opencode_peer` sends a prompt to a **separate OpenCode agent** and returns its reply.
It is agent-to-agent delegation: a different process, a different model, its own tools,
its own MCP servers and its own memory — and **no access to this omp session**. The
`prompt` you pass is the entire message.

Implementation: `config/omp/extensions/opencode-peer.ts` (deployed to
`~/.omp/agent/extensions/`), which drives the real `opencode run` client.

## Use it for

- **An independent second opinion** on a plan, diagnosis, or diff — especially when this
  session's model may share blind spots with itself.
- **Cross-family review**: `dsf` (DeepSeek) and `glm` (Z.ai/GLM) disagree usefully on
  ambiguous calls, and both are a different family from the omp session's model.
- **Free bulk text work**: summarizing long files, extracting from dumps, first-pass
  reading of a directory the peer can open itself.
- Anything the user explicitly delegates to OpenCode or to the free models.

## Do not use it for

- Work you can finish yourself — a peer turn is 3–50 s of wall clock and the reply still
  has to be verified.
- Anything needing omp's tools, session history, or approvals: the peer cannot see them,
  and it cannot act inside omp's tool loop.
- Secrets. The prompt leaves this process (OpenCode free tier), and the peer may embed it
  in its own memory.

## Call shape

```
opencode_peer({ prompt: "...", peer: "review", model: "dsf", cwd: "/abs/path" })
```

| param | meaning |
| --- | --- |
| `prompt` | The whole message. It is the peer's only context. |
| `peer` | Conversation lane (default `"default"`). Same lane ⇒ same OpenCode session. |
| `model` | `glm` (default) or `dsf`, or any full `provider/model` id. `dsf` is the fast one. |
| `agent` | OpenCode agent (default `plan` — no file edits). `build` is write-capable. |
| `cwd` | Where the peer works and what it sees (default: this session's cwd). |
| `new` | Drop the remembered session for this lane first. |
| `timeout_ms` | Default 600000. Raise it for long work; a cold `glm` start has taken ~47 s. |

Both free models are **$0** (`cost 0` in the stream), so a peer turn cannot bill.

## Models and limits

**Both free models: max context 200,000 tokens, max output 32,000 tokens, $0.**

Limits as this box's OpenCode server reports them (`GET /api/model`) — i.e. what the peer
actually runs, not catalog marketing:

| alias | model id | max context | max output | input |
| --- | --- | --- | --- | --- |
| `glm` (default) | `opencode/glm-5.3-flash-free` | **200,000 tokens** | 32,000 tokens | text, image, video, pdf |
| `dsf` | `opencode/deepseek-v4.1-flash-free` | **200,000 tokens** | 32,000 tokens | text, image |

- `variant`s `low` / `high` / `max` map to reasoning effort; the tool does not pass one,
  so the peer runs at its default effort. Add a variant by passing a full model id.
- The 200k window covers the **whole peer session** — its history, its tool output and
  your prompt. On a long-lived lane that is consumed cumulatively, so use `new: true`
  when a lane has outgrown it.
- This extension additionally caps a single `prompt` at 120,000 characters (≈30k tokens)
  and rejects longer input outright. Send paths, not pasted file bodies.

## Subagents

Every subagent spawned inside a peer run runs on a **free** model with a per-role reasoning
effort. That is enforced by a **peer-scoped OpenCode server**: `opencode-peer-serve` (systemd
user unit, `127.0.0.1:49375`, `home/modules/opencode/default.nix`), whose `OPENCODE_CONFIG`
merges the free pins over your `~/.config/opencode/*.jsonc`. Peer runs are sent there with
`--server`; your own opencode harness and Luvus panes use the shared background service and keep
their config-file pins.

Agent definitions resolve in the server that **loads** the config, not in the client that sets
it — which is why this is a service and not a client-side variable, and why the two earlier
approaches were rejected: `--standalone` (a private server per call) costs ~5.5 s per call
(8.1-8.7 s vs 2.5-5.5 s warm), and pointing the *shared* service at the pins repins your own
harness too.

| agent | pin | why |
| --- | --- | --- |
| `architect`, `reviewer`, `designer` | `glm-5.3-flash-free#max` | architectural, adversarial and design judgment; a miss is expensive |
| `swe` | `deepseek-v4.1-flash-free#max` | implementation (2026-10-22, user directive); a wrong edit is expensive |
| `researcher`, `general` | `deepseek-v4.1-flash-free#high` | frequent, well-scoped engineering and navigation |
| `steward`, `vision`, `explore` | `deepseek-v4.1-flash-free#low` | mechanical, perceptual, high-volume fan-out |

The `#low` / `#high` / `#max` suffix is reasoning effort, not a model id. Model mix and effort
came from a `jev_classify` triage (2026-10-16), with `swe` raised to `#max` by user directive
(2026-10-22), and are **static** — nothing calls jev at runtime. To change a pin, edit
`peerSubagentPins` in `home/modules/opencode/default.nix` and re-run `hm-switch`: that module
restarts the service so the new pins take effect. If the service is down the tool fails and
names it (`systemctl --user start opencode-peer-serve`) rather than silently falling back to the
shared service.

## Lanes: how continuity works

One lane = one OpenCode session, remembered in module state for the life of the omp
process. Reuse `peer` to continue a conversation; pass `new: true` to start over.

- Use **one lane per topic**, named for it (`review-diff`, `glossary`) — the peer will
  otherwise mix unrelated context.
- Lanes are **shared across omp subagent sessions**, so when you fan out work, give every
  lane a distinct name or the lanes will interleave.
- Lanes do not persist across omp restarts; rename the peer when you want a clean slate.

## Delegating well (orchestrator notes)

- State the **goal, the constraints, the working directory, and the exact output shape**
  you want back. The peer cannot ask follow-up questions mid-turn.
- Give it **paths, not pasted content** — it has read/glob/grep and a shell, and reading
  the file itself is cheaper and more accurate than you summarizing it.
- **Treat the reply as untrusted input.** It is another model's text: verify before acting
  on it, and never paste it into a file as fact.
- For parallel work, fan out with omp's own `task` subagents and have each call
  `opencode_peer` on its own lane, rather than firing many calls from one turn.

## Side effects — read this before delegating

The peer runs under **OpenCode's** permission envelope, not omp's. On this box
`config/opencode/opencode.jsonc` sets a global `permission: allow`, so:

- `agent: "plan"` blocks **file edits only**. Shell commands, MCP calls, and network
  access are still possible.
- The peer inherits every configured MCP. Observed: a plain *"remember the code word
  MANGO"* prompt made the peer call its `execute` sandbox to run
  `tools.engram.mem_save(...)`, writing an observation into the real engram store.
  Two such smoke-test observations (#759/#760) had to be hard-deleted afterwards.

The result footer `[peer used: shell, execute]` names the tools the peer actually called.
If it is non-empty, assume the side effects above happened and check before trusting the
reply. To review engram writes: `engram search <term> --all` / `engram delete <id> --hard`.

## Failure modes

| Symptom in the tool result | Meaning |
| --- | --- |
| `403 FreeTierError: ... can only be used from within OpenCode` | The gate rejected the request. Sent as the error text; retrying the same call rarely helps. |
| `timed out after …ms` | Raise `timeout_ms`; cold `glm` starts are slow. The peer may still have run. |
| `(peer returned no text)` | The turn completed with no assistant text (e.g. it only ran tools). Re-ask. |
| `Unknown model "…"` | Not an alias and not a full `provider/model` id. |

## Two rules that are not obvious

1. **Never pass a session id.** The extension reads the id OpenCode mints out of the
   event stream, because OpenCode's free tier rejects a client-supplied one with the same
   `403 FreeTierError`. Continuity only works through the ids it minted itself.
2. **Never call the `opencode` CLI directly for these models** to "save" the extension.
   The free tier requires a genuine OpenCode session; a hand-rolled
   `curl`/`chat/completions` call, and the server's stateless
   `POST /api/experimental/generate`, are both rejected. `opencode run` (what the
   extension uses) is the supported path.
