# Implementation Plan: Main Window Affordances

**Branch**: `011-main-window-affordances` | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-main-window-affordances/spec.md`

**Depends on**: `009-theme-content` (supplies the `dismiss` theme icon token). 011 merges after 009. Only the dismiss-control rendering (US1/FR-006) needs it; the other four defects and the new setting are independent.

## Summary

Five independent, user-visible main-window defects plus one small setting, all confined to the
**renderer + UI-main folder-picker handler + `@throng/core` config layer**. **No daemon, no SQLite,
no `ipc-contract` change.** The defects:

1. **Dismissable error surfaces (US1).** Make all four panel error surfaces (Projects, File
   Explorer, terminal panel-type exit notice, sub-workspaces — the last already correct and the
   reference) carry a trailing-edge themeable **dismiss icon** that removes the error **immediately**.
   Decouple the terminal form's **Clear** (fields only) from **error dismissal** (notice only): today
   `panel-type-form.tsx` calls `clearPanelExit(panelId)` in *both* the Clear handler and Confirm,
   and the exit notice only clears on a form action — this is the "persists until re-typed" bug and
   the "Clear also clears the error" bug. Introduce a per-panel **dismissed-exit** flag so the notice
   can be cleared without touching the draft, and Clear resets only the draft.
2. **File-changed warning names the file (US4).** The `onSync` `externalChange` branch in
   `use-editor.ts` currently shows a generic notice; populate the existing `EditorNotice.files`
   list (dir/name/note) with the affected document's **full path** (split into dir+name) and a
   **note naming the panel and its containing tab**, the tab resolved **locally from the workspace
   layout** at the call site (no IPC-message change).
3. **Pulsing unsaved dot (US5).** The shared `.throng-unsaved-dot` (one CSS rule in `theme.css`,
   used by projects/tab/panel) gains a continuous **~1.5 s opacity pulse** (full to partial, never
   zero) via a single keyframe animation on the shared class, so all three locations are inherently
   in step; a `@media (prefers-reduced-motion: reduce)` block pins it static at full opacity.
4. **Consistent removal terminology (US2).** Apply the four-verb glossary (Close / Destroy / Remove
   / Delete) per target+location across control tooltips, context-menu entries, and confirmation
   dialogs in `projects-panel.tsx`, `subworkspaces-panel.tsx`, `tab-group.tsx`,
   `panel-placeholder.tsx`. The headline change: a project is **Removed** (not "Destroyed"), and its
   confirmation states plainly that **no files on disk are deleted**. Re-align the two
   settings-editor confirmation **labels** (keys unchanged) in `settings-metadata.ts`.
5. **Smarter folder picker + starting-folder setting (US3).** Add a `startingFolder`
   (`profile` | `lastViewed` | `override`, default `lastViewed`) + `overridePath` setting to
   `app-settings.ts`, plus an **internal** `lastProjectFolder` leaf (added to
   `SETTINGS_INTERNAL_KEYS`). The UI-main `throng:pickFolder` handler accepts a `defaultPath`; the
   renderer resolves the starting folder (falling back to the OS profile folder when unresolvable)
   and persists the chosen folder. Build **one shared folder-picker component** (editable path field
   + themeable browse icon) reused by project-creation and by the settings override, driven by a new
   `folder` **ControlKind** in `metadata.ts`; the settings editor flags an unresolvable override.

**Governance backbone.** Two constitution v3.12.0 rules bind here and are the enforcement points:
**Configuration-editor completeness** (the new settings leaves get descriptors, `lastProjectFolder`
is declared internal, and `settings-metadata.test.ts` stays green) and **Themeable icon controls**
(every dismiss / browse control is a themeable icon with a hover title, colours from theme tokens —
no text label, no inline SVG). The dialog decision-button exception keeps confirmation buttons
text-labelled.

**Build order (dismiss token last).** Everything except the dismiss-control *rendering* is
independent of 009. The tasks are ordered so the **009-blocked work (rendering the `dismiss` icon in
the three newly-dismissable surfaces, and the E2E asserting its glyph) comes last**; all logic
(state decoupling, immediate removal, recurrence), the other four defects, and the new setting land
first. At the first task that must render the `dismiss` token, work STOPS for a rebase onto a
`master` containing 009.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS (ESM); React 18 (renderer).

**Primary Dependencies**: Electron (UI-main owns the `throng:pickFolder` OS dialog); React 18 +
Vite; `@dnd-kit` (existing, untouched here); `@throng/core` pure config layer (`app-settings.ts`,
`metadata.ts`, `settings-metadata.ts`, `theme.ts` — the last **read-only** here, owned by 009).
CodeMirror/node-pty/xterm.js/better-sqlite3 and the daemon are **untouched**.

**Storage**: File-based user config only (`%USERPROFILE%\.throng\settings.json` via the existing
`FileConfigStore` + config watcher). **No SQLite change** (`user_version` unchanged). New settings
leaves: `newProject.startingFolder`, `newProject.overridePath`, and the internal
`newProject.lastProjectFolder`. Applied through the existing atomic `config.write` -> watcher
rebroadcast path (immediate-apply); no new persistence mechanism.

**Testing**: Vitest **unit** (core: starting-folder resolution helper — profile/lastViewed/override
+ unresolvable fallback; settings parse/merge of the new section incl. tolerant defaults; the
`folder` ControlKind in the metadata completeness audit; the removal-verb chooser if extracted as a
pure helper). Vitest **unit (ui, jsdom)** extends `panel-type-form.test.ts` for Clear-vs-dismiss
independence. Vitest **integration** extends `editor-external-change.integration.test.ts` for the
file-named notice, and `config-write`/settings round-trips for the new leaves. **Playwright-Electron
E2E** (mandatory, Principle V) for every user-visible behaviour: the four dismiss surfaces (with
immediate-removal timing), Clear-vs-dismiss both directions, the file-changed naming, the pulsing +
reduced-motion dot, each removal-verb matrix row, the project "no files deleted" confirmation, and
the folder-picker starting-location + override-flag behaviours.

**Target Platform**: Windows 11 first (OS-agnostic core per Principle II; the profile-folder
fallback uses an injected/abstracted home-dir source, not a hardcoded path).

**Project Type**: Electron desktop app — monorepo (`packages/core`, `packages/ui`).

**Performance Goals**: UI-only; no throughput target. The dot animation is a single CSS keyframe
(GPU-composited opacity), negligible cost.

**Constraints**: Keep the `use-editor.ts` and `panel-placeholder.tsx` diffs tightly scoped and
well-tested — `012-focus-contexts-and-zoom` rebases on both after this feature merges.

**Scale/Scope**: ~10 renderer files, 1 UI-main handler, 3 core config files (+ 1 shared component,
+ CSS), plus tests. Bounded bug-fix + one setting.

## Constitution Check

*GATE: v3.12.0. Must pass before Phase 0. Re-checked after design (below).*

- **I Project-First Isolation** — unaffected; removal-verb cascade semantics (project vs
  sub-workspace ownership) are preserved exactly, only the wording changes. **PASS**
- **II Platform-Abstracted Core** — the profile-folder fallback and starting-folder resolution use
  the existing home-dir/OS abstraction (no hardcoded `C:\Users\...`); the OS folder dialog stays in
  UI-main behind the `throng:pickFolder` seam. **PASS**
- **III Terminals** — removal wording must not change behaviour: Destroy still terminates the
  session, Close still leaves a project-owned panel's terminal running. Verified by the removal-matrix
  E2E. **PASS**
- **V Test-First + every UI change ships E2E** — all five defects are user-facing, so E2E is
  mandatory, written Red-first. **PASS (enforced by task ordering)**
- **VIII SOLID/DRY/YAGNI** — one shared folder-picker component (DRY, two call sites); one shared
  dot animation (DRY, three sites); a single dismissed-exit flag rather than duplicating clear
  logic. **PASS**
- **IX DI / composition root** — no new cross-boundary wiring; the `throng:pickFolder` handler stays
  in the UI-main composition root. **PASS**
- **X Externalised Configuration** — the new starting-folder behaviour is a setting, not a hardcoded
  path; dot timing/opacity are theme/CSS, not magic values buried in logic. **PASS**
- **Governance — Configuration-editor completeness** — new user-facing leaves get descriptors; the
  internal `lastProjectFolder` is added to `SETTINGS_INTERNAL_KEYS`; the new `folder` ControlKind is
  covered; `settings-metadata.test.ts` stays green. **PASS**
- **Governance — Themeable icon controls** — dismiss and browse controls are themeable icons
  (hover title, theme-token colours), resolving `dismiss` (from 009) and a browse token via the
  normal icon-token path; confirmation decision buttons keep text labels (stated exception). **PASS**
  (dismiss glyph rendering deferred until the 009 rebase — a *sequencing* deferral, not a weakening;
  tracked below.)
- **Governance — Documentation currency** — README/CONTRIBUTING/ROADMAP reconciled at converge if
  user-facing behaviour or the settings set changed (the new setting + verb wording qualify). Tracked
  as a converge task. **PASS**

No unjustified violations. The only deferral is *delivery sequencing* of the dismiss glyph behind
009 (Incremental Delivery rule) — recorded in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/011-main-window-affordances/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (folder-picker IPC + settings shape)
├── checklists/
│   └── requirements.md   # Spec-quality checklist (already written)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (files this feature owns — exclusive write)

```text
packages/core/src/config/
├── app-settings.ts            # + newProject section (startingFolder, overridePath) + internal lastProjectFolder
├── settings-metadata.ts       # + descriptors for the new leaves; internal-keys update; verb label re-align
├── metadata.ts                # + 'folder' ControlKind
└── (new) starting-folder.ts   # pure starting-folder resolution helper (profile/lastViewed/override + fallback)

