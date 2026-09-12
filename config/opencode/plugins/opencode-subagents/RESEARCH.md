# opencode-subagents — TUI plugin research notes

Reference for developing this plugin against **OpenCode V2**. Written from three
sources, each labelled:

- **BIN** — strings extracted from the installed binary
  `@opencode/cli@2.0.2` (`~/.bun/install/global/node_modules/@opencode/cli/bin/opencode.exe`).
  This is the source of truth for the exact running version.
- **DOC** — <https://opencode.ai/v2/docs/build/plugins> and `/cli`, `/rpc`,
  `/cli/config`, `/build/client`.
- **CODE** — the current plugin files in this directory.

The dev-branch docs do **not** match 2.0.2 event names (see §4). Trust BIN.

---

## 1. Architecture

Two plugin halves, same package:

| Half | File | Config | SDK |
|------|------|--------|-----|
| Server | `index.ts` | `opencode.json(c)` → `plugins` | `@opencode/plugin` |
| TUI | `tui.tsx` | `cli.json` → `plugins`, or auto when package exposes `./tui` | `@opencode/plugin/tui` |

- TUI plugins run in the terminal process and stay active against remote servers (DOC).
- A plugin configured in `opencode.json(c)` that exposes a `./tui` export is loaded
  automatically by the CLI (DOC).
- Discovery paths (DOC): `<global-config>/plugins/<name>/{index,tui}.ts`,
  `<project>/.opencode/plugins/<name>/{index,tui}.ts`. This repo uses
  `config/opencode/plugins/opencode-subagents/`.
- Current server half is a deliberately empty plain object (`index.ts`) — a bare
  `@opencode-ai/plugin` import on the server failed once (CODE comment).

Recommended publishable entrypoints (DOC):

```jsonc
{
  "type": "module",
  "exports": { ".": "./src/index.ts", "./tui": "./src/tui.tsx" },
  "peerDependencies": {
    "@opentui/core": ">=0.5.8",
    "@opentui/solid": ">=0.5.8",
    "solid-js": ">=1.9.0"
  }
}
```

Current `package.json` has **no** `exports`/`main` — opencode discovers
`index.ts` + `tui.tsx` by filename convention. Add `exports` before publishing.

## 2. TUI plugin shape

```tsx
/** @jsxImportSource @opentui/solid */   // REQUIRED at top of every .tsx (CODE)
import { Plugin } from "@opencode/plugin/tui";

export default Plugin.define({
  id: "opencode-subagents-tui",
  setup(context) {
    return context.ui.slot({ append: "sidebar.content", render: ({ sessionID }) => <X .../> });
  },
});
```

`setup` returns a cleanup function (or the slot unregister fn). `Plugin.define`
takes `{ id, setup }`.

### Rendering

- SolidJS components + OpenTUI primitives (`<box>`, `<text>`), JSX via
  `@opentui/solid` (DOC/CODE).
- **Do not use `usePlugin()`** in components. The bundled `@opencode-ai/plugin`
  copy ships its own Solid context while the host provides
  `@opencode/plugin/tui`, so host context reads as missing. Pass `context.data`
  and `context.theme` down through props from the `setup` closure (CODE).
- In slot content, flex spacers collapse — emit one padded string per `<text>`
  node instead of relying on spacer layout (CODE).
- A `<box>` with `border`/`title` inside a TUI slot **freezes the renderer** (CODE).

## 3. `context` surface (DOC)

```
context.options        plugin options from config
context.location       { directory, project, workspaceID? }
context.app            { version, channel }
context.client         generated @opencode/client HTTP client
context.renderer       OpenTUI renderer
context.theme          reactive theme tokens
context.data           reactive cached data layer
context.ui             slots / panels / router / dialogs / toast / tabs / format
context.keymap         commands + keybind layers
context.storage        durable + memory stores
context.markdown       code-block renderer registration
context.attention      notifications + sounds
```

### `context.data`

```
data.listen(handler)                      // ALL events; handler({ details: { type, data } })
data.on("<event>", handler)               // typed single event -> unsubscribe
data.session.list() | get(id) | root(id) | family(id) | status(id) | cost(id)
data.session.sync(id) | invalidate(id)
data.session.message.{sync,list,get,invalidate}
data.session.pending.{sync,list,invalidate}
data.session.permission.{sync,list,invalidate}
data.session.form.{sync,list,reply,cancel,invalidate}
data.location.{agent,command,model,provider,skill,mcp,integration,reference,vcs}.{sync,list/info,invalidate}
data.project.{sync,list,get,invalidate}
data.shell.{sync,list,get,invalidate}
```

`session.root(id)` = root ancestor, `session.family(id)` = descendant tree.
`session.list()` items carry `parentID` — subagents are child sessions.

