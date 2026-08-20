# Movable verdicts — the tests that could name no reserve entry

**This file is what FR-022 requires**: every verdict ends applied, or declined with a recorded
reason. These 191 are neither yet, and leaving them in a scratch directory would have made
"every verdict accounted for" a claim nobody could check.

## Where they came from

Spec 035 requires every E2E test to name the constitutional reserve entry that makes it irreducible.
Five readers went through all 226 spec files and asked one question per test: **what does this assert
that no unit, component, integration or contract test could?**

191 tests had no answer. That is not a failure of the reading — it is the tag doing its
job on its first pass. A test that cannot name an entry is a test that should not be at this layer,
and finding those was always half the point of asking.

For context, the tests that COULD name one came out overwhelmingly `@reserve:layout` (103) and
`@reserve:window` (93), against `@reserve:native` (9), `@reserve:osdrag` (6), `@reserve:process`
(6) and `@reserve:focus` (3). This suite is about what the engine painted and what a second real
window does. The entries that sound most end-to-end are the ones almost nothing actually claims.

## What these numbers do NOT mean

**Not a deletion list.** Every one of these needs a replacement written at the named layer, observed
failing against a broken implementation, and only then may the E2E go (constitution Principle V,
FR-002). Each of the ones below took a red step, a named covering test and a verification run
against the trimmed spec.

### Applied so far

| E2E | went to | note |
|---|---|---|
| `config-files` (whole file) | component | |
| `new-project-folder` (×4) | contract + component | `pickFolder` extracted from `main.ts` |
| `status-bar` (×2, whole file) | component | |
| `quick-open:549` | component | |
| `titlebar-chrome:107` | component | |
| `tree-drop-open:194` | component | |
| `panel-tooltips:115` | unit | |
| `editor-open-target` (×2, whole file) | component | `EditorOpenListener` driven directly |
| `tree-unsaved-dot` (whole file) | component + unit | added the path-normalisation cases the E2E could not reach |
| `subworkspace-persist-error` (whole file) | component | the real sidebar panel, so the NOTICE is asserted |
| `terminal-root-lock` (whole file) | — | strict duplicate of the integration test |
| `editor-recovery-stale` (whole file) | integration | found the un-awaited-`remove` gap the E2E's poll could not see |
| `fileop-lock-cause` (×2, whole file) | unit | `speakFailure`, the join neither end covered |
| `os-drop` (×3) | component | the synthetic `throng:os-drop` seam |
| `os-drop-defects:151` | component | |
| `subtree-expand-collapse` (×3) | component | took the ipcMain listing instrument with them |
| `active-panel` (×2, whole file) | component | **`PanelPlaceholder` mounts in jsdom** |
| `destroy:68` | component | |
| `editor-naming` (×2, whole file) | component | Reset Name's disabled state had no test at any layer |
| `editor-feedback3` (×2) | component | found #283 |
| `removal-verbs:130` | component | |
| `destroy:147` | component | **`TabGroup` mounts too** — the whole workspace renders in jsdom
| `tab-picker:76` | component | the overflow precondition was layout; the claim was not |
| `sidebar:56` | unit | a claim about ABSENCE across the renderer — the one migration to a source guard
| `ux-refinements:249, :271` | component | |
| `ux-refinements:303` | component | SPLIT — its tab and panel thirds; the project third stays |
| `workspace-docking:98, :154` | component | |
| `icon-packs:49, :66` | component | three payload-shape errors and a rung the shipped theme hid |
| `preferences-themes:226, :322, :362` | — + component | the file semantics were ALREADY integration; only the wiring was missing
| `notification-prefs:304, :654` | component | four shape/vacuity errors caught by the red step
| `quick-open:354, :386, :418, :478` | — | four routes proved four times; `:616` proves they agree
| `tree-drop-open` (×4, whole file) | component | the chip route had no test anywhere
| `fileop-undo:117` | unit | `explorer-commands.ts` had no test, including its own guard |
| `quick-open:354, :386, :418, :478` | — | four routes proved four times; `:616` proves they agree
| `preferences-json:360, :423` | component | **`PreferencesApp` mounts with NO providers** |
| `tab-name-limit:265, :329, :355, :447, :509` | component | a STATEFUL fake daemon makes a project switch a real reload, which is what NP1/NP3 need to be falsifiable at all |

### Three components that were said to be unmountable, and are not

**`PanelPlaceholder`, `TabGroup` and `PreferencesApp` all mount in jsdom.** Each had been written
off — the first two on their import lists, the third by nobody having tried — and between them they
are the panel header, the whole workspace, and the entire preferences window.

| component | what it needs |
|---|---|
| `PanelPlaceholder` | six providers; only `useProjects` throws without one |
| `TabGroup` | the same six; it takes no props and brings its own `DndContext` |
| `PreferencesApp` | **none at all** — it is the window's root and mounts its own six |

`PreferencesApp` is the sharpest of the three: a component test supplies only
`window.throng.config`, which is one seam at the process boundary. The single stub is
`StandaloneEditor`, swapped for a textarea by the seam `preferences-json-tab.test.ts` had already
established and argued for.



**`PanelPlaceholder` mounts in jsdom under six providers.** Three separate migrations had turned
back at its thirty imports — dnd-kit, the terminal focus registry, the PTY-backed subprocess
registry, the document authority — and one of them wrote that judgement into a test header as if it
were measured. It was not. Only `useProjects` throws without its provider; `useDraggable`,
`useDroppable`, `useDetach`, `useSubWorkspaceWindow` and `useCapabilities` all tolerate absence, and
`ConfigContext` has shipped defaults.

