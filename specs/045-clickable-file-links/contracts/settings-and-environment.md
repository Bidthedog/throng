# Contract: settings, descriptors, IPC and the terminal environment

**Feature**: 045 | **Requirements**: FR-037, FR-060 – FR-062, FR-080 – FR-080d; *amended
2026-09-18*: FR-112, FR-113, FR-120, FR-124 — see §6. The `editor.links.defaultAction` row of §1 and
its descriptor text describe a setting that is **retired**; they are kept as the record of what
shipped on this branch before the change request.

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
| I1 | The request carries a **link**, never a resolved path. Main resolves it from `text`, `kind`, `baseDirectory`, `panelId` and `originProjectId`. |
| I2 | The owning project **root** is derived in **main** from the `originProjectId` the renderer names (the `authoritative()` precedent, `editor-ipc.ts:71-83`). The renderer never supplies a root. |

### Amendment 2026-09-18 — the request carries `originProjectId`, and I2 says which way round

I1/I2 originally said main derives the owning project root "from `panelId`". It cannot: **main holds
no panel→project map.** `editor-coordinator` knows `ownerProjectId` for *editor* panels only, and a
terminal panel — the surface this feature exists for — appears in no main-side registry at all. The
`authoritative()` precedent the rule cites does not work that way either: it takes a renderer-supplied
**`ownerProjectId`** and replaces the renderer's `ownerRoot` with main's own.

So `LinkResolutionRequest` gains a fifth field, `originProjectId`, and the rule is stated the way the
precedent actually works:

- **The renderer names an ID** — `Panel.originProjectId`, which it legitimately owns and which main
  can check against its daemon-fed project cache.
- **Main derives the ROOT.** An id main does not recognise answers `null`, which judges every target
  outside a project (M3) — a lookup that failed cannot prove a file is in scope, and a check that
  gives up and says yes is not a check.