> Verify `data.session.*` method names against the binary before relying on
> them; they are DOC-sourced, not BIN-confirmed.

### `context.ui`

- Slots: `slot({ append|prepend|before|after|replace: "<slot>", render })` → unregister fn.
- Panels: `panel.open(name, { presentation })`, `panel.current()`, `panel.close()`.
- Router: `router.register({ name, render })`, `router.navigate({ type: "plugin"|"session"|"home", ... })`.
- Dialog: `dialog.alert|confirm|prompt|select` (async), `dialog.set|show|clear`.
- `toast.show({ title?, message, variant?, duration? })`.
- `tabs.*`, `format.path(filepath)`.

### `context.keymap`

```
keymap.layer(() => ({ mode, priority, commands: [{ id, title, group, bind, palette, slash, enabled, suggested, run }], bindings })) -> unregister
keymap.dispatch(id, ...args) | shortcuts(id) | commands() | pending() | active()
keymap.mode.current() | mode.push(mode) -> pop
```

### `context.storage`

Reactive tuples, not async:

```
const [value, update] = storage.store(key, { initial });   // durable
const [value, update] = storage.memory(key, { initial });  // per TUI run
```

## 4. Events — VERIFIED for 2.0.2 (BIN)

The v2 docs / `sst/opencode` dev-branch SDK union (`session.next.*`) is **NOT**
what 2.0.2 emits. 2.0.2 emits these families (extracted from the binary):

**Session lifecycle**
`session.created`, `session.updated`, `session.deleted`, `session.status`,
`session.idle`, `session.compacted`, `session.moved`, `session.renamed`,
`session.diff`, `session.error`, `session.forked`, `session.viewed`

