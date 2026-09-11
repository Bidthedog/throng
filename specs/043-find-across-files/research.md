# Phase 0 Research: Find / Replace in Files

**Feature**: 043 | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

Every decision below is grounded in a citation from this repository. Where the spec assumed something
that turned out not to hold, that is stated as a **correction**, not smoothed over — three of them
change what gets built.

---

## R1. The search seam: what "reuse, not duplicate" actually means

**Decision.** Hoist the **match-mode model** (`MatchModes`, `Match`, `editorMatches`) from
`packages/ui/src/renderer/search/search-model.ts` into `packages/core`, re-exporting from the old home
so no existing caller changes. **Do NOT implement `SearchController` a third time.**

**Rationale.** The spec's Assumption says "the engine-agnostic search controller seam and the
match-mode model are extended rather than paralleled". Read against the code, those two halves have
opposite answers.

The controller (`packages/ui/src/renderer/search/search-controller.ts:12-51`) is shaped around **one
in-memory buffer with a cursor**, and every method breaks on a file corpus:

| Contract | Why a corpus breaks it |
|---|---|
| `setQuery(term, modes): SearchCount` — synchronous, returns a **complete** count | FR-041 streams; there is no total until the walk ends |
| `findNext()` / `findPrevious()` with wrap-around | FR-032/FR-037 is a list you click, not a cursor you step |
| `Match { from, to }` — offsets in one document | A row needs `{ path, line, column, lineText, from, to }` (FR-036) |
| `close({ refocus })` — "hand focus back to the panel content" | A Find in Files panel **is** the results; there is no content behind it |
| Registry keyed by `panelId` = the panel **being searched** (`:53`) | Here the panel is the **searcher**. Same key, inverted meaning |
| `replaceAll` commits immediately in one transaction | FR-046/FR-047 need an **uncommitted preview** spanning many files |

A third implementation would be a Liskov violation with no shared caller: nothing consuming
`SearchController` today (`find-bar.tsx:40`, `search-keybindings.tsx:110`) could drive it.

The match model, by contrast, **is** reusable. `editorMatches` (`search-model.ts:40-56`) is
`@codemirror/search`'s `SearchQuery` with `literal: true` over a CodeMirror `Text`, and
`Text.of(lines)` builds one from a plain string array — `packages/ui/tests/unit/search-model.test.ts:19`
already does exactly that. FR-039's "rather than reimplementing them" points here.

**The obstacle, and its exact precedent.** `search-model.ts` lives under `src/renderer/`, and **main
never imports from renderer** (verified: zero matches for `from '../renderer` under `src/main/`). This
is the situation `packages/core/src/editor/refusal.ts:1-13` describes and resolves for the identical
reason — a pure domain decision with consumers in two processes belongs in core. Follow it exactly,
including the re-export from the old home.

**Cost to declare.** `packages/core` depends on `picomatch` and nothing else
(`packages/core/package.json:21-23`). Hoisting adds `@codemirror/state` and `@codemirror/search`. Both
are pure JS with no DOM and no OS calls, so Principle II is not breached — but a new engine dependency
in the domain layer is stated in the Constitution Check, not slipped through.

**Alternatives rejected.** (a) Implement `SearchController` for files — breaks the union for its two
existing consumers. (b) Hand-write case-fold + word-boundary matching in core — exactly what FR-039
forbids, and would drift from the find bar's semantics.

---

## R2. Which process owns the scan

**Decision.** **UI main**, following `ProjectFileIndexService` (`packages/ui/src/main/project-file-index.ts`).

**Rationale.** That file recorded this decision for the identical workload and both arguments transfer
verbatim (`project-file-index.ts:7-10`): the renderer is sandboxed and single-threaded, so a large walk
there is precisely the stall FR-041 forbids; the daemon "walks nothing, reads its settings once at
startup, and has no reason to outlive a cache of the filesystem". Confirmed independently —
`packages/daemon/src/` contains no `IFileSystem` reference at all.

**Consequence.** Nothing in this feature touches `daemon`, `persistence`, `ipc-contract` or
`platform-windows`.

---

## R3. Streaming results to the renderer

**Decision.** Copy the file-index channel shape: subscribe → snapshot → deltas, pushed to **one**
`webContents`, with an unsubscribe closure.

**Rationale.** It is shipped, tested and solves this exact problem:

- Preload: `packages/ui/src/preload/preload.cts:519-549`
- Main IPC: `packages/ui/src/main/file-index-ipc.ts:41-47` — `pushFileIndexUpdate` targets a single
  `webContents`, and the subscriber is `event.sender`, **never payload-supplied** (`:56-60`)
- Wire shape: `FileIndexUpdate` (`project-file-index.ts:43-59`)
- Renderer consumer with its race guards spelled out: `packages/ui/src/renderer/navigate/use-file-index.ts:37-150`

**Gate to respect.** `packages/ui/tests/unit/ipc-bridge-parity.test.ts:45-165` fails the build if a
`throng:*` channel appears in `src/main` but not `src/preload`, or vice versa. Every new channel goes
in both.

---

## R4. Cancellation and supersession (FR-043, FR-043c)

**Decision.** A polled `cancelled()` predicate plus a **generation counter**. No new primitive.

**Rationale.** `AbortController` / `AbortSignal` appear **nowhere in any package's `src/`** — zero
occurrences, verified across all five packages. What exists is:

```ts
// packages/core/src/explorer/file-index.ts:14-28
export interface WalkOptions {
  cancelled: () => boolean;   // polled once per directory
  excluded: (relPath: string) => boolean;
}
```

polled at `file-index.ts:50`, where an abandoned walk returns **nothing** rather than a truncated set.
The thunk closes over `RootIndex.generation` (`project-file-index.ts:107`), bumped on teardown and
restart (`:269`, `:321`, `:496`).

**Why this is the right fit.** Bumping the generation **is** FR-043c's "superseded, never compounded",
for free. A second mechanism would be YAGNI.

---

## R5. The file walk, exclusions and the refusal set

**Decision.** Reuse all four; add nothing.

| Need | Reuse | Citation |
|---|---|---|
| Walk | `walkFiles(fs, root, {cancelled, excluded})` — pure, `IFileSystem` only, returns sorted root-relative POSIX paths | `packages/core/src/explorer/file-index.ts:36` |
| Exclusions (FR-045) | `compileExcluder(globs)` over `explorer.excludeGlobs` + the project's hidden set | `packages/core/src/explorer/exclude.ts:44`; composition at `project-file-index.ts:310-316` |
| Binary (FR-045e) | `isProbablyBinary(bytes)` — NUL scan over the first 8000 bytes after any BOM | `packages/core/src/editor/text-fidelity.ts:113` |
| Too large (FR-045e) | `editor.maxOpenFileBytes`, default 10 MiB | `packages/core/src/config/app-settings.ts:228`, `:501` |

**Correction to the spec.** FR-045e names **"unreadable"** as a refusal reason. It does not exist:
`NOT_A_MISSING_FILE` is `{binary, too-large, out-of-tree, folder}`
(`packages/core/src/editor/refusal.ts:27`), and a permission-denied read collapses into `io` carrying a
raw `Error.message` (`packages/ui/src/main/editor-service.ts:107`). The scan therefore skips
**binary, too-large, and any file whose read throws**, and the last of those is not a named member of
the refusal set. FR-045e's wording is corrected accordingly rather than inventing a reason.

**`.gitignore` is not read anywhere** in the app, so "the project's existing exclusion rules" means the
glob setting plus "Hide in this project", and nothing else.

**A gap that matters for SC-004.** `IFileSystem` has **no partial read** — no offset/length, no
streams, no `createReadStream` anywhere under `packages/*/src`. `readBytes` slurps the whole file
(`packages/ui/src/main/node-file-system.ts:116`). A 5,000-file scan therefore reads every candidate
whole. The size guard is what keeps that off the memory ceiling, which makes it load-bearing rather
than incidental. **Decision:** accept whole-file reads for this feature and rely on
`editor.maxOpenFileBytes`; a `readBytesRange` port method is real work with its own contract test and
is not required by any requirement here (YAGNI).

---

## R6. Per-file staleness without a new watcher (FR-045a, FR-045d)

**Decision.** Consume an **existing** whole-root watch from main. Add **no** watcher.

**Rationale.** Two recursive watches already cover the whole project root:

| Watch | Armed | Payload |
|---|---|---|
| `ExplorerWatcher` | `packages/ui/src/main/explorer-watcher.ts:31` | `{ relDir }` — the directory only; filename discarded (`:50`) |
| `ProjectFileIndexService` | `packages/ui/src/main/project-file-index.ts:280` | per-path `added` / `removed` deltas |

Both are `node:fs.watch` with `{ recursive: true }` (`packages/ui/src/main/node-file-watcher.ts:231`).
`throng:files:changed` is already broadcast to every window (`main.ts:1005`) and has exactly **one**
subscriber today, so a second consumer costs **zero new watches** — which is what FR-045d asks for, and
what #272/#306 are about.

**The catch, stated plainly.** Neither existing signal reports a **content** change:

- `throng:files:changed` carries `{ relDir }` — no filename, no event kind, one coalesced event per burst.
- The file index is a **membership** index; `rescanDir` (`project-file-index.ts:407`) lists names, so a
  modified file produces **no delta at all**.
- The editor's `onDiskChange` (`editor-coordinator.ts:1200`) covers only open documents.

**So FR-045a needs the directory signal widened, not a new watch**: on a `{relDir}` event, the scan
service re-stats the result files it holds under that directory and marks the ones whose mtime/size
moved. That is one new consumer beside `ProjectFileIndexService`, on a watch that already exists.

**Note for the plan's honesty.** `specs/039-terminal-reload-and-defaults/spec.md:110` states
*"throng has no project-level path-availability event, and this feature does not add one."* 043 does not
add one either; it re-stats on an existing signal.

---

## R7. Committing a replace — the finding that changes the design

**Decision.** The commit is **one main-side operation** on `EditorCoordinator`, not a renderer loop.

**Rationale — this is the sharpest finding of the research.** Only the **active tab's** panels are
mounted (`packages/ui/src/renderer/workspace/tab-group.tsx:1548` renders `activeTab.root` and nothing
else). On unmount the view and replica are torn down (`use-editor.ts:1595-1598`) **but the document
stays alive in main** (`:1599-1601`).

So a file open in a **background tab** has a `DocumentAuthority` and **no view and no replica**. A
commit implemented as "find the view and `view.dispatch`" would:

