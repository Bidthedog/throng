# Phase 0 Research: Main Window Affordances

All five clarification questions were answered by the human (spec `## Clarifications`,
Session 2026-07-10); no `NEEDS CLARIFICATION` markers remain. This file records the design
decisions and the two hard boundaries that shape the build order.

## D1 — Decoupling terminal Clear from exit-notice dismissal

**Decision**: Add a per-panel **dismissed-exit** signal (a small reactive store, or a
`dismissPanelExit(panelId)` alongside the existing `clearPanelExit`/`getPanelExit` in
`terminal/exit-store.ts` which the form already imports). The notice renders when an exit record
exists AND it has not been dismissed. **Clear** resets only the draft (`setDraft(panelId,
EMPTY_DRAFT)`), and MUST NOT call `clearPanelExit`/dismiss. **Confirm** still clears the exit record
(the panel becomes typed and the form is replaced), which is correct. The dismiss control clears
only the notice.

**Rationale**: Today `panel-type-form.tsx` calls `clearPanelExit(panelId)` in both the Clear
handler and `onConfirm`, entangling the two concerns (the reported bug). The notice also only clears
via a form action, so it "persists until re-typed" (the second reported bug). A dedicated
dismissed-flag makes dismissal immediate and independent, and keeps typed values intact.

**Alternatives rejected**: Clearing the exit record on Clear (status quo — the bug). Unmounting the
form to clear the notice (leaves a blank, unrecoverable panel — explicitly forbidden by FR-005).

## D2 — Pulsing unsaved dot

**Decision**: One `@keyframes throng-unsaved-pulse` cycling `opacity: 1 -> ~0.4 -> 1` over ~1.5s,
applied to the single shared `.throng-unsaved-dot` class in `theme.css`. Because all three sites
(projects list, tab chip, panel header) use that one class, they animate from the same document
timeline and are inherently in step (FR-022). A `@media (prefers-reduced-motion: reduce)` block sets
`animation: none; opacity: 1` (FR-023). The dot element is only mounted while dirty, so it stops on
save automatically (FR-020).

**Rationale**: Pure CSS keyframe on the shared class satisfies "synchronised", "never invisible"
(min opacity 0.4 > 0), "~1.5s", and "static under reduced motion" with no JS timers and no
per-instance drift. GPU-composited opacity is negligible cost.

**Alternatives rejected**: JS-driven `requestAnimationFrame` per instance (drift between locations,
violates FR-022; needless complexity). A shared JS animation clock (YAGNI — CSS already
synchronises via the document timeline).

## D3 — Starting-folder resolution + persistence

**Decision**: New `app-settings.ts` `newProject` section: `startingFolder: 'profile' | 'lastViewed'
| 'override'` (default `'lastViewed'`), `overridePath: string` (default `''`), and an **internal**
`lastProjectFolder: string` (default `''`) added to `SETTINGS_INTERNAL_KEYS`. A pure helper
`resolveStartingFolder(settings.newProject, { profileDir })` returns the *candidate* path
(profile -> profileDir; lastViewed -> lastProjectFolder or profileDir; override -> overridePath or
profileDir). The UI-main `throng:pickFolder` handler accepts an optional `defaultPath`, and — because
existence/drive checks are OS-specific — validates it in main (`existsSync` + `isDirectory`),
falling back to the OS home dir (`app.getPath('home')`) when unresolvable (FR-043). On a successful
project creation the renderer writes the chosen folder to `newProject.lastProjectFolder` via the
existing `config.write` path (FR-040).

**Rationale**: Keeps OS-specific filesystem checks in UI-main (Principle II), keeps the choice pure
and unit-testable in core, and reuses the existing atomic config-write + watcher immediate-apply
path (no new persistence). `lastProjectFolder` is machine bookkeeping, so it is internal (Q2) and
excluded from the editor-completeness requirement rather than surfaced in the editor.

**Alternatives rejected**: Storing `lastProjectFolder` as a user-facing setting (it is not
hand-tuned; would clutter the editor). Resolving existence in the renderer (renderer is sandboxed;
drive/dir checks belong in main).

## D4 — Shared folder-picker component + `folder` ControlKind