Every verdict below that names a panel header, a panel's active state, a removal verb or a panel
title is therefore reachable now, and several were written by readers who assumed otherwise.

### Where the count stands, measured

Re-derived from the files rather than from this record, because the record lists the 191 verdicts as
they were READ and the suite has moved underneath them:

| | |
|---|---:|
| verdicts recorded | 191 |
| still pointing at a live `test(` declaration | **145** |
| file deleted, or the line no longer a declaration | 46 |
| of the 145: component | 71 |
| of the 145: integration | 73 |
| of the 145: unit | 1 |
| of the 145: flagged uncertain | 52 |

The 46 are resolved — migrated, deleted with their file, or moved by an edit above them. The 145 is a
**floor** on what is left rather than an exact figure: a line that shifted reads as resolved here, so
some of those 46 are still to do under a new number. Stated as a floor because the alternative is a
number that looks precise and is not.

### Declined, with the reason

A verdict that does not survive contact with the code is recorded here rather than quietly dropped
— that is the whole of what makes this file checkable.

| verdict | why it was declined |
|---|---|
| `tab-actions.e2e.ts:120` → component | The step-left / step-right / show-all controls render only when the strip OVERFLOWS (`tab-group.tsx:1427`), and `counts.overflowing` is computed from measured widths. jsdom reports every rect as 0×0, so the controls are never in the DOM to assert icons or titles on. The reading was right that nothing native is involved; what it missed is that the controls' EXISTENCE is a layout fact. This one belongs to `@reserve:layout`, not to component. |
| `app-shell.e2e.ts:166` → component | **Tagged `@core`.** See below. |
| `projects.e2e.ts:195` → component | **Tagged `@core`.** See below. |
| `projects.e2e.ts:240` → component | **Tagged `@core`.** See below. |
| `editor-find.e2e.ts:296` → component | **Cannot be red-proven at any layer.** See below. |
| `preferences-theme-reset.e2e.ts:110` → integration | **The fixture, not the layer.** See below. |
| `preferences-theme-reset.e2e.ts:132` → integration | **The fixture, not the layer.** See below. |
| `preferences-map-control.e2e.ts:129` → integration | **034 already decided this, on the record.** See below. |
| `preferences-map-control.e2e.ts:152` → integration | **034 already decided this, on the record.** See below. |

#### An absence guarded three times over — `editor-find.e2e.ts:296`

*"Find is a no-op when no panel is active"* is a real requirement and the verdict is right that
nothing OS-specific is involved. It was written as a component test, and then withdrawn, because it
could not be made to fail:

| removed | result |
|---|---|
| the panel-kind gate (`search-keybindings.tsx:108`) | 7/7 still pass |
| that gate AND the controller lookup (`:111`) | 7/7 still pass |

The reason is defence in depth. `FindBar` renders `null` unless `state.panelId === panelId`
(`find-bar.tsx:38`), so the bar's absence is a property of the find STORE and survives anything done
to the keybinding path. Three independent points produce the same absence, and no single-point
mutation can distinguish them.

That is good design and a bad test. An assertion nothing can break is not coverage, and committing
one is worse than leaving the E2E in place — it reads as proof while proving nothing. The E2E is not
better evidence either; it simply costs more to be equally unfalsifiable.

**What would settle it** is a test of the find STORE — that `openFind` refuses a panel whose kind is
neither editor nor terminal — because that is a claim with one owner and one place to break it. That
is a different test from this verdict, and it belongs to whoever writes it rather than being smuggled
in under this one.

#### The `@core` lane is a different question from the layer

A verdict answers *"what does this assert that no cheaper layer could?"* — a claim about MECHANISM.
`@core` answers *"which journeys must run on every push?"* — a claim about PURPOSE. The census asked
the first question 675 times and never once asked the second, so the two were never compared.

Measured: **3 of the 191 verdicts name a test tagged `@core`**, out of 35 `@core` declarations in the
suite. Small, and worth stating precisely because the reasoning generalises rather than the number.

All three are right about the mechanism. "Creates a project, makes it active, and opens its
workspace" really is workspace-store state and rendered DOM; nothing in it needs a real window. But
that is not why it is in the lane. It is there because it is the shortest path that proves the app
BOOTS — a build where Electron starts and the renderer throws passes every component test in this
repo and fails this one in four seconds. Moving it down would shrink the only check that runs against
a real assembled application on every push, in exchange for a few seconds of a lane that is capped at
50 tests and currently holds 35.

So the rule this establishes, for the rest of the backlog: **a `@core` verdict is declined by
default, and adopted only if someone argues the journey should leave the lane.** That is a decision
about what gates a push, not a decision about test layering, and it is not 035's to make silently.


More will land here. Three of the first three census verdicts examined in depth needed correcting,
and the same rate is expected across the rest — a decline is the record working, not failing.


#### `preferences-theme-reset.e2e.ts:110` and `:132` — the fixture, not the layer

Both were attempted, and the migration was written before it was measured. The reasoning was that
that file's own note — *"A component handed an `onReset` callback cannot tell you which it is wired
to"* — applied only to a test rendering `RowActions` in isolation with supplied callbacks, and not to
one mounting `PreferencesApp`, where `themes-tab.tsx` wires its own handlers. That much is true.

