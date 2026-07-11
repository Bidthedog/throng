# Feature Specification: Main Window Affordances

**Feature Branch**: `011-main-window-affordances`

**Created**: 2026-07-10

**Status**: Draft

**Depends on**: `009-theme-content` — supplies the `dismiss` theme icon token (defaults to the `✕` glyph, distinct from `destroy` so the two can diverge under re-theming). The dismiss-control rendering in US1/FR-006 requires that token; this feature merges after 009. Everything else in this feature is independent of 009.

**Input**: User description: "Five independent user-visible defects in the main window plus one small new setting: dismissable panel error surfaces, a file-changed-on-disk warning that names the file, a more visible unsaved-changes dot, consistent removal terminology, and a smarter new-project folder picker with a starting-folder setting."

## Clarifications

### Session 2026-07-10

- Q: How should the themeable dismiss control get its icon — reuse the existing `destroy` token, or a new one? → A: A new `dismiss` icon token, added by feature `009-theme-content` (defaults to the `✕` glyph, distinct token). This feature does NOT edit `theme.ts`; it resolves `dismiss` through the normal icon-token path. This creates a hard dependency: 011 merges after 009.
- Q: Where does the persisted "last chosen project folder" live, and how is it kept out of the settings-completeness test? → A: An internal `AppSettings` leaf in `app-settings.ts`, added to `SETTINGS_INTERNAL_KEYS` so it is not surfaced in the visual settings editor and does not require an editor descriptor. It is machine bookkeeping, not a user-tuned setting.
- Q: Must the override folder be chosen only via a folder picker (no typing)? → A: **Reversed.** Users CAN type and edit the path directly (a path you cannot type is a path you cannot paste). Build ONE shared folder-picker component — an editable text field plus a themeable browse icon that opens the OS folder dialog on demand — and reuse it at both call sites. The only difference: project creation auto-pops the OS dialog on new-project; the settings control never pops a dialog on its own (only when the user clicks browse). Add a first-class `folder` ControlKind to `metadata.ts` that renders this component.
- Q: Should the settings-editor confirmation labels be re-aligned to the new verbs? → A: Yes, in scope. Update descriptor **labels** only (keys unchanged, no migration): `confirmations.destroyProject` → "Remove a project"; `confirmations.destroySubWorkspace` → "Destroy a sub-workspace".
- Q: How is the "containing tab" sourced for the file-changed warning? → A: Resolve the tab locally from the workspace layout at the notice call site. Do NOT thread tab identity through the IPC sync message — keep the `use-editor.ts` diff to a few lines so `012-focus-contexts-and-zoom` rebases cleanly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dismiss a panel error and keep working (Priority: P1)

A terminal fails to launch, a project operation is rejected, a file operation errors, or a
sub-workspace action is refused. An error message appears in the affected panel. The user reads
it, presses a dismiss control at the trailing edge of the message, and the message disappears
immediately, leaving the panel fully usable. Nothing else the user typed or configured is
disturbed. If the same error condition recurs, the message reappears.

