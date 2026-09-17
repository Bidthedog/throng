# Contract: settings, descriptors, IPC and the terminal environment

**Feature**: 045 | **Requirements**: FR-037, FR-060 – FR-062, FR-080 – FR-080d

---

## §1 Settings leaves

Four. Each needs the four `app-settings.ts` edits (interface field, `DEFAULT_APP_SETTINGS` entry,
tolerant parse line, **and the field in the section's `clone…` — a field missing there is silently
dropped on write**, `app-settings.ts:1017-1019`) plus exactly one descriptor in
`settings-metadata.ts`, which `core/tests/unit/settings-metadata.test.ts` enforces.

| Key | Control | Ships | Group · subgroup | FR |
|---|---|---|---|---|
| `editor.links.defaultAction` | `select`, `DEFAULT_LINK_ACTIONS` + `optionLabels` | `'throng'` | Editor · Links | FR-050, FR-061 |
| `editor.links.detectInEditors` | `toggle` | `true` | Editor · Links | FR-060, FR-061 |
| `editor.links.detectInTerminals` | `toggle` | `true` | Editor · Links | FR-060, FR-061 |
| `terminals.advertiseHyperlinks` | `toggle` | `true` | Terminal | FR-080b, FR-061 |

**Descriptor text that carries a requirement:**

- `editor.links.defaultAction` — `optionLabels` for the **whole** set (`metadata.ts:107-120` requires
  all-or-none): `throng` → *"Open in throng"*, `editor` → *"Open in Editor"*, `preview` →
  *"Open in Preview"*, `osExplorer` → *"Open in OS Explorer"*, `osDefaultProgram` →
  *"Open in OS Default Program"*. The description must say that a link carrying a line and column
  always opens an editor (FR-052) and that an executable is never run by a click (FR-039) — both are
  behaviours a user would otherwise report as a bug.
- `terminals.advertiseHyperlinks` — the description **must say** that it applies to terminals started
  afterwards and does not change one already running, because FR-080c requires the setting to say so.
  It must also say that a `FORCE_HYPERLINK` the user set themselves is never overridden (FR-080a).

**No `SHIPPED_DEFAULTS_VERSION` bump**: four settings leaves, no theme token
(`shipped-defaults.ts:490` clones `DEFAULT_APP_SETTINGS`).

**Placement**: `groupDescriptors` (`ui/src/renderer/preferences/group-descriptors.ts:59`) buckets by
`group` then `subgroup` in declaration order, so the three link settings render as an **Editor ·
Links** subsection — FR-061's "together in one place" — and the fourth renders inside the existing
flat Terminal group beside *Shell integration* and *Link hover tooltip delay*.

---

## §2 Key binding

`preview.followLink`: id and default `['Ctrl+Enter']` unchanged; `COMMAND_SCOPES` entry changes from
`PREVIEW_ONLY` to a set containing `editor` and `preview`; the metadata description is rewritten
(FR-062). `.has('terminal')` stays **false** (FR-046).

**Tests this is permitted to change, and no others**:
`core/tests/unit/keybindings-preview.test.ts:42-45`, `:56-59`, `:119`. The terminal assertions at
`:61-67` and `ui/tests/e2e/terminal-modified-enter.e2e.ts:233` stay exactly as they are.

---

## §3 IPC — `throng:links:*`

Three channels, all `ipcRenderer.invoke`, all registered in `ui/src/main/link-ipc.ts` over
`FileLinkResolver`. The preload surface is `window.throng.links`, typed in
`ui/src/renderer/global.d.ts`; a preload-parity contract test covers it, as
`preview-ipc` does for 044.

| Channel | Request | Response |
|---|---|---|
| `throng:links:resolve` | `LinkResolutionRequest` | `LinkResolution` |
| `throng:links:reveal` | `LinkResolutionRequest` | `LinkActionOutcome` |
| `throng:links:open` | `LinkResolutionRequest` | `LinkActionOutcome` |

**Policy, on every one of the three (FR-037):**