The confinement is unchanged in strength and is arguably clearer: a renderer able to name a *root*
could name `C:\`, while one naming an *id* can only ever reach a project that exists and whose root
main already knows. A `projectRoot` field sent alongside is dropped by the handler's whitelist, and
`link-ipc.contract.test.ts` asserts exactly that.

The alternative considered and rejected was a panel→project registry in main, kept current as panels
open, close, move between windows and are torn off into sub-workspaces — a second source of truth for
something the renderer's workspace model already owns, which is what Principle XI warns about.

`panelId` stays on the request. It identifies the asker and carries no authority of its own.
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

---

## §5 Reconciled against the shipped code — 2026-09-18 (T130)

Read against `core/src/config/settings-metadata.ts`, `core/src/config/keybindings.ts`,
`ui/src/main/link-ipc.ts` and `core/src/terminal/spawn-env.ts`. §1–§4 hold as written; what follows
is what the code adds to them.

**§1 — the four descriptors ship with these labels**, and a doc that names a different one is wrong
rather than merely informal:

| Key | Shipped label |
|---|---|
| `editor.links.defaultAction` | **Default link action** |
| `editor.links.detectInEditors` | **Detect file links in editors** |
| `editor.links.detectInTerminals` | **Detect file links in terminals** |
| `terminals.advertiseHyperlinks` | **Tell programs that links are supported** |

The three `Editor · Links` descriptors are declared **consecutively** in `SETTINGS_METADATA`, and
that adjacency is load-bearing rather than tidy: `groupDescriptors` buckets by group then subgroup in
declaration order, so a descriptor pushed in between them would split the section in the preferences
editor with no test of the values noticing. `allowedValues` is spread from `DEFAULT_LINK_ACTIONS`
rather than restated, so the descriptor, the tolerant parser and `resolveDefaultLinkAction` cannot
drift apart.

**§2 — the widened scope ships as a named constant**, `LINK_SURFACES` (`editor` + `preview`), which
**replaces** `PREVIEW_ONLY`: that set had one member and one user, and leaving it in place beside its
successor is a second definition of the same idea. It is deliberately **not** shared with
`HISTORY_PANELS`, which holds the same two scopes today by coincidence — folding them together would
make a later change to one silently move the other.

**Not a settings question, but the fourth switch this feature turned out to need**: xterm's
`linkHandler.allowNonHttpProtocols`. It is an xterm option, carries no throng setting and is not
user-visible; without it xterm never hands a `file:` hyperlink over at all. See
[../data-model.md](../data-model.md) §8.

**The `IPathForms` pass-through** — a form the platform already understands resolves exactly as
written, rather than being separator-normalised by a port member that does not exist — is recorded
where the rule lives, in [link-resolution.md](./link-resolution.md) §2's amendment.

---

## §6 Amendment 2026-09-18 — one setting retired, one added, one reason added

### §6.1 The `Editor · Links` block after the change request

| Key | Control | Ships | Group · subgroup | FR |
|---|---|---|---|---|
| ~~`editor.links.defaultAction`~~ | — | — | **retired** | FR-112, FR-113 |
| `editor.links.detectInEditors` | `toggle` | `true` | Editor · Links | FR-060, FR-061 (unchanged) |
| `editor.links.detectInTerminals` | `toggle` | `true` | Editor · Links | FR-060, FR-061 (unchanged) |
| `editor.links.existenceCheckTimeoutMs` | `slider`, `step` 250 | `2000` | Editor · Links | FR-120, FR-061 |
| `terminals.advertiseHyperlinks` | `toggle` | `true` | Terminal | FR-080b (unchanged) |

**Retirement, on 019 FR-023's mechanism.** `DefaultLinkAction`, `DEFAULT_LINK_ACTIONS`, the interface
field, the `DEFAULT_APP_SETTINGS` entry, the `linkSettings` parse line, the `cloneEditor` field and
the descriptor are all deleted. Nothing else is written: `linkSettings` builds the block from the
leaves it knows, so a persisted `defaultAction` does not survive a parse, and the first ordinary
settings write leaves it out. That is the whole migration, as it was for `explorer.openMode`; a
comment at the deleted descriptor's position says so, on the pattern at `settings-metadata.ts:353`.
The idempotent-re-run assertion (FR-113) is a unit test: `parseAppSettings` of a document carrying
each of the five old values and a junk value yields no `defaultAction` and the other leaves intact,
and parse → serialise → parse → serialise is a fixed point.

**The new leaf.** Label **Existence-check timeout**. Description: how long throng waits for a file or
network location to answer before treating a path as not a link for now; applies to the next check,
with no restart; raise it for a slow network share. Bounded `250` – `25,000` ms by 031's bounds guard
(`bounds-guard.ts`'s `correctScalar` substitutes the default for anything outside). Displayed values
are digit-grouped — `2,000`, `25,000` — per the constitution's NON-NEGOTIABLE gate. The three
`Editor · Links` descriptors stay **consecutive** in `SETTINGS_METADATA` (§5).

**No `SHIPPED_DEFAULTS_VERSION` bump** — settings leaves only.

### §6.2 IPC — the failure reasons

`throng:links:resolve` may now answer `{ ok: false, reason: 'unreachable' }` (a bare `{ ok: false }`
still means "does not exist"). `throng:links:reveal` and `throng:links:open` may answer
`{ ok: false, reason: 'unreachable', path }`. `link-ipc.ts`'s handlers pass both through unchanged;
the sanitiser only ever touched the **request**. I1 – I6 are unchanged.

---

## §7 Amendment 2026-09-18, third round — one request field, one guard, no setting

### §7.1 The request gains `wslFlavour` (FR-151)

`LinkResolutionRequest` gains a sixth field, `wslFlavour?: true`, which a terminal sets when its
flavour is WSL (platform-ports §6.2) so main can skip Git Bash's mount table
([link-resolution.md](./link-resolution.md) §8 R13). The handler's whitelist admits it; any other
value than `true` is dropped.

| # | Rule |
|---|---|
| I7 | `wslFlavour` can only **remove** readings — the mount-table and platform steps — never add one, and it changes neither the project root main derives (I2) nor the existence re-check (I3). A renderer that lies about it can make a link resolve **less**, never reach a location the text did not name. It therefore needs no main-side verification, unlike a root, which I2 keeps in main |

`link-ipc.contract.test.ts` gains the whitelist case: `wslFlavour: true` passes, `wslFlavour: 'x'`
and `wslFlavour: false` arrive absent. *(Not written by this amendment — the file is in progress
elsewhere; T205 carries it, as its contract half.)*

### §7.2 No new setting

FR-150's word cap (`MAX_PATH_SPACE_WORDS`) is an integrity guard in `core/src/links/limits.ts`, not a
setting — [../plan.md](../plan.md) Complexity Tracking, third round. Git's install root comes from
shell detection, not configuration. FR-154 adds no switch: a dead hyperlink is not a link under any
setting. The `Editor · Links` block of §6.1 is unchanged, and so is `SHIPPED_DEFAULTS_VERSION` for this
round.