The conclusion was not, and the red step is the only thing that said so. Two mutations swap the
baselines outright:

```
reset-reads-entry     getAtPath(shippedTheme, …) → getAtPath(entryTheme, …)
revert-reads-shipped  getAtPath(entryTheme, …)   → getAtPath(shippedTheme, …)
```

**Both leave all four replacement tests green.** The cause is the fixture: the window opens on the
shipped theme, so `entryTheme` and `shippedTheme` hold the same value and which one is read cannot
be observed.

The sharp part is that **the E2Es have the same blind spot, for the same reason.** Both of them also
open on the shipped theme. So neither layer currently proves the distinction the two controls exist
for, and the E2Es were not buying it either — they were buying the round trip through a real window.

What would close it is a window opening on a token that is ALREADY customised, where reset owes the
factory value and revert owes the customisation and the two answers differ. That needs the component
harness to model the theme REGISTRY `themes-tab` resolves the active theme from, rather than taking
the `theme` document off the config payload: a seeded `themeOverrides` is ignored today, measured as
the control reading `#6aa3ff` where `#123456` was seeded.

The verdicts stay declined and both E2Es stay, because a replacement covering part of what an E2E
asserted is not a replacement. Four tests were kept as ADDED coverage of the enabled/disabled state
machine — which had no test at any layer — red-proven by `never-overridden` and `always-changed`.


#### `preferences-map-control.e2e.ts:129` and `:152` — 034 already decided this, on the record

Not declined on new evidence. Declined because the decision already exists, is written down in the
file itself, and re-making it is the failure `CLAUDE.md` devotes a section to: *a requirement that
changes existing behaviour needs a search for the requirement that already describes that behaviour,
before it is written down.*

`preferences-map-control.e2e.ts:113` records what 034 moved down and what it deliberately kept:

> The add case also asserted that the new key reached settings.json. That half is not lost: the
> removal test below adds a row, watches it reach the file, and then removes it — so the write path
> keeps a witness, and FR-022c (an empty map means empty, rather than falling back to the shipped
> value) keeps the end-to-end test it actually needs.

So the two survivors are not leftovers; they are the residue of a migration that already happened,
chosen for what they reach that the component tests do not. `:129` is the suite's witness that a map
edit lands in `settings.json` at all, and the emptiness rule is about what a real parse does with a
real empty object — the thing that decides whether a user can ever clear a map.

`:152` carries something a component test structurally cannot: a measured DEBOUNCE RACE. Its comment
records that polling for one of the two writes let a still-pending second write overtake the reset
and put the mapping back, *"measured once in a full-suite run under six CPU hogs"*. That is a
property of a real debounce against a real file under real contention, and a fake timer removes the
very condition it is about.

The classification pass read the CLAIMS and stopped there, which is how it produced these two — the
claims genuinely are about settings semantics. What it did not read was the note eleven lines above
them saying why they are where they are.

### Two things migration found that the E2Es had not

- **#283** — the rename box applies the strip-the-extension rule to FOLDERS, so a folder called
  `my.config` opens with `my` selected. The E2E asserted `top.txt` only, so the case had never been
  exercised at any layer. Filed, not fixed: this branch migrates tests.
- **A vacuous test of my own**, caught by its red step. A draft asserted that Escape SUPPRESSES the
  blur-commit that follows a cancel; deleting the suppression left every test green, because jsdom
  does not fire `blur` when a focused element is unmounted. The claim was narrowed to what runs and
  the gap written into the test. It is recorded here because it is the failure mode this whole record
  exists to make visible: a migration that reports a verdict applied when nothing was proved.

**Not a promise the count falls by 191.** Several will narrow rather than vanish: the
migratable half comes down and a smaller E2E stays. And some will not survive contact with the code
at all — three of the first three census verdicts examined in depth needed correcting, and one was
declined outright. Expect the same rate here.

**61 of them are flagged uncertain by the reader who wrote them**, marked below. Those are
hypotheses, not verdicts, and the flag was preserved deliberately rather than resolved by whoever
happened to be reading — a confident wrong verdict is worse than an honestly uncertain one, because
the whole value of this record is that the next person can trust it.

## By target layer

| layer | count |
|---|---:|
| component | 97 |
| integration | 93 |
| unit | 1 |
| contract | 0 |

The split is itself informative. **93 integration verdicts** is the larger half of
the story: those are tests reaching a real config store, a real file or a real daemon round trip
through a running window, when the same claim is provable against the real collaborator directly.
That is the spec's central thesis — the destination existed, it was just barely built.

## The record

### `active-panel.e2e.ts` — 2

- **:53** → `component` — single-window active-panel attribute/class toggling on click
- **:74** → `component` — per-tab active-panel memory is single-window workspace-store state

### `app-shell.e2e.ts` — 1

- **:166** → `component` — Asserts only rendered sidebar DOM contents, no real window property used

### `config-hotreload.e2e.ts` — 1

- **:111** → `integration` *(uncertain)* — pre-seeded settings.json read at startup gates a confirm dialog

### `context-menu.e2e.ts` — 1

- **:171** → `component` *(uncertain)* — pure DOM/state logic, panel reassigned to chosen tab via a synthetic non-native context menu click

### `delete-mixed.e2e.ts` — 1

- **:73** → `integration` — permanent multi-select delete via context menu ends in real fs removal; UI is generic selection+menu

