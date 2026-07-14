# Research: Theming, Preferences & Shell Polish (018)

**Date**: 2026-07-13 | **Phase**: 0 | **Input**: [spec.md](./spec.md)

This document records what the codebase **actually is**, established by direct survey, and the decisions
that follow. The specification was written against a careful reading of the code, and is broadly right —
but a survey of the source found a dozen places where it is wrong in ways that change the work. Those
corrections are recorded here with file:line evidence, because the plan is built on them rather than on
the spec's prose.

Where a correction changes what a requirement *means*, the requirement is amended in `spec.md` and the
amendment is noted below.

---

## Part 1 — Corrections to the specification

### C1. There are **15** bundled themes in the guards' eyes, not 14

`DEFAULT_THEMES` holds 14 (`packages/core/src/config/default-themes/index.ts:195-288`), but
`ALL_DEFAULT_THEMES = { throng, ...DEFAULT_THEMES }` (`index.ts:291-294`) is what the distinctness and
contrast guards iterate. `THRONG_THEME` (`packages/core/src/config/theme.ts:69`) is a real, shipped,
selectable theme — it is simply defined elsewhere.

**Consequence**: every "all 14 bundled themes" obligation (FR-003, FR-006, FR-012, FR-015, FR-031) is
really **15**. The token-completeness sweep (`default-themes.test.ts:38-48`) iterates `DEFAULT_THEMES`
and compares against `THRONG_THEME`'s keys, so it is *structurally* 14-vs-1 — but a new token must be
authored in `THRONG_THEME` **and** reachable in all 14, which `makeTheme()` does by derivation.

**Amendment**: spec wording corrected to "all bundled themes (the 14 in `DEFAULT_THEMES` plus the
built-in `throng` theme)".

### C2. FR-008's backward-compatibility **cannot** be implemented with a CSS `var(…, fallback)`

This is the single most dangerous correction, because the wrong approach *looks* like it works.

`toCssVariables()` (`theme.ts:244-249`) merges the incoming theme over `THRONG_THEME.colours` **before**
emitting the custom properties. So every `--throng-colour-*` variable is **always defined**, and a CSS
fallback (`var(--throng-colour-menuSurface, var(--surface))`) can never fire at runtime — it only applies
in the instant before `ThemeProvider` mounts.

There is a precedent that proves the trap: `theme.css:24` reads
`--btn-bg: var(--throng-colour-buttonBg, var(--bg-panel))`. That fallback is **dead code** and has been
since feature 007.

The practical failure this causes: a user theme that sets `surface: #ff0000` and (being older than the
split) has no `menuSurface` would render its menus in **throng's** default `#1b2230` — a visible change
to a theme the user already had. That is precisely what FR-008 forbids.

**Decision**: the fallback is authored in the **theme-resolution layer**, not in CSS. `toCssVariables()`
resolves each new token as `theme.colours.<new> ?? theme.colours.<parent> ?? THRONG_THEME.colours.<new>`,
where `<parent>` is the pre-split token the role was carved out of (`surface` or `surfaceActive`). A pure
function in `@throng/core` owns this chain so it is unit-testable without a DOM.

### C3. `surfaceActive` is load-bearing **outside** CSS

Splitting it is not a CSS-only change. It seeds derived values in every bundled theme:

- `default-themes/index.ts:172` — `buttonBg: p.surfaceActive ?? p.surface`
- `default-themes/index.ts:146,150` — `terminalSelection` / `editorSelection` fall back to it
- `theme-quality.ts:283` — the contrast pairing `buttonText` on `surfaceActive`

**Consequence**: the split perturbs derived palette values across all themes, which *by itself* moves the
distinctness constant. The re-derivation (FR-006) is therefore not optional bookkeeping — it is a
mechanical consequence of the change.

### C4. The distinctness constant fails on an **equality** assertion, not a threshold

`theme-quality.test.ts:70` asserts `expect(CLOSEST_LEGITIMATE_PAIR_DELTA).toBeCloseTo(delta, 2)`.