1. silently skip that file's buffer edit, and
2. also decline to write it to disk, because `isOpen()` correctly reports it **open** (FR-053).

The file would receive **neither**, silently. That is a data-loss-shaped defect, and it is invisible to
any test that only ever opens one tab.

**What is needed:** a new `EditorCoordinator` entry point that builds the `ChangeSet` against
`authority.version`, calls `authority.dispatch` with a **synthetic view id** and `mergeClass: null`,
and relays with `relaySync(-1, …)` exactly as `dispatchChange` does (`editor-coordinator.ts:579-594`).

**Single-undo-step is free.** One `ChangeSet` is one `UndoEntry`
(`document-authority.ts:170-181`, `:306`), and merging happens **only** for `mergeClass` `'type'` or
`'delete'` (`:325-333`). `mergeClass: null` "never merges" by contract
(`packages/core/src/editor/document-sync.ts:22`). This is how `replaceAll` already gets FR-057 today.

---

## R8. The open/closed partition and its race (FR-053, FR-054)

**Decision.** The partition, the pre-write re-check and the write are **one main-side turn**, with
`isOpen` re-checked immediately before each `fs.writeBytes`.

**Rationale.** The registry is authoritative and keyed by canonical path —
`open-registry.ts:26`, keyed by `normaliseFolder(absPath)` (lowercased; **not** `realpath`-resolved, so
a symlink and its target are two keys). `isOpenAnywhere(reg, absPath)` is the exact predicate.

Nothing makes ask-then-write atomic, and there are two windows: cross-process (the renderer asks, then
asks again to write, and a `load()` can register the path in between — `editor-coordinator.ts:312`) and
within main (any `await` in `EditorService.save`'s `resolveRealTarget → resolveSaveConfinement → encode
→ writeBytes` chain, `editor-service.ts:145-171`).

**Precedent for the fix already exists**: `EditorCoordinator.save` re-runs `openOrFocus` before a
Save-As write for this same hazard (`editor-coordinator.ts:975-980`).

**FR-054's re-check is a content check, not merely an authority check**, and both are needed: for open
documents the authority's rebase protects the position; for the disk path nothing does.

---

## R9. The direct disk write must preserve fidelity (FR-053, FR-056)

**Decision.** `decode` → replace in the `\n`-normalised text → `encode` with the **same**
`{encoding, hasBom, lineEnding}` that `decode` reported, then apply confinement.

**Rationale.** `packages/core/src/editor/text-fidelity.ts:74`/`:83` are the helpers, and
`EditorService.save` is the only code in the app that currently knows the confinement rule
(`editor-service.ts:148-171`). A naive `readFile`/`writeFile` would rewrite every CRLF as LF and drop
the BOM — violating FR-056 silently, in files the user never opened.

**Encoding detection is minimal and that is fine here.** `detectEncoding` checks only the UTF-8 BOM
(`text-fidelity.ts:32`); UTF-16 detection does not exist, and a UTF-16 file is caught by
`isProbablyBinary` (interleaved NULs) and skipped as binary. Consistent with FR-045e.

---

## R10. Per-panel find sessions (FR-001 – FR-006)

**Decision.** Replace the module-level singleton with a `Map<panelId, FindSession>` plus a separate
"which panel's bar is showing" pointer. Model it on the controller registry that is **already**
per-panel.

**Rationale.** `packages/ui/src/renderer/search/search-store.ts:49` is `let state: FindState = CLOSED` —
one session for the whole renderer, and `openFind` explicitly discards the previous panel's term,
replacement and modes when the panel changes (`:97-102`). That **is** the #220 defect, in one place.

`search-controller.ts:53` already keeps `Map<panelId, SearchController>` — the shape to copy.

**Consumers to change** (complete list): `find-bar.tsx:33,39,150`; `editor-panel.tsx:73`;
`terminal-panel.tsx:65,68,218,236`; `search-keybindings.tsx:72,113,118,125,133,140+`;
`use-editor.ts:48,1218`.

**Two behavioural changes inside that:** `closeFindIfNotOn` (`search-store.ts:120-126`) becomes
**hide**, not `emit(CLOSED)` (FR-002); and a discard-on-destroy hook is new (FR-006) — today
`unregisterPanelSearch` (`use-editor.ts:1590`) leaves the find store holding a dead `panelId`.

---

## R11. Persistence of the panel and its query (FR-027a–d)

**Decision.** The query rides **`Panel.config`**. **No SQLite migration.**

**Rationale.** `PanelKind` is deliberately open — `'terminal' | (string & {})`
(`packages/core/src/workspace/model.ts:28`) — and `PanelConfig` is `Record<string, unknown>`
"serialised verbatim inside the layout blob" (`:35`). Feature 006 added the editor panel type with
**zero** schema change, and there is a test pinning that decision:
`packages/persistence/tests/integration/no-editor-migration.integration.test.ts:8-21`.

`EditorPanelConfig` (`model.ts:53-62`) is the shape to copy. Runtime mutation is
`updatePanelConfig(layout, panelId, config)` (`packages/core/src/panel-type/assignment.ts:77-86`),
exposed as `WorkspaceContextValue.updatePanelConfig` (`workspace-store.tsx:119`), which schedules a
debounced save.

**FR-023 / FR-027b / FR-027c / FR-027d are satisfied by construction**: results are simply not in
`config`, so nothing retains them and no cleanup code is needed.

**One registration not to miss.** A scope holding an absolute folder path must be added to
`CONFIG_PATH_KEYS` (`packages/core/src/workspace/persisted-paths.ts:33`), which today is
`['filePath', 'startDirectory']`.

**Restore precedent for "reopened, not yet run"**: 039's dormant terminal — `Panel.dormant`
(`model.ts:120`) rendering `DormantTerminal` rather than mounting the live component
(`panel-body.tsx:104-116`).

---

## R12. FR-033b — remembering the grouping per project

**Decision.** **In-memory, per project, for the running application only** — matching 033's precedent
exactly. The preference itself is the only part that reaches disk.

**Rationale.** There is **no generic per-project key/value store**; each concern got its own column or
table (`projects.hidden_paths` v6, `workspace_layout.layout_json`, `document_state` v7, `fileop_undo`
v8). The closest *setting* in shape is `editor.navigation.rememberQuickOpenQuery`, and what it
remembers is **not persisted at all** — `app-settings.ts:167-169` says the value "lives in memory, per
window, for the running application only (FR-062) — this setting is the only part of it that reaches
disk."

FR-033c does not say the remembered grouping must survive a restart, so the cheapest option that
satisfies it is also the one with a shipped precedent. **This is recorded in the spec as a
clarification rather than left implicit**, because the alternative (a v9 migration) is real work that a
later reader might otherwise assume was intended.

**Alternatives rejected.** A `projects` column + v9 migration — unrequested durability, and a schema
change for a view preference. Riding `Panel.config` — per **panel**, not per project, so a second
Find in Files panel in the same project would not inherit it (wrong for FR-033c).

---

## R13. Key bindings — both chords are free

**Decision.** `Ctrl+Shift+F` → find in files, `Ctrl+Shift+H` → replace in files, scoped `EVERYWHERE`.

**Rationale.** Exhaustive check of `WINDOWS_BINDINGS` (`packages/core/src/config/keybindings.ts:246-368`):
the only shipped `Ctrl+Shift+*` chords are `focus.cycleBack` (`` Ctrl+Shift+` ``),
`navigate.quickOpen` (`Ctrl+Shift+T`, `:311`), `editor.saveAll` (`Ctrl+Shift+S`), and the terminal
scroll pair. **`Ctrl+Shift+F` and `Ctrl+Shift+H` appear nowhere** in `packages/*/src`. No CodeMirror
keymap claims them. `Ctrl+F`/`Ctrl+H` do not collide — `chordCollisions` compares normalised token
equality (`keybindings.ts:517`), so `Ctrl+F ≠ Ctrl+Shift+F`.

**No constitutional exception needed.** The reserved-key tiers
(`.specify/memory/constitution.md:1239-1257`) list `Ctrl+F` and `Ctrl+H` as recorded exceptions; the
enforcing test matches **exact normalised tokens**
(`packages/core/tests/unit/terminal-reserved-keys.test.ts:29,34,44,66-79`), and neither new chord is in
either list, so the exhaustive-list assertion stays green.

**Trap.** `packages/ui/tests/unit/window-chord-manifest.test.ts:49-63` discovers Shift-keeping chords
on letter keys from `app.tsx:287` and requires each to be covered in
`window-chord-resolution.e2e.ts`'s `COVERED` map. Both new chords land in that `keepShift` branch —
this is the bug `Ctrl+Shift+T` had, arriving at the resolver as `Ctrl+T` and being silently inert.

---

## R14. The keyboard scope for a Find in Files panel

**Decision.** Add a fourth `DispatchScope`, `'findInFiles'`, and map the kind explicitly.

**Rationale.** `DispatchScope` is a **closed** union `'editor' | 'terminal' | 'explorer'`
(`packages/core/src/config/keybindings.ts:142`), and `scopeFromKind` falls through to `'explorer'` for
any unknown kind (`packages/ui/src/renderer/keybindings/scope.ts:62-66`).

Left alone, that is an active defect rather than a gap: with a Find in Files panel focused,
`file.cut` / `file.copy` / `file.delete` / `file.undo` (all `EXPLORER_ONLY`, `keybindings.ts:198-204`)
would become **live over the file tree's selection**, while `search.find` (scoped `PANELS`) would be
dead. A user pressing Delete in a results panel could delete a file.

`PANELS = ['editor','terminal']` (`:151`) also widens to include the new scope where the spec says a
Find in Files panel offers the action.

---

## R15. Theme tokens — reuse, do not add

**Decision.** Reuse `searchMatch`, `searchMatchCurrent`, `searchMatchCurrentBorder`. Add **no** colour
token. Add **two** icon tokens (a Find in Files toolbar action, and a scope control).

**Rationale.** `packages/core/src/config/theme.ts:264-266` already ships those three, documented at
`:255-263` as "**One pair of surfaces shared by the editor and the terminal**", re-tuned by 016 FR-007a
for syntax legibility. A result row's match highlight is the same idea on a third surface. A new token
would need the justification `editorStatusStripBg` records at `:248-251` for not reusing `statusBarBg`,
and there is no such argument here.

**This corrects FR-044's implication** that new tokens are expected. FR-044's actual requirement —
match highlighting takes its colours from theme tokens, and any *new* token is exposed in the Themes
editor — is satisfied with no new token.