### `destroy.e2e.ts` — 2

- **:68** → `component` — dialog-skip decision for an empty panel is pure renderer confirm-policy logic
- **:141** → `component` — cancel leaves tab/dialog state unchanged; pure renderer state logic

### `diagnostics-logging.e2e.ts` — 1

- **:123** → `integration` — native shell.openPath is stubbed away; remaining claim is renderer-to-main path resolution wiring

### `editor-content-menu.e2e.ts` — 6

- **:97** → `component` — right-click menu driving cut/paste on a mounted CodeMirror doc
- **:123** → `component` — selection-preserving right-click, pure editor/menu logic
- **:154** → `component` — selection-collapsing right-click, pure editor/menu logic
- **:179** → `component` — menu Undo routed to document authority, pure wiring
- **:203** → `component` — content-menu vs panel-menu item sets, pure DOM assertion
- **:254** → `component` — language-picker naming + focus return, pure DOM/focus logic

### `editor-external-change-named.e2e.ts` — 1

- **:36** → `integration` — structured file/panel/tab naming in the notice is fs-watcher + notice-builder logic

### `editor-feedback.e2e.ts` — 3

- **:84** → `integration` — out-of-tree save refusal is a real fs boundary check in the main process; notice UI is component-level
- **:116** → `component` — in-app context-menu item enable/disable keyed on open-buffer state, no OS involvement
- **:146** → `integration` — verifies a real file write via panel-header Save; unsaved/revert UI states are component concerns

### `editor-feedback2.e2e.ts` — 2

- **:82** → `integration` — In-app menu disabled-state from cross-panel file-identity comparison, not OS-specific
- **:110** → `integration` — In-app context-menu action creating a real folder, no window/native/layout claim

### `editor-feedback3.e2e.ts` — 3

- **:77** → `component` — pill text shows native-separator relative path, no real layout needed
- **:135** → `component` — rename input selectionStart/End range on entering rename
- **:159** → `integration` — blur-commit rename verified via existsSync on real disk

### `editor-file-deleted.e2e.ts` — 1

- **:102** → `integration` *(uncertain)* — real fs watcher delivers a real unlink into the live renderer

### `editor-file-switch.e2e.ts` — 2

- **:227** → `integration` — real async grammar-chunk race decides tab vs space indent profile
- **:253** → `integration` — reverse case of the same chunk-load race deciding indent profile

### `editor-find.e2e.ts` — 4

- **:85** → `component` *(uncertain)* — search decorations are DOM marks a jsdom-mounted editor could also render
- **:131** → `component` *(uncertain)* — toggle-narrowed match counts are DOM state, testable without a real window
- **:184** → `component` *(uncertain)* — Escape closing the bar and focus returning to content is DOM/focus logic
- **:296** → ~~`component`~~ **DECLINED** — the absence is over-determined by two independent guards (`findKind`, and `getPanelSearch` returning nothing for an untyped panel), so no mutation isolates either without fabricating a state the app cannot produce. A component version was written and deleted: it passed under both of its own mutations. Reasoning on the test itself.

### `editor-highlighting.e2e.ts` — 1

- **:201** → `component` — plain-line class marker and editability, no real colour/geometry asserted

### `editor-indentation.e2e.ts` — 1

- **:195** → `integration` *(uncertain)* — doc content/dirty-flag check; file's own "wiring witness" rationale matches the flagged anti-pattern in docs/testing.md

### `editor-indicators.e2e.ts` — 2

- **:24** → `component` *(uncertain)* — dirty-state indicator aggregation/clearing is pure UI state; save dialog is stubbed
- **:56** → `integration` *(uncertain)* — debounced auto-save write-to-disk is testable against a real fs without full Electron UI

### `editor-language-override.e2e.ts` — 2

- **:129** → `component` *(uncertain)* — strip text reflects detection state, no rendering-dependent claim
- **:326** → `integration` *(uncertain)* — stale languageId fallback exercised via real IPC round trip, no window-only mechanism

### `editor-menus.e2e.ts` — 2

- **:28** → `integration` *(uncertain)* — in-app (non-native) menu item state plus a real file's content loading into an editor
- **:98** → `component` — in-app (non-native) dirty-destroy dialog and panel removal, no OS or reserve mechanism

### `editor-missing-aggregate.e2e.ts` — 3

- **:78** → `integration` — real delete of two files aggregated into one consolidated notice
- **:318** → `integration` — real delete without tab reselect raises no notice (one-shot scan)
- **:355** → `integration` — setting suppresses the notice entirely for a real deleted file

### `editor-move-repoint.e2e.ts` — 2

- **:178** → `integration` *(uncertain)* — Coordinator re-point already integration-tested (AC4); UI cut/paste wiring doesn't need real Electron
- **:374** → `integration` *(uncertain)* — Real fs.watch reaction to an externally-renamed file is coordinator/watch logic, no Electron needed

### `editor-naming.e2e.ts` — 2

- **:81** → `component` — rename-box blur-without-typing and auto-name-from-file is pure renderer naming logic
- **:115** → `component` — auto-name/manual-rename/Reset-Name precedence is pure renderer naming logic

### `editor-open-target.e2e.ts` — 2

- **:21** → `component` — openTarget setting drives new-vs-reuse editor panel, plain DOM counts
- **:44** → `component` — default reuse-one-editor behaviour, plain DOM counts

### `editor-replace.e2e.ts` — 2