| # | Rule |
|---|---|
| I1 | The request carries a **link**, never a resolved path. Main resolves it from `text`, `kind`, `baseDirectory` and `panelId`. |
| I2 | The owning project root comes from `panelId` in **main** (the `authoritative()` precedent, `editor-ipc.ts:71-83`), never from the renderer. |
| I3 | Existence is re-checked at action time. A path that has gone answers `{ ok: false, reason: 'gone', path }`, which raises **one** notice naming the path — the *one condition, one notice* rule. |
| I4 | A `file:` URI is converted to a path in main and **never** handed to the OS URL opener. |
| I5 | `throng:openExternal` and `throng:preview:openExternal` are **untouched**, and `isSafeExternalUrl` keeps `file:` in its `INJECTIONS` list (`ui/tests/unit/external-url.test.ts`). 024 FR-019b's denial of renderer-opened windows is unchanged. |
| I6 | Nothing here is broadcast. Each response goes to the window that asked. |

`throng:files:reveal` and `throng:files:revealDocument` are unchanged and keep their own
confinements; this feature adds a third policy rather than widening either of theirs.

---

## §4 The terminal environment (FR-080 – FR-080d)

### The decision — pure, in core

`hyperlinkAdvertisementEnv(baseEnv, advertise)` in `core/src/terminal/spawn-env.ts`:

| # | Input | Output | FR |
|---|---|---|---|
| E1 | `advertise`, no `FORCE_HYPERLINK` in `baseEnv` | `{ FORCE_HYPERLINK: '1' }` | FR-080 |
| E2 | `advertise`, `FORCE_HYPERLINK=0` in `baseEnv` | `undefined` — the user's `0` survives | FR-080a |
| E3 | `advertise`, `FORCE_HYPERLINK=1` in `baseEnv` | `undefined` — the user's own value, not throng's | FR-080a |
| E4 | `advertise`, `force_hyperlink` in `baseEnv` (any case) | `undefined` — Windows env names fold case | FR-080a |
| E5 | `advertise`, `FORCE_HYPERLINK=` (set but empty) | `undefined` — set is set, whatever its value | FR-080a |
| E6 | not `advertise` | `undefined`, whatever `baseEnv` holds — throng neither sets nor unsets | FR-080b |
| E7 | any | the result has **at most one key**, and it is `FORCE_HYPERLINK` | FR-080d |

E7 is how FR-080d is met: throng cannot set `WT_SESSION` or a borrowed `TERM_PROGRAM` because the
function can return nothing else. A `WT_SESSION` **inherited** from a user who launched throng from
Windows Terminal is not something throng set; the assertion is about what throng added.

### Where it is applied

`ui/src/main/terminal-ipc.ts`, in `doAttach`, merged into `launch.env` beside the existing
`baseEnv: { ...process.env }` (`:283`).

**Not into `baseEnv`.** A de-elevated terminal never receives `baseEnv`:
`daemon/src/pty-agent-host.ts:290` sends only `env`, and `pty-agent-entry.ts:172-179` forwards only
`env`. `launch.env` also layers **on top** of the base at
`platform-windows/src/node-pty-host.ts:135-138`, so it always wins.

### How the setting reaches `doAttach`

`registerTerminalIpc` gains an injected reader — `readTerminalSettings: () => TerminalSettings` —
wired in `ui/src/main/main.ts:1661-1669` from the same `configStore`
`ShellDetectionService` already reads (`shell-detection-service.ts:52-60`). Read **per attach**,
which is FR-080c: a change applies to the next terminal, and a running one is untouched because a
process's environment is fixed when it starts.

Neither shipped pattern fits and both were rejected: riding on `TerminalFlavour` (as
`terminals.shellIntegration` does) would make hyperlink advertising a property of a *shell*, which
it is not; re-reading in the daemon (as `terminals.commandPollMs` does,
`daemon/src/composition-root.ts:128-135`) would need a daemon restart, which FR-080c forbids.

### Verification

| Layer | What |
|---|---|
| unit (core) | E1–E7 over a fake `baseEnv` |
| unit (ui) | `doAttach` merges the result into `launch.env` and never into `baseEnv`; the setting is read per attach |
| integration (platform-windows) | a real shell is spawned and echoes its environment: with the setting on it sees `FORCE_HYPERLINK=1`; with a seeded `FORCE_HYPERLINK=0` it still sees `0`; with the setting off it sees neither a throng-added value nor a changed user value; in none of the three does the environment carry a `WT_SESSION` throng added |

**Not an E2E**, as the spec's own Assumptions require. `platform-windows/tests/integration/` already
holds a spawn-a-real-shell-and-read-it test of this shape.

**Hands-on only**: whether Claude Code actually emits OSC 8 under `FORCE_HYPERLINK=1` on this
Windows build is a property of Claude Code, not of throng — [../quickstart.md](../quickstart.md) §6.
