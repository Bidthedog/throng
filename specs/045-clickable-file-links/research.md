# Phase 0 Research: Clickable File Links

**Feature**: 045 | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Every finding below is grounded in a citation from this worktree, read on 2026-09-18 at
`03ba7aed`. **No test, lint, typecheck or build command was run while this was written**; anything
only a run can settle is under *Open items*, with the command that settles it.

Paths are relative to `packages/` unless they start with `specs/`, `docs/` or a root file name.

---

## R1. Terminals have no link *provider* today — this feature adds the first

**Decision.** Detected file paths in a terminal are produced by **`term.registerLinkProvider(...)`**,
a new `TerminalFileLinkProvider` in `ui/src/renderer/terminal/file-link-provider.ts`, loaded beside
the existing `WebLinksAddon` and the `linkHandler`. Web links keep their present mechanism unchanged.

**Rationale.** Three mechanisms exist in `ui/src/renderer/terminal/use-terminal.ts` and they do
different jobs:

| Mechanism | Where | What it handles |
|---|---|---|
| `linkHandler: { activate, hover, leave }` | `use-terminal.ts:402-409` (a `Terminal` constructor option) | **OSC 8 hyperlinks only** — xterm hands it the target the program declared |
| `WebLinksAddon(handler, { urlRegex, hover, leave })` | `use-terminal.ts:800-806` | plain-text `http(s)` URLs, via its own internal link provider and `TERMINAL_URL_REGEX` |
| `registerLinkProvider` | **not used anywhere in the repo** | arbitrary per-line link discovery |

So FR-011 (explicit `file:` hyperlinks) is a change to the **`linkHandler`** path and needs no
detection at all — which is exactly why the spec makes US2 a separate slice. FR-001/FR-003 (detected
paths) is the `registerLinkProvider` path and is genuinely new code.

**Why not a second regex on `WebLinksAddon`.** The addon's constructor takes one `urlRegex` and one
handler; it is an `http(s)` opener with a pattern hole in it. Reusing it would mean one handler
receiving both kinds and re-deciding which it has, and it would make FR-009 ("a span that is a web
link MUST NOT also be a file link") an accident of regex alternation rather than a stated rule. A
separate provider makes precedence explicit: the file provider **declines** any span the web regex
already claims.

**Alternatives rejected.**

| Candidate | Why not |
|---|---|
| A single unified regex feeding `WebLinksAddon` | Collapses FR-009 into regex ordering; the addon's handler is `(event, uri) => void` with no room for a resolved target, a position or an "is it a folder" answer |
| Decorating the buffer ourselves (a custom overlay) | Re-implements underline, hover, wrap-following and selection interaction that xterm's linkifier already owns, and FR-008 forbids touching rendered text, selection, copy or reflow |

---

## R2. `provideLinks` is hover-scoped, which is what makes FR-071 true by construction

**Decision.** The existence check never runs on the output path because **nothing on the output path
calls the detector**. xterm calls a link provider's `provideLinks(bufferLineNumber, callback)` only
for the row under the pointer, on hover. The provider is the sole caller of the resolver.

**Rationale.** FR-071 says an existence check "MUST NEVER run on the terminal's output path", and
FR-072 requires a test that asserts it. A design in which the detector subscribes to `onData` or
`onWriteParsed` and then has to be throttled would make FR-071 a runtime property that has to be
measured. Making it a *structural* property — the module registers no data hook, and the resolver is
reachable only from `provideLinks` — makes it a unit assertion (see R14).

The editor half is the same shape one layer up: FR-073 limits detection to the visible range, which
is what `ViewPlugin` + `view.visibleRanges` already does in
`ui/src/renderer/editor/function-highlight.ts:187` (`buildDecorations` builds a `RangeSetBuilder`
over `view.visibleRanges` and nothing else). That file is the pattern to copy, not a new one to
invent.

**Open item O1** — xterm's link-provider contract is documented as "called for the line the pointer
is on". Confirm empirically that it is not also called during `refresh`/render for the whole
viewport, because if it were, FR-071 would need an explicit hover gate rather than relying on xterm.
Settled by a unit test with a fake `Terminal` (R14) plus the existing E2E fixture.

---

## R3. Resolution lives in **UI main**, not in the renderer

**Decision.** A candidate span is detected in the renderer (pure, from `@throng/core`); the
**resolution** — does it exist, is it a file or a folder, is it in the owning project, is it
executable — is answered by a new **`FileLinkResolver`** in `ui/src/main/file-link-resolver.ts` over
a new request channel, and the renderer caches the answer per link text + base directory.

**Rationale.** Four separate requirements force it into main, and no requirement pulls it the other
way:

1. **FR-006 / FR-020** need the filesystem. `IFileSystem.exists` and `.stat`
   (`core/src/abstractions/file-system.ts:19-67`) are implemented by `NodeFileSystem`
   (`ui/src/main/node-file-system.ts:35`), a main-process object; the renderer is sandboxed.
2. **FR-025** needs the user's home folder for `~`. There is no port for it —
   `homedir()` is imported directly in `ui/src/main/composition-root.ts:2`. It is a main fact.
3. **FR-039a** needs `PATHEXT` "read at the time of the decision". The renderer has no `process.env`.
4. **FR-037** says the process performing an action "MUST check again that the path exists, and for
   Open in Editor and Open in Preview that it lies in the project". A renderer-owned answer would
   have to be re-derived in main anyway; deriving it once, in main, is the same code doing the check
   once.

This also matches the shipped precedent for project membership: 044's plan records that isolation is
enforced in main and never trusted from the renderer, resolving a panel's project root from
`Panel.originProjectId` (`ui/src/main/editor-ipc.ts:71-83`).

**Consequence for the cache.** One round trip per *distinct* candidate, answered asynchronously.
FR-071's "a location whose existence is not yet known MUST be treated as not a link until it
answers" falls straight out: `provideLinks` returns nothing on a cache miss, fires the request, and
the next hover — which FR-070 already contemplates — sees the answer.

---

## R4. The #198 fix already carries FR-043, **provided `setHovered` is widened**

**Finding, and it is the single most load-bearing coupling in this feature.**
`keepLinkClickFromProgram` (`ui/src/renderer/terminal/use-terminal.ts:838-861`, added by `f407a506`
on this branch) reads:

```ts
if (ev.button !== 0 || !(ev.ctrlKey || ev.metaKey)) return;
if (hoveredLink === null || term.modes.mouseTrackingMode === 'none') return;
ev.stopPropagation();
ev.preventDefault();
term.focus();
```

`hoveredLink` is set by `setHovered` (`:368-392`), whose **first line filters to `^https?://`**
(`:369`). A file link therefore leaves `hoveredLink` at `null`, the interceptor does not fire, and
under a mouse-owning program one Ctrl+click would both open the file and be forwarded to the
program — the exact #198 defect, reintroduced for a new link kind.

**Decision.** `hoveredLink` stops being "the hovered URL string" and becomes "**the link throng has
resolved under the pointer**" — a discriminated value (`{ kind: 'web'; uri } | { kind: 'file';
target }`). Every consumer moves with it:

| Consumer | Today | After |
|---|---|---|
| `keepLinkClickFromProgram` (`:844`) | `hoveredLink === null` | unchanged in shape — now non-null for file links too, which is the fix |
| the hover tooltip (`:391`, text at `:311`) | `Ctrl+Click to open in system browser` | wording by kind (R10) |
| `getHoveredLink()` → `terminalLinkTarget` (`terminal-panel.tsx:268`) | a URL string | the resolved link, so the menu can compose FR-031 |

**This is why FR-043 needs no new mechanism and no new E2E declaration**: the mechanism shipped two
commits ago and is covered by `ui/tests/e2e/terminal-link-once.e2e.ts:529`
(`@extended @terminal @reserve:pty`). What it needs is a second *case* in that fixture (R15).

---

## R5. Four independent `^https?://` gates exist; FR-009/FR-013 need one