**Icon tokens are different**: the convention is explicit that a new token means a **new action**, never
a glyph reused for a second meaning (`theme.ts:392-394`, `:445-455`). Find in Files is a new action, so
it gets its own. Adding one costs: the token in `theme.ts`, an area in `areaForToken`
(`theme-metadata.ts:270` routes `icons.*` for free), hand-written copy in `theme-copy.ts`, a value in
**every** bundled theme, and a bump of the **token-count assertion** at
`packages/core/tests/unit/default-themes.test.ts:94`.

---

## R16. Adding the six preferences

**Decision.** All six are flat leaves under a `search` section that **already exists**. Six keys, and
FR-059 enumerates all six: the settle interval is user-configurable and reaches the preference editors,
so it is a preference rather than an internal constant.

**The seven places**, in dependency order:

| # | What | Where |
|---|---|---|
| 1 | Typed leaf | `packages/core/src/config/app-settings.ts:443` (`SearchSettings`) |
| 2 | Shipped default | same file, `:551-553` |
| 3 | Tolerant parse | `searchSettings()` at `:627`. **No hand-written clamps** — `:620-626` records that 031/#227 deleted them; bounds come from the descriptor |
| 4 | Clone | `structuredCloneSettings` at `:1113` — shallow spread, so flat leaves need no change |
| 5 | Editor descriptor | `settings-metadata.ts`, `group: 'Search'` (`search.asYouTypeDebounceMs` at `:795-805` is the sibling) |
| 6 | **`SHIPPED_DEFAULTS_VERSION` bump** | `shipped-defaults.ts:65`. Read `:20-64` — an existing install never materialises new settings without it, and fresh-install E2E can never see the gap |
| 7 | A reader outside the config layer | see below |

**No renderer change is needed** — `settings-tab.tsx:30` renders entirely from `SETTINGS_METADATA`.

**Completeness gates**: `settings-metadata.test.ts:22` (both directions),
`reset-completeness.test.ts:22`, `slider-descriptors.test.ts`. A `select` descriptor's `allowedValues`
**is** the enforcement — `bounds-guard.ts:142` rejects a stored value outside the declared set.

**FR-059a is not free.** No fleet-wide inertness guard exists — #108 is the issue proposing one, and
`packages/core/tests/unit/settings-inertness-040.test.ts` is the per-feature pattern to copy (a
hand-listed `NEW_KEYS` array, walking every `packages/*/src` file with the config layer excluded). 043
writes `settings-inertness-043.test.ts` naming all six keys.

**FR-043b has a sibling but should not share its key.** `search.asYouTypeDebounceMs` already exists,
default **120 ms** (`app-settings.ts:442-450`, applied at `find-bar.tsx:56-62`). 120 ms is tuned for
re-scanning one buffer; SC-004's corpus is 5,000 files on disk, so the file-scan settle interval is its
own key.

**Debounce trap (#186).** A pure quiet-period debounce **never fires under sustained churn** —
measured at 180 events over 3 s producing zero reports. `ProjectFileIndexService` solves it with a
quiet period **plus a forced ceiling** (`quietMs = 750`, `reconcileMaxWaitMs = 10_000`,
`project-file-index.ts:154-155`, rationale `:12-24`). Anything debouncing in main copies that shape,
not a plain timer. The reusable helper is `debounce()` at
`packages/ui/src/renderer/config/write-config.ts:327-358` (trailing-edge, `cancel()`, `flush()`).

---

## R17. The panel type, and FR-017's "registered but not offered"

**Decision.** Add an `offered: false` (or equivalent) flag to `PanelTypeDescriptor` and filter in the
New Panel form. **Do not solve it by leaving the type unregistered.**

**Rationale.** The registry is the source of truth for a panel's **header label and icon** —
`panel-placeholder.tsx:632` and `use-panel-display-names.ts:70` both call `registry.get(panel.kind)`,
falling back to the raw kind string. An unregistered kind loses both. So "just don't register it" trades
FR-017 for a broken panel header.

The seam is small: `PanelTypeDescriptor` (`packages/core/src/panel-type/descriptor.ts:129-151`) has no
such field today, `registry.list()` (`registry.ts:11-18`) has no filtered listing, and
`panel-type-form.tsx:110` applies no filter. One field, one filter.

**Registration sites for the new type** (complete): descriptor module modelled on
`packages/core/src/editor/panel-type.ts:29-45`; one `register()` in
`panel-type/default-registry.ts:11-14`; re-export from `packages/core/src/index.ts`; a branch in
`panel-body.tsx`; menu items in `panel-header-menu.ts`; the scope map in `keybindings/scope.ts`
(see R14).

---

## R18. The results list must be virtualised — and nothing exists to copy

**Decision.** Build a windowed list for the results. This is **new work**, and the plan sizes it as such.

**Rationale.** No general-purpose virtualised list exists in the renderer. `react-arborist` drives only
the explorer **tree** (`file-tree.tsx:17`), CodeMirror's viewport virtualisation is internal to the
editor, and the preferences lists are not virtualised at all. Verified: no `react-window`,
`react-virtual`, `FixedSizeList` or hand-rolled windowing anywhere under
`packages/ui/src/renderer`.

**The nearest existing pattern is a hard cap, and this feature declines it.** The no-match-ceiling
decision lives in the spec's **Assumptions**, not in FR-041 — FR-041 requires progressive results and a
responsive interface, and it is the Assumptions that decline a ceiling. Quick Open slices to
`QUICK_OPEN_MAX_ROWS = 200` (`packages/core/src/picker/rank.ts:28`) and prints
`Showing N of M matches` (`quick-open.tsx:231`). The spec's Assumptions explicitly decline a match
ceiling, so that pattern does not transfer.

**Digit grouping is already solved**: `formatGrouped` / `parseGrouped` at
`packages/core/src/config/number-format.ts:38`, `:51`, with `quick-open.tsx:32,231` as the compliance
example the constitution names.

---

## R19. Menus — the constitution's audit is stale

**Finding.** The constitution (`.specify/memory/constitution.md:1531-1535`) records the **editor content
menu** and **panel header menu** as drawing items "in one undivided run", owed to feature 033 and issue
#160. **Both were sectioned by 033 US5 and now conform.**

- `panel-header-menu.ts` declares a section on every item (`:99` content, `:109` viewState, `:189`
  navigate, `:352` destroy), with the sections it draws tabulated at `:12-18`.
- `editor/content-menu.ts` likewise (`:89,96,103,121,131,138` content; `:149` navigate; `:165,173` viewState).
- Pinned by `packages/ui/tests/unit/menu-sections.test.ts:459,556,574,604`.

**Consequence.** FR-015 adds Find/Replace/Replace All into an **already-sectioned** menu — there is no
gap to deepen. `section` is a **required field** on `MenuAction`
(`packages/ui/src/renderer/workspace/context-menu.tsx:48`), so the constitution's "an item with no
section is a defect, not a default" is enforced by the **type system**, not by convention. Dividers are
derived by `withDividers()` (`menu-dividers.ts:19-27`), never authored.

**This is reported to the maintainer as a constitution-currency finding**, not worked around.

---

## R20. Where FR-025a's actions sit in the menu vocabulary

**Decision**, against the closed vocabulary (`packages/core/src/workspace/menu-sections.ts:29-45`):

| Action | Section | Reasoning |
|---|---|---|
| Toggle replace | `viewState` | "Toggles and per-surface state" — it reveals a row, changes no content |
| Switch grouping | `viewState` | A presentation change over results already found (FR-033) |
| Collapse / expand all | `viewState` | Same family as the explorer's Collapse All Children |
| Change scope | `navigate` | "names where something is" — the same test that puts Copy Path there |
| Run / Cancel | `viewState` | The panel's own run state; it acts on the panel, not on content |
| Replace All / replace in one file / replace one match | `content` | "Acts on the item's content" — these are the only items here that change text |

**No amendment is needed.** The earlier reading — that Run, Cancel and the commit granularities map to
nothing — dissolves once "content" is read as the *result row's* content (the file's text) rather than
the panel's. Replace **is** a content action; Run is a view-state one.

**Chords in menu items**: `firstBinding(kb, action)` (`keybindings.ts:501`) on `MenuAction.shortcut`
(`context-menu.tsx:37-43`). A new menu builder must be added to `menu-sections.test.ts`'s import list
(`:28-37`).

---

## R21. The explorer toolbar control (FR-029a)

**Decision.** Copy `toolbar.tsx`'s Quick Open button **exactly**, including its deliberate departure
from `IconButton`.

**Rationale.** `packages/ui/src/renderer/explorer/toolbar.tsx:70-93` is the 033 FR-018c precedent, and
its header comment (`:6-16`) records why the toolbar moved out of `FileTree` — so it renders with **no
project open**, which is what FR-029a's drawn-and-disabled requires. The pattern:

- chord read live: `firstBinding(keybindings, 'navigate.quickOpen')` (`:39`)
- title carries the live chord **and** states the reason when unavailable (`:73-77`)
- `aria-label` is the **bare action without the chord** (`:78-87` explains: a name-based locator would
  break on rebind)
- `disabled={!quickOpenEnabled}` (`:88`), `<Icon token="quickOpen" />` (`:91`)

**It does not use `IconButton`** because that sets `title` and `aria-label` from one string
(`icon-button.tsx:110-115`), which would put the chord in the accessible name. FR-029a needs the same
split, so it copies the raw `<button>`.

**Two call sites** to update, mirroring `quickOpenEnabled`: `file-tree.tsx:573-579` and
`panes/file-explorer-pane.tsx:112` (the no-project case).

---

## R22. The folder context menu item (FR-029b)

**Decision.** `section: 'navigate'`, gated on `node.kind === 'folder'`.

**Rationale.** `packages/ui/src/renderer/explorer/context-menu-items.ts` builds it; folder-only items
are expressed as `if (node.kind === 'folder')`, and the worked example is Collapse/Expand All Children
at `:208-222` — both `section: 'navigate'`, both carrying no chord because they act on the
right-clicked node.

**On the Contextual-vs-Navigate question**: `contextual` is for items "present only because of what the
pointer is over", and its test is "would this item be absent if the pointer were elsewhere?" A
folder-scoped Find in Files **would** be absent over a file — but so would Collapse All Children, which
the shipped menu places in `navigate`. Following the established reading keeps one rule for both;
inventing a different answer for the new item would make the vocabulary inconsistent.

---

## Open items carried into the plan