packages/ui/src/main/
└── main.ts                    # throng:pickFolder handler accepts defaultPath (folder-picker handler ONLY)

packages/ui/src/renderer/
├── sidebar/projects-panel.tsx        # Projects error dismiss; "Remove" verb + no-files confirmation; shared folder picker at create
├── sidebar/subworkspaces-panel.tsx   # reference dismiss (behaviour unchanged); Destroy verb wording
├── explorer/file-tree.tsx            # File Explorer error dismiss
├── panel-type/panel-type-form.tsx    # decouple Clear (fields) from exit-notice dismissal; trailing-edge dismiss
├── workspace/tab-group.tsx           # tab removal verbs (Destroy)
├── workspace/panel-placeholder.tsx   # panel removal verbs (Destroy/Close per ownership) — MINIMAL diff (012 rebases)
├── editor/use-editor.ts              # file-changed notice call-site ONLY: populate files list w/ tab+panel+path
├── theme.css                         # pulsing unsaved-dot keyframe + reduced-motion; error-surface/dismiss styling
└── (new) common/folder-picker.tsx    # shared editable-path + browse-icon component (two call sites)

tests/  (packages/core/tests/unit, packages/ui/tests/{unit,integration,e2e})
```

**Do NOT touch**: `keybindings*.ts`, `renderer/app.tsx`, `terminal/use-terminal.ts`,
`preferences/**`, `default-themes/**`, `config-store.ts`, and `core/src/config/theme.ts` (009 owns
the `dismiss` token). The `use-editor.ts` change is confined to the notice call site.

**Structure Decision**: Renderer + UI-main + core-config only; no new package, no daemon/DB surface.

## Complexity Tracking

| Violation / Deferral | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Dismiss-glyph rendering (US1/FR-006) sequenced **after** 009 | The `dismiss` theme icon token is owned by `009-theme-content`; rendering it before 009 lands would either duplicate the token (DRY/ownership violation) or fall back to `destroy` (conflates two verbs — the very thing Q1 rejected). All dismiss *logic* (immediate removal, recurrence, Clear/dismiss decoupling) ships first and is E2E-covered; only the glyph render + its glyph-assertion E2E wait for the rebase. | Adding the token here — rejected: crosses feature 009's exclusive ownership of `theme.ts` and would collide at merge. Falling back to `destroy` — rejected per Q1 (semantic conflation). Text-label "✕" — rejected per Themeable-icon-controls rule. |