**Why this priority**: Three of the four error surfaces trap the user — the error stays on screen
and, for the terminal-exit notice, cannot be cleared without side effects (it survives until the
panel loses focus or is re-typed, and it is entangled with the form's "Clear" button). An
undismissable error that also blocks re-typing the panel is the most disruptive defect: it can
leave a panel effectively unusable. Fixing it restores basic panel usability.

**Independent Test**: Trigger each of the four error surfaces in turn, confirm each shows a
trailing-edge dismiss control, confirm pressing it removes the error at once and leaves the panel
usable, confirm the same error re-appears if re-triggered, and confirm the terminal form's "Clear"
and its error-dismiss are fully independent.

**Acceptance Scenarios**:

1. **Given** the Projects sidebar shows an error, **When** the user activates the trailing-edge
   dismiss control, **Then** the error is removed immediately and the project list stays usable.
2. **Given** the File Explorer shows an error, **When** the user activates its trailing-edge
   dismiss control, **Then** the error is removed immediately and the tree stays usable.
3. **Given** a terminal panel's type form shows an exit/failure notice, **When** the user
   activates the notice's dismiss control, **Then** the notice is removed immediately and the
   type form remains fully usable so the user can re-type the panel (the panel is never left
   blank or unrecoverable).
4. **Given** a terminal type form with a visible exit notice and typed field values, **When** the
   user activates the form's "Clear", **Then** only the form fields are cleared and the exit
   notice remains visible.
5. **Given** a terminal type form with a visible exit notice and typed field values, **When** the
   user dismisses the exit notice, **Then** the notice is removed and the typed field values are
   left intact.
6. **Given** any of the four error surfaces was dismissed, **When** the same error condition
   occurs again, **Then** the error surface re-appears.

---

### User Story 2 - Removal actions say what they will actually do (Priority: P2)

The user removes a panel, tab, sub-workspace, or project. The verb on the control, its tooltip,
its context-menu entry, and its confirmation dialog all agree, and each names the true
consequence. In particular, removing a project reads as "Remove" and its confirmation states
plainly that no files on disk are deleted, so the user is never misled into thinking a project's
folder will be erased.

**Why this priority**: Today "Destroy" is used for a project even though only its registration is
removed and no files are touched — this is actively misleading about data safety. The same verb
also carries different consequences in different places (a project-owned panel destroyed in the
main window is gone everywhere; the same panel "destroyed" in a sub-workspace only leaves that
window). Correct, consequence-accurate terminology is a trust and data-safety concern.

**Independent Test**: Walk each removal target in each location, and confirm the verb shown on the
control matches its tooltip, its context-menu entry, and its confirmation dialog, that the verb
matches the glossary for that target, and that the project-removal confirmation states no files
are deleted.

**Acceptance Scenarios**:

1. **Given** a project in the Projects list, **When** the user removes it, **Then** the control,
   tooltip, menu entry, and confirmation all read "Remove", and the confirmation states that the
   project is unregistered and no files on disk are deleted.
2. **Given** a project-owned panel in the main window, **When** the user removes it, **Then** the
   verb is "Destroy" and the confirmation states it is removed everywhere (including
   sub-workspaces mirroring it) and its terminal session is terminated.
3. **Given** a project-owned panel shown inside a sub-workspace, **When** the user removes it from
   that sub-workspace, **Then** the verb is "Close" and the confirmation states the panel survives
   in its project with its terminal still running.
4. **Given** a sub-workspace-owned panel in a sub-workspace, **When** the user removes it, **Then**
   the verb is "Destroy" and its terminal session is terminated.
5. **Given** a tab in the main window, **When** the user removes it, **Then** the verb is "Destroy"
   and it removes the tab and every panel it owns.
6. **Given** a tab in a sub-workspace, **When** the user removes it, **Then** the verb is
   "Destroy"; panels it owns are destroyed and project-owned panels within it are merely closed.
7. **Given** a sub-workspace in the sidebar list, **When** the user removes it, **Then** the verb
   is "Destroy"; the sub-workspace and panels it owns are destroyed and project-owned panels it
   mirrored are merely closed.
8. **Given** any removal control in the main window's scope, **When** the user inspects its verb,
   **Then** it is exactly one of Close, Destroy, Remove, or Delete — no other removal verb is used.

---

### User Story 3 - The new-project folder picker opens somewhere useful (Priority: P3)

The user creates a new project and the folder picker opens at a sensible starting location instead
of an arbitrary default. By default it opens at the folder they last chose for a project. A setting
lets them choose the starting behaviour: their user profile folder, the last-viewed folder, or a
fixed override folder they select with a folder picker. When the configured starting folder cannot
be resolved, the picker falls back to the user profile folder, and an unusable override is flagged
in the settings editor.

**Why this priority**: The picker opening "nowhere useful" is friction on a common action, and the
missing setting is a completeness gap. It is lower priority than the trust/usability defects above
but is a clear, self-contained improvement.

**Independent Test**: With each of the three starting-folder options set, open the new-project
picker and confirm the starting folder; set "Last Viewed" and confirm the picker opens at the
last-chosen project folder after a project is created; make each configured location unresolvable
and confirm fallback to the profile folder and, for an override, a flag in the settings editor.

**Acceptance Scenarios**:

1. **Given** the starting-folder setting is "Last Viewed" (the default) and a project was last
   created from folder F, **When** the user opens the new-project folder picker, **Then** it opens
   at F.
2. **Given** the starting-folder setting is "User Profile", **When** the user opens the picker,
   **Then** it opens at the user's profile folder.
3. **Given** the starting-folder setting is "Override", **When** the user sets the override,
   **Then** they may type/paste/edit the path directly OR click the browse icon to pick it via the
   OS folder dialog, and the new-project picker subsequently opens at that override folder.
4. **Given** the configured starting folder no longer exists or is on a disconnected drive,
   **When** the user opens the picker, **Then** it opens at the user's profile folder instead.
5. **Given** an override folder that cannot be resolved, **When** the user opens the settings
   editor, **Then** the override is flagged as unresolvable.
6. **Given** a project is created from a chosen folder, **When** the choice completes, **Then** the
   last-chosen folder is persisted so it survives an application restart.

---

### User Story 4 - The "file changed on disk" warning names the file (Priority: P4)

An editor's backing file is changed by another program while the user has unsaved edits. The
warning that appears names the containing tab, the panel, and the file's full path, so the user
knows exactly which document is affected before deciding to save (overwrite) or revert (reload).

**Why this priority**: The warning is real and correct in intent, but naming the specific document
is a clarity improvement rather than a blocker — a user with one open editor can infer it. It is
valuable but less urgent than usability and trust defects.

**Independent Test**: With two editors open on different files, externally modify one and confirm
the warning names the correct tab, panel, and full file path (not a generic message).

**Acceptance Scenarios**:

1. **Given** an editor with unsaved edits whose file is changed externally, **When** the warning
   appears, **Then** it names the containing tab, the panel, and the file's full path.
2. **Given** the warning is shown, **When** the user reads it, **Then** it still explains that
   saving overwrites the external change and reverting discards local edits and loads the on-disk
   version.

---

### User Story 5 - The unsaved-changes dot is hard to miss (Priority: P5)

Wherever the unsaved-changes dot appears — the projects list, the tab chip, and the panel header —
it pulses gently and continuously so it draws the eye, and it stops the instant the document is
saved. It never fades to invisible (an absent dot always means "no unsaved changes"), all three
locations pulse in unison, and when the operating system requests reduced motion the dot is shown
static at full opacity.

**Why this priority**: The dot is already present and correct; making it pulse is a visibility
polish. It is the least urgent of the five, but still user-visible and worth doing.

**Independent Test**: Make an unsaved edit and confirm the dot pulses in all three locations in
sync, never disappears, stops on save, and renders static at full opacity under an OS
reduced-motion preference.

**Acceptance Scenarios**:

1. **Given** a document has unsaved changes, **When** the dot is shown in any of the three
   locations, **Then** it pulses continuously, cycling opacity between fully opaque and partially
   opaque over approximately 1.5 seconds and never becoming invisible.
2. **Given** a document has unsaved changes shown in more than one location, **When** the dots
   pulse, **Then** all locations pulse in unison (never bright in one place and dim in another).
3. **Given** a document with a pulsing dot, **When** the user saves it, **Then** the dot stops
   (it is removed, since there are no unsaved changes).
4. **Given** the operating system requests reduced motion, **When** the dot is shown, **Then** it
   is static at full opacity.

---

### Edge Cases

- **Two errors in quick succession on one surface**: dismissing the visible error and a new error
  arriving should show the new error (recurrence reinstates the surface); the surfaces show one
  error at a time.
- **Dismiss then immediate re-type (terminal)**: after dismissing an exit notice, the type form
  must be usable so the panel can be re-typed; a panel must never be left blank and unrecoverable.
- **File-changed warning with an unsaved (never-saved) document**: an editor with no file path
  cannot receive an external-change warning; the warning applies only to pathed documents.
- **Starting folder resolves to a path that exists but is not a directory / is inaccessible**:
  treated as unresolvable, so fall back to the profile folder.
- **Override configured then the folder is later deleted**: opening the picker falls back to the
  profile folder and the settings editor flags the override as unresolvable.
- **Reduced-motion toggled while a dot is visible**: the dot switches between pulsing and static
  to match the current OS preference.
- **A removal target that carries a running terminal**: the confirmation's consequence text must
  reflect whether the session is terminated (Destroy) or kept running (Close).

## Requirements *(mandatory)*

### Functional Requirements

#### Dismissable error surfaces (US1)

- **FR-001**: All four panel error surfaces — the Projects sidebar error, the File Explorer error,
  the terminal panel-type exit/failure notice, and the sub-workspaces sidebar error — MUST carry a
  dismiss control at the surface's trailing edge that removes the error and leaves the panel
  usable. The sub-workspaces error surface (already dismissable) is the reference behaviour the
  other three MUST match.
- **FR-002**: Dismissing any error surface MUST take effect immediately. No error surface may
  persist until the panel loses focus, is re-rendered, or is re-typed.
- **FR-003**: If the same error condition recurs after dismissal, the error surface MUST re-appear.
- **FR-004**: In the terminal panel-type form, the "Clear" control MUST clear only the form's input
  fields. It MUST NOT clear the exit/failure notice or any error state. Clearing the form while an
  error is visible MUST leave the error visible.
- **FR-005**: Dismissing the terminal exit/failure notice MUST leave any typed form values intact,
  and MUST leave the panel-type form usable so the user can always re-type the panel. Dismissing a
  notice MUST NEVER leave a blank, unrecoverable panel.
- **FR-006**: Each error-surface dismiss control MUST be a themeable icon carrying a hover title
  that names the action, with its glyph and colours resolved from the active theme's tokens. It
  MUST NOT be a text label or an inline (non-themeable) vector asset. (Constitution v3.12.0,
  Themeable icon controls rule.)

#### File-changed-on-disk warning names the file (US4)

- **FR-010**: The "file changed on disk" warning MUST name the affected document by its containing
  tab, its panel, and the file's full path, using the notice model's existing per-file list rather
  than a generic message.
- **FR-011**: The warning MUST continue to explain the two available actions: that saving
  overwrites the external change and that reverting discards local edits and loads the on-disk
  version.

#### Unsaved-changes dot visibility (US5)

- **FR-020**: The unsaved-changes dot MUST pulse continuously wherever it appears (projects list,
  tab chip, panel header) while the document has unsaved changes, and MUST stop the moment the
  changes are saved.
- **FR-021**: The dot MUST cycle opacity between fully opaque and partially opaque over
  approximately 1.5 seconds and MUST NOT become invisible at any point in the cycle.
- **FR-022**: The dot's pulse MUST be synchronised across all three locations, so one document's
  dot is never bright in one place and dim in another at the same instant.
- **FR-023**: When the operating system requests reduced motion, the dot MUST render static at full
  opacity (no animation).

#### Consistent removal terminology (US2)

- **FR-030**: The application MUST use exactly four removal verbs, each denoting a distinct
  consequence: **Close** (dismiss a view of something; the thing itself survives, and so does any
  process it hosts); **Destroy** (irreversibly remove a thing together with everything it owns,
  terminating any process those things host); **Remove** (unregister a project from the
  application; files on disk are never touched); **Delete** (irreversibly remove something
  persisted on disk — a theme, or a file/folder in the explorer).
- **FR-031**: The verb MUST be selected per target and location, per the glossary in Key Entities.
  The same physical control MUST present the verb matching its target's ownership and location.
- **FR-032**: For any single removal action, the control label, its tooltip, its context-menu
  entry, and its confirmation dialog MUST all use the same verb.
- **FR-033**: A removal confirmation dialog MUST state the consequence, not merely the verb. In
  particular, removing a project MUST state that the project is unregistered and no files on disk
  are deleted.
- **FR-034**: No removal verb other than the four in FR-030 may be used anywhere in the main window
  this feature owns.
- **FR-035**: Removing a project MUST be presented as "Remove" (control, tooltip, menu, and
  confirmation), replacing the current "Destroy" wording; the action still unregisters the project
  and destroys its panels and tabs, but touches no file on disk.
- **FR-036**: The theme editor ("Delete a theme") and the file explorer ("Delete a file/folder")
  are listed in the glossary for completeness only. This feature MUST NOT change the theme editor
  (owned by a sibling feature); it owns the main-window removal controls.
- **FR-037**: The settings-editor confirmation-descriptor **labels** MUST be re-aligned to the new
  verbs (keys unchanged, no migration): `confirmations.destroyProject` → "Remove a project";
  `confirmations.destroySubWorkspace` → "Destroy a sub-workspace". A settings page that says
  "Delete a project" while the main window says "Remove" breaks the verb-consistency promise.

#### New-project folder picker & starting-folder setting (US3)

- **FR-040**: The new-project folder picker MUST open at the folder last chosen for a project, and
  that folder MUST be persisted so it survives an application restart.
- **FR-041**: A setting MUST control the starting folder with exactly three options: "User
  Profile", "Last Viewed", and "Override". "Last Viewed" MUST be the default.
- **FR-042**: The override folder MUST be set through a shared folder-picker component reused at
  both call sites (project-creation and the settings override). The component is an editable text
  field showing the path (the user MAY type, paste, and edit it directly) plus a themeable browse
  icon (hover title, theme-token colours) that opens the OS folder dialog on demand. The two call
  sites differ in exactly one respect: project creation auto-pops the OS dialog when a project is
  created, whereas the settings control never pops a dialog on its own — the dialog opens only when
  the user clicks browse.
- **FR-042a**: A first-class `folder` control kind MUST be added to the settings-editor metadata so
  the shared folder-picker component renders declaratively from a descriptor; the override-path
  setting MUST NOT be special-cased in the settings form, and a browse affordance MUST NOT be
  bolted onto ordinary text controls.
- **FR-043**: When the configured starting folder cannot be resolved (never existed, no longer
  exists, or is on a disconnected/inaccessible drive), the picker MUST silently cascade to the next
  candidate and open at the first that resolves. For "Override" the cascade is override → last-viewed
  folder → user profile folder; for "Last Viewed" it is last-viewed folder → user profile folder. The
  user's profile folder is the universal final fallback and is always resolvable.
- **FR-044**: An override folder that cannot be resolved MUST be flagged as unresolvable in the
  settings editor. **Delivery note:** the runtime cascade of FR-043 handles an unresolvable override
  at pick time; the *visual settings-editor flag* is NOT delivered in this feature — it needs a
  main-side path-resolvability check surfaced in the preferences form and is a documented handoff to
  feature `015-preferences-and-settings` (which owns `preferences/**`). The pure `isOverrideResolvable`
  helper is implemented and exported for 015 to consume. Tracked in tasks.md under Convergence.
- **FR-045**: The new starting-folder setting and its override-path value MUST be represented in
  the settings-editor metadata registry so they are editable through the visual settings editor,
  and MUST be covered by the registry completeness test. (Constitution v3.12.0,
  Configuration-editor completeness rule.) Any internal "last chosen folder" value that is not a
  user-facing setting MUST be excluded from the completeness requirement (recorded as internal
  bookkeeping) rather than left as an uncovered leaf.

#### Cross-cutting

- **FR-050**: Every new or altered interactive action control introduced by this feature MUST be a
  themeable icon with a hover title, taking its glyph and colours from theme tokens, except the
  decision buttons inside confirmation dialogs (Close / Destroy / Remove / Delete / Cancel), which
  retain text labels because the label is the statement of consequence being consented to.
- **FR-051**: Each user-visible behaviour in this feature MUST be covered by end-to-end tests
  exercising the change through the running application (Constitution Principle V).
- **FR-052**: The settings editor MUST display the values of static enum dropdowns in Title Case
  (e.g. `lastViewed` → "Last Viewed", `override` → "Override", `tab` → "Tab", `project` → "Project"),
  keeping well-known abbreviations upper-cased (`lf`/`crlf`/`cr` → "LF"/"CRLF"/"CR"). This is
  presentation-only: the stored setting values (the JSON tokens) MUST be unchanged, and dynamic
  option lists that are already human names (e.g. theme names) MUST be shown verbatim.

### Key Entities *(include if feature involves data)*

- **Removal-verb glossary**: the authoritative mapping of removal target + location to verb +
  consequence:

  | Target | Where | Verb | Consequence |
  |---|---|---|---|
  | Panel owned by a project | Main window | Destroy | Gone everywhere, including sub-workspaces mirroring it; its terminal session is terminated. |
  | Panel owned by a project | Sub-workspace | Close | Leaves this sub-workspace only. Survives in its project; its terminal session keeps running. |
  | Panel owned by the sub-workspace | Sub-workspace | Destroy | Gone; its terminal session is terminated. |
  | Tab | Main window | Destroy | The tab and every panel it owns. |
  | Tab | Sub-workspace | Destroy | The tab; panels it owns are destroyed, project-owned panels within it are merely closed. |
  | Sub-workspace | Anywhere | Destroy | The sub-workspace and the panels it owns; project-owned panels it mirrored are merely closed. |
  | Project | Projects list | Remove | Unregistered; its panels and tabs destroyed. No file on disk is touched. |
  | Theme | Theme editor | Delete | Removed from the user's configuration. (Owned by a sibling feature — glossary only.) |
  | File or folder | File explorer | Delete | Removed from disk. |

- **Error surface**: one of four panel-scoped message areas (Projects error, File Explorer error,
  terminal panel-type exit/failure notice, sub-workspaces error). Each shows at most one error at a
  time, carries a trailing-edge themeable dismiss control, and re-appears on recurrence.

- **Editor notice (file-changed)**: the existing notice model, which already supports a per-file
  list of directory / name / note entries. The file-changed warning populates that list with the
  affected document's tab, panel, and full path.

- **Unsaved-changes dot**: a single shared visual indicator rendered in the projects list, tab
  chip, and panel header; pulsing and synchronised across all instances, static under reduced
  motion, and absent exactly when there are no unsaved changes.

- **Starting-folder setting**: a user setting choosing where the new-project folder picker opens —
  "User Profile", "Last Viewed" (default), or "Override" — plus, for "Override", an editable
  override path set through the shared folder-picker component. Backed by a persisted "last chosen
  project folder" (an internal `AppSettings` leaf, listed in `SETTINGS_INTERNAL_KEYS`) used by
  "Last Viewed".

- **Shared folder-picker component**: one reusable control — an editable path text field plus a
  themeable browse icon that opens the OS folder dialog on demand — used both by project creation
  (which additionally auto-pops the dialog on new-project) and by the settings override path (which
  only opens the dialog on an explicit browse click). Rendered from a `folder` metadata control kind.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All four panel error surfaces can be dismissed, and after dismissal the panel is
  immediately usable — verified for each of the four surfaces.
- **SC-002**: In the terminal panel-type form, "Clear" and error-dismissal are fully independent in
  both directions: clearing the form leaves a visible error visible, and dismissing the error
  leaves typed field values intact — verified in 100% of test runs.
- **SC-003**: Dismissing a terminal exit notice never leaves a blank, unrecoverable panel — the
  type form is always usable afterwards.
- **SC-004**: The file-changed warning names the correct tab, panel, and full file path for the
  affected document, distinguishable when two editors on different files are open.
- **SC-005**: The unsaved-changes dot pulses over an ~1.5-second cycle, never reaches zero opacity,
  is synchronised across all three locations, stops on save, and is static under reduced motion —
  all four properties verified.
- **SC-006**: Every removal control's verb matches its tooltip, context-menu entry, and
  confirmation dialog, and matches the glossary for its target/location, across every target listed
  — with no removal verb outside the set {Close, Destroy, Remove, Delete}.
- **SC-007**: The project-removal confirmation states that no files on disk are deleted.
- **SC-008**: The new-project folder picker opens at the expected folder for each of the three
  starting-folder options, falls back to the profile folder when the configured folder is
  unresolvable, and flags an unresolvable override in the settings editor.
- **SC-009**: The starting-folder setting and its override path are editable in the visual settings
  editor and the settings-metadata completeness test passes with them present.

## Assumptions

- The sub-workspaces sidebar error surface is already dismissable and is the correct reference
  implementation for the other three surfaces (control placement, immediate removal, recurrence).
- The editor notice model already carries a per-file list (directory / name / note) that other
  notices use; the file-changed warning simply adopts it — no new notice model is required.
- The unsaved-changes dot is already a single shared visual element rendered in all three
  locations; making it pulse in one place makes it pulse consistently everywhere.
- "Approximately 1.5 seconds" and "partially opaque" are deliberately loose; a fixed cycle near
  1.5 s and a minimum opacity comfortably above zero (never invisible) satisfy the requirement.
- The "user profile folder" is the logged-in OS user's home/profile directory (per the per-user
  local-storage constraint); it is always resolvable and is the universal fallback.