1. **FR-045e's "unreadable"** — corrected here (R5); the spec text is updated to match the refusal set.
2. **FR-044's new tokens** — corrected here (R15); no colour token is added.
3. **The E2E budget** must rise, and the raise is justified in `e2e-budget.json`'s own `measuredFrom`
   field, which records six prior raises in exactly that form. Categories available are `@editor`,
   `@explorer`, `@failure`, `@prefs`, `@terminal`, `@window` — there is **no** `@search`.
4. **The constitution's menu audit is stale** (R19) — reported, not worked around.
   **Discharged 2026-09-09**: constitution v5.4.1 corrects it, citing this feature's plan as the
   finding. Nothing in 043 changes as a result; the report was the whole obligation.

---

# Phase 0 Research — Round two (Session 2026-09-09)

**Date**: 2026-09-09 | Decisions **R23 onward**. R1–R22 above are unchanged and still hold.

Round two answers the design questions the sixteen change requests and the three convergence
findings raise. Nothing above is withdrawn: where a round-two decision changes a round-one one, it
says so and names it, exactly as the spec's supersession markers do.

Two of these entries exist because reading the code contradicted the change request's own premise.
**R28 is the important one** — four of this round's requirements are value CHANGES to documents that
already exist on users' disks, and the shipped upgrade path is additive-only, so on the code as it
stands every one of them would have reached fresh installs and nobody else, invisibly, with no test
in the repository able to see it.

---

## R23. FR-078 / FR-078a — one scan, several windows

**Decision.** The run key stops being `(webContentsId, panelId)` and becomes **`panelId`**. The
window identity moves out of the key and into an explicit **`viewers: Set<number>`** on the run.
A window joins that set by starting a scan (as today) or by a new **`throng:fileSearch:attach`**
message; it leaves by `drop`, or when the window dies. Every update goes to every viewer. The run
**retains its rows** for as long as it exists, and a window that attaches is sent a **snapshot** of
whatever the run currently holds before it sees another delta. The run is released when the **last**
viewer leaves.

**Rationale — what the code actually says.**

The single-target rule is deliberate and documented: `packages/ui/src/main/file-search-service.ts:212`
reads *"Deliver to ONE webContents. Never a broadcast — two panels, two projects (FR-018)."* The key
is built at `:190-192` (`` `${webContentsId}:${panelId}` ``), the map is declared at `:195`, and the
service holds a single injected `push(webContentsId, payload)` callback (`:213`) that is called with
`run.webContentsId` and nothing else (`:675`, `:686`). There is no set to widen — the identity of the
recipient is the key.

The composite key was not arbitrary. `contracts/file-search-ipc.md` records why it exists: keyed by
`panelId` alone, *"closing the mirror aborted the parent's scan, and a search typed in the mirror
redirected the parent's updates to it"*. **Both of those failures are re-solved by the viewer set
rather than by the key**, and one of them stops being a failure at all:

- *Closing the mirror aborted the parent's scan.* `drop` becomes **detach one viewer**; the run is
  released only when the set empties. `release(webContentsId)` (`:394-398`) — which today drops every
  run a dead window owned — becomes "remove this window from every viewer set, releasing any run that
  is left with none".
- *A search typed in the mirror redirected the parent's updates.* Under FR-078 the mirror **is** the
  same panel, so a search typed there is a search on that panel and both windows must see it. This is
  now the required behaviour, not a bug; supersession stays per panel (FR-043c), which is what one
  logical panel wants.