**Execution (this plugin's hooks)**
`session.execution.started`, `session.execution.succeeded`,
`session.execution.failed`, `session.execution.interrupted`

**Steps**
`session.step.started`, `session.step.ended`, `session.step.failed`, `session.step.streamed`

**Tools**
`session.tool.called`, `session.tool.success`, `session.tool.failed`,
`session.tool.progress`, `session.tool.input.started`,
`session.tool.input.delta`, `session.tool.input.ended`

**Streaming text / reasoning**
`session.text.started|delta|ended`, `session.reasoning.started|delta|ended`

**Usage**
`session.usage.updated`, `session.usage.recorded`

**Messages**
`message.updated`, `message.removed`, `message.part.updated`,
`message.part.delta`, `message.part.removed`

**Permissions**
`permission.asked`, `permission.replied`, `permission.rejected`

**Shell / compaction / inbox / skills**
`session.shell.started|ended`,
`session.compaction.started|delta|ended|failed`,
`session.inbox.enqueued|delivered|cancelled|delivery.changed`,
`session.skill.activated`

**Misc**
`file.edited`, `plugin.updated`, `mcp.tools.changed`, `mcp.resources.changed`,
`mcp.prompts.changed`, `lsp.updated`, `vcs.branch.updated`,
`workspace.ready|failed|status`, `worktree.ready|failed|updated`,
`project.updated`, `catalog.updated`, `integration.updated`,
`models-dev.refreshed`, `installation.updated`, `installation.update-available`,
`command.executed`, `command.updated`, `global.disposed`, `server.connected`,
`pty.created|updated|exited|deleted`,
`tui.toast.show`, `tui.prompt.append`, `tui.command.execute`, `tui.session.select`

Not found in 2.0.2 binary: `todo.updated` (docs mention it), `question.*`,
`session.next.*`. Treat as absent for 2.0.2.

Payload shape for `data.listen` is `{ details: { type, data } }`; `data` for
session events carries at least `{ sessionID, parentID? }` (CODE + BIN).

## 5. Slots — present in 2.0.2 (BIN)

Confirmed strings: `sidebar.content`, `sidebar.footer`,
`sidebar.footer.location`, `session.composer.top`, `session.panel`,
`home.footer`, `prompt.footer`, `prompt.footer.status`, `prompt.footer.file`,
`session_prompt`.

Not present: `sidebar.title`, `app_bottom`, `home_logo`, `home_prompt`.
(`app` as a slot could not be confirmed; docs list it.)

## 6. Built-in subagent UI already in 2.0.2 (BIN)

The host already ships subagent controls — avoid duplicating them and check for
overlap before adding new ones:

```
composer.subagent.down | up | select | interrupt | toggle-activity
ui.subagent
session.child.first | next | previous
```

## 7. Current plugin map (CODE)

| File | Role |
|------|------|
| `index.ts` | empty server half |
| `tui.tsx` | `Plugin.define` + `sidebar.content` slot |
| `SubagentSection.tsx` | section UI, collapse, rows |
| `useSubagents.tsx` | state: child lookup, `data.listen` refresh, 2s poll |
| `types.ts` | `SubagentSummary`, status mapping, `summarizeSession` |
| `variants.ts` | palette, formatting, void states, layout widths |

Data flow: `setup(context)` → slot render → `SubagentSection(sessionID, data, theme)`
→ `useSubagents` → `data.session.list().filter(s => s.parentID === sessionID)`
→ `sync`/`get`/`status` per child → summaries → padded text rows.

## 8. Dev workflow

```sh
opencode service restart          # reload after editing
opencode plugin list              # confirm loaded
tail -f ~/.local/share/opencode/log/opencode.log
```

`@opencode/client` / `@opencode/plugin` have no local `.d.ts` (binary ships
them). No on-disk typecheck without installing the packages; verify empirically
via the TUI and logs.

### Host renderer constraint — nodes added after mount are NOT drawn (2026-09-13)

**The `sidebar.content` slot renderer reliably updates text/values after mount
but does NOT add new nodes to an already-mounted subtree.** The original plugin
appeared to work only because `data.session.list()` returned children
synchronously, so the rows existed on the very first frame.

Symptom: with async hydration, the render-time store read `h1 n29 krows v4`
(hydrated, 29 children, `voidKind` "rows", 4 visible) while the body stayed on
the initial `loading subagents…` line forever — the rows branch produced no
paint. Converting sibling `<Show>`s to `<Switch>/<Match>` did not help; the
nodes still never appeared. A live tick in the header DID advance, proving Solid
reactivity works and only structural addition fails.

**Fix (implemented):** seed the store **synchronously** at mount from
`data.session.list()` + `data.session.get(id)` so every row exists on the first
frame; then let the async `children()`/`sync` refresh update values in place.
Keep the async refresh for accuracy — never rely on it to introduce structure.

Corollary: any state that changes node COUNT (rows appearing, `+K more`, void →
rows) must already be represented on the first frame, or be a text/value change
within existing nodes.

### Live-test findings (2.0.2, 2026-09-13) — important

- **TUI plugins are hydrated by the shared background service, not per TUI
  client.** Editing the plugin files and restarting the TUI (`opencode`) does
  NOT pick up changes: the running server keeps the plugin version it loaded at
  startup. A capture showed the *old* plugin still rendering after the files on
  disk were replaced under a fresh TUI. To load new code you MUST
  `opencode service restart` (disrupts the current session), or run an isolated
  instance with `opencode --standalone` (private server).
- **`~/.config/opencode/plugins/opencode-subagents/` is a real directory synced
  from the dotfiles repo by home-manager**, not a symlink. A `home-manager
  switch` overwrites any manual overlay. Do not treat manual copies there as
  durable; put test plugins somewhere stable or use `--standalone`.
- `opencode --standalone` starts a private server but is a poor substitute for
  end-to-end checks: a fresh server's `data.session.list()` did not surface the
  spawned children the way the long-lived shared server did (no `SUBAGENTS`
  section appeared). Prefer a service restart for real verification.
- Verified on the shared server with the pre-Phase-1 plugin: the
  `sidebar.content` slot renders `▾ SUBAGENTS` + rows without freezing, and the
  sidebar layout/width assumptions in `variants.ts` hold.
- Data layer verified via `opencode api get /api/session`:
  - 50 sessions, 29 with `parentID`; child sessions carry `parentID`, and
    grandchildren (explore under researcher) exist. Phase 1's tree assumption is
    sound.
  - Session fields present: `id`, `parentID`, `agent`, `model`, `cost`,
    `tokens{input,output,reasoning,cache{read,write}}`, `outcome`, `time{created,updated,idle,viewed}`, `title`, `location.directory`.

### Reading the live sidebar from an agent (herdr)

The TUI is a full-screen app; capture it via the pane, then isolate the right
column:

```sh
herdr pane zoom <pane> --on
herdr pane read <pane> --source visible --lines 60 --format text > /tmp/x.txt
# sidebar is the right ~38 columns; slice and print with markers
```

`opencode api get /api/session` returns `{data:[...], cursor}`, which is the
cheapest way to verify what the plugin's `data.session.list()` will see.

## 9. Open questions

- Are `data.session.*`, `ui.slot` panel, and `keymap` signatures identical to
  DOC in 2.0.2? Only the event/slot **strings** are BIN-verified.
- Does `session.execution.*` fire for subagent (child) sessions, or only root?
- Can a `session.panel` open outside an active session? (DOC says opening
  outside a session returns `false`.)
- Is `session.panel` the right surface for a full monitor, vs `sidebar.content`?
- Overflow/scroll behaviour of long subagent lists inside a slot.