**Decision**: One reusable `renderer/common/folder-picker.tsx`: an editable path `<input>` (type,
paste, edit — Q3 reversal) plus a **themeable browse icon** (hover title, theme-token colours) that
opens the OS folder dialog on demand. Two call sites: **project creation** additionally auto-pops
the dialog on new-project (existing behaviour), the **settings override** never auto-pops (browse
only). Add a first-class `folder` value to `ControlKind` in `metadata.ts` so the settings form can
render this component declaratively (no special-casing the key, no browse button bolted onto plain
text controls — FR-042a).

**Rationale**: DRY (Principle VIII) — one component, two call sites; a declarative ControlKind keeps
the settings form generic (Principle X, editor-completeness).

**Alternatives rejected**: Two separate pickers (duplication). A text field with no browse (fails
FR-042 browse affordance). Special-casing the override key in the form (fails FR-042a).

## D5 — File-changed notice names the file

**Decision**: In `use-editor.ts`, the `onSync` `externalChange` branch builds an
`EditorNotice.files` entry: split the document's full path into `{dir, name}` and set
`note` to `Panel: <panel.title> - Tab: <tab.title>`, with the tab resolved **locally** from
`ws.layout.tabs` (find the tab whose split tree contains this `panelId`) at the call site. No change
to the IPC sync message or the notice model (it already carries `files`).

**Rationale**: The notice model already supports `files` (dir/name/note) used by the missing-file
notice; reusing it keeps the change to a few lines in `use-editor.ts`, which matters because
`012-focus-contexts-and-zoom` rebases on that file (Q5).

**Alternatives rejected**: Threading tab identity through the IPC message (broader surface, worse
for the 012 rebase). A bespoke message string (loses the structured dir/name/note layout).

## D6 — Removal-verb application

**Decision**: Apply the glossary verb per target+location directly at each control's tooltip,
context-menu label, and confirmation copy. The project delete becomes **Remove** with a confirmation
that states "no files on disk are deleted". Behaviour (session termination, destroy cascade, close
semantics) is UNCHANGED — only wording. Re-align the two settings-metadata confirmation **labels**
(keys unchanged). Consider a tiny pure helper for the panel case (project-owned in main = Destroy;
project-owned in sub-workspace = Close; sub-workspace-owned = Destroy) if it reduces duplication;
otherwise inline, since the branches already exist in `panel-placeholder.tsx`.

**Rationale**: Wording-only change keeps risk low and behaviour-preserving; the E2E matrix locks the
verb-per-row mapping.

**Alternatives rejected**: Renaming config keys (needs a migration; Q4 chose label-only).

## Boundaries (build-order drivers)

- **B1 — `dismiss` icon token is owned by `009-theme-content`.** Rendering the dismiss glyph resolves
  `resolveIcon(theme, 'dismiss')`; that token does not exist until 009 lands. All dismiss *logic*
  (immediate removal, recurrence, Clear/dismiss decoupling) and its E2E ship first; the glyph render
  in the three newly-dismissable surfaces + the E2E asserting the glyph are the LAST tasks and STOP
  for a rebase onto a `master` containing 009. Do not add the token, do not fall back to `destroy`,
  do not stub.

- **B2 — the settings-form rendering of the `folder` control + the unresolvable-override flag live in
  `preferences/**`, owned by `015-preferences-and-settings` (off-limits here).** This feature
  delivers everything on its side of that boundary: the `folder` ControlKind (`metadata.ts`), the
  descriptors (`settings-metadata.ts`), the shared folder-picker component, the pure
  resolve/validate helpers (`starting-folder.ts`), the `app-settings.ts` section, the UI-main
  handler, and the project-creation wiring (all fully tested). Wiring the `folder` case into
  `preferences/form-controls.tsx` and rendering the unresolvable-override flag in
  `preferences/settings-tab.tsx` (FR-042a settings-side, FR-044) are a **handoff to 015**. Until 015
  adds the `case 'folder'`, the settings form's existing default renders the override as an editable
  text field (typeable/pasteable — partially satisfying FR-042) without the browse icon or the flag.
  **This is a second cross-feature boundary the coordinator should confirm** (the briefing named only
  the 009 dependency). Flag it; do not touch `preferences/**`.