**Why not the house broadcast.** `broadcast.ts:33-49`'s `broadcastToWindows` plus per-window
filtering is this repository's normal answer for one object seen by many windows —
`EditorCoordinator`'s `relaySync(-1, …)` is wired that way at `main.ts:1274-1276`, and `main.ts:1551`
states the style outright (*"The drain NAMES NO WINDOWS — it asks getAllWindows(), exactly as
relaySync does"*). It is rejected here, and the reason is Principle I rather than taste: a scan update
carries **root-relative file paths and the text around every match** for one project. A sub-workspace
window may be showing a different project entirely, and a broadcast would put one project's file
names and file contents into that window's process, where a filter decides after the fact whether to
render them. FR-018 says updates must reach no panel that is not displaying the panel; a broadcast
satisfies that only at the rendering layer, not at the delivery layer. The editor precedent does not
transfer, because a document change carries one panel's own buffer and every window already holds a
replica of it — there is nothing new to leak.

**Why the viewer set is registered by the renderer and not inferred.** Main cannot see which windows
have a given panel mounted; the workspace layout lives in the renderer store. So the panel component
that already calls `ensureFindInFilesPanel` on mount (`find-in-files-panel.tsx:176-195`, whose comment
already names *"a panel remounted in another window"*) is what calls `attach`, and
`destroyFindInFilesPanel` (`find-in-files-store.ts:659-672`), which already calls `drop`, is what
detaches. The subscriber is `event.sender` and never payload-supplied, keeping `file-search-ipc.ts`'s
own rule (`:5-9`).

**The accepted cost, stated rather than discovered.** Today a window can only receive results for a
scan it started; after this it can receive results for any `panelId` it names. A window that names a
panel it is not displaying would get another project's paths. The mitigation is that the only caller
is the panel component, mounted from the workspace layout, which is the same authority in both
windows — but the guarantee is weaker than it was, and it is weaker by exactly the amount FR-078
asks for.

**Retention (FR-078a).** `ScanRun` gains `rows: ResultRow[]`, appended as batches are emitted rather
than cleared. Today the opposite is explicit — `file-search-service.ts:175` says *"the rows
themselves are pushed and forgotten"*, and `:605-606` empties `pending` on completion. What is
already retained for the life of the run is the per-file stamp map (`held: Map<string, FileStamp>`,
`:179`), so the run is not a stateless object; this adds the rows beside the stamps.

The bound is the one FR-078a names and no other: the run dies with the panel. `drop` on the last
viewer reclaims everything, `FR-023` is untouched, and a restored panel still comes back with no
results because nothing crosses `Panel.config` (data-model §3). The honest cost is that peak memory
for a large scan becomes **one main-side copy plus one per attached window**, where it was one per
window; with no match ceiling (Assumptions) that is unbounded in the same way the renderer's copy
already is, which is the argument FR-078a makes and this decision accepts rather than improves on.

**Alternatives rejected.**

| Alternative | Rejected because |
|---|---|
| Broadcast to `getAllWindows()` and filter in the renderer (house style) | Puts one project's paths and match text into a window showing a different project. Principle I, and FR-018 read at the delivery layer. |
| Keep the composite key; have the parent renderer relay its rows to the mirror | The parent may be unmounted, minimised or torn down while the mirror lives; and it makes a renderer the authority for state main owns, which is the shape CLAUDE.md's *"the report belongs to whatever owns the state"* rejects. |
| Let the mirror run its **own** scan for the same query | Two walks over one tree for one panel, two generations, two sets of staleness, and US5 scenario 6 still unmet — it says the synced panel shows *the scan its parent ran*, not an equivalent one. |
| Retain nothing; a late attacher sees an empty panel until the next run | Directly refused by FR-078's last clause. |
| Retain in a store outside the run (an LRU, a cache with an eviction policy) | FR-078a bounds retention to *a scan whose panel still exists* and nothing more. A store with a policy is the design the Assumption declined and FR-078a still declines. |

---

## R24. FR-067 — a match-vs-current distinctness rule, and re-deriving fourteen themes

**Decision.** Add a **mutual-distinctness gate** to `theme-quality.ts`, measured with the
**CIEDE2000 machinery already in that file**, over three pairs per theme: `searchMatch` ↔
`searchMatchCurrent`, `searchMatch` ↔ `editorBg`, `searchMatchCurrent` ↔ `editorBg`. Replace the
fixed 45% fraction in the derivation with a **searched** ordinary-match tint under that floor, and
give the two fills **two axes** rather than one so a dark theme has room for the separation. The
floor's number is a **measurement**, taken and recorded the way `DISTINCTNESS_THRESHOLD` was.

**Rationale — the check that is missing and the derivation that collapses.**

`packages/core/src/config/theme-quality.ts:347-350` is the entirety of what governs these tokens:

```ts
const SYNTAX_ON_MATCH: readonly ContrastPairing[] = SYNTAX_TOKENS.flatMap((fg) => [
  { fg, bg: 'searchMatch', min: WCAG_AA_BODY, label: `${fg} on a search match` },
  { fg, bg: 'searchMatchCurrent', min: WCAG_AA_BODY, label: `${fg} on the current search match` },
]);
```

Ten foregrounds on two backgrounds, at 4.5:1 (`:280`). Text-on-a-match, exactly as FR-067 says.
Nothing anywhere measures the two fills against **each other** or against the surface.

The derivation is `default-themes/index.ts:119-122`:

```ts
const current = blend(editorBg, accent, strongest);
// An ordinary match is the same hue at ~45% of the strength, so it always reads as
// weaker than the current one and is at least as legible (it sits nearer the surface).
const match = blend(editorBg, accent, strongest * 0.45);
```

`strongest` is the largest tint that keeps every syntax hue readable, found by walking `t` down from
0.7 (`:112-118`). **The 45% is a ratio of a quantity that is itself small on dark themes**, so the
whole separation budget shrinks with it. The shipped values say so plainly — from
`packages/core/tests/unit/fixtures/pre-refactor-theme-colours.json`:

| Theme | `editorBg` | `searchMatch` | `searchMatchCurrent` | match − bg (R,G,B) | current − match |
|---|---|---|---|---|---|
| SUBNET | `#001B40` | `#03253e` | `#06323c` | **(3, 10, −2)** | (3, 13, −2) |
| Matrix | `#000000` | `#001104` | `#00260a` | (0, 17, 4) | (0, 21, 6) |
| Bash | `#000000` | `#030e10` | `#062024` | (3, 14, 16) | (3, 18, 20) |
| throng | `#0c0f16` | `#151e2d` | `#213049` | (9, 15, 23) | (12, 18, 28) |
| Light | `#ffffff` | `#ebf1fd` | `#d3e0fb` | (−20, −14, −2) | (−24, −17, −2) |

SUBNET is the worst case in both directions and it is one of the three `IN_SCOPE_THEMES`
(`theme-quality.ts:284`, enforced at `:440`) whose contrast is build-blocking — an ordinary match there is ten units of green away from the page,
and its blue goes *down*. This is the maintainer's report reproduced from the shipped data rather
than taken on trust.

**The metric, and why it is not a contrast ratio.** WCAG contrast is a luminance ratio designed for
text on a background; two fills that differ mainly in hue can be perceptually obvious and still score
near 1:1. `theme-quality.ts` already carries the right tool and already uses it for exactly this kind
of question — `ciede2000` (`:98`), `rgbToLab` (`:76`), and `themePairDistance` (`:185`), which powers
the theme-vs-theme distinctness gate at `:262`. FR-067 is that same question asked of three token
pairs inside one theme instead of across two themes, so it reuses the function rather than adding a
second notion of "different enough". Principle VIII, and the same argument R15 made about tokens.

**The derivation, and the second axis.** Keeping both fills on the accent ray is what makes the dark
themes fail: the ray from `editorBg` to `blend(editorBg, accent, strongest)` has to hold two gaps,
and `strongest` is capped by readability. So:

- **The current match is unchanged**: `blend(editorBg, accent, strongest)`. It keeps the appearance
  016 FR-007a tuned, and keeps `searchMatchCurrentBorder`'s 3:1 relationship with it.
- **The ordinary match moves to the neutral axis**: `mixToward(editorBg, editorFg, t)` — the shipped
  primitive (`default-themes/index.ts:34-41`) that the border derivation already uses — with `t`
  searched downward exactly as `strongest` is, taking the largest value that keeps every syntax hue
  at 4.5:1. It then differs from the current match in **chroma and hue** as well as lightness, which
  is where ΔE00 finds separation that the accent ray alone cannot supply, and it differs from the
  surface in lightness.
- The ordinary match stays the **weaker** of the two, which is what the 45% was protecting: a neutral
  lift of the surface reads as less emphatic than an accent tint of the same lightness, and it stays
  *nearer* the surface, so the "at least as legible" half of the old comment still holds.

**The floor is a measurement.** `theme-quality.ts:257-259` states the house rule for exactly this
kind of constant: *"The constant follows the measurement, never the other way round"*, and
`DISTINCTNESS_THRESHOLD` (`:259`) sits below the measured `CLOSEST_LEGITIMATE_PAIR_DELTA` (`:227`)
with its headroom recorded. The same is owed here: derive all fifteen themes, measure the smallest of
the three ΔE00 gaps across them, and set the floor below it with the headroom written down. **A floor
chosen to be whatever the themes happen to pass is a ratchet and not a rule**, so the measurement must
be taken *after* the re-derivation, and if the re-derivation cannot clear a floor that is
perceptually meaningful on the darkest themes, that is a finding to report rather than a number to
lower. This is a task, and it needs a command run — it is not settled here.

**Two things that must move with it, or the change is invisible or red.**

1. **`pre-refactor-theme-colours.json` is re-seeded for these three tokens, in the same commit.**
   `packages/core/tests/unit/default-themes.test.ts:125-139` (*"non-drift: every surviving token keeps
   its exact pre-refactor value"*) compares every theme's colours to that fixture, and the search-match
   tokens are in neither `BUTTON_TOKENS` nor `ADDED_SINCE_FIXTURE`. The test's own carve-out lists are
   the shipped mechanism for a deliberate change, and this is one — the fixture records what was
   shipped, so re-seeding it is the act of shipping something else, not of silencing a guard.
2. **`throng` is hand-authored and is not derived at all.** `THRONG_THEME.colours` carries
   `searchMatch: '#151e2d'` / `searchMatchCurrent: '#213049'` literally (`theme.ts:264-266`); only the
   fourteen in `DEFAULT_THEMES` go through `makeTheme`. FR-067 says a **theme** must not render them
   indistinguishably, so the gate applies to all fifteen and `throng`'s two literals must be hand-set
   to clear it. A gate that fifteen themes must pass and fourteen are derived to satisfy will
   otherwise fail on the built-in default.

   **Decided 2026-09-09 (plan D5): hand-set them, and record the asymmetry at the literals.** Fourteen
   themes are *maintained* by the derivation and one is not, so a future change to `searchHighlights`
   will move fourteen and silently leave the fifteenth behind — which is exactly the shape that is
   easy to miss. Two consequences follow and both are requirements, not suggestions: the gate runs over
   **`ALL_DEFAULT_THEMES`**, never `DEFAULT_THEMES`, so the drift is caught; and a comment at
   `theme.ts:264-266` says these two values are hand-maintained against a rule the other themes satisfy
   automatically.

**Blast radius, enumerated.** Every surface reading these tokens changes appearance:
`find-bar.css:134-140` (the editor find bar), `terminal-panel.tsx:209-211` and `use-terminal.ts:819-821`
(terminal search), `find-in-files.css:251,261-262,282` (this panel, including the replace preview),
and `theme.css:2778` (`.picker__mark`, the shared list-and-choose highlight — Quick Open, the tab
picker, the language picker). The last is worth naming because it is not a "search" surface and would
not be found by looking for one.

**Alternatives rejected.**

| Alternative | Rejected because |
|---|---|
| Assert a WCAG contrast ratio between the two fills | Wrong instrument: it is blind to hue and chroma, so it would pass a pair that differs only in luminance and fail a pair a user tells apart instantly. And it would fight the readability walk, which is itself a luminance constraint. |
| Keep one axis; search the ordinary tint down from `strongest` | On the darkest themes the whole ray is shorter than two gaps. SUBNET's ordinary match is already only ten units from the page; there is nothing to search. |
| Let `searchMatchCurrentBorder` carry the distinction | It already exists, already clears 3:1 against the current fill, and the maintainer reports the pair as indistinguishable *with it shipping*. FR-067 names the two match surfaces, not the composite. |
| Add a fourth colour token for the ordinary match | R15 and FR-044 both bind: reuse 013's tokens, change the derivation, not the identity. A new token would need every consumer above to opt in, and #325 is where a wider vocabulary belongs. |
| Hand-tune fifteen themes' six literals | The derivation exists precisely so themes are legible *without* hand-listing them (`default-themes/index.ts:87-95`). Fifteen hand-tuned pairs are fifteen things to re-tune the next time `strongest` moves. |

---

## R25. FR-073 — retiring one value of a live enum

**Decision.** Delete `'folder'` from **`FIND_IN_FILES_GROUPINGS`** in
`packages/core/src/config/app-settings.ts:472-477`, and from the `Grouping` union in
`packages/core/src/search/file-search.ts:50`. **That is the whole migration.** The coercion of a
stored `'folder'` to the FR-033a default already exists, in `bounds-guard.ts`, and no new code is
written to perform it.

**Rationale.** The setting is deliberately parsed as a **bare string with no membership check**.
`app-settings.ts:689-691` records why: *"`allowedValues` on the descriptor is the single statement of
the set, and the guard substitutes the default for anything outside it."* The guard is
`correctScalar` (`packages/core/src/config/bounds-guard.ts:142-148`):

```ts
if (decl.allowedValues && decl.allowedValues.length > 0) {
  if (raw === undefined || !decl.allowedValues.includes(raw as string | number)) {
    out.push({ path, kind: 'default-substituted', from: raw, to: fallback });
    return fallback;
  }
  return raw;
}
```

`FIND_IN_FILES_GROUPINGS` is the array the descriptor's `allowedValues` points at
(`settings-metadata.ts:870-879`), and `fallback` is `DEFAULT_APP_SETTINGS.search.inFiles.defaultGrouping`,
which is `'file'` (`app-settings.ts:634`). So removing one element from that array makes a stored
`'folder'` read as `'file'`, on every read, with a recorded `default-substituted` correction — which
is precisely FR-033c's *"MUST be read as the FR-033a default rather than rejected"*, satisfied by
subtraction. `optionLabels.folder` goes with it, or the descriptor describes a value it does not
allow.

**Why there, and not in a rewrite of the file on disk.** This is 019 FR-023's case, and its reasoning
transfers exactly. `preferences-settings.e2e.ts:351-384` states it for `explorer.openMode`: *"it is
DROPPED, not migrated — it never had any effect, so dropping preserves exactly the behaviour they
have today, while migrating would change it"*, and the mechanism is *"the tolerant PARSE, which runs
on every read"*. Here the value **did** have an effect and that effect is being withdrawn, so the
parallel is not perfect — but the conclusion is the same one for a stronger reason: the user's chosen
value is no longer a thing the application can do, so the only question is which of the two remaining
values they get, and FR-033a already answers it. Read-time coercion answers it without writing to a
file the user did not ask us to touch; the first ordinary form write then persists the coerced value
through `writeConfigPatch`'s `parseSettingsGuarded` round-trip (`config-write-ipc.ts:118-182`), which
is the same lifecycle the retired key has.

**Not spec 032's unmodelled-key rule, and this is worth being explicit about.** That rule is about a
key the schema does not model at all — `settings-validity.test.ts:57` (*"A hand-added key is
legitimate — the write path preserves it"*) versus `writeConfigPatch` stripping it. `defaultGrouping`
**is** modelled, is still modelled after this change, and keeps its descriptor; one of its *values*
is retired. Different mechanism, different file, different rule. Conflating them would send the next
reader to `config-write-ipc.ts:167-171` for an answer that lives in `bounds-guard.ts:142-148`.

**One consequence, accepted rather than hidden.** `settings-validity.ts:131-136` reports
`must be one of: …` for a value outside `allowedValues`, so a user who chose folder grouping through
the shipped control will see the raw JSON editor flag `search.inFiles.defaultGrouping` until the next
ordinary write clears it. That report is *accurate* — the document does hold a value the schema no
longer models — and it is transient. It is named here because the user never hand-authored the value;
the application wrote it.

**Decided 2026-09-09 (plan D3): leave it. This is not a bug and must not be "fixed" later by somebody
reading it as one.** Silencing it means teaching a general validation checker about one retired value
— a permanent carve-out that outlives everyone who remembers why it is there — and the behaviour is
already correct without it, because `correctScalar` coerces on every read.

**What else goes with the grouping, from the spec's own note.** FR-073's parenthetical: the per-row
staleness marking exists only because folder grouping produces no file heading to carry the flag. Its
call sites are `find-in-files.css:218,231` (`.fif-row__stale`) and the row branch of the staleness
render; the `.fif-group__stale` half stays. The pure transforms in `file-search.ts` narrow with the
union — `groupRows` loses one branch, and `file-search-grouping.test.ts` loses the cases that name it.

**Alternatives rejected.**

| Alternative | Rejected because |
|---|---|
| Leave `'folder'` in `FIND_IN_FILES_GROUPINGS` and filter it in the UI | FR-073 says it must not be offered *"as a preference value"*. A descriptor that allows it is an offer, and the preferences editor renders it from `allowedValues`. |
| A hand-written coercion in `searchSettings()` | Two statements of one set, which is the exact duplication `app-settings.ts:689-691` was written to avoid. It would also be dead code the moment `bounds-guard` runs first. |
| `planSettingsUpgrade` rewriting `'folder'` to `'file'` on disk | Its guard idiom is *"only when the on-disk value still equals what we shipped"* (`shipped-defaults.ts:134-142`). `'folder'` is never what was shipped — `'file'` is — so a stored `'folder'` is by that idiom a customisation, and the guard would refuse it. Loosening the guard for one leaf would make the mechanism mean something else. See R28. |
| Keep the grouping and name the file on each row (~15 lines) | Offered to the maintainer explicitly and declined (Session 2026-09-09). |

---

## R26. FR-062 — the zoom factor has to reach the arithmetic, not just the text

**Decision.** The panel computes `zoomFactor(panelZoomLevel(panel))` once and derives
`rowHeightPx = Math.round(RESULT_ROW_HEIGHT_PX * factor)` from it. **That single rounded integer is
what both consumers use**: it is passed into the results list and threaded through every windowing
calculation, and it is published to CSS as `--fif-row-height`, which the stylesheet already consumes.
Text scales through a separate custom property in `calc()`, following the editor's precedent.
`RESULT_ROW_HEIGHT_PX` stops being *the* row height and becomes the **base** it is derived from.

**Rationale.** The windowing arithmetic is in JavaScript and reads the constant directly at five
places in `packages/ui/src/renderer/find-in-files/results-list.tsx`:

- `visibleRange` (`:132-143`) — `Math.floor(scrollTop / RESULT_ROW_HEIGHT_PX)` and
  `Math.ceil(viewportPx / RESULT_ROW_HEIGHT_PX)`
- `maxScrollTop` (`:254`) — `items.length * RESULT_ROW_HEIGHT_PX - viewport`
- the sizer's height (`:371`) and the window's `translateY` (`:375`)
- keyboard scroll-into-view (`:349-353`)

and the stylesheet reads the same number through one variable, set inline at `:356-366` with the
comment *"The one number the maths and the stylesheet share"*, consumed by
`find-in-files.css:197-206` as `height: var(--fif-row-height)`.

**The crux is that the two must agree exactly, which forbids the obvious implementation.** Scaling
the text with `calc()` and letting the row height follow — `height: calc(var(--fif-row-height) *
var(--fif-zoom))` — would give CSS a fractional pixel (22 × 1.2 = 26.4) that the browser rounds by its
own rules, while JavaScript would be multiplying by 1.2 and rounding by ours. The sizer's total is
`items.length ×` that number, so a disagreement of half a pixel becomes half a pixel per row: at the
list's 500th row the mounted window sits 250 px away from where the scroll position says it should,
which is rows overlapping at one end of the range and gaps at the other. So the **rounding happens
once, in JavaScript, and CSS is told the answer** — never asked to compute it. `terminal-panel.tsx:248`
sets the same precedent for the same reason (`Math.round(font.size * zoomFactor(…))`, *"Rounded to a
whole pixel for crisp glyphs"*), because xterm measures its own cells and cannot be allowed to
disagree with the grid.

**How the factor reaches the text.** `editor-panel.tsx:42-47` publishes
`['--throng-zoom-editor']: String(zoomFactor(panelZoomLevel(panel)))` on the panel container and
`editor.css:29` multiplies with it — `font-size: calc(var(--throng-font-editor-size, 14px) *
var(--throng-zoom-editor, 1))`. The panel does the same with its own name on `.fif-panel`, so every
font-size in `find-in-files.css` becomes a `calc()` against it. Nothing else in the sheet is measured
in pixels that a user would notice, so the row height is the only metric that needs the integer path.

**What this changes in the signatures.** `visibleRange` takes the row height as a parameter instead of
closing over the module constant; it is exported and unit-tested, so its tests gain the argument.
`RESULT_ROW_HEIGHT_PX` stays exported as the unzoomed base, which is what level 0 produces.

**Zoom is already stored and already routed**, which is why this is small: `Panel.zoom` is a persisted
integer step (`packages/core/src/workspace/model.ts:156-162`), clamped to [−5, 5] and converted by
`zoomFactor(level) = 1.2 ** level` (`packages/core/src/config/zoom.ts:9-29`), read by
`panelZoomLevel(panel)` (`operations.ts:458-460`), and the three chords already resolve to the active
panel by id in `app.tsx:348-363`. Only the two consumers were missing, exactly as the clarification
says.

**FR-062a, and the gap beside it.** The Zoom submenu is built unconditionally in
`panel-header-menu.ts:122-150`, before any `panel.kind` branch (the first is at `:153`). Implementing
FR-062 makes it meaningful on this panel — but the **untyped placeholder** panel has no zoom consumer
either (only `editor-panel.tsx` and `terminal-panel.tsx` read `panelZoomLevel`), so on its own FR-062
would leave three permanently inert commands standing one panel kind away. FR-062a's wording is
general (*"MUST NOT be offered on a panel that does not implement zoom"*) while its stated occasion is
this panel.

**Decided 2026-09-09 (plan D2): close it too, and it is in scope BY FR-062a rather than scope creep.**
The general wording is deliberate, and citing that rule to fix one panel while knowingly leaving the
identical violation on the panel beside it would make it mean "this panel" — which is neither what it
says nor why it was written. The submenu is gated on the set of kinds that consume zoom, in the **same
edit to the same block** as FR-062, at a cost of about three lines. So this decision adds a task's
worth of assertion, not a task.

**Alternatives rejected.**

| Alternative | Rejected because |
|---|---|
| Scale the row height in CSS with `calc()` | Two rounding authorities over one number; the drift accumulates linearly down the list. This is the whole finding. |
| Leave the row height fixed and scale only the text | Text overflows a 22 px row at level +1 and the list looks broken at every level above 0 — and the spec names this as the thing that "breaks the windowing arithmetic rather than merely looking wrong". |
| Measure a rendered row and feed the measurement back | A layout read per render on a virtualised list, and a feedback loop between the measurement and the thing being measured. The height is derivable; nothing needs measuring. |
| Give the panel its own zoom state | `Panel.zoom` is persisted, per-panel, already chorded and already synced with the layout. A second store would need its own persistence and its own restore. |

---

## R27. FR-070 — the folder picker is validated afterwards, not fenced

**Decision.** The dialog stays exactly as it is. The **renderer** decides the refusal, immediately on
the picker's return, using **`relPathUnderRoot`** — one call that answers containment and
relativisation together. The refusal is shown **on the scope control**, in the slot the missing-scope
marking already occupies, and **nothing is written to the scope box** when it fails.

**Rationale.** `packages/ui/src/main/pick-folder.ts:46-53` is a wrapper over the OS dialog and nothing
more:

```ts
const defaultPath = resolvePickerDefaultPath(requested, deps.home, deps.existsAsDir);
const result = await deps.showOpenDialog({ properties: ['openDirectory'], defaultPath });
return result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] ?? null);
```

`defaultPath` is where the dialog opens. There is no option that confines it, which is what makes
FR-070's "restricted to the project" a validation rather than a fence.

**Why the renderer and not main.** `throng:pickFolder` (`main.ts:938-951`) is a shared primitive with
two other consumers through one component: `folder-picker.tsx:56-62` serves the new-project form
(`projects-panel.tsx:391-402`) and the preferences start-folder control (`form-controls.tsx:504-524`),
neither of which has a project root to be inside. Teaching the channel about project confinement
would put one feature's rule inside a primitive two unrelated callers share — Principle VIII, and the
kind of coupling that makes the next caller pass a flag to turn it off. The renderer already holds
`projectRoot` on the panel's state, `relPathUnderRoot` is pure and exported from `@throng/core`
(`packages/core/src/index.ts:164`), and no I/O is needed to answer the question.

**Why `relPathUnderRoot` alone, and not `isWithinRoot` first.** `path-rules.ts:27-34` returns
`string | null` and returns `null` precisely when the path is not inside the root, so one call is both
the guard and the conversion; calling `isWithinRoot` first would be the same comparison run twice.
Its comparison is case-insensitive and separator-agnostic while the returned slice keeps the original
spelling (`:20-23`), which is what the scope box needs — a lower-cased relative path would match no
directory on a case-sensitive scan.

**The trap, and it is one line in the doc comment.** `relPathUnderRoot` returns **`null` for the root
itself** (`:24-26`: *"The root itself yields null rather than `''`: callers are revealing a FILE, and
the root row is not a thing they can mean"*). Here the root **is** a legitimate choice — it is
FR-030's default, spelled `''` in the control and `null` on the wire (`panel-config.ts:24-33`). So a
user who browses to the project root and clicks OK would be told their own project is outside their
project. The caller tests for the root first, with the same comparison the rest of the app uses, and
maps it to `''`; only then does it call `relPathUnderRoot`.

**Which containment primitive — a real fork in the road, resolved deliberately.** There are two in the
codebase, and this feature already uses the other one: `file-search-service.ts:252` refuses an
out-of-tree scope with `isUnderPath` from `packages/core/src/fs/path-id.ts:97`, which additionally
refuses a literal `..` segment rather than resolving it (033 FR-032, per the comment at
`file-search-service.ts:239-242`). Both are kept, and the split is principled rather than accidental:

- **The picker returns a resolved absolute OS path** — the dialog cannot produce `..` — and the
  caller needs a *relative* answer. `relPathUnderRoot` produces one; `isUnderPath` produces a boolean
  and would need a second function to do the conversion.
- **The scope box accepts typed text**, which can contain `..`. That path is unchanged: it goes to
  main and is refused by `isUnderPath` exactly as it is today.

So the picker validates with `path-rules.ts` and the scan keeps validating with `path-id.ts`, each
against the input it actually receives. **No third implementation is added** — which is the outcome
the note at `path-id.ts:34` (*"byte-for-byte the predicate already spelled as `isWithinRoot`"*) exists
to warn about. Unifying the two is real work with its own blast radius and is not this feature's.

**Where the refusal is shown.** `ScopeControl` (`find-in-files-panel.tsx:688-720`) already has the
idiom: `data-missing` on `.fif-scope` (`:692`), `aria-invalid` on the input (`:705`), and a plain-text
sibling `.fif-scope__missing` reading *"Scope missing"* (`:708-713`), styled from
`--throng-colour-danger` at `find-in-files.css:140-148`. The refusal takes **that same slot** rather
than a second one — one control, one notice, per CLAUDE.md's *one condition, one notice*, whose
structural half (*"the report belongs to whatever OWNS the state"*) points at the scope control in
both cases.

Concretely, `scopeMissing: boolean` in the store (`find-in-files-store.ts:197`) generalises to
`scopeNotice: 'missing' | 'outsideProject' | null`, rendered by one span, with
`data-scope-notice` on `.fif-scope` replacing `data-missing`. The precedence is stated rather than
left to fall out: **the most recent condition holds the slot.** A refusal is a report about the
gesture the user just made and takes the slot immediately; the missing-scope condition is a standing
property of the run and is re-established by the next run, since the refusal writes nothing and the
scope text is unchanged. `setFindInFilesScope` already clears the notice on any edit (`:514-520`), and
that behaviour carries over unchanged.

A toast is refused for the reason CLAUDE.md gives: the remedy is *pick a different folder*, which is
reached from the control and not from a toast, and a message naming a remedy the user cannot reach
from it is worse than none. The nearest in-app precedent agrees — `projects-panel.tsx:168` marks the
offending field with an `--error` class rather than raising a notice.

**Alternatives rejected.**

| Alternative | Rejected because |
|---|---|
| Confine the OS dialog | Not possible. `defaultPath` is a start location; Electron exposes no subtree constraint. This is the finding, not a preference. |
| Validate in main inside `throng:pickFolder` | Puts a project rule inside a primitive shared by the project form and the preferences editor, neither of which has a root. |
| A second `throng:pickFolderInProject` channel | A second channel and a second dialog wrapper to add one pure comparison the renderer can already make. |
| Accept the outside path and store it absolute | FR-070 requires a root-relative value, and an absolute scope would break the *"survives the project moving on disk"* property `panel-config.ts:31-33` is built on. |
| An in-app chooser over the explorer's own tree | Genuinely confined, and genuinely new UI. Offered and declined in the clarification. |
| A second `data-*` attribute beside `data-missing` | Two markings on one control for two conditions that are alternatives, and a crowded control when both hold. One slot with a stated precedence is the same information with one surface. |

---

## R28. The reach problem — four value CHANGES, one bump, and the trap this file records four times

**Decision.** Bump **`SHIPPED_DEFAULTS_VERSION` 6 → 7**, and extend the upgrade with a **guarded
value-rewrite** covering the settings leaves FR-074 and FR-075 change and the theme tokens FR-067 and
FR-065 change. Freeze what version 6 shipped in named constants, and rewrite only where the on-disk
value still equals it.

**This is the entry to read before the four requirements it serves**, because on the code as it
stands every one of them changes nothing for anybody who has already run the application, and no test
in this repository can see that.

**Rationale — the shipped upgrade is additive-only, in its own words.**
`packages/ui/src/main/shipped-defaults-service.ts:309-313` describes `upgrade()` as
*"additive-only … materialises newly-added theme properties into existing theme files … **NEVER
changing a value the user already has**"*, and `readPresentThemes` repeats it at `:388-390`
(*"still additive-only (no present value is changed)"*). So:

- **FR-067's re-derivation** (R24) writes new values for `searchMatch` / `searchMatchCurrent` /
  `searchMatchCurrentBorder`. Version 6 already materialised those tokens into every
  `themes/*.json` on disk — that bump's own comment says so, and gives the reason it was needed. An
  existing install therefore keeps the collapsing pair **forever**, and the person who reported the
  problem is by definition an existing install.
- **FR-065's glyph** is the same shape: `icons.findInFiles` is already on disk at `'⌕'`.
- **FR-074 and FR-075** are settings, and settings are worse, because `seed()` writes the
  **materialised** document. `shipped-defaults.ts:57-61` states it: *"first-run `seed()` writes the
  MATERIALISED settings document, so every install that has ever started the app holds the old
  … array literally and `parseAppSettings` honours a present array. Changing the constant alone
  therefore reaches FRESH installs only."* Round one's install wrote `trigger: 'run'` and
  `settleMs: 250`; changing `DEFAULT_APP_SETTINGS` leaves both exactly where they are.

And the line that makes this a planning item rather than a footnote, from the same block (`:78-79`):
*"no fresh-install E2E can see either gap, because every test run starts from an empty config root.
The population at risk is exactly the one no test represents."* Version 6's comment already records
this trap arriving from two directions at once; this is the **third** direction — a value that
changes rather than a token or a key that appears — and the existing mechanism does not cover it.

**The guard, and the one place it is weaker than `explorer.excludeGlobs`'.**
`planSettingsUpgrade` (`shipped-defaults.ts:134-142`) rewrites one leaf and only when the on-disk
value still deep-equals `V4_EXCLUDE_GLOBS`, a frozen copy of what was written to users' disks
(`:85-98` explains why it must be a copy and not a reference). The same shape applies here, with one
honest difference: a six-element glob array that still equals the shipped list is strong evidence
nobody touched it, whereas `trigger: 'run'` — the literal on disk (`app-settings.ts:626`); the
descriptor's `'When you press Run'` is only its label — is **both** the value version 6 shipped and a
value a user might deliberately have chosen — the two are byte-identical and the document cannot tell
them apart.

So the guard is widened rather than weakened: **rewrite the `search.inFiles` leaves only when the
whole section still equals what version 6 shipped** — all six keys, not one. A user who changed
nothing in the section is far more likely never to have visited it, and a user who changed anything
keeps everything. This is a proxy and it is stated as one. It stays idempotent for the same reason the
existing guard does: after the rewrite the section no longer equals the v6 record, so a second run
plans nothing.

The theme half needs a new plan function beside `planThemeUpgrade` — the **first non-additive theme
upgrade** — guarded per token: rewrite `searchMatch` in a **built-in** theme only where it still
equals what version 6 shipped for that theme. A custom theme is never touched, and a built-in the user
has recoloured keeps their colour. The record of what version 6 shipped already exists in
`packages/core/tests/unit/fixtures/pre-refactor-theme-colours.json`, which is why R24 requires that
fixture to be re-seeded *and* its previous contents preserved as the frozen v6 constants — the fixture
cannot serve both roles at once.

**What rides this bump, and what deliberately does not.**

| Change | On the bump? | Why |
|---|---|---|
| FR-074 `search.inFiles.trigger` → `asYouType` | Yes | Otherwise the default change reaches nobody who has run the app, including the maintainer who asked for it. |
| FR-075 `search.inFiles.settleMs` → 500 | Yes | Same, and it is meaningless without FR-074. |
| FR-067 the three search-match colours, 15 themes | Yes | Otherwise the re-derivation is invisible to every existing install. |
| FR-065 `icons.findInFiles` glyph | Yes | Same mechanism, same population. |
| FR-073 `defaultGrouping: 'folder'` | **No** | `'folder'` is never what was shipped, so the guard idiom refuses it by construction. Read-time coercion is the answer (R25), and it needs no bump. |
| FR-076 moving descriptors between groups | **No** | Presentation of the editors; nothing on disk changes. |

**Decided 2026-09-09 (plan D1): take the rewrite.** The section guard is a proxy and stays one, and
the reason it is accepted is the asymmetry of being wrong: these defaults were **asked for**, the
guard fires only on a section nobody has touched, and every value it rewrites is a preference the user
changes back in one click — so a false positive costs one setting, while fresh-install-only reach
costs the person who requested the change the whole change.

**The additive-only contract is narrowed, not broken, and the narrowing is stated in words** (plan
D1): *additive for tokens and themes the install does not have; and, for an enumerated, frozen set of
leaves and tokens, a rewrite where the on-disk value is still byte-identical to what a named earlier
version shipped.* The guard **is** the contract. `upgrade()`'s doc comment at
`shipped-defaults-service.ts:309-313` must be rewritten to say so, or it goes on promising something
the code no longer does.

**The JSON-editor complaint is accepted, not fixed** (plan D3). Making it silent means a permanent
carve-out for one retired value inside a general validation checker, which every future reader of
`settings-validity.ts` would have to understand before trusting the rest of it. The complaint is
accurate and self-clearing; the behaviour is right throughout, because `correctScalar` reads the value
as `'file'` on every read.

**Alternatives rejected.**

| Alternative | Rejected because |
|---|---|
| Change the constants and accept fresh-install-only reach | The four requirements exist because the maintainer met the shipped behaviour on an installed build. A fix they cannot see is not a fix. |
| Rewrite unconditionally on bump | Overwrites deliberate customisation — a recoloured theme, a chosen trigger — which is what every guard in `shipped-defaults.ts` exists to prevent. |
| Ask the user to delete their config root | Not a shippable migration. |
| A one-off startup script outside the shipped-defaults service | A second migration mechanism beside the versioned one, with its own idempotence to get right. The version marker exists for this. |

---

## R29. FR-064 / FR-063 — the typography role the panel never took

**Decision.** `.fif-panel`'s body text subscribes to the **`paneText`** role by joining that role's
selector list in `theme.css`. The **code snippet keeps the `editor` role's FAMILY only** — monospace,
as it already does — and takes its **size and weight from `paneText`**. FR-063's bold heading reads
`var(--throng-font-weight-bold)`. The four `0.85em` secondary rules **stay**, now relative to the
correct base.

**Rationale.** The role registry is `TypographyRole` in `packages/core/src/config/theme.ts:60-86`,
and subscribing is a CSS matter with no per-component wiring: `theme.css:2138-2150` lists the
selectors that take `paneText`'s six emitted variables, and a component simply carries a class in
that list (`panes.css:50-58`'s `.pane-explorer__empty` is the worked example, comment and all —
*"font from the paneText typography role (theme.css)"*). `find-in-files.css` carries none of them,
which is the defect exactly: 021 FR-049 requires Pane Text to reach the body text of **every** pane
and panel, and this panel shipped without it. No requirement is added; FR-064 records the correction.

**The snippet sub-decision, which FR-064 requires be stated wherever it is made.**
`find-in-files.css:239` already takes `--throng-font-editor-family` and nothing else. That stays, and
the reason is not only that code is monospace:

- **The `editor` role's size is independently user-configurable.** A row whose snippet took
  `--throng-font-editor-size` while its heading took `--throng-font-paneText-size` would have a height
  that is a function of whichever the user happened to set larger.
- **The results list is windowed on a fixed row height** (R26). A row height that depends on two
  independent settings is a row height the windowing arithmetic cannot predict, and R26's whole
  finding is that the arithmetic and the rendered height must agree exactly.

So the family is borrowed — deliberately, and it already is — while the metrics come from one role.
This is the same partial borrowing the sheet already does, made explicit rather than incidental.

**Why the four `0.85em` rules stay.** They are on `.fif-scope__missing` (`:146`), `.fif-status`
(`:166`) and the counts/positions group (`:223`) — metadata beside the body text, not the body text
itself. (`.fif-scope__ran` at `:153` is deleted by FR-072 regardless.) The defect FR-064 names is that
the *base* was `body` rather than `paneText`; once the base is right, a relative secondary size is an
ordinary typographic choice and not a violation of "Pane Text MUST reach the body text". The body text
— group headings, snippets, inputs — sets no size of its own and takes the role's. **Stated so it can
be overruled**: if the maintainer reads FR-064 as requiring the panel to carry exactly one text size,
these four rules go too, and the change is four deletions.

**FR-063's weight.** Both forms exist today: `--throng-font-weight-bold` and
`--throng-font-weight-normal` are emitted from `ThemeFonts.weights` at `theme.ts:668-672`, and each
role additionally emits `--throng-font-<role>-weight` at `:688-689`. The heading takes the **base bold
token**, because it wants "bolder than the rows", and the rows take `paneText`'s own weight — a role
weight would give the heading whatever the row already has. A literal `600` is what
`find-in-files-results.test.ts` guards against in spirit for colour (`:253-262`) and what 021 made
themeable for weight; the same rule applies here even though the existing guard only greps colours.

---

## R30. FR-060 / FR-061 — a name that is the query, and a rename that never happens

**Decision.** `panelDisplayTitle` gains a `findInFiles` branch reading the term from **`panel.config`**,
needing no new title source. Rename is removed by **not registering a starter** and by omitting the two
menu items for this kind — the chord then does nothing by construction.

**Rationale.** `packages/core/src/workspace/panel-title.ts:64-83` branches for `terminal` and `editor`
and otherwise returns `panel.title`, which the layout fills with the positional placeholder — the
"Panel 7" the maintainer saw. The branch this panel needs takes no new `PanelTitleSources` field,
because the term is already in `Panel.config`: `findInFilesConfigOf` writes all five query fields on
every change (`panel-config.ts:68-77`, and the effect at `find-in-files-panel.tsx:299-301`), and the
existing editor branch sets the precedent of reading `panel.config` as a backstop (`panel-title.ts:78`,
`panel-placeholder.tsx:173-174`). The config write is debounced at the *layout save*, not at the
in-memory update, so the header follows typing.

`panelDisplayTitle` bounds its result with `truncateGraphemes` (`:54-61`), so a long term is capped by
`tabs.maxNameLength` through the same path as a long shell title — which is the reason #218 put the
rule in one function, and the reason the term does not need its own limit.

**FR-061 is satisfied by absence in three places, and the chord needs no special case.**
`requestPanelRename` (`panel-rename.ts:30-38`) looks the panel up in a module-level registry and
*"Returns whether anything was listening — a panel whose header is not mounted (or has already gone)
is a no-op, not an error"*. The header registers itself unconditionally today
(`panel-placeholder.tsx:203-206`). Skipping that registration for this kind makes `panel.rename` a
no-op for it with **no branch in `app.tsx`** and no new state — the mechanism the registry was built
with already answers the question. The two menu items (`panel-header-menu.ts:104-121`) become
conditional on the kind: **absent, not disabled**, per FR-061 and Constitution VI's *absent when
meaningless* — renaming is not temporarily unavailable here, it is never meaningful.

**The deliberate exception, recorded because it breaks an app-wide rule.** Every other panel is
renamable. This one is not, and the reason is that its identity **is** its query: FR-019 lets a tab
hold several, and a user-chosen name would hide the only thing that tells them apart. That is the
spec's argument (FR-061) and it is recorded here so the next reader of `panel-header-menu.ts` finds a
decision rather than an omission.

---

## R31. FR-079 — a token resolved by hand and then frozen

**Decision.** Derive an icon control's box from `--throng-size-icon` with `calc()`. Fix the **two**
controls this feature owns or changes; record the rest. The guard is a **stylesheet-as-text** assertion
that the rule declares no absolute pixel box metric.

**Rationale — the tell, and why nothing caught it.**

`.fif-btn` (`find-in-files.css:78-96`) sets `width: 22px; height: 22px; padding: 3px` with
`overflow: hidden` and `box-sizing: border-box`. The theme's icon size is `sizes.iconPx: 16`
(`theme.ts:329`), emitted as `--throng-size-icon` at `:664`, and `.icon` sizes **itself** from it
(`theme.css:2377-2379`). So:

> **`16 + 3 + 3 = 22`.**

That is the whole finding. A magic number that equals a token's default plus its own padding is a
**token dependency written in arithmetic** — and the token's name appears nowhere in the rule, so
**no grep for `--throng-size-icon` will ever find it**. It is a token that was *resolved by hand at
authoring time and then frozen*, which is a different failure from the one the project already
guards against.

**Why every themeable-icon audit missed it, stated precisely because it decides where the rule
belongs.** The themeable-icon NON-NEGOTIABLE asks three things of a control: that its glyph comes
from an icon token, that it carries a hover title naming its action, and that its colours come from
theme tokens. `.fif-btn` **passes all three** — it renders an `Icon`, its buttons carry titles, and
`find-in-files-results.test.ts:253-262` proves the sheet holds no colour literal. The audits look for
a *missing* token and for a *hardcoded colour*; this is neither. What is hardcoded is a **metric**,
and it is hardcoded as the resolved value of a token that is correctly referenced everywhere else.

**So this is Principle X, not the icon rule** — externalised configuration, and specifically its
"values a user needs to change" half. `sizes.iconPx` is a shipped control in the Themes editor; a
control whose box ignores it is a setting that governs less than it says it does, which is the class
`settings-inertness` guards exist for. Filing it under the icon NON-NEGOTIABLE would have put it
where the audits already looked and already passed.

**The two symptoms differ by one declaration**, and a task written for the wrong one sends its
implementer hunting:

| Container | Raising `iconPx` gives | Example |
|---|---|---|
| has `overflow: hidden` | the glyph **clipped** | `.fif-btn`, `.find-bar-btn` |
| has none | the glyph **overflowing**, colliding with neighbours | `.explorer-toolbar__btn`, `.pane-collapse` |

**Scope, and why it is narrow on purpose (FR-079a).** The audit found five instances and left two
stylesheets unopened. Past two or three, this is a repository-wide pattern, and sweeping it inside a
find-and-replace feature would mean one commit touching the explorer, the find bar, the panes rail and
the terminal — none of which this feature has any other reason to enter, and one of which
(`.pane-collapse`) has a comment saying its fixed size is load-bearing for the collapsed rail's
geometry. The two taken are the two the round's own requirements reach: the panel this feature builds,
and the toolbar control FR-065 is about.

**Why the guard is a text assertion over the stylesheet.** jsdom does not resolve `var()` through the
cascade, and this repository's component tests read these sheets as **text** rather than attaching
them to a document — so there is no computed pixel value to assert at any layer below a real browser.
The literal guard is the honest instrument, and it is the one `find-in-files-results.test.ts` already
uses for colours in the same file.

**Alternatives rejected.**

| Alternative | Rejected because |
|---|---|
| Fold it into FR-065 | FR-065 says *"The remedy is the glyph"*. Stretching a requirement to cover work it does not describe is how a spec stops reading as a contract (FR-079b). |
| Fold it into FR-064 | FR-064 is the Pane Text typography role. This sizes a **glyph**, not body text; `.icon` explicitly opts out of inheriting surrounding text size (`theme.css:2374-2377`, 018 follow-up). Calling it a 021 FR-049 violation would be overreach. |
| Sweep all five, plus the unopened sheets | A repository-wide pattern inside a feature that has no other reason to touch four of those files, one of which is load-bearing geometry. Recorded as F3 and an issue instead. |
| Assert the computed pixel size | No layer below a real browser can produce one here. |
| Leave all five and file one issue | The Find in Files panel is this feature's own surface, and the explorer toolbar is the control FR-065 is changing. Shipping "make this icon more prominent" beside the mechanism that punishes making icons bigger is incoherent in the same way as fixing the zoom menu on one panel and not the next. |

---

## Items carried into the plan — round two

Six were open when this section was written and all six were answered on 2026-09-09; the answers live
in the plan as **D1–D6**, and each is folded back into the decision it changes above.

1. **The distinctness floor is a MEASUREMENT** (R24) and cannot be chosen from a desk. Taken after the
   fifteen themes are re-derived; the constant follows it, never the reverse. **Plan M1** names the
   command. If the re-derivation cannot clear a perceptually meaningful floor on the darkest themes,
   that is a finding to report — not a number to lower.
2. **`pre-refactor-theme-colours.json` serves two roles at once** (R24, R28). **Decided (D4)**:
   separated in the same change, in a stated order, because a guard pointed at the re-seeded fixture
   compares the new values against themselves, rewrites nothing, and passes every test —
   `shipped-defaults.ts:85-98`'s *"silently inert"* migration, arriving from the theme side.
   **Plan M2** names the command that confirms the re-seed.
3. **`SHIPPED_DEFAULTS_VERSION` 6 → 7 is not optional** (R28), and its payload spans two documents.
   **Decided (D1)**: taken, with `upgrade()`'s additive-only contract **narrowed in words** rather
   than broken in silence.
4. **The Zoom submenu on an untyped panel** (R26). **Decided (D2)**: closed in this round, in scope by
   FR-062a, in the same edit as FR-062.
5. **The JSON editor will flag a stored `'folder'`** until the next ordinary write (R25).
   **Decided (D3)**: accepted. Accurate, transient, and not to be "fixed" later by somebody reading it
   as a bug.
6. **`throng`'s two literals are hand-authored** (R24). **Decided (D5)**: hand-set, with the
   derivation asymmetry recorded at the literals and the gate run over `ALL_DEFAULT_THEMES`.
7. **The E2E budget moves in both directions** — up for FR-078's sub-workspace assertion, down for the
   `ranScope` spec FR-072 deletes — and both are re-seeded in the same commit, with the raise justified
   per-test in `e2e-budget.json`'s `measuredFrom` field as every prior raise was.
8. **Zero new theme tokens of either kind** (D6). `EXPECTED_ICON_TOKEN_COUNT` stays 65; FR-065 changes
   a token's value, which is D1's payload.