**Finding.** The same scheme test is written out four times:

| # | Site | Purpose |
|---|---|---|
| 1 | `ui/src/renderer/terminal/terminal-url.ts` (`TERMINAL_URL_REGEX`) | plain-text detection |
| 2 | `ui/src/renderer/terminal/use-terminal.ts:29` (`openTerminalLink`) | activation gate for **both** OSC 8 and plain text |
| 3 | `ui/src/renderer/terminal/use-terminal.ts:369` (`setHovered`) | hover/underline/tooltip gate |
| 4 | `core/src/terminal/link-menu.ts` (`terminalLinkTarget`) | menu gate |

**Decision (Principle VIII, DRY).** One core classifier,
`classifyTerminalLinkTarget(uri: string): TerminalLinkKind`, returns `'web' | 'file' | 'inert'` and
becomes the single authority sites 2, 3 and 4 consult. Site 1 stays a regex because it is a *text
scanner*, not a classifier, and it keeps matching `http(s)` only — plain-text `file://` is FR-003f's
business and belongs to the **file** provider's grammar, not to the web regex.

**What must not change.** `ui/tests/unit/external-url.test.ts` pins `isSafeExternalUrl` as http/https
only and lists `file:`/`FILE:` in its shared `INJECTIONS` array. The spec names that file explicitly
(*"MUST NOT change. FR-037 depends on it"*). Nothing in this feature goes near
`throng:openExternal`: a file link takes a **path-based** route and a `file:` URI is converted to a
path in main and never handed to the OS URL opener.

---

## R6. Two new Principle II ports, and why it is two rather than one or none

**Decision.** `core/src/abstractions/` gains:

```ts
// path-forms.ts — FR-025, FR-026, FR-012
export interface IPathForms {
  homeDirectory(): string;
  /** '/d/x' → 'D:\x'; '/mnt/d/x' → 'D:\x'; anything else → null. */
  fromDriveForm(posixPath: string): string | null;
  /** file:///D:/a%20b → 'D:\a b'; file://server/share/x → '\\server\share\x'; else null. */
  fromFileUrl(url: string): string | null;
  /** '~/x' → '<home>\x'. */
  fromHomeForm(path: string): string | null;
}

// executable-extensions.ts — FR-039a
export interface IExecutableExtensions {
  /** Answers from the extension alone. A folder is never executable. */
  isExecutable(path: string): boolean;
}
```

Both get a contract suite in `core/src/testing/` and a Windows implementation in
`platform-windows/src/`, bound in `ui/src/main/composition-root.ts`.

**Rationale.**

- **There is no path port today, deliberately.** Path *rules* are pure string functions in core
  (`core/src/fs/path-canon.ts`, `core/src/fs/path-id.ts`) with the separator passed in as a
  parameter, and `core/tests/unit/no-os-imports.test.ts` fails the build on an OS import in
  `core/src`. FR-026 asks for something those functions cannot be: a **mapping between spellings**
  that depends on what the OS means by `/d/x`, `~` and `file://server/share`. That is a platform
  capability, so it is a port.
- **Two ports, not one, because they answer different questions to different callers.** `IPathForms`
  is consulted during resolution; `IExecutableExtensions` is consulted when deciding what a gesture
  does. Interface segregation (Principle VIII) — and FR-039a asks for the classification to be
  "a single rule, stated once", which a one-method interface says better than a fifth method on a
  path object.