- **:128** → `component` *(uncertain)* — Replace-current advance behaviour is CodeMirror/find-controller logic
- **:157** → `component` *(uncertain)* — Match-offset rebasing after live edit is find-controller logic, not window/OS-specific

### `editor-stranded-recovery.e2e.ts` — 2

- **:133** → `integration` — real fs rename detected by the real file watcher while an editor is mounted, no window-only mechanism
- **:261** → `integration` — real fs write re-read on demand via a command, no window-only mechanism

### `editor-tab-destroy-reopen.e2e.ts` — 2

- **:133** → `integration` — one-buffer registry release on tab destroy is daemon/IPC registry state, no window/pty/native claim
- **:160** → `integration` — same one-buffer registry mechanism proven via reopen; no reserve mechanism

### `explorer-follow-active-editor.e2e.ts` — 1

- **:276** → `component` — selection-persistence guard is reactive logic; terminal/editor are just panel-type setup

### `explorer-live-sync.e2e.ts` — 4

- **:69** → ~~`integration`~~ **DECLINED** — the cited integration test covers the DEBOUNCE under churn, not the chain reaching the tree
- **:92** → ~~`integration`~~ **DECLINED** — same chain, same gap: no lower layer holds both the disk and the tree
- **:113** → ~~`integration`~~ **DECLINED** — `remove()` is the one mutation that never calls `reloadDirs`, so this asserts the watcher covering for it
- **:145** → ~~`integration`~~ **DECLINED** — as `:113`

### `explorer.e2e.ts` — 2

- **:323** → `integration` — dedup-naming + reveal round-trip need only a real copy service + stubbed shell
- **:474** → `component` — hide-from-view is a pure app/config state toggle, no OS/fs mechanism

### `fileop-lock-cause.e2e.ts` — 2

- **:111** → `integration` *(uncertain)* — real OS EPERM/EBUSY from an external lock classified into user prose
- **:209** → `integration` *(uncertain)* — real OS lock via throng's own shell classified as throng not another program

### `fileop-undo.e2e.ts` — 5

- **:73** → `integration` — real rename/undo/redo verified via existsSync through the daemon
- **:117** → `component` — keyboard-scope routing: Ctrl+Z fires pane handler regardless of DOM focus target
- **:147** → `integration` — real two-step move undo verified via existsSync on both ends
- **:212** → `integration` — cross-component: undoing a delete clears editor dirty state, real fs
- **:251** → `integration` — real name-collision refusal from the daemon reported and retryable

### `goto-line.e2e.ts` — 3

- **:601** → `component` — chord scope-routing gated on active panel type, no real layout needed
- **:646** → `component` — single-modal-slot mutual exclusion via dispatched keyboard chords
- **:676** → `component` — CodeMirror's own keymap not bound, verified via dispatched chord plus DOM count

### `icon-colour.e2e.ts` — 1

- **:124** → `component` — Duplicate-control check is pure rendering-registry logic, no real window needed

### `icon-packs.e2e.ts` — 4

- **:49** → `component` — resolved icon-cell text per pack token/fallback, no computed style needed
- **:66** → `component` — single-token override text, same resolution logic as above
- **:167** → `integration` *(uncertain)* — prefs-window edit re-skins the separate MAIN window live via IPC
- **:253** → `integration` *(uncertain)* — malformed pack.json on disk: app still starts, picker marks it disabled

### `menus.e2e.ts` — 2

- **:93** → `component` — Icon-element presence/count checks are DOM structure, no real window needed
- **:130** → `integration` *(uncertain)* — Context-menu click writing a real config file is testable via a real config service, no Electron

### `move-focus.e2e.ts` — 2

- **:71** → `component` — panel-to-panel directional focus via unambiguous chords, within one window
- **:105** → `component` — forward/backward cycle focus via unambiguous chords, within one window

### `notice-stacking.e2e.ts` — 1

- **:101** → `integration` *(uncertain)* — real refused moves raise/stack/dedupe/copy independent notices

### `notice-subjects.e2e.ts` — 3

- **:157** → `component` — notice heading/message text content and structure, formatting only
- **:199** → `component` — notice heading text assembled by the Project - Tab - Panel formatter
- **:297** → `component` — two notices' title text compared for identical formatting

### `notification-prefs.e2e.ts` — 6

- **:304** → `component` — static control markup/options/attrs in the Notifications settings group
- **:365** → `integration` — mode setting gates whether a raised notice renders on screen
- **:439** → `integration` — timed-mode notice removed after configured duration, real wall clock
- **:522** → `integration` *(uncertain)* — pre-030 settings file resolves to defaults with no config error
- **:577** → `integration` — dismiss-mode notice never auto-expires under a real timer
- **:654** → `component` — confirm-dialog Escape leaves the mode setting unchanged

### `open-in-terminal.e2e.ts` — 2

- **:138** → `component` *(uncertain)* — live comparison of two DOM lists + separator absence, no OS/window mechanism needed
- **:365** → `integration` *(uncertain)* — settings.json to menu catalogue wiring, no window/OS mechanism in the claim

### `os-drop-defects.e2e.ts` — 1

- **:151** → `component` — drop routing is driven by a synthetic CustomEvent, not a real DragEvent; jsdom reproduces this identically

### `panel-auto-naming.e2e.ts` — 3

