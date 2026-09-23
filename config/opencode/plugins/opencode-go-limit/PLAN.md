# Plan — `opencode-go-limit` TUI plugin

Show OpenCode Go usage limits in the OpenCode V2 TUI status line.
Method: `design-thinking` (program) + `design-graph` (surface). Code must match the graph below.

Status: **DONE + deployed & active. Tests 64/64. Key resolution fixed (active DB credential, not the stale auth.json). 5h reset countdown added. Console (device-OAuth) auth support added 2026-09-23. Phase 4 (optional) pending.**
Decisions: mount = `prompt.footer.status` (status line, `append`); build = plan-first (this file).

---

## 1. Verified facts (ground truth — do not re-research)

| Thing | Value | Source |
|---|---|---|
| TUI entry | `export default Plugin.define({ id, setup(context) })` | local `plugins/opencode-subagents/tui.tsx:5-15` |
| Import | `import { Plugin } from "@opencode/plugin/tui"` | same |
| JSX | `/** @jsxImportSource @opentui/solid */`, deps `@opentui/core ~0.5.8`, `@opentui/solid ~0.5.8`, `solid-js ~1.9.0` | `opencode-subagents/package.json` |
| In-component context | `usePlugin()` from `@opencode/plugin/tui` | V2 CLI plugin docs |
| Slot | `context.ui.slot({ append: "prompt.footer.status", render: () => <C/> })`; **returns unregister fn** | V2 CLI plugin docs §Slots |
| All slots | `app`, `home.footer`, `prompt.footer`, `prompt.footer.status`, `prompt.footer.file`, `session.composer.top`, `session.panel`, `sidebar.content`, `sidebar.footer` | V2 CLI plugin docs §Slots |
| Placement | `prepend` \| `append` \| `before` \| `after` \| `replace` | V2 CLI plugin docs §Slots |
| Events | `context.data.on(evt, cb)` and `context.data.listen(cb)`, both return unsubscribe | V2 CLI plugin docs §Events |
| Storage | `context.storage.store(key,{initial})` (durable, cross-instance) / `.memory(...)` | V2 CLI plugin docs §Storage |
| Dialog / keymap | `context.ui.dialog.*`, `context.keymap.layer(fn)` | V2 CLI plugin docs |
| Data API | `GET https://opencode.ai/zen/go/v1/usage`, `Authorization: Bearer <key>` | live: 401 unauth, 200 authed |
| Key | precedence: active `opencode.db`→`credential` (`integration_id='opencode-go' AND active=1`) `.value.key` → active DB `opencode` OAuth (`type:'oauth'`, `metadata.server/orgID`) → `auth.json` `opencode-go` → `opencode` → `opencode` oauth | `opencode auth list`, DB query, live sha check, console probe |
| Key gotcha | `auth.json` is **legacy/stale** and held a different account (sha `eced93…`) than the active DB credential (sha `7f616c…`, console-matching) | live `/zen/go/v1/usage` diff by key |
| Payload | `usage.{rolling,weekly,monthly}.{status,percent,resetsAt}`, `percent` = **used 0..100**, `resetsAt` ISO | live call |
| Limit model | 5h = 20%, weekly = 50%, monthly = 100% of per-model monthly $ cap | docs `/docs/go/` |
| Plugin dir | `~/.config/opencode/plugins/<name>/` auto-discovered | `ls` + local plugins |
| Deploy | sync block in `home/modules/opencode/default.nix` (`opencodeSyncPlugins`); real mutable files + `bun install` for `node_modules` | `default.nix:31-71` |

Reference payload (real, captured 2026-09-13):

```json
{"usage":{
  "rolling":{"status":"ok","percent":0,"resetsAt":"2026-09-13T00:21:07.261Z"},
  "weekly":{"status":"rate-limited","percent":100,"resetsAt":"2026-09-14T00:00:00.261Z"},
  "monthly":{"status":"ok","percent":80,"resetsAt":"2026-09-26T16:04:38.261Z"}}}
```

---

## 2. Shapes (§1)

```
Window        = "rolling" | "weekly" | "monthly"                 // IDs = literal union
WindowUsage   = { status: "ok" | "rate-limited" | string; percent: number /*used, clamped 0..100*/; resetsAt: string }
GoUsage       = { rolling: WindowUsage; weekly: WindowUsage; monthly: WindowUsage }
DisplayState  = { kind:"loading" }
              | { kind:"ready";  usage:GoUsage; fetchedAt:number }
              | { kind:"stale";  usage:GoUsage; error:UsageError; fetchedAt:number }
              | { kind:"error";  error:UsageError }              // no known usage to show
UsageError    = NoAuth | AuthError | Entitlement | Network | RateLimited | BadSchema   // tagged, not strings
```