- **Core names no extension.** FR-039a requires it; the Windows implementation owns `PATHEXT` (read
  per call, not cached, so FR-039a's "without a restart" holds) plus the declared handler-launched
  set `.lnk .url .msi .msp .ps1 .scr .cpl .reg .hta .pif`.

**Model for the contract suite**: `core/src/testing/platform-info-contract.ts:18`
(`runPlatformInfoContract(makeSubject)`) — the pure-throw style that imports nothing, paired with
`platform-windows/tests/contract/windows-platform-info.contract.test.ts`. Classification is pure, so
the pure-throw style is right; the harness style (`file-system-contract.ts:27`, which imports
vitest) is for ports that need a temp tree.

**The duplication trap.** FR-021 ("in the project") must reuse `isUnderPath`
(`core/src/fs/path-id.ts:97`), not add a fifth normaliser. That file's own docstring records the
debt: `normaliseFolder` (`core/src/projects/project.ts`), `isWithinRoot`
(`core/src/explorer/path-rules.ts`) and `isFolderConflict` are already three near-copies. Read it
before writing anything path-shaped.

---

## R7. FR-038 is implementable through the **existing** `IDeElevator`, but not through `shell.openPath`

**Finding.** Nothing de-elevates an OS open today. `IShellIntegration`
(`core/src/abstractions/shell-integration.ts:8-18`) exposes `revealInFileManager`, `openFolder` and
`openExternal`; its Electron implementation calls `shell.showItemInFolder` and `shell.openPath`
(`ui/src/main/electron-shell-integration.ts:22,26,31`). Those are `ShellExecute`-style calls made by
the current process, so in an elevated throng the launched application inherits the elevated token —
which is precisely what FR-038 forbids.

`IDeElevator` (`core/src/abstractions/de-elevator.ts`) **can** fix it, and the reason is not
obvious: its contract is `wrap(spec: { file, args }) → { file, args }`, and both operations have a
launch-spec form.

| Action | Launch spec | Wrapped |
|---|---|---|
| Open in OS Explorer, file | `{ file: 'explorer.exe', args: ['/select,<path>'] }` | ✔ |
| Open in OS Explorer, folder | `{ file: 'explorer.exe', args: ['<path>'] }` | ✔ |
| Open in OS Default Program | `{ file: 'rundll32.exe', args: ['shell32.dll,ShellExec_RunDLL', '<path>'] }` | ✔ |

**Decision.** `IShellIntegration` gains `openWithDefaultProgram(path)`, and both it and
`revealInFileManager` route through a spawn the de-elevator can wrap when
`shouldDeElevate(...)` (`core/src/terminal/elevation.ts`) says so. Today's `shell.*` behaviour is
kept verbatim for the non-elevated case, so nothing changes for the overwhelming majority of runs.

**Why `cmd /c start "" <path>` was rejected** for the default-program route: it flashes a console
window, and its first quoted argument is a *title*, which is a well-known injection foot-gun when the
path is user-supplied.

**Open item O2** — whether `IDeElevator.isAvailable()` is true in the **UI main** process. Its only
consumer today is `platform-windows/src/node-pty-host.ts`, which runs in the daemon or the de-elevated
agent. Settled by `npx vitest run --project contract packages/platform-windows/tests/contract/windows-de-elevated-launcher.contract.test.ts` plus a new `@admin` case. If it is not, FR-038 is delivered by handing the de-elevation to the daemon over an existing RPC, and that is a design change worth its own research note.

---

## R8. Revealing a link's file needs a new confinement rule, and the spec already grants it

**Finding.** There are two reveal channels and neither accepts an arbitrary path:

- `throng:files:reveal` (`ui/src/main/files-ipc.ts:48`) takes a **root-relative** path and is
  confined by the project root (`files-service.ts:531-544`).
- `throng:files:revealDocument` (`files-ipc.ts:54`) takes an absolute path and is confined by the
  **open-document registry** — `this.isDocumentOpen?.(absPath)` (`files-service.ts:518-528`).

FR-030 offers **Open in OS Explorer** for *every* file link, including one outside the project and
one no panel has open. Neither existing policy allows that.

**Decision.** A new channel, `throng:links:reveal`, whose confinement is **FR-037's own rule**: main
re-resolves the link from the same inputs the renderer used, re-checks that the path exists, and
reveals it. The renderer never hands main a bare path to act on; it hands main the *link* (text,
base directory, panel id) and main resolves it. That keeps the renderer from being able to name an
arbitrary target, which is what the open-document confinement was protecting against.

The same envelope carries Open in OS Default Program, so both OS actions share one policy and one
re-check. The existing two channels are untouched.

---

## R9. `preview.followLink` keeps its **id**, widens its **scope**, and is dispatched at the window

**Decision.** FR-045's "one rebindable command" is the existing ActionId `preview.followLink`
(`core/src/config/keybindings.ts:147`, default `['Ctrl+Enter']` at `:408`). Its scope constant
changes from `PREVIEW_ONLY` (`:180`, `:256`) to a set containing `editor` and `preview`; its
metadata description (`keybindings-metadata.ts:166-173`, currently *"Live in a preview only."*) is
rewritten. **The id is not renamed.**

**Rationale for keeping an id that now spans editors.** A user's saved keybindings are stored by
ActionId. Renaming it to `link.follow` would silently drop every rebinding a user has made since 044
shipped — a behaviour change with no requirement behind it, to buy a tidier identifier. Recorded in
Complexity Tracking rather than argued away.

**Dispatch.** At the **window**, in capture phase, not in the CodeMirror keymap. The precedent is
written down in the repo: `navigate.gotoLine` is `EDITOR_ONLY` yet dispatched at
`ui/src/renderer/app.tsx:466-473`, and `use-editor.ts:1168-1180` records why — the chord goes through
the window so the scope gate runs, and the menu item reaches the same opener by a different route.
`editorCommandKeymap` (`ui/src/renderer/editor/commands.ts:575-590`) deliberately does **not** bind a
chord owned by a window-level command, precisely so the keypress is not `preventDefault`ed and
reaches the window listener (comment at `:581-583`). FR-044's "otherwise the chord keeps its current
editor meaning" then falls out: when no link holds the caret the window handler does not
`preventDefault`, and CodeMirror's `defaultKeymap` (`use-editor.ts:1232`) inserts the blank line as
it does today.

**Tests this changes, and no others** (the spec's own list): `core/tests/unit/keybindings-preview.test.ts:42-45`
(`scopesOf('preview.followLink')` is `['preview']`), `:56-59` (Ctrl+Enter resolves to nothing in an
editor) and `:119` (the scope-name column). The terminal assertions at `:61-67` — Ctrl+Enter resolves
to nothing in a terminal — **stay exactly as they are** (FR-046), as does
`ui/tests/e2e/terminal-modified-enter.e2e.ts:233`.

---

## R10. Two wordings the spec's Assumptions get wrong, and what they become

**(a) The hover tooltip.** The spec assumes *"the hover tooltip's wording for file links matches the
wording web links use"*. The shipped wording is built at `use-terminal.ts:311`:
`` `${linkChord}+Click to open in system browser` ``. Taken literally, a Ctrl+click on `src/foo.ts`
would promise to open it in a browser. FR-042's actual requirement is that the tooltip "name the
gesture", which the same *shape* satisfies: `Ctrl+Click to open`. Recorded as a reading, not a spec
change — the assumption meant "the same shape and the same delay", and the delay
(`terminals.linkHoverDelayMs`, `settings-metadata.ts:743-753`) is unchanged.

**(b) The chord on a terminal's Open Link item.** FR-031 requires Open Link to show "the Open Link
chord (FR-045)"; FR-046 requires that chord **not** to be live in a terminal. Showing it there would
advertise a key that does nothing. Constitution Principle VI settles it in as many words: *"A menu
item MUST show its command's current chord **where one is bound**"* — in the terminal scope none is.
So the chord is drawn on the editor's and the preview's Open Link items and **not** on the
terminal's. Recorded here so the menu contract does not have to re-derive it.

---

## R11. Where `FORCE_HYPERLINK` is assembled, and why it goes in `launch.env`

**Decision.** A pure core function in `core/src/terminal/spawn-env.ts`:

```ts
export function hyperlinkAdvertisementEnv(
  baseEnv: Readonly<Record<string, string | undefined>>,
  advertise: boolean,
): Record<string, string> | undefined;
```

returns `{ FORCE_HYPERLINK: '1' }` only when `advertise` is true **and** no case-insensitive
`FORCE_HYPERLINK` key is present in `baseEnv`; otherwise `undefined`. It is merged into the
`LaunchSpec.env` in `ui/src/main/terminal-ipc.ts`'s `doAttach`, beside the existing
`baseEnv: { ...process.env }` at `:283`.

**Rationale, and the trap it avoids.** The environment merge happens at
`platform-windows/src/node-pty-host.ts:135-138`:

```ts
env: {
  ...dropInheritedModulePath(sanitizeSpawnEnv(opts.baseEnv ?? process.env)),
  ...(opts.env ?? {}),
},
```

`opts.env` layers **on top**, so a value placed there always wins. But there is a second route:
**a de-elevated terminal never receives `baseEnv` at all**. `daemon/src/pty-agent-host.ts:290` sends
only `env: opts.env` in its `{op:'start'}` message and `daemon/src/pty-agent-entry.ts:172-179`
forwards `env: msg.env` — so a variable placed in `baseEnv` silently vanishes for a mixed-mode
terminal, while one placed in `launch.env` survives. FR-080 must hold for every terminal, so
`launch.env` is the only correct route.

**FR-080a is a decision about `baseEnv`, made where `baseEnv` is captured.** UI main's `process.env`
*is* "the environment the terminal is launched from" — the #209 comment at `terminal-ipc.ts:274-282`
says so explicitly, and says why the daemon's own environment is not (it may be days stale).

**FR-080d costs nothing**: the function returns at most one key, so throng cannot set `WT_SESSION` or
`TERM_PROGRAM` by construction. A `WT_SESSION` **inherited** from a user who launched throng from
Windows Terminal is not something throng set, and stripping it would be a change to the user's own
environment that no requirement asks for. The test asserts what throng *added*, which is what FR-080d
says.

**The setting must reach `doAttach`.** `registerTerminalIpc` (`ui/src/main/terminal-ipc.ts:94-115`)
takes `daemonClient`, `shellDetection`, `attachTimeoutMs`, `clipboard` and `foregroundHandoff` — no
settings. Two shipped patterns exist; `terminals.shellIntegration` rides on the resolved
`TerminalFlavour` (`core/src/terminal/flavour.ts:57-59`), and `terminals.commandPollMs` is re-read by
the daemon at process start (`daemon/src/composition-root.ts:128-135`). Neither fits: the flavour
route is wrong because hyperlink advertising is not a property of a shell, and the daemon route is
wrong because it needs a daemon restart, which FR-080c forbids. **Decision: an injected settings
reader** — `registerTerminalIpc` gains `readTerminalSettings: () => TerminalSettings`, wired in
`ui/src/main/main.ts:1661-1669` from the same `configStore` `ShellDetectionService` already uses
(`shell-detection-service.ts:52-60`). Read per attach, which is exactly FR-080c's "applies to
terminals started afterwards".

---

## R12. Opening at a line and column: a `RevealResolver`, not the open router

**Decision.** FR-033's "with the cursor at the link's position" is delivered by a new
`positionRevealTarget(line, column?)` in `ui/src/renderer/editor/reveal-range.ts`, handed to
`openFileInTab(ws, tabId, absPath, openTarget, range)` (`ui/src/renderer/editor/editor-open.tsx:156-174`).

**Rationale.** `RevealRange` is `{ from, to }` in **absolute document offsets**
(`reveal-range.ts:30`), not line/column — offsets that cannot be computed until the document is
loaded. `RevealTarget = RevealRange | RevealResolver` (`:44`) exists for exactly that case, and
`headingRevealTarget(absPath, fragment)` (`:55`) is 044's worked example of "a place only findable
once the doc is loaded". `revealRangeInEditor` (`:90`) then polls `getEditorView(panelId)` and
dispatches the selection. The "position beyond the file's end" edge case is a clamp inside the
resolver, which is a pure unit-testable decision.

**A link with a position must not go through `open-router.ts`.** Its module header (`:5-17`) is
explicit that Find in Files and the Open In editor targets deliberately bypass it *because "a preview
cannot reveal a line and column" (044 FR-054)*. FR-052 states the same rule for links. So:

- **Open in throng, no position** → `openFromTree(...)` (the router), which applies
  `defaultOpenActionFor` (`core/src/config/preview-settings.ts:283-294`).
- **Open in throng, with a position** → `openFileInTab(..., positionRevealTarget(...))` directly.
- **Open in Editor** (the named variant) → always `openFileInTab`, never the router (FR-033/044 FR-055).
- **Open in Preview** → `requestPreviewOpen({ absPath, projectId, requesterPanelId })`
  (`ui/src/renderer/preview/open-preview.ts:330`), which already places beside the file's editor
  (`:218-220`).

---

## R13. Editor gestures: Ctrl+click must beat CodeMirror's own multi-cursor

**Finding.** There is **no `mousedown` or `click` handler anywhere in `ui/src/renderer/editor/`** —
the only `EditorView.domEventHandlers` blocks are `contextmenu` (`use-editor.ts:1146`) and
`drop`/`dragover` (`:1276`). Ctrl+click adding a cursor is CodeMirror's own internal mouse-selection
handler, enabled here by `EditorState.allowMultipleSelections.of(true)` (`:1049`), which the block-
selection story requires.

**Decision.** A `mousedown` entry in a new `EditorView.domEventHandlers({ mousedown })` that returns
`true` (consuming the event) **only** when the modifier is held and a resolved file link is under
`view.posAtCoords({ x, y })`. Returning `true` stops CodeMirror's own handler, so FR-041's "anywhere
else, Ctrl+click keeps the meaning it has today" is the default path, untouched.

The modifier itself follows the shipped rule rather than a literal: `rectangularSelection({
eventFilter })` (`:1058-1069`) takes its modifier from
`shippedBindingsFor(DEFAULT_BINDING_PLATFORM).columnSelectModifier` (`:138`) rather than hardcoding
Alt. FR-040's Cmd-on-macOS clause is the same requirement, so the link handler reads the platform's
"follow link" modifier from one place.

**Decoration.** Underline + pointer cursor via `Decoration.mark({ class: 'cm-throng-link' })` in a
`ViewPlugin` over `view.visibleRanges` — `function-highlight.ts:172-222` end to end, and it is
delivered through a compartment so FR-060's switch can turn it off live, exactly as
`functionHighlightCompartment` and `wrapCompartment` already do (`use-editor.ts:462-466`,
`:939-952`, `:1254`).

---

## R14. Test layers — what proves what, and why almost nothing reaches E2E

The full map is in [plan.md](./plan.md) *Testing strategy*. Three placements are worth their
reasoning here, because each is a place where E2E is the tempting answer and the wrong one.

**FR-072 (no existence check on the output path) is a unit test.** The provider factory is
constructed with a fake `Terminal`-shaped object and a fake resolver port; 50,000 lines are pushed
through the fake's data path; the resolver must have been called **zero** times; one
`provideLinks(row, cb)` then calls it exactly once, and a second call for the same span calls it not
at all (FR-070's cache). That asserts the structural property R2 describes. An E2E could only assert
a wall-clock time, which is SC-004, and which is not asserted at all (below).

**SC-004's 5% ceiling is deliberately not asserted.** A wall-clock bound on a shared hosted runner
is a flake by construction, and a flaky gate costs more than the property it guards — the reasoning
044's plan records for SC-002. It is a measured annotation in the quickstart instead.

**FR-080's environment is an integration test, not an E2E.** The spec says so, and the mechanism
allows it: the pure function is a unit test over a fake `baseEnv` (three cases: absent → set; present
as `0` → untouched; present as `1` → untouched), and
`platform-windows/tests/integration/` spawns a real shell that echoes its environment. The
worktree already carries an untracked sibling of exactly this shape,
`platform-windows/tests/integration/shell-leaves-start-dir.integration.test.ts`.

---

## R15. The E2E budget is a both-ways ratchet, and this feature holds it flat

**Facts.** `ui/tests/e2e/e2e-budget.json` reads `"total": 570`, `"core": 39`, with `@terminal` at
107 — and its own changelog records that **#198 already spent a slot on this branch**
(`569->570`, `@terminal 106->107`). `ui/tests/e2e/reserve-tag-debt.json` reads `"untagged": 114`.
`ui/tests/unit/e2e-tags.test.ts` caps `@core` at 50, enforces exactly one significance tag, at least
one category tag and at most one `@reserve:*` entry from a closed list of nine.

**Decision: zero new E2E declarations.** Two existing declarations gain cases:

| Declaration | New case | Reserve entry it already carries |
|---|---|---|
| `terminal-link-once.e2e.ts:529` | the same one-click-one-open assertion for a **detected path** and for an **OSC 8 `file:` target naming a folder**, under the same mouse-owning fixture | `@reserve:pty` |
| `terminal-links.e2e.ts` | a detected path is underlined on hover and a look-alike that names nothing is not | (tagged with the file's existing entry) |

**Why each is irreducible and why neither needs its own declaration.** Both assert one property — a
Ctrl+click on a link throng resolved opens it once — over a second link kind. No lower layer has a
real xterm linkifier, a real ConPTY mouse-tracking mode or a real stream of forwarded bytes to count,
which is `@reserve:pty` exactly. Adding a case inside a table-driven declaration does not raise the
budget: the counter is a per-line regex over `test(` declarations, and the file records that
loop-driven table tests count once.

**If the tasks phase finds a case that genuinely needs its own declaration**, it must be paid for by
moving one down, and the candidate pool is stated rather than hoped for: the 114 declarations that
name no reserve entry. The constitution's own words — *"an existing E2E test whose assertion a lower
layer can make MUST be moved down"* — make that owed anyway.

---

## R16. Constitution Principle VI's "Known gaps" sentence is **already** stale

**Finding.** FR-091 asks for a PATCH amendment on delivery, because Principle VI's *One gesture
follows a link* rule says *"no surface yet implements Ctrl+Enter"* and that spec 044 and #394 "add
the first". 044 **has shipped**: `preview.followLink` is bound to `Ctrl+Enter`
(`core/src/config/keybindings.ts:408`) and dispatched at
`ui/src/renderer/preview/preview-commands.tsx:162-167`. So the sentence is wrong today, before this
feature changes anything.

**Decision.** FR-091's amendment is still a PATCH and still lands with this feature, but it corrects
**two** statements rather than one: that no surface implements Ctrl+Enter (044 does), and that
editors do not (045 does). Recorded here so the amendment's SYNC IMPACT REPORT can say what it found
rather than restating FR-091's premise.

---

## R17. Retire the default link action rather than narrow it *(2026-09-18, change request)*

**Question.** The maintainer's rule fixes where every link goes. What becomes of FR-050's five values?

**Options.** (a) Narrow to the values the rule permits — `throng`, `editor`, `preview`. (b) Retire
the setting.

**Decision: (b).** Every destination is now decided: a folder and an out-of-project file go to OS
Explorer, and a web link to the browser, whatever a preference says. The only choice left — editor or
preview for an in-project file — is already made by 044's per-provider default open action, which
Files & Folders, Quick Open and Find in Files all follow. Keeping `editor` and `preview` as link-only
overrides would let a link open a file differently from the tree, which is the drift the maintainer's
"identical" forbids, and would keep a preference whose remaining job duplicates another — the YAGNI
half of Principle VIII. `osExplorer` as a whole-link value contradicts "in throng if it's a local
file". `osDefaultProgram` is withdrawn by name.

**The persisted value.** 019 FR-023 is the precedent for a retired key: dropped, not migrated,
because migration must invent an intent. Its test (C1) asks which option preserves what the user
experiences. Here no option preserves everything — the maintainer has withdrawn behaviours — but the
setting **never reached a release** (branch-only, PR #408), and the shipped value `throng` becomes the
click rule exactly. Dropping is therefore both the precedent and the answer with no invented intent.
The mechanism is the tolerant parse, as it was for `explorer.openMode`: nothing to write.

**Constitution.** Principle VI's *A preference picks the default* is conditional ("When a preference
decides…"); the deciding preference is now 044's, and the plain Open Link item runs it. No amendment.

## R18. D1 — where a network path is lost *(2026-09-18)*

**Evidence.** The untracked reproduction `core/tests/unit/link-resolve-unc.test.ts` (another
session's work in this worktree, adopted by T135, not rewritten) records a trace against real shares
— absolute UNC paths survive detection, `resolveCandidate`, `NodeFileSystem.stat` (1 – 8 ms),
membership and `FileLinkResolver` — and a failure at one point: joining onto a UNC base.

**Code, read, not yet run.** `join` in `core/src/links/resolve.ts`:

```ts
const segments = base.split(/[\\/]/).filter((s, i) => s.length > 0 || i === 0);
```

`\\fileserver\home\dir` splits to `['', '', 'fileserver', 'home', 'dir']`; the filter keeps index 0 and drops
index 1, so the result is `\fileserver\home\dir\…` — rooted at the current drive. Every R5 join (a
terminal's network cwd, an editor's network folder) and every R6 join (a network project root) is
affected. `..` handling has the same defect one level up: `segments.length > 1` lets `..` pop the
share.

**Second finding, same reproduction.** PowerShell prints a network location provider-qualified
(`Microsoft.PowerShell.Core\FileSystem::\\fileserver\home`), in the prompt and in `pwd`; the grammar's
"a colon anywhere else means not a path" rule refuses the whole token. FR-003g adds the form.

**Status.** A **hypothesis** in CLAUDE.md's sense until T135 runs the reproduction and the maintainer
confirms it matches what they saw. The absolute-path control in the same file is the anti-vacuity
check: if it fails, the join cases are failing for another reason.

## R19. Bounding an existence check *(2026-09-18)*

**Question.** FR-071 says a slow location is "not a link until it answers", and says nothing about
what an offline share costs.

**Finding (hypothesis — not measured on this machine).** `IFileSystem.stat` is `fs.promises.lstat`,
which runs on the Node thread pool (four threads by default). Against a server that does not answer,
Windows' SMB client waits out its own timeout — commonly tens of seconds — and the thread is held for
all of it; JavaScript cannot cancel it. Four such hovers would occupy the whole pool, and every
`fs.promises` call in UI main — saving a document, reading one, the watchers' follow-up stats —
would queue behind them. The renderer never blocks (P5 holds), but a save could.

**Decision.** Race each check against a timeout (a setting — the right value is a property of the
network, Principle X), mark the volume root of a check that loses, and answer at once for that root
until the stuck call settles; cap the stuck calls process-wide at two, so half the default pool is
the most links can ever hold. `node:path`'s `parse(p).root` gives `\\server\share\` for UNC and `C:\`
for a drive, which also gates a **mapped** drive to an offline server without any "is this a network
drive" question to the OS.

**Open question O7 (FR-123).** The terminal provider holds its reply to xterm for
`LINK_ANSWER_DEADLINE_MS` and drops an answer that arrives later, because xterm keeps one reply per
line (`Linkifier._askForLink`, `useLineCache`). Two candidate mechanisms: (a) hold the reply for the
existence-check timeout rather than a separate constant, so a check that answers at all answers in
time; (b) on a late answer, make xterm ask again for that line. (a) is the smaller change and removes
a Principle X constant; its cost is that a line's other links wait for its slowest candidate.
T149's test states the observable either must satisfy; the choice is T150's, recorded here when made.

## R20. One web grammar, moved rather than copied *(2026-09-18)*

**Finding.** `TERMINAL_URL_REGEX` lives in `ui/src/renderer/terminal/terminal-url.ts`, and an editor
has no URL scan at all — `link-decorations.ts` passes `claimed: never[] = []`, which contradicts
[contracts/link-resolution.md](./contracts/link-resolution.md) §1's "the editor passes the ranges its
own URL scan matched". The contract described a scan that was never built.

**Decision.** Move the pattern to `core/src/links/web-url.ts` byte-for-byte, re-export it from
`terminal-url.ts`, and leave `ui/tests/unit/terminal-url.test.ts` untouched as the proof nothing
changed. Add `scanLinkLine` so both surfaces take a line's links from one call (FR-104). Copying the
pattern into the editor would have been two grammars that agree today — the precondition for the
drift FR-104 forbids.

## R21. Wrapped links — why nothing past the first row is clickable *(2026-09-18, second round)*

**Code, read, not run.** `file-link-provider.ts` reads exactly one buffer row
(`buffer.active.getLine(n - 1).translateToString(true)`) and builds every range with `start.y` and
`end.y` both equal to that row. A path that wraps is therefore two unrelated fragments to it, and
each fragment usually names nothing, so neither row is a link. Plain-text URLs come from
`WebLinksAddon`, which the maintainer's report says fails the same way; #326 recorded the underline
half of it for OSC 8. xterm marks continuation rows (`IBufferLine.isWrapped`), and `ILink.range` may
span rows, so the fix is to scan the logical line and map spans back to cells. Serving web links from
the same provider (via `scanLinkLine`) retires `WebLinksAddon`; that is the DRY half of FR-104 in the
terminal and the only way FR-135's affordance is drawn by one mechanism.

**Hard wraps.** A TUI that inserts its own newline breaks the logical line, and xterm cannot tell a
wrapped path from two paths. FR-132 declines to guess; OSC 8 is the exception because xterm links
cells by declared target, not by row.

## R22. At rest, not hover only *(2026-09-18, second round)*

**Options.** (a) Hover only — today's terminal behaviour for web and detected links. (b) At rest for
every link. (c) At rest for declared links (web, OSC 8) and hover-only for detected paths.

**Decision: (b), with detected paths marked once resolved.** (a) fails the maintainer's test ("it
should be clear to users that links can be clicked"): discovering links by sweeping the pointer is
the opposite of clear. (c) is the inconsistency the maintainer reported, relocated. (b) is what the
editor already does (its `ViewPlugin` marks resolved links in the visible range).

**Squaring it with FR-071/FR-072.** An at-rest mark on a detected path needs its existence answer
first. FR-071 forbids a check on the **output path**; FR-070 already allows checks "for the visible
range". So: an idle scan of the rows in view, started only when output has been quiet for
`LINK_IDLE_SCAN_MS`, cancelled by the next write, bounded by the viewport and the per-line cap, and
sharing the cache with hover. During streaming nothing is checked — exactly today's state — and
FR-072's zero-check assertion keeps its meaning. Cost: under output that never stops, detected paths
are marked only on hover, which is no worse than before.

**Style.** Dashed at rest, solid on hover: xterm already draws OSC 8 links dashed at rest, which is
the look the maintainer saw and read as "a link"; making every other kind match costs one style,
where changing OSC 8's may not be possible (O10). The text colour is left alone — a terminal link must
not alter rendered output (FR-008), and an editor's syntax colours must survive.

**Addendum 2026-09-18 (T184, O10 settled).** It is not possible through xterm 6.0.0's options: the
OSC 8 underline is a property of the CELL (`ExtendedAttrs.underlineStyle` answers `DASHED` for any
`urlId`), rendered as `xterm-underline-5` in the cell's colour, and the Linkifier's hover underline is
an inline style in the same colour. So the terminal's mark is an xterm DECORATION per occupied row
(`link-marks.ts`) — dashed `linkUnderline` at rest, solid `linkUnderlineHover` on hover, the pointer
only with the modifier — the same for all three kinds (FR-139), and xterm's own visuals are neutralised
in `terminal.css`. At-rest marks for OSC 8 links need their ranges before any hover; the public API
exposes no `urlId`, so the idle scan calls xterm's own OSC 8 provider (`_core._linkProviderService
.linkProviders[0]`, registered first in xterm's constructor) — guarded, and if it moves the only loss
is the at-rest mark on OSC 8 links. A dead OSC 8 target (FR-154) is judged in `link-marks.ts` and in
`use-terminal.ts`'s `linkHandler.hover`, never drawn.

## R23. Flavours and their directories *(2026-09-18, second round)*

**Built-in flavours** (`platform-windows/src/windows-shell-detection.ts`): `windows-powershell`,
`pwsh`, `cmd`, `git-bash`. WSL is not one (the detector deliberately avoids mislabelling
`System32\bash.exe`); it runs as a user-defined flavour.

**Who reports a directory today** (025 D2, `core/src/terminal/command-recipe.ts`):

| Flavour | Mechanism | With `terminals.shellIntegration` off |
|---|---|---|
| `cmd` | observed — `cd` moves the process directory, read by the daemon's PEB poll | unchanged, still observed |
| `windows-powershell`, `pwsh` | reported — a `prompt` function emits OSC 9;9 (`BUILTIN_SHELL_INTEGRATION`) → `reportTerminalCwd` | cannot report; the PEB poll returns the **launch** directory |
| `git-bash` | reported — `PROMPT_COMMAND` via environment emits OSC 9;9 with `cygpath -w` | cannot report; same |
| WSL (user-defined) | none — but `flavourReportsDirectory` answers **true** for it (absent from both maps ⇒ "observable"), so the stale launch directory of `wsl.exe` would be used as a link base today | none |

`flavourReportsDirectory(id, enabled)` already encodes the middle column. **Consequence for links**:
no built-in flavour needs new integration. The one risk is using the PEB poll's stale launch
directory as a base for a flavour that cannot report — FR-143 forbids it, and T188 checks what the
code does today before changing anything.

**OSC 8 through ConPTY.** Whether each flavour's ConPTY path passes OSC 8 intact on this Windows build
is a fact to measure, not to assume: T190 prints one through each real shell and reads the raw PTY
stream; the matrix probe (O11) confirms it end to end.

## R24. A request for an extended reading answers for that reading only *(2026-09-18, T202)*

**Finding.** T202 expected no production change — "the resolver already takes the first reading that
exists". T201's SC-020 cases showed otherwise: `FileLinkResolver.readingsOf` re-runs detection on the
request's text, and since FR-150 that text may itself be an extended reading
(`<root>\with space\notes.md for details`). Re-detection then yields the SHORTER readings inside it,
the resolver takes the first that exists — `…\notes.md` — and answers the long request `ok`. The
surface, walking its candidates longest first, takes that answer as the long reading's, and underlines
"for details" as part of the link.

**Decision.** `readingsOf` keeps only the readings of the WHOLE text: the candidates starting at the
first candidate's start and reaching the widest candidate's end, a position suffix counted as part of
its reading (so `src/foo.ts:42:7`'s positioned and unpositioned twins both stay, R7). Choosing among
nested readings is the surface's walk, which already asks for each; main answering a longer request
with a shorter file was a second opinion about FR-150 living in main — the same thing `readingsOf`'s
verbatim fallback already refuses to be for FR-003.

---

## Open items

| # | Question | Command that settles it |
|---|---|---|
| **O1** | ~~Is `provideLinks` called only on hover, or also during viewport render?~~ (R2) | **SETTLED 2026-09-18: hover only, and the answer is structural rather than measured.** `ui/tests/unit/terminal-file-link-provider.test.ts` — **14 passed** — pushes 50,000 lines through a fake `Terminal`'s data path and asserts the resolver port receives **zero** calls; one `provideLinks(row, cb)` calls it exactly once; a second call for the same span calls it **not at all** (FR-070's cache); and the provider module registers no `onData`/`onWriteParsed` hook at all, which is what makes P1/P2 true by construction rather than by timing. The E2E half of the original command was **not** needed and was not run: the claim is about which callbacks exist, and a fake `Terminal` answers it without an app. R2's reading is confirmed. |
| **O2** | ~~Is `IDeElevator.isAvailable()` true in **UI main**?~~ (R7) | **SETTLED 2026-09-18, and the question was aimed at the wrong object.** Literally: `IDeElevator.isAvailable()` is `false` in UI main — and everywhere else — because **no concrete `IDeElevator` exists in this repository**. The only value of that type is `passthroughDeElevator`, whose `isAvailable()` is `false` by construction, and `NodePtyHost` defaults to it (`node-pty-host.ts:83`). Nothing binds another. But that does **not** trigger the "hand it to the daemon over an RPC" contingency, because the mechanism that actually de-elevates is `WindowsDeElevatedLauncher`, which is **not** an `IDeElevator`: it exposes `launch(file, args, report)`, not `wrap(spec)`. Its `isAvailable()` is `process.platform === 'win32'` — a property of the platform, not of being the daemon — so it is **true in UI main**, and a vitest process (an ordinary Node process, as main is) confirms it: `windows-de-elevated-launcher.contract.test.ts`, 5 passed. **Consequence for T055**: FR-038 is delivered in-process by constructing `WindowsDeElevatedLauncher` in UI main and calling `launch`, with no new RPC and no daemon round trip. `plan.md`'s Complexity Tracking row is unchanged, because the contingency it was written for did not occur. `contracts/platform-ports.md` §3's "launch through `IDeElevator.wrap({file, args})`" is corrected by the amendment in that file — `wrap` returns a spec for a spawner to run, and a reveal has no spawner. |
| **O3** | Does `explorer.exe /select,<path>` behave identically to `shell.showItemInFolder` for a UNC path and for a path with a comma? (R7) | **PARTLY SETTLED 2026-09-18** — `platform-windows/tests/integration/explorer-select-path.integration.test.ts`, 4 passed / 1 skipped. **The comma is safe at throng's layer**: `/select,` is a prefix on ONE argv element, not a separator between two, and Node passes argv as an array, so nothing re-splits it — `C:\Reports\2026,Q1\summary.txt` reaches the process intact, which is asserted unconditionally. **The launch half is `@admin` and has not run here**: a developer machine is not elevated, and a launched `explorer.exe` opens a window on the desktop, so what explorer then makes of a comma or a UNC path is answered by CI or by the hands-on step in quickstart §4 — never by softening the case into one that passes. The test prints which half ran on every run. |
| **O4** | Does Claude Code actually emit OSC 8 under `FORCE_HYPERLINK=1` in a throng terminal, on this Windows build? (US7 scenario 6) | **STILL OPEN at the close of Phase 12.** The hands-on step in [quickstart.md](./quickstart.md) §6 is the only thing that can answer it, and it needs the running app, so it is deliberately left for the maintainer (T121). It is a property of **Claude Code**, not of throng: throng's half — that the variable is set, that a user's own value survives, and that nothing else is added — is settled by `core/tests/unit/spawn-env-hyperlinks.test.ts` (E1–E7) and by the real-shell integration test `platform-windows/tests/integration/terminal-hyperlink-env.integration.test.ts`. Whatever the answer, no throng code changes on it. |
| **O5** | ~~Does widening `preview.followLink`'s scope leave `keybindings-collision.test.ts` green?~~ (R9) | **SETTLED 2026-09-18: yes.** With `COMMAND_SCOPES['preview.followLink']` widened from `PREVIEW_ONLY` to `LINK_SURFACES` (`editor` + `preview`), `keybindings-preview.test.ts`, `keybindings-collision.test.ts` and `keybindings-scope.test.ts` run **42 passed, 0 failed**. Nothing else in the editor scope claims `Ctrl+Enter`, so no collision rule fires and no second command has to be introduced. The three edits S3 permits in `keybindings-preview.test.ts` were made and no others; `:61-67` (Ctrl+Enter dead in a terminal, FR-046) is untouched and still green. |
| **O6** | Measured cost of the FR-073 visible-range scan on the largest fixture document, for SC-004's editor half | **STILL OPEN at the close of Phase 12.** SC-004's wall-clock ceiling is measured in a running app (quickstart §5) and is deliberately **not** asserted by any test, so it is left for the maintainer (T114). Its **structural** half is already settled and is the half a regression would break: O1 above proves no existence check runs on the output or typing path, and the editor's scan is confined to the visible range by the `ViewPlugin` it lives in. |
| **O7** *(2026-09-18)* | How does a late existence answer reach xterm for the line it belongs to (FR-123)? (R19) | **SETTLED 2026-09-18 (T150): mechanism (a).** The provider holds its reply for `existenceCheckTimeoutMs`, read from `editor.links` on every ask (`readLinkSettings`, the resolver's own dependency shape), because main answers every check within that timeout — `unreachable` included — so an answer that arrives at all arrives inside the hold. `LINK_ANSWER_DEADLINE_MS` survives only as the fallback for a caller that offers no settings (unit tests). The superseding rule is unchanged: a newer `provideLinks` call drops the held reply. The idle scan reads rows through a separate non-holding `linksOnLine`, so a scan cannot supersede the reply xterm is waiting for. `terminal-file-link-provider.test.ts`, T149's two cases green. |
| **O8** *(2026-09-18)* | Does D1's reproduction fail as recorded, and does it match what the maintainer saw? (R18) | **OPEN.** T135: run `core/tests/unit/link-resolve-unc.test.ts`, show the output, wait for the maintainer. |
| **O9** *(second round)* | Does xterm's own OSC 8 handling hover and activate a hyperlink from a soft-wrapped **later** row? (R21) | **OPEN.** The E2E case in T186 answers it; if not, throng's provider serves OSC 8 ranges on continuation rows too. *Evidence 2026-09-18 (third round), not yet the T186 case:* the matrix probe's 76-column pass (row 66, a wrapped OSC 8 `file:` link) showed a Ctrl+click on row 2 **does** activate it, and the solid hover underline covers **only the hovered row** — #326 as filed. So activation needs nothing; the hover half is T185/T187's. |
| **O10** *(second round)* | Can xterm's OSC 8 underline be styled from the theme tokens, or must a decoration replace it? (R22, FR-139) | **SETTLED 2026-09-18 (T184, by reading the pinned `@xterm/xterm` 6.0.0 source; see R22's addendum): a decoration must replace it.** xterm offers no option for a link's colour or style. `ExtendedAttrs.underlineStyle` returns `DASHED` for ANY cell carrying a `urlId`, whatever its target, so the DOM renderer gives every OSC 8 cell `xterm-underline-5` in the cell's own colour; a hovered link from any provider gets an inline `text-decoration: underline` and the screen `xterm-cursor-pointer`. Throng therefore draws the one mark itself (`link-marks.ts`, T187) and switches xterm's off: `decorations` false on the links its own provider serves, and `terminal.css` neutralising `xterm-underline-5`, the inline hover underline and xterm's pointer inside a terminal panel. **Recorded cost:** a program's own SGR 4:5 dashed underline is drawn without its underline in a terminal panel, because xterm gives it the same class. **Consequence for T213:** the `xterm-underline-5` class is still present on a dead OSC 8 link's cells (it cannot be removed through the API); the E2E must assert the COMPUTED `text-decoration-line`, not the class. |
| **O11** *(second round)* | The flavour matrix (FR-145) — which cells pass on this machine, per flavour, including OSC 8 through ConPTY? (R23) | **RECORDED 2026-09-18 (third round, T193).** A temporary Playwright probe ran the maintainer's corpus (81 rows) against the worktree build at `7f985028`, with every OS seam a recorder, in `cmd`, `windows-powershell`, `pwsh` and `git-bash` at 144 columns (plus a 76-column pass for wrapping) and against the same text in an editor. **The four flavours are identical on all 81 rows: 51 pass, 30 fail each.** The editor: 27 pass, 34 fail, 20 not applicable (OSC 8). WSL: **not run** — no WSL flavour is configured (not a built-in; T220). Per FR-145 cell: *OSC 8 `http`* passes in every flavour (so OSC 8 survives ConPTY in all four); *OSC 8 `file:`* fails — out-of-project targets open in the default program (T155 – T158), `file://localhost/C$/…` and `file:///mnt/c/…` do nothing (FR-153), and dead targets are drawn as links (FR-154); *plain-text URL* passes in every terminal and is **not a link** in the editor (T161 – T168); *absolute path, each form* — out-of-project files open in the default program in both panel types (T155 – T158), paths with a space are never recognised (FR-150), `/usr/bin/…`, `/etc/…` and `/tmp` are not mapped to Git Bash's meaning (FR-151/FR-152), `file:///c/…` is not recognised (FR-153); executables are revealed and never run (pass, every row); *relative path after `cd sub`* was not exercised by the corpus (T192); *position suffix* — terminal opens at 1:1 (D2, T174/T175; `terminal-panel.tsx:271-274`), editor passes; *wrapped link* — every wrapped plain-text path is no link at all, the wrapped web URL passes, the wrapped OSC 8 link's hover covers one row (T176 – T187); *affordance* — OSC 8 links carry xterm's dashed underline plus throng's solid hover, plain-text links only the solid hover (T184 – T187). Two failures outside the expected column: an editor first-character Ctrl+click missed a decorated link in 2 of 27 attempts (D3) and, by reading, FR-038's launcher is not wired (D4). The row-by-row mapping is [tasks.md](./tasks.md) Phase 15. The maintainer's folder was snapshotted before and after the run and is unchanged. |

### Where the six stand, 2026-09-18 (T131)

Settled: **O1** (hover only, structurally), **O2** (de-elevation is in-process via
`WindowsDeElevatedLauncher`, no new RPC), **O5** (the widened scope collides with nothing).
**O3** is *partly* settled — the comma is safe at throng's layer, asserted unconditionally; the
launch half is `@admin` and answered by CI or by hand, never by softening the case. **O4** and
**O6** both need the running app and are open by design; neither gates any code, and both are named
in `tasks.md` as T121 and T114.

Nothing here has been deleted or rewritten. An open item that turned out differently from how it was
asked is recorded as it was asked and then answered — **O2** is the worked example: the question
named the wrong object, and saying so is the finding.