- **:179** → `integration` — daemon's real name-claim + IPC broadcast back to sender relies on real persisted layout, no window-only mechanism
- **:221** → `component` *(uncertain)* — uncontrolled rename box's stale seed vs backing state is DOM/render-timing logic, not reserve-specific
- **:292** → `component` — tab-add rename-box and resulting panel title reflect app state, not a reserve mechanism

### `panel-failure-banner.e2e.ts` — 5

- **:408** → `integration` *(uncertain)* — menu-item presence given an already-real failure state; assertion itself is pure UI
- **:465** → `integration` *(uncertain)* — menu-triggered retry hitting a real broken path/shell; no native/window/pty mechanism asserted
- **:525** → `integration` *(uncertain)* — Clear-panel-type app-state transition over a real failure condition
- **:589** → `integration` *(uncertain)* — retry success/failure + banner clearing on hidden repair, real fs/shell but no reserve mechanism
- **:704** → `integration` *(uncertain)* — real config-seeded notification suppression not reaching the banner; no reserve mechanism named

### `panel-name-unique.e2e.ts` — 2

- **:96** → `integration` — cross-project global name-sequence numbering is daemon/SQLite service logic
- **:130** → `integration` — cross-project rename collision + notice-once is daemon uniqueness service + notice logic

### `panel-tooltips.e2e.ts` — 5

- **:49** → `component` — checks the title HTML attribute value only, no rendering needed
- **:63** → `component` — rename flow + title attribute check, testable against a fake panel model
- **:95** → `component` — popover text/attribute check; hover-rest timing simulable with fake timers in jsdom
- **:115** → `component` — page-wide title attribute string scan, pure DOM query
- **:126** → `component` — title attribute presence check on a button

### `phase9.e2e.ts` — 2

- **:90** → `component` — project delete confirm/cancel flow is pure UI state, no OS dependency
- **:108** → `component` — panel/tab counts and confirm-dialog wording are pure UI state

### `preferences-fonts-and-sliders.e2e.ts` — 2

- **:113** → `component` — :focus state on menu/menu-items, no real cascade needed
- **:225** → `integration` — revert-to-sitting-baseline semantics, pure app/config logic

### `preferences-json.e2e.ts` — 5

- **:360** → `component` *(uncertain)* — tab-switch refusal + invalid-theme notice is renderer-only gating logic
- **:423** → `component` *(uncertain)* — exit-blocking (tab switch, mode toggle) on invalid JSON is renderer-only gate logic
- **:615** → `component` *(uncertain)* — CodeMirror undo-history annotation bug reproducible with real CM in jsdom
- **:674** → `integration` *(uncertain)* — real file watcher + IPC broadcast reaching an open editor without moving caret
- **:761** → `integration` *(uncertain)* — real file watcher external-change flow, resolved by overwrite-to-disk

### `preferences-map-control.e2e.ts` — 3

- **:129** → `integration` — Config-store write/removal reaching settings.json, no UI-specific claim
- **:152** → `integration` — Reset-to-default write logic on config store, testable without full Electron
- **:201** → `component` — Column label, language names and picker option filtering are pure rendering

### `preferences-reset.e2e.ts` — 1

- **:355** → `component` — pure mode-toggle DOM visibility swap, no disk or IPC involved

### `preferences-row-actions.e2e.ts` — 2

- **:207** → `component` — button-count in gutter across a tab switch, purely structural
- **:269** → `component` — reset/revert transitions asserted only on displayed control value

### `preferences-scroll.e2e.ts` — 1

- **:45** → `component` — per-tab scrollTop persistence is React/DOM state, reproducible in jsdom

### `preferences-theme-reset.e2e.ts` — 2

- **:110** → `integration` *(uncertain)* — Reset wiring to the shipped on-disk theme value, no real OS window needed
- **:132** → `integration` *(uncertain)* — Revert wiring to the window-entry snapshot value, no real OS window needed

### `preferences-themes.e2e.ts` — 9

- **:161** → `integration` — config round-trip (file write + live CSS var) needs no real window/OS feature
- **:179** → `integration` — activation writes settings.json; no real window/OS behaviour is under test
- **:226** → `integration` — in-app confirm plus file deletion is app logic, not an OS feature
- **:240** → `integration` — pills already moved to component; remaining claim is a config-file round-trip
- **:290** → `integration` — control visibility plus one file/CSS round-trip; no OS feature required
- **:322** → `integration` — multi-file restore/recreate/preserve logic on the theme store, no window/OS feature
- **:362** → `integration` — per-theme restore file semantics; reachable without real window/OS behaviour
- **:407** → `integration` — dialog prefill/validation and file rename are app+fs logic, not OS-level
- **:495** → `integration` — reserved-name business logic over the theme store, no OS feature needed

### `preferences-window.e2e.ts` — 1

- **:125** → `component` — pure DOM absence/presence of a minimise control

### `project-settings.e2e.ts` — 1

- **:39** → `integration` *(uncertain)* — un-hide brings a file back into the real tree via daemon round trip

### `projects.e2e.ts` — 2

- **:195** → `component` — project creation/active-switch/panel-count is pure app state, no reserve entry applies
- **:240** → `component` — edit/delete via in-app confirm modal (not native) and resulting empty-state render

### `quick-open-perf.e2e.ts` — 2

- **:313** → `component` — UI state machine: rows plus still-listing banner shown together during a walk
- **:442** → `component` — modal shows a building state before a walk-in-progress resolves