`usage(w) = w.percent` (used, 0..100). Binding window = highest usage.

## 3. Happy path A (§2)

```
setup(context)                                            [tui.tsx]
  → context.ui.slot({ append: "prompt.footer.status", render })
      → <GoFooter>                                        [GoFooter.tsx, Solid]
          → useGoUsage(options)                           [useGoUsage.ts, reactive]
              ├ → resolveAuth()                           [db/api key or db/console oauth]
              ├ → fetchUsage(key, signal)                 [GET /zen/go/v1/usage, timeout]
              │     → decodeUsage(unknown)                [schema @ boundary → GoUsage]
              ├ → poll(refreshMs)                         [initial pull + interval, single-flight]
              └ → onEvent("session.idle")                 [opportunistic refresh]
          → footerChips(GoUsage)                          [compact text per window]
```

`loadUsage() = readKey → fetchUsage → decodeUsage` — happy path only, no try/catch inside.

## 4. Cardinality (§3)

- `fetchUsage`: time-bounded pull → poll (default 60s) + **single-flight** + TTL cache (`fetchedAt`). Never refetch for countdown; derive countdown from `resetsAt` on a 1s tick.
- UI: reactive signal (many values over time), not a stream.

## 5. Break points E (§4)

| Node | Failure | Strategy |
|---|---|---|
| `readKey` | missing entry/key | **escape** `NoAuth` → footer `Go —`; no fetch, no toast loop |
| `fetchUsage` | network/timeout/5xx | **retry** ×3 exp-backoff+jitter → **escape** `stale` (last-known) or `error` |
| `fetchUsage` | 429 | **retry** honoring `Retry-After`, else backoff |
| `fetchUsage` | 401 | **escape** `AuthError` → `Go key!` (no retry) |
| `fetchUsage` | 403 | **escape** `Entitlement` → `Go none` |
| `decodeUsage` | shape mismatch | **escape** `BadSchema` → `Go ?`; debug log (server drift ≠ bug) |
| `decodeUsage` | percent OOB / unknown status | lenient: clamp percent; only `"rate-limited"` is special |
| any | — | never `die`; TUI must not crash |

## 6. Requirements R (§5)

`fetch` (ambient) · `fs` for auth.json · `@opencode/plugin/tui` · `@opentui/solid` + `solid-js` · `context.ui.slot` · `context.theme`.
Test R: inject `KeySource` + `UsageClient`; prod layer is auth.json + global fetch. Same graph, no network.

## 7. Boundary (§6)

Two untrusted inputs parsed once:
1. `auth.json` → `opencode-go.key` non-empty string.
2. HTTP body `unknown` → `GoUsageSchema` (lenient `status`, clamped `percent`, `resetsAt` string).
Never log the key. Inside boundary: trust `GoUsage`.

## 8. Behavior (§7) & scope (§8)

`.pipe()` layers: AbortController timeout (~10s), retry/backoff, single-flight, TTL cache, redacted debug log.
`setup` returns cleanup: `unregisterSlot()`, `clearInterval`, `abort()`, unsubscribe. Persist last-known via `context.storage.store` so restart paints `stale` instantly.

## 9. Surface — footer (`design-graph`)

`Surface<C,V,N>` for `prompt.footer.status`:
- **C**: `Go` + chips `5h 17%` `wk 8%` `mo 4%` (**used %**, theme-colored) + rolling **5h reset countdown** `↻2h45m` (muted, after the 5h chip, re-rendered each second from `resetsAt`).
- **V**: `loading` → `Go …`; `stale` → dim + `~`; `NoAuth` → `Go —`; `AuthError` → `Go key!`; `Entitlement` → `Go none`; `Network`/`BadSchema` → `Go ?`. None drawn as clickable/dead affordance.
- **N**: data (usage), permission (key), viewport (narrow → `Go <usage of binding window>%`); no session needed.
- Color thresholds (on used %): `<70` ok, `70..90` warn, `>=90` or `status:"rate-limited"` danger. Exact theme token names confirmed at Phase 2.

Optional detail view (Phase 4): keybind/palette command `Go usage` → dialog with all windows, reset times, error text, manual refresh. Keeps footer tiny.

---

## 10. Quality gates