`CLOSEST_LEGITIMATE_PAIR_DELTA = 4.46892856529523` (`theme-quality.ts:221`) and
`DISTINCTNESS_THRESHOLD = 4.3` (`theme-quality.ts:232`).

The metric is the **mean** CIEDE2000 over shared colour tokens (`theme-quality.ts:185-195`). Adding
tokens changes the denominator, so the mean moves **even if every new token duplicates an existing
value**. The equality assertion breaks on a change that is entirely correct. Both constants must be
re-derived, and `DISTINCTNESS_THRESHOLD` must remain just below the new closest-legitimate delta.

### C5. The menus are **already themed**. The spec's FR-014 charge is wrong as written

Spec line 58 says the bespoke menus "take their background from hard-coded colour literals". They do not.

- `title-bar.css:109` — `background: var(--surface, #1a1f2b)`
- `preferences.css:454` — `background: var(--surface, #1a1f2b)`

`--surface` is aliased from the theme at `theme.css:20`, so those literals are **dead fallbacks**, and
there is already an E2E proving the cog menu re-themes (`titlebar-chrome.e2e.ts:89-110`, which seeds
`surface:#ff00aa` and asserts the computed background).

**The real defects** — and what FR-013/FR-014 must actually be held to:

1. The cog's **inline SVG gear** (`cog-menu.tsx:21-34`) — a genuine constitutional violation.
2. **No flip/clamp** on either bespoke menu (`title-bar.css:99-114` is pure CSS `position:absolute`;
   `keybindings-tab.tsx:254` is a raw `left/top`).
3. **No shared single-menu-open invariant** — each rolls its own click-away.
4. The **token overload** — menus read the same `surface` panes do. That is FR-001, not FR-014.
5. Unconditional `box-shadow: … rgba(0,0,0,0.4)` literals (`title-bar.css:112`, `preferences.css:457`).

**And the shared menu is not literal-free either** — `theme.css:993` hard-codes `color: #06101f` on
item hover, `theme.css:964` an rgba shadow, and `context-menu.tsx:116` a hard-coded `▸` chevron while
the theme *has* a `chevron` icon token. A plan that only touches the two bespoke menus leaves SC-002
unmet.

**Amendment**: FR-014 restated to charge what is actually wrong.

### C6. Two more inline vectors the spec misses

- `panes/chevron.tsx:7-24` — the pane collapse/expand chevrons, drawn as inline SVG **while the theme
  ships a `chevron` icon token** (`theme.ts:191`). A pre-existing FR-014/SC-002 violation.
- `title-bar/window-controls.tsx:14-42` — four window-control glyphs. Arguably OS chrome; called out and
  deliberately left alone (see Out of Scope).

### C7. The shared menu has **no keyboard navigation** and no separator

`context-menu.tsx` handles Escape only — no arrow keys, no roles on the `<ul>`, `<li>` items with bare
`onClick`. The cog menu today is a list of `<button role="menuitem">` and **is** keyboard-reachable.

**Porting the cog menu onto the shared menu as it stands would be an accessibility regression.** The spec
does not mention this. FR-013 therefore carries an obligation the spec never stated: the shared menu must
gain roving-focus keyboard navigation before the cog menu can be migrated onto it.

**Amendment**: added as FR-013a.

### C8. The colour control performs **no validation whatsoever** today

`pickers.tsx:52,59` — both the swatch and the hex field call `onCommit` on **every `onChange`**, with no
validation. Typing `zzz` into the hex box writes `"zzz"` straight into `colours.<token>` in the theme
file on disk.