### `quick-open.e2e.ts` — 8

- **:324** → `integration` — picker-to-workspace open wiring, no OS/native mechanism
- **:354** → `integration` — reuse-vs-new-panel routing is pure app logic
- **:386** → `integration` — routing driven by a real config value, no reserve mechanism
- **:418** → `integration` — focus-existing-editor routing within one workspace, not cross-window
- **:478** → `integration` — dirty-buffer prompt wiring, shipped dialog reused
- **:517** → `integration` — exclude-glob filtering over a real file index, no reserve mechanism
- **:549** → `integration` — project-scoped filtering across two real projects, pure app logic
- **:616** → `integration` — cross-route outcome consistency, pure app logic

### `removal-verbs.e2e.ts` — 2

- **:69** → `component` — in-app (non-native) confirm-dialog text; own docblock argues setup cost, not irreducibility
- **:130** → `component` — tooltip title attribute computed inline from panel state, no OS involvement

### `search-keybindings-editor.e2e.ts` — 2

- **:122** → `component` — just checks static action-list testids render in preferences list; core completeness covered lower down
- **:137** → `integration` *(uncertain)* — synthetic keydown dispatch + real config-file write of rebound chord; no reserve mechanism, just file I/O

### `sidebar.e2e.ts` — 1

- **:56** → `component` — Only checks panel presence/absence, no geometry needed, DOM structure suffices

### `status-bar-deduped.e2e.ts` — 1

- **:70** → `component` — DOM text de-dup between two components under faked elevation; no native window property checked

### `subtree-expand-collapse.e2e.ts` — 3

- **:415** → `integration` *(uncertain)* — open-folder state verified against real readdirSync, no window feature used
- **:477** → `integration` *(uncertain)* — expand-one-level verified against real fs, excluded folder never listed
- **:577** → `integration` *(uncertain)* — hidden-folder-never-listed verified via instrumented real ipcMain listing calls

### `subworkspace-persist-error.e2e.ts` — 1

- **:15** → `integration` *(uncertain)* — real seeded SQLite trigger; daemon-side persist failure surfaced not swallowed

### `subworkspace-sync.e2e.ts` — 1

- **:131** → `integration` *(uncertain)* — greyed-out class from real pure derivation function; no reserve entry covers a coverage gap

### `tab-actions.e2e.ts` — 1

- **:120** → `component` — icon presence and title/aria-label attributes are renderable without a real window

### `tab-name-limit.e2e.ts` — 5

- **:265** → `integration` *(uncertain)* — over-long-name-cannot-return guarantee is a real daemon/store round trip
- **:329** → `integration` *(uncertain)* — live settings hot-reload reaching an already-open field, no window-only mechanism
- **:355** → `integration` *(uncertain)* — seeded 300-char name load/shorten/preserve is a real daemon/store round trip
- **:447** → `integration` *(uncertain)* — lower-then-raise round trip through the real store, no window-only mechanism
- **:509** → `integration` *(uncertain)* — ordinary save at lower limit persists shortening via the real store

### `tab-picker.e2e.ts` — 2

- **:76** → `component` — row order/panel-count/active-mark is DOM state; list/highlight already covered by component picker.test.ts
- **:215** → `component` — DOM focus-restoration on dismiss; jsdom tracks activeElement/focus accurately

### `terminal-find.e2e.ts` — 1

- **:249** → `component` — find-bar DOM mounted per panel id; no real PTY fidelity is asserted

### `terminal-flavours.e2e.ts` — 2

- **:94** → `integration` *(uncertain)* — real host machine shell detection + dropdown reactivity, no window/focus/pty/native claim
- **:121** → `integration` *(uncertain)* — config hot-reload write flowing to dropdown; file-watch + IPC wiring claim

### `terminal-path-drop.e2e.ts` — 1

- **:22** → `integration` — asserts quoting/join formatting of dropped paths via synthetic CustomEvent seam, no real PTY or OS drag

### `terminal-title-persist.e2e.ts` — 1

- **:22** → `component` — title-store persisting across a component remount is renderer state, real PTY title is setup

### `theme-flash.e2e.ts` — 1

- **:156** → `component` *(uncertain)* — default-theme color-scheme is pure derived CSS state, no native window property checked

### `theme-sweep.e2e.ts` — 2

- **:113** → `unit` — toCssVariables merge completeness across bundled themes is a pure function property
- **:165** → `component` — optional-token removal is DOM style API behaviour reproducible in jsdom via applyTheme()

### `theme-tokens.e2e.ts` — 1

- **:137** → `integration` — Boot-time fallback plus no-stray-file is config/theme-service logic; no Electron window needed

### `transient-overlays.e2e.ts` — 4

- **:195** → `component` *(uncertain)* — overlay-registry one-slot claim plus real chord dispatch and DOM focus
- **:252** → `component` *(uncertain)* — three-overlay chain caret-focus bug from mount/unmount effect ordering
- **:291** → `component` *(uncertain)* — pointer-opened language picker dismissed by a chord-opened overlay
- **:318** → `component` *(uncertain)* — four-overlay chain, caret still lands on the final survivor

### `tree-drop-open.e2e.ts` — 4

- **:84** → `component` — synthetic drop CustomEvent (jsdom-identical) opens editor via workspace-store logic
- **:109** → `component` — synthetic drop CustomEvent refocuses the existing panel via workspace-store dedup logic
- **:148** → `component` — synthetic drop CustomEvent replaces an existing editor's content via workspace-store logic
- **:180** → `component` — synthetic drop CustomEvent on a tab chip activates the tab via workspace-store logic