Test graph (Phase 1, `bun test`): happy · rolling-only · weekly rate-limited (real payload) · 401 · 403 · timeout · malformed JSON · `percent:120` · missing key.
Acceptance: footer shows live used % for 3 windows; correct colors incl. rate-limited; no crash on any E; exactly one in-flight request per interval; key never logged; graph in code == graph above.

## 11. Phases

**Phase 1 — data core (no UI).** `usage.ts`: `readKey`, `fetchUsage` (timeout/retry/single-flight), `decodeUsage`, `UsageError`. Verify: `bun test` green on fixtures above.
  - ✅ DONE 2026-09-13. Files `usage.ts`, `usage.test.ts`, `package.json`. Exports `readKey(env?)`, `decodeUsage`, `remainingPercent`, `createUsageClient` (`fetchUsage` single-flight per key; timeout+retry; 401→AuthError, 403→Entitlement, 429→Retry-After then RateLimited, 5xx/throw→Network after retries; lenient clamp). Gate: `bun test` → `22 pass, 0 fail`. No `@opencode/*`/`@opentui/*` imports.

**Phase 2 — footer slot minimal.** `tui.tsx` mounts `prompt.footer.status`; `GoFooter.tsx` + `useGoUsage.ts` render chips from live fetch; 60s poll; cleanup. Verify: plugin loads without crash, footer shows real numbers.
  - ✅ DONE 2026-09-13. Added `display.ts` (pure), `display.test.ts`, `useGoUsage.ts`, `GoFooter.tsx`, `tui.tsx`, deps (`@opentui/core ~0.5.8`, `@opentui/solid ~0.5.8`, `solid-js ~1.9.0`). Theme tokens from `opencode-subagents/variants.ts` palette. Footer strings: `Go …` / `Go 5h 100% wk 0% mo 20%` / `~Go …` / `Go —` / `Go key!` / `Go none` / `Go ?`. Gate: `bun test` → `33 pass, 0 fail`; `bun build ./tui.tsx` bundles clean. Live TUI render NOT yet verified (needs Phase 5 deploy).

**Phase 3 — states.** All V states + color thresholds + stale/storage. Verify: each state simulated and correct.
  - ✅ Covered by Phase 2: `shortError` all kinds, `levelFor` ok/warn/danger incl. `rate-limited` forced danger, `useGoUsage` storage last-known → instant `stale`. Optional 1s reset-countdown text still pending.

**Phase 4 (optional) — detail dialog.** Palette/keybind command, dialog, manual refresh.

**Phase 5 — deploy wiring.** `package.json` (deps as `opencode-subagents`); add `opencode-go-limit` sync block to `home/modules/opencode/default.nix` mirroring `opencodeSyncPlugins`; **add `index.ts` server stub (`Plugin.define({ id:"opencode-go-limit", setup(){} })`) — both working local plugin dirs have one, herdr's comment: "keeps the plugin directory valid for server-side discovery"**; `home-manager switch`; `opencode service restart`. Verify: `ls ~/.config/opencode/plugins/opencode-go-limit`, footer visible. Update `config/opencode/CONFIGURATION.md`; sync stays in dotfiles.

**Phase 6 — OpenCode Console (device-OAuth) auth.** Added 2026-09-23. `resolveAuth(env?)` returns `Auth = {kind:"apiKey",key} | {kind:"oauth",access,server,orgID?}`. Precedence: active DB `opencode-go` key → active DB `opencode` OAuth → auth.json `opencode-go` key → auth.json `opencode` key → auth.json `opencode` OAuth. API key hits `/zen/go/v1/usage` (unchanged); OAuth hits `${metadata.server ?? https://opencode.ai/console}/api/go/status` with `Bearer <access>` + optional `x-org-id`. `decodeConsoleStatus` maps `access.meters.{fiveHour,week,month}` micro-cent strings → used % (rounded), `resetsAt` with `access.endsAt` fallback, `status` derived (`>=100%` → `rate-limited`); `404` → `Entitlement`. `readKey` kept (api key only, compat); `keySource` gains `db:oauth` / `auth:opencode-oauth`. Verify: `bun test` → `64 pass, 0 fail`.

## 12. File layout

```
config/opencode/plugins/opencode-go-limit/
  PLAN.md            (this file)
  package.json       type:module; deps @opentui/core @opentui/solid solid-js
  tui.tsx            Plugin.define → slot("prompt.footer.status")
  GoFooter.tsx       compact chips + states
  useGoUsage.ts      signal + poll + retry + storage
  usage.ts           readKey / fetchUsage / decodeUsage / UsageError
  usage.test.ts      fixtures (payload captured above)
```
