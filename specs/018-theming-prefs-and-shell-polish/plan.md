# Implementation Plan: Theming, Preferences & Shell Polish

**Branch**: `018-theming-prefs-and-shell-polish` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/018-theming-prefs-and-shell-polish/spec.md`, plus the
Phase 0 survey in [research.md](./research.md), which corrects it in twenty places.

## Summary

A consistency sweep, in the spirit of feature 017: it closes a class of defects rather than adding a
capability. Nine tracked issues, three strands — **theming** (split one overloaded colour token into
per-role tokens; bring scrollbars, menus, the colour picker and icon artwork inside the theming system),
**preferences** (sliders and readable numbers; make hidden files un-hideable), and **shell** (collapse
nine notice idioms into two models; accept a file dragged in from the operating system).

The technical approach is dictated by three findings from the Phase 0 survey, each of which would have
sunk a naive implementation:

1. **The backward-compatibility fallback must live in the theme-resolution layer, not in CSS.** The
   colour-variable emitter merges every theme over the built-in defaults *before* emitting, so a CSS
   `var(…, fallback)` can never fire — a pre-split theme's custom `surface` would be silently replaced by
   throng's default on every new token. There is already a dead precedent of exactly this mistake in the
   codebase (`theme.css:24`).
2. **The notice sweep is nearly twice the size the spec thought.** Nine idioms, not five. The
   confirmation model must become n-way to absorb the three decision modals the spec missed.
3. **The hidden-paths story is renderer-only.** `setHidden` is already a full replace and the list is
   already in the renderer's hand — so the story is a surface, not a stack.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node ≥ 20, ES modules

**Primary Dependencies**: Electron 43, React 18, CodeMirror 6, xterm.js, better-sqlite3, inversify
(DI), picomatch

**Storage**: SQLite (projects, workspace, terminals) via `@throng/persistence`; user-scoped JSON
configuration files (`settings.json`, `keybindings.json`, `themes/*.json`) under the per-user throng
profile directory

**Testing**: Vitest (unit / integration / contract projects) + Playwright-Electron (E2E). Test-first,
per constitution Principle V. Suites are run once, unfiltered, with complete output captured.

**Target Platform**: Windows 11 desktop (Electron); OS-specific behaviour behind Principle II
abstractions

**Project Type**: Desktop application — npm workspaces monorepo, six packages, two process boundaries
(UI main + detached daemon), one renderer bundle routed by query string across three window kinds

**Performance Goals**: No regression to the existing bars — two-pane shell within 5 s (NFR-002);
theme switching repaints without a stale surface; the colour picker applies live during a drag

**Constraints**: Lint and type-check must report **zero** errors (constitution). The terminal's
scrollbar must keep its classic non-overlay geometry — xterm's fit calculation depends on the bar taking
real layout width. Existing E2E test identifiers must be preserved, not renamed: `confirm-accept` alone
is asserted by 13 suites.

**Scale/Scope**: 9 user stories, 82 functional requirements, 15 bundled themes, ~30 call sites of the
overloaded token, 9 notice idioms to collapse, 15 new theme tokens (10 colour + 5 icon), 3 window kinds
to keep in step.

## Constitution Check

*GATE: evaluated against all eleven principles before Phase 0, and re-evaluated after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Reinforced.** The project-settings dialog puts project-scoped data (hidden paths) beside the project's own identity rather than in the user-scoped Preferences window. US9's confinement rule enforces "every file belongs to exactly one project" on the *read* side, where it was previously only enforced on write. |
| **II. Platform-Abstracted Core** | **Upheld, with one new seam.** Extracting a filesystem path from a dropped file is OS-specific (`webUtils.getPathForFile`) and sits behind the preload bridge; everything downstream is a pure, path-taking function in `@throng/core`. The confinement rule is already pure core logic and is reused unchanged. |
| **III. Detached Terminals** | **Untouched**, with one guard: the terminal's scrollbar is **recoloured only**. Its non-overlay geometry is load-bearing for xterm's fit calculation and must not change. The terminal's native context menu stays native (explicitly out of scope). |
| **IV. Native Terminal Support** | Untouched. |
| **V. Test-First Quality Discipline** | **The spine of this plan.** Every story is Red-Green-Refactor. Every user-facing change ships E2E coverage — including the Key Bindings menu, which has **none** today (FR-019). One honest limitation is stated up front and in the spec (FR-066a): a synthetic drop event cannot exercise the real path extraction, because a renderer-fabricated file is not an OS file. The seam exists so that everything *downstream* of that one line is verified through the running app. |
| **VI. Simple, Modern, Discoverable UX** | **The point of the feature.** Nine ways of saying two things becomes two. Five surfaces that ignore the theme start obeying it. |
| **VII. Change Review & Approval** | Untouched. |
| **VIII. SOLID, DRY & YAGNI** | **The point of the feature.** DRY: one menu, one confirmation, one notification, one numeric control, one picker. YAGNI: buttons re-point at the `buttonBg`/`buttonHoverBg` tokens that **already exist** rather than gaining new ones; the hidden-paths story adds **no** IPC operation because the existing one already does the job. |
| **IX. Dependency Injection & Composition Root** | Upheld. New renderer providers (notification host, confirmation provider) mount in the existing composition roots. No new container, no service locator. |
| **X. Externalised Configuration** | **The point of the feature.** Every new surface colour, the scrollbar, the icon colour and the settings glyph become theme tokens. The dead `--danger` alias — a variable referenced **13 times across 3 files** and defined nowhere — is repaired, and a guard discovers the next one. |
| **XI. Dockable Workspace** | Upheld. The drop target is the panel; drop handling must coexist with the two existing drag systems and must work in sub-workspace windows, which have no explorer. |

**Gate result: PASS.** No violation requires justification. Three constitutional *repairs* are folded in
(the inline cog gear, the inline pane chevrons, and the un-themeable colour dialog), and two
pre-existing violations found in Phase 0 are fixed in the same pass rather than left behind (the dead
`--danger` variable; the browser-engine file-drop navigation hole).

**Post-design re-check (after Phase 1): PASS.** The design adds no new process boundary, no new
container, and no configurable key without an editor descriptor. The one new IPC surface (drop-path
resolution) exists precisely so the confinement decision is made in the **main** process rather than
trusted from the renderer — which strengthens Principle II rather than bending it.

## Project Structure

### Documentation (this feature)

```text
specs/018-theming-prefs-and-shell-polish/
├── plan.md              # This file
├── spec.md              # Amended in Phase 0 (20 corrections)
├── research.md          # Phase 0 — the survey, its corrections, and 8 decisions
├── data-model.md        # Phase 1 — tokens, descriptors, notice models, drop contract
├── quickstart.md        # Phase 1 — how to validate the feature by hand
├── contracts/
│   ├── theme-tokens.md      # The new tokens, their fallbacks, and the guards
│   ├── notice-models.md     # The two models, and the nine surfaces they replace
│   └── drop-contract.md     # The drop seam, its reasons, and the confinement rule
└── checklists/
    └── requirements.md  # Spec-quality checklist (16/16, passed)
```

### Source Code (repository root)

```text
packages/
├── core/                      # Platform-agnostic. No OS calls, no React.
│   └── src/config/
│       ├── theme.ts                    # +10 colour tokens, +5 icon tokens (see contracts/theme-tokens.md
│       │                               #   for the authoritative roster) AND the split-fallback chain (FR-008)
│       ├── theme-copy.ts               # Hand-written copy for every new token
│       ├── theme-quality.ts            # Re-derive CLOSEST_LEGITIMATE_PAIR_DELTA + threshold
│       ├── theme-metadata.ts           # Font weights gain declared bounds + the slider control (T087)
│       ├── settings-metadata.ts        # Sliders declared where they belong; step becomes load-bearing
│       ├── metadata.ts                 # ControlKind gains 'slider' (explicit opt-in, not inferred)
│       ├── number-format.ts    (NEW)   # Digit grouping: format + its exact inverse parse
│       ├── colour.ts           (NEW)   # Pure hex validator — the picker has NO validation today
│       └── default-themes/index.ts     # makeTheme derives every new token from its parent
│   └── src/editor/confinement.ts       # Reused unchanged — now applied on load, not only save
│
├── ui/
│   └── src/
│       ├── main/
│       │   ├── editor-coordinator.ts   # load: realpath + FULL confinement + 'out-of-tree' reason
│       │   ├── editor-service.ts       # LoadResult gains the new reason
│       │   ├── editor-ipc.ts           # + drop-path resolution channel
│       │   ├── main.ts                 # + window-level drop-navigation guard (FR-061a)
│       │   └── ghost-window.ts         # Drag-ghost must follow the token split
│       ├── preload/preload.cts         # + webUtils.getPathForFile (Electron 43: File.path is gone)
│       └── renderer/
│           ├── common/
│           │   ├── notification.tsx    (NEW)  # THE notification model (severity, dismiss, host)
│           │   └── colour-picker.tsx   (NEW)  # THE colour picker (SV area, hue, hex, keyboard)
│           ├── confirm-dialog.tsx      # THE confirmation model — gains n-way choices + details
│           ├── workspace/context-menu.tsx      # THE menu — gains keyboard nav, sheds literals
│           ├── panes/chevron.tsx       # Inline SVG → the theme's chevron token
│           ├── panes/file-explorer-pane.tsx    # + the project-settings options icon
│           ├── title-bar/cog-menu.tsx  # Rebuilt on the shared menu; gear from the settings token
│           ├── title-bar/window-controls.tsx   # 4 inline vectors → new icon tokens (SC-002)
│           ├── sidebar/projects-panel.tsx      # Hard-coded ＋ glyph → the `add` token
│           ├── explorer/file-tree.tsx  # Gate the window-level dragover on an OS file drag
│           ├── terminal/terminal-panel.tsx     # `?? '#0c0f16'` fallbacks are LIVE, not dead
│           ├── panel-type/             # The untyped panel becomes a drop target
│           ├── preferences/
│           │   ├── keybindings-tab.tsx # Bespoke menu → the shared menu (+ its first E2E)
│           │   ├── form-controls.tsx   # NumberControl gains a slider + digit grouping
│           │   ├── pickers.tsx         # Native <input type=color> → the new picker
│           │   ├── icon-section.tsx    # + the icon-colour control
│           │   ├── preferences-app.tsx # Inline confirm strip → the confirmation model
│           │   └── confirm-dialog.tsx  # DELETED — the rival modal
│           ├── project-settings/       (NEW)  # The project-settings dialog (renderer-only)
│           ├── editor/
│           │   ├── drop-target.tsx     (NEW)  # The drop seam: File → path → pure handler
│           │   ├── dirty-close-dialog.tsx     # → the confirmation model
│           │   ├── unsaved-open-dialog.tsx    # → the confirmation model
│           │   └── editor-notice-dialog.tsx   # → the notification model
│           ├── app-close-prompt.tsx    # → the confirmation model (n-way + details)
│           └── workspace/restore-notice.tsx   # → the notification model
```

**Structure Decision**: The existing monorepo layout is kept exactly. Pure logic (tokens, fallback
resolution, number formatting, confinement) lives in `@throng/core` so it is unit-testable without a DOM
or an Electron process; the OS-specific path extraction sits behind the preload bridge; React surfaces
live in `@throng/ui`'s renderer. Two new renderer directories (`project-settings/`, and the drop target
under `editor/`) follow the existing one-directory-per-surface convention.

## Delivery sequence

The spec's story priorities are respected, with **one deliberate reordering**: US6 (the notice models)
moves ahead of US2–US5, because US8's dialog and US9's rejection affordance both consume the
notification model, and the confirmation provider must be mounted in the preferences window before the
themes surface can drop its rival dialog. The spec anticipates this in its Assumptions — *"the rejection
affordance is … reinforced by the notification model from Story 6, which is precisely why Story 6
precedes Story 9"*.

| # | Story | Depends on | Why this order |
|---|---|---|---|
| 1 | **US1** Token split | — | Foundational. Every later story adds or re-points a themed surface. Re-derive the distinctness constant **here**. |
| 2 | **US6** Two notice models | US1 | Consumed by US8 and US9. Unblocks the preferences window's confirmation. |
| 3 | **US2** One menu | US1 (`menuSurface`, `settings` + window-control icons) | Independent of US8; both consume tokens US1 ships. |
| 4 | **US3** Scrollbars | US1 (scrollbar tokens) | Self-contained. |
| 5 | **US4** Colour picker | US1 | US5 needs its control. |
| 6 | **US5** Icon colour | US4 | Needs the picker. |
| 7 | **US7** Numeric controls | US1 | Independent of US2–US6. |
| 8 | **US8** Project settings | US1 (icon token), US6 | Renderer-only (research C10). **Not** US2 — every token lands in US1, so US8 and US2 are parallel tracks. |
| 9 | **US9** OS file drop | US6 | Largest and riskiest; goes last so a slip does not hold up the other eight. |

## Complexity Tracking

> No constitutional violation requires justification. This section records the **three** places where the
> delivered scope is **larger** than the specification asked for. Each was found by the survey or the
> analyze loop, and each is the difference between the feature being true and merely looking true.

| Expansion | Why it is necessary | Simpler alternative rejected because |
|---|---|---|
| **The notice sweep covers 9 idioms, not 5** — including three n-way decision modals the spec missed, which requires the confirmation model to accept an ordered set of choices. | SC-009 states "exactly two notice models exist in the codebase". Building only the five named surfaces leaves four behind, and the success criterion would be **false on the day it shipped**. | *Migrate only the five named idioms* — rejected: it satisfies the letter of FR-051 and fails its stated purpose, leaving the next feature to pick one of five idioms exactly as before. |
| **Two pre-existing defects are fixed in the same pass**: the dead `--danger` CSS variable (**13** references across 3 files, defined nowhere), and the browser engine's file-drop navigation hole (a dropped file navigates the renderer away from the app). | Both sit **inside** the surfaces this feature rewrites. The notification model cannot be "themed from theme tokens" (FR-050) while its danger colour is a dead variable; and inviting the user to drag files onto the app while a stray drop destroys the workspace would ship a defect this feature created the conditions for. | *File them as separate issues* — rejected: the notice work would have to be done twice, and the drop hole is a direct hazard of the feature being built. |
| **Four window-control glyphs and a `＋` glyph brought into scope** after the analyze pass (FR-014b). | **SC-002 claims *zero* icons draw from an inline vector.** Deferring these would have made a success criterion false at merge — the identical failure this table's first row exists to prevent. Icon tokens do not touch the colour-distinctness metric, so the cost is small. | *Narrow SC-002 to exclude OS window chrome* — rejected: defensible, but it weakens a criterion to fit the work rather than doing the work. The guards (T002a scouts it; T058c/T058d enforce it) are what keep it true afterwards. |

## Known deferrals (tracked, per the Incremental Delivery rule)

- **Feature 007's "exhaustive" control-vocabulary declaration** — this feature adds a `slider` to that
  vocabulary but does not rewrite 007's sentence calling it exhaustive. Tracked by
  [#79](https://github.com/Bidthedog/throng/issues/79); more than one in-flight feature extends the same
  sentence and its correct final wording depends on the order they land in.
- **The end-to-end flake tail** — [#75](https://github.com/Bidthedog/throng/issues/75), on its own
  branch. The baseline for this feature was green apart from one cold-start flake of that class.
- **The terminal's native context menu** stays native — a deliberate platform choice (Copy/Paste), not a
  theming defect.
- **The app-wide keyboard-accessibility pass** ([#26](https://github.com/Bidthedog/throng/issues/26))
  and **theme accessibility conformance** ([#61](https://github.com/Bidthedog/throng/issues/61)). This
  feature makes the *new* colour picker and the *shared* menu keyboard-operable, because shipping a new
  control without that would be a new violation. It does not attempt the app-wide sweep.
> **Removed from this list during the analyze pass**: the window-control glyphs were originally deferred
> here on the reading that OS window chrome is not an "action control". That reading is defensible — but
> it collides head-on with this feature's own **SC-002**, which claims that *zero* icons in the
> application draw from an inline vector. Deferring them would have made a success criterion false on the
> day it shipped, which is exactly the failure this feature's Complexity Tracking calls out for FR-051.
> They are now **in scope** (FR-014b), along with the Projects pane's hard-coded "new project" glyph.
> Icon tokens do not participate in the colour-distinctness metric, so the cost is small and the
> criterion becomes true.