### `ux-refinements.e2e.ts` — 4

- **:198** → `component` — project path text is pure prop-to-DOM rendering, no IPC needed
- **:249** → `component` — custom context-menu rename/destroy flow is UI event wiring, not native
- **:271** → `component` — context-menu rename flow is pure UI event wiring
- **:303** → `component` — double-click triggering inline rename is pure event wiring, no geometry

### `workspace-docking.e2e.ts` — 2

- **:98** → `component` — tab/panel add renders type-selection form, plain DOM counts
- **:154** → `component` — split collapses on close, plain DOM counts

## Where it finished

Re-derived from the files, the same way the earlier count was — a verdict is LIVE only while it
still points at a `test(` declaration that exists.

| | |
|---|---:|
| verdicts recorded | 186 |
| resolved — applied, declined, or the file gone | **180** |
| still live | **6** |
| of the 6: component | 4 |
| of the 6: integration | 2 |

The suite went **689 → 548 declarations** (a **20.5% cut**) across **229 → 207 spec files**, with the
reserve-tag debt at **121** and the sleep budget at **42**.

### The last six, and what stops each one

FR-022 asks for applied or declined-with-a-reason, and "there was no time" is not one. Each of these
was READ, its covering tests found, and the obstacle named. One is applied-by-narrowing; five are
declined, and every decline says what would have to change for the answer to be different.

#### `editor-indicators.e2e.ts:24` — APPLIED by narrowing

Already split by this spec. The four-dot agreement is `component/editor-dirty-store.test.ts` and the
call sites are `unit/unsaved-dot-call-sites.test.ts`; what is left in the E2E is the SAVE — a stubbed
native save dialog, a real `Ctrl+S`, and one dot kept as the live witness that a real edit reached
the real store. The test's own comment records the split. Nothing further to move.

#### `transient-overlays.e2e.ts:195` and `:252` — DECLINED: the ordering is the subject

Both are about the CARET after a chain of overlays — the third one opened must hold focus, with
exactly one overlay on screen. The one-slot rule is already `unit/transient-overlay.test.ts`
("claiming while another holds the slot calls the incumbent's dismiss exactly once"), so what these
two add is the FOCUS, and the defect they exist for is an effect-ordering race between an outgoing
overlay's focus RESTORE and an incoming one's guard.

jsdom has focus, so this was examined rather than waved away. What jsdom does not have is the
ordering: the restore that MASKS the bug at two overlays happens because the outgoing input is still
in the document for a frame, and a synchronous unmount does not reproduce that frame. A component
test would assert the right thing and could not fail for the right reason — which is the vacuity this
whole record exists to prevent, and the reason the pair stays.

They are `@reserve:focus` in substance and are tagged `@window`. **Retagging them is the follow-up**,
and it is left as one deliberately: a reserve tag is a claim about a test, and changing one belongs in
the commit that can show its evidence.

#### `panel-auto-naming.e2e.ts:179` and `:221` — DECLINED: a fixture, not a migration

`:179` is the daemon's name-claim service broadcasting an adjustment BACK to the window that asked;
`:221` is that adjustment landing UNDER an open rename box. Both need two projects whose panel names
collide, both names already persisted in the layout the claim service reads, and the adjustment
arriving asynchronously afterwards.

The claim service is covered in `daemon/tests/integration`. The COLLISION is not, and building it
below E2E means seeding two projects' layouts into a real `WorkspaceRepository` and driving
`panelName.claim` against them. That is a worthwhile integration test — but it is a fixture the
feature never had, and writing it under a spec about layer classification would be building missing
coverage and calling it a move. **Recorded as work worth doing, not as a verdict that survives.**

#### `terminal-path-drop.e2e.ts:22` — DECLINED: nothing to write to

The formatting is pure and covered (`core/tests/unit/terminal-drop-paths.test.ts` — quoting, joining,
the single and empty cases). The wiring is `terminal-panel.tsx:306`: `formatDroppedPaths(paths)`
followed by a Left-arrow escape, written into the live terminal, filtered on the panel id.

Reaching it means mounting `TerminalPanel`, which mounts xterm.js against a live terminal session.
The editor's equivalent was spiked this spec and worked; this one would have to fake `apiRef` — and a
test that faked the thing being written to would be asserting its own scaffolding. The E2E delivers
the paths through a synthetic `throng:tree-drop` CustomEvent but reads the result off a REAL
`cmd.exe`, and that second half is what keeps it here.

### What the last stretch changed about the record itself

Three findings from these migrations are worth carrying forward, because each is a way a gap hides:

- **A fixture that looks like it is exercising the rule.** `explorer-subtree-menu.test.ts` already
  used the multi-select shape — for `Hide`, which deliberately does NOT take the selection. So the
  shape was present and the targeting rule had no test at all, in either direction.
- **A test double that makes the mistake the test is about.** `preferences-app.test.ts`'s fake bridge
  parsed every write into `settings`, which is exactly the theme/settings crossing the migrated test
  existed to forbid. It had been wrong since the file was written, and no test had asked it.
- **An escape test with nothing outside the fence.** The theme-name traversal case pointed at
  `../off-tree` and asserted the fallback — but no file was there, so a build with the guard REMOVED
  fell back too, for the wrong reason.