- The persisted "last chosen project folder" is updated whenever a project is successfully created
  from a chosen folder.
- Removal-verb changes are confined to the main window's controls this feature owns; the theme
  editor and any sibling-owned surfaces are out of scope even though they appear in the glossary.
- The override path is set through the shared folder-picker component (editable text field + browse
  icon); typing/pasting is allowed. A new `folder` metadata control kind renders it declaratively.
  The "last chosen project folder" is an internal `AppSettings` leaf (in `SETTINGS_INTERNAL_KEYS`),
  so the completeness test stays honest without surfacing machine bookkeeping in the editor.
- The `dismiss` theme icon token is provided by feature `009-theme-content`; this feature resolves
  it through the normal icon-token path and does not edit `theme.ts`.

## Dependencies

- **`009-theme-content`** — supplies the `dismiss` theme icon token that US1/FR-006 dismiss
  controls resolve. 011 merges after 009. All non-dismiss work is independent of 009.
- The active-theme icon-token system (themeable glyphs resolved from the theme) — dismiss controls
  and any new action icons draw from it via the `dismiss` token above.
- The settings-metadata registry and its completeness test — the new setting must be registered
  there.
- The native folder-picker capability used by the new-project flow — extended to accept a starting
  directory.
- The editor cross-window notice channel that currently raises the file-changed warning — it must
  provide (or the call site must supply) the tab, panel, and full path for the affected document.

## Out of Scope

- Any change to the theme editor, theme deletion, or default themes (sibling feature owns these).
- Any change to keybindings, the renderer app shell wiring, terminal session internals, or the
  preferences shell beyond the one new setting.
- Redesigning confirmation dialogs beyond making their verb and consequence wording correct.
- Changing what the four error conditions are or when they occur — only their dismissibility and
  independence are in scope.