**Consequence**: FR-026 ("an invalid colour entry MUST be rejected … matching the existing
numeric-rejection behaviour") is **net-new behaviour and a live bug fix**, not a preserved semantic. The
spec presents it as preservation. It is not.

### C9. FR-022's "apply immediately, persist debounced" describes one mechanism, not two

For a **theme token** there is exactly one write path: a 150 ms debounced write
(`themes-tab.tsx:192-210`) that then hot-reloads back through the config store
(`config-store.tsx:120-122`). The "immediate" part is an **optimistic in-memory ref**
(`themes-tab.tsx:187-190`), not an undebounced write.

The genuinely load-bearing guarantee — and the one that must survive the rewrite — is that the **target
theme name is captured at edit time** (`themes-tab.tsx:207-210`), so activating another theme inside the
debounce window cannot land theme A's document in theme B's file.

**Amendment**: FR-022 restated as "optimistic in-memory apply + debounced write + hot-reload".

### C10. **US8 is a renderer-only story.** No new IPC, no daemon method, no SQL

The spec says the hidden-paths list is "append-only" and recoverable "only by hand-editing the database".
That is true **as UX** and false at every layer beneath it:

- `projects.setHidden` is a **full replace**, not an append — `core/src/projects/project.ts:196`
  (`hiddenPaths: sanitiseHiddenPaths(hiddenPaths)`). The append semantics come entirely from the single
  call site's spread: `file-explorer-pane.tsx:54` (`[...activeProject.hiddenPaths, relPath]`).
- `hiddenPaths` is already on `ProjectDto` (`ipc-contract/src/projects.ts:29`), already populated by
  `toDto` for every `projects.*` method, and **already in the renderer's hand** as
  `activeProject.hiddenPaths`.

**Un-hide is therefore `setProjectHidden(id, current.filter(p => p !== target))`.** The story needs a
surface to render the list and one new icon token — nothing else. This is a substantial scope reduction
and it removes the story's only cross-process risk.

Also confirmed: FR-043's "without a restart" is **already satisfied by the existing reactivity**. Hidden
entries stay in `childrenMap` and are dropped only when deriving the tree
(`use-explorer-data.ts:201-214`), so removing a path re-derives the tree with no re-fetch and no watcher
event.

### C11. FR-047's combining rule has a trap that must be surfaced to the user

The two filters are applied at **different stages**:

- `explorer.excludeGlobs` — at **fetch** (`use-explorer-data.ts:142`). Excluded entries never enter
  `childrenMap` at all.
- `hiddenPaths` — at **derive** (`use-explorer-data.ts:209`). Exact string match on `relPath`.

**The trap**: a path that is both hidden *and* glob-matched will be listed in the new dialog, the user
will remove it, and **it still will not reappear** — because the glob filters it out one stage earlier.

**Decision**: the effective set is defined as *(entries on disk) − (glob matches) − (hidden paths)*, with
**globs taking precedence** and being unaffected by un-hiding. The dialog states that global exclusions
also apply (FR-047 already requires this) and — going beyond the spec — marks any listed path that is
*also* glob-excluded, so removing it does not look broken.

### C12. US9: the load path is **half**-shipped, and the symlink hole cuts both ways

The spec (FR-060, Decision 1) claims the load path applies no confinement rule and resolves no symlinks.
Half right:

- **Symlinks: correct.** No `realpath` anywhere on the load path (`editor-service.ts:63-90` calls only
  `size`/`readBytes`/`decode`).
- **Confinement: wrong.** `editor-coordinator.ts:115` *already* refuses a cross-project load for a
  **project-owned** editor (`isWithinTree`) — but on the **raw, unresolved** path, and it is skipped
  entirely when `ownerRoot` is null.
- **The sub-workspace half is genuinely absent.** `isOutsideAllProjects` is never called on load;
  `allProjectRoots` is carried into the doc and read only by `save()` (`editor-coordinator.ts:297`).

**And the symlink hole runs the other way too**: a link *inside* a project resolving *outside* it opens
fine today and fails only at save.

### C13. FR-061 has a hidden dependency: the silent no-op **already exists**

Today's load rejection returns `reason: 'io'` (`editor-coordinator.ts:115`), and the renderer's
`maybeWarn` (`use-editor.ts:100-112`) classifies any reason other than `binary`/`too-large` as a
*missing-file* — which is **suppressed when `editor.warnOnMissingFile` is false**.

So a rejected load can already be a silent no-op, which FR-061 prohibits. A **new reason code**
(`out-of-tree`) must be plumbed through `LoadResult` (`editor-service.ts:23-32`) and `global.d.ts:208-217`.
A new UI call site alone would not fix it.

### C14. FR-059's "panel-type form" open route **does not exist**

The Editor panel-type descriptor takes **no inputs** (`core/src/editor/panel-type.ts:23-35`,
`editor-inputs.tsx:10-20`) — the form can only create an *empty* document. There is no route by which the
panel-type form opens a named file, so there is nothing to apply the rule to.

**Amendment**: FR-059's "every open route … not only for drops" is restated to name the routes that
exist: the OS drop, the explorer's "open" action, and the mount-time restore load.

### C15. Nothing prevents Chromium navigating the window to a dropped file

There is **no** `preventDefault` on a window-level `dragover`/`drop` anywhere in the app, and no
`will-navigate` guard (`main.ts` has exactly one `preventDefault`, at `:581`, for window close).

Today, dropping a file on the window makes Chromium **navigate the renderer to that file** — blowing away
the application. This is a live defect that the drop work must close, and it is not in the spec.

### C16. Electron 43: `File.path` is gone; `webUtils.getPathForFile` is mandatory

`package.json:49` pins `electron: ^43.0.0`. `File.path` was removed in Electron 32. The preload
(`preload.cts:7`) must expose `webUtils.getPathForFile(file)`; there is no other way to get a real path
from a dropped `File`.

**This constrains the E2E strategy** (see Decision 6).

### C17. The notices: there are **nine** idioms, not five

Every idiom the spec names exists and is described accurately. It misses four more:

| # | Idiom | Where | Spec? |
|---|---|---|---|
| 1 | Inline confirm strip `.prefs-confirm` | `preferences-app.tsx:214-248` | ✅ named |
| 2 | Inline notice strip `.prefs-notice` | `reset-notice.tsx` + `preferences-app.tsx:250-261` | ✅ named |
| 3 | `ConfirmProvider` / `useConfirm()` — promise modal | `confirm-dialog.tsx:37-105` | ✅ named |
| 4 | `ConfirmDialog` — the rival prefs modal | `preferences/confirm-dialog.tsx:25-60` | ✅ named |
| 5 | Four copy-pasted error strips | projects, explorer, sub-workspaces, terminal-exit | ✅ named |
| 6 | **A fifth error strip** `.themes-notice--error` | `themes-tab.tsx:415-424` | ❌ **missed** |
| 7 | `RestoreNotice` — non-dismissable | `workspace/restore-notice.tsx:8-14` | ✅ named |
| 8 | **`EditorNoticeDialog`** — modal message box | `editor/editor-notice-dialog.tsx:8-51` | ❌ **missed** |
| 9 | **Three n-way decision modals** — `AppClosePrompt`, `DirtyCloseDialog`, `UnsavedOpenDialog` | `app-close-prompt.tsx`, `editor/dirty-close-dialog.tsx`, `editor/unsaved-open-dialog.tsx` | ❌ **missed** |

FR-044's "MUST NOT introduce a sixth notice idiom" is already moot — the sixth exists. And **SC-009
("exactly two notice models exist in the codebase") would be false on the day it shipped** if only the
five named surfaces were migrated. See Decision 3.

### C18. `--danger` is a **dead CSS variable** — a live theming bug

The theme emits only `--throng-colour-*` properties (`theme.ts:244-249`). `theme.css:9-30` aliases
`--bg`, `--bg-panel`, `--border`, `--text`, `--accent`, `--surface`, `--surface-active` … but
**never `--danger`**.

So every `var(--danger, X)` in the codebase silently renders the literal `X`:

- `preferences.css:164` — the inline notice strip's colour is *always* `#e5534b`
- `preferences.css:671-674` — the themes error strip's "failure must not read like a success" comment is
  a lie in practice: it renders `--accent` and `--text`
- `theme.css:1185-1194` — the confirm dialog's warning block

Two of the four main-window error strips are hard-coded outright (`theme.css:268-278`,
`theme.css:1481-1491` — `background:#3a1d22; color:#ff9aa6`), and so is the restore notice
(`theme.css:473-480`).

The notification model must be themed from `--throng-colour-danger` (which *is* emitted), and the dead
alias either defined or removed.

### C19. `step` is dead metadata — confirmed

Declared at `metadata.ts:44`, written by 8 descriptors, and **read nowhere**. `NumberControl` reads only
`min`/`max` (`form-controls.tsx:151-152,184-185`). Spec correct.

### C20. No slider, no `Intl`, no locale plumbing anywhere — confirmed greenfield

Repo-wide: zero `type="range"`, zero `Intl.`/`NumberFormat`/`toLocaleString`. `NumberControl.parse` uses
bare `Number(raw)`, which rejects `"10,485,760"` outright. A formatter/parser pair must be introduced
from scratch, and the parser must be the **inverse** of the formatter or FR-038 breaks.

---

## Part 2 — Decisions

### Decision 1 — The token split: keep `surface`, carve **five** new roles out of it

`surface` has **30 live consumers**; `surfaceActive` has **12**.

`surface` is **kept** as the pane/panel body role — it already carries the copy label "Panel surface",
and keeping it means the most common role needs no migration and no theme change. New tokens are carved
out for the roles that were stealing it, each falling back to its parent (per C2).

| New token | Role | Falls back to | Sites moved |
|---|---|---|---|
| *(kept)* `surface` | Pane and panel body | — | `panes.css:17`, `theme.css:639` |
| `menuSurface` | Menus, drop-downs, context menus, typeahead lists | `surface` | `theme.css:961`, `title-bar.css:109`, `preferences.css:454`, `preferences.css:787` |
| `inputSurface` | Text inputs, selects, search boxes, hex fields | `surface` | `theme.css:310,324,1585`, `preferences.css:220`, `panel-type.css:38` |
| `hoverSurface` | Row hover, icon-button hover, chrome hover | `surface` | `explorer.css:114`, `theme.css:391,815`, `preferences.css:478`, `title-bar.css:89,152` |
| `dialogSurface` | Modal cards, dialog bodies, the find bar | `surface` | `theme.css:1020,1046`, `preferences.css:512`, `find-bar.css:14` |
| `menuItemHoverSurface` | The hovered row *inside* a menu | `surfaceActive` | `title-bar.css:128`, `preferences.css:474,806` |
| *(kept)* `surfaceActive` | Selected/active row, active panel header | — | `explorer.css:119`, `theme.css:1309`, `theme.css:513` |

Buttons keep the **existing** `buttonBg`/`buttonHoverBg` tokens rather than gaining new ones — the three
button sites currently reading `surface` are re-pointed at the token that already exists for them
(YAGNI: no new token where one is already shipped).

The drag-ghost window (`ghost-window.ts:57-63`, fed from `main.ts:349-360`) is a **separate
BrowserWindow** and must be updated in the same pass or it will drift from the theme.

### Decision 2 — Scrollbars: **three** holes to fill, not two

The terminal's scrollbar is the only one styled (`terminal.css:28-43`), and its **track is a literal
`transparent`** — the spec says it "borrows two unrelated tokens"; it borrows two (`border` for the
thumb, `textMuted` for the hover) and hard-codes the third.

Three new tokens: `scrollbarTrack`, `scrollbarThumb`, `scrollbarThumbHover`.

Applied **globally** (`* { scrollbar-color }` plus the `::-webkit-scrollbar` rules) rather than
per-surface, per FR-010. The terminal's rule keeps its explicit `width: 12px` and non-overlay geometry —
this story **recolours** it and must not touch its layout (FR-011), because xterm's fit calculation
depends on the bar taking real width.

### Decision 3 — The notice sweep covers **all nine** idioms, and the confirmation model becomes n-way

The spec's SC-009 demands "exactly two notice models exist in the codebase". Migrating only the five
idioms the spec names would leave four behind and make SC-009 false on the day it shipped. The three
n-way decision modals are confirmations by every behavioural test — they are modal, blocking, and their
text-labelled buttons state the consequence being consented to. They differ only in **arity**.

**Resolved**:

- **One confirmation model** — `ConfirmProvider` (the survivor, already used by 13 E2E suites) gains an
  optional **`choices` array** and an optional **details slot**, so it serves binary *and* n-way
  decisions. `AppClosePrompt` (3-way + terminal table), `DirtyCloseDialog` (3-way), `UnsavedOpenDialog`
  (4-way), the prefs inline confirm strip and the rival prefs `ConfirmDialog` all become **calls** into
  it. It is mounted in **all three** windows.
- **One notification model** — a new transient, themed, dismissable notification host, mounted in all
  three windows. It carries a **severity** (`error` sticky, `success`/`info` auto-dismissing), because an
  error that auto-vanishes is a worse defect than the one being fixed. That is still one model with one
  property — not two models.
- Migrated onto it: the prefs notice strip, all **five** error strips, the restore notice, and
  `EditorNoticeDialog`.

**Test identifiers are preserved, not renamed** (FR-053). `confirm-accept` alone is asserted by 13 E2E
specs; `confirm-dialog` by 8. Every migrated call site passes its existing test ids through explicitly.

**Amendment**: FR-048 and FR-051 restated to enumerate the nine surfaces.

### Decision 4 — Numeric controls: slider **and** field, step derived, grouping is view-only

- `ControlKind` gains **`slider`** (FR-032). Feature 007's "exhaustive" declaration is **not** touched —
  that reconciliation is #79 and explicitly out of scope.
- A numeric descriptor with **both** `min` and `max` renders slider + field. One without renders
  field-only. `editor.maxOpenFileBytes` (min 1024, **no max**) is given a declared maximum of
  **2 GiB** — the largest file a 32-bit-safe `Buffer` read can address, so it is a *real* ceiling rather
  than an invented one, and it cannot clamp a value any user already has.
- **Theme font weights** get `min: 100, max: 900, step: 100` — the CSS `font-weight` range. Today they
  have no bounds at all.
- `step` becomes **load-bearing** (FR-035): the slider reads it from the descriptor. It is already
  declared on every bounded numeric.
- **Digit grouping is view-only** (FR-038). A formatter/parser pair in `@throng/core`, where the parser
  is the exact inverse of the formatter for the active locale. The **stored** value is always a plain
  number. The grouping character is stripped on parse, so a locale using `.` as a group separator cannot
  corrupt a value.
- **The stale-value defect must not return** (FR-036). `NumberControl` commits from the **live DOM
  input** (`form-controls.tsx:156-173`) precisely because a fast fill-then-blur dropped the edit — a real
  CI flake fixed in `78d2331`. The slider streams `onChange` continuously; the two are reconciled by
  making the slider commit on `onChange` (it is always valid — it is bounded by construction) while the
  field keeps its blur/Enter commit, both writing through **one** `onCommit`.

### Decision 5 — The colour picker: a new themed control, and validation is **new behaviour**

Per C8, there is no validation today. The new picker:

- Saturation/value area, hue slider, hex field — all themed (FR-021).
- Keeps the **target-theme-captured-at-edit-time** guarantee (C9/FR-023) — this is the one correctness
  property that genuinely exists today and must survive.
- **Rejects** an invalid hex, leaving the last valid colour applied and showing the error on the row,
  matching `NumberControl`'s `ctl__error` pattern (`form-controls.tsx:201-206`). This is new.
- Fully keyboard-operable with a visible focus ring (FR-024).
- Holds **local edit state** rather than binding the hex field directly to the round-tripped theme value,
  so typing is not gated on a 150 ms write + IPC round-trip (today it is — `pickers.tsx:58`).

### Decision 6 — The OS-drop E2E strategy: a path-taking seam

A `File` synthesised in the renderer is **not** an OS file: `webUtils.getPathForFile()` returns `''` for
it. A purely synthetic `drop` event therefore **cannot** exercise the real path extraction, and any E2E
that claims to is lying.

**Resolved**: the drop handler is structured so that `File → absPath` is a **one-line adapter**
(`window.throng.getPathForFile`) and everything downstream is a **pure, path-taking function**. That
seam is exactly the shape the app already uses for `throng:open-file` (`editor-open.tsx:24`).

- **E2E** drives the path-taking seam directly and asserts the whole open / reject / focus behaviour
  through the running app — including the rejection affordance and the sub-workspace case.
- **E2E also covers the `dragover`/`drop` wiring and the navigation guard**, by dispatching a synthetic
  drop event in the page and asserting the renderer does not navigate away. (There is **no jsdom or
  component-test stack** in this repository, so there is no DOM-level unit layer to put this in — the
  renderer is verified through the running application or not at all.)
- The one-line `getPathForFile` adapter is the only thing not covered end-to-end, and that is stated
  plainly rather than papered over.

This is honest about what can be verified, and it is the reason the seam exists at all.

### Decision 7 — Close the Chromium navigation hole (C15)

An app-level `dragover`/`drop` `preventDefault` guard is added in the same change. Without it, a file
dropped anywhere *other* than a panel navigates the renderer away from the application. This is a live
defect today; it becomes far more likely to be hit the moment the app invites the user to drag files onto
it.

### Decision 8 — Menus: fix the shared menu **first**, then migrate onto it

Per C5/C7, the shared menu is not ready to receive the cog menu: it has no keyboard navigation, and it
hard-codes a hover colour and its submenu chevron.

Order: (1) bring the shared menu up to standard — keyboard navigation, `menuSurface`/`menuItemHoverSurface`
tokens, the `chevron` icon token instead of `▸`; (2) migrate the cog menu onto it, adding the new
`settings` icon token for the gear; (3) migrate the Key Bindings menu, which gains its first E2E coverage
(FR-019); (4) mount the provider in the preferences window (one line — everything it needs is already
there).

`panes/chevron.tsx` (C6) is folded into step 1, because it is the same defect in the same pass.

---

## Part 3 — Sequencing and risk

The stories are ordered by the spec's own priorities, and the dependencies are real:

1. **US1 (token split)** — foundational. Everything that adds or re-points a themed surface depends on it.
   Re-derive the distinctness constant here.
2. **US6 (notices)** — moved **early**, ahead of the spec's P2 ordering. US8's dialog and US9's rejection
   affordance both consume the notification model (the spec says as much at line 431), and the confirmation
   provider must be mounted in the preferences window before the themes surface can drop its rival dialog.
3. **US2 (menus)** — needs `menuSurface` (US1) and the `settings` icon token.
4. **US3 (scrollbars)** — needs the scrollbar tokens (US1).
5. **US4 (colour picker)** — needs themed primitives (US1); US5 needs it.
6. **US5 (icon colour)** — needs US4's picker.
7. **US7 (numeric controls)** — independent; can land any time after US1.
8. **US8 (project settings dialog)** — needs the `settings` icon token (US2) and the notice models (US6).
   Renderer-only per C10.
9. **US9 (OS drop)** — last, and largest. Needs the notification model (US6).

**The two riskiest things in this feature**, and how they are handled:

- **The distinctness constant** (C3/C4). It will break, on a correct change, in a way that looks like a
  regression. It is a *task*, not a surprise.
- **The confinement behaviour change** (C12/FR-060). This makes previously-openable files un-openable in
  a sub-workspace editor. It is deliberate, it closes a real trap, and it needs its own E2E asserting the
  *new* refusal — not just that the old behaviour is gone.
