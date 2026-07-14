# Feature Specification: Typed Panels — Editor Panel Type

**Feature Branch**: `006-editor-panel-type`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "Implement the 'Editor' panel type — a rich, well-known cross-platform code
editor hosted inline in a Panel (plain-text first pass), one dedicated editor per tab by default, opened
by clicking/Enter in the Files & Folders pane (configurable), with an active-pane focus model, per-editor
Ctrl+S / scoped Ctrl+Shift+S Save-All confined to the owning project (or workspace) tree, unsaved-content
indicators, editor/filename pills, auto-save setting, 'Open In' / 'Send to Tab' / unified 'Sync to
Sub-workspace' context menus, sub-workspace ownership + project-panel sync (as terminals), crash/close
recovery via temp files, and a rename-no-op bug fix."

## Overview

This feature adds the second concrete **Panel type** — **Editor** — on top of the extensible typed-panel
system delivered in 005 (Terminal). Where a Terminal Panel hosts a live shell, an **Editor Panel** hosts a
**rich, well-known code-editor component** for viewing and editing a project's text files inline in the
workspace. The user picks **Editor Panel** from the existing Panel-Type dropdown (or opens a file from the
Files & Folders pane straight into an editor), edits, and saves.

This first pass deliberately ships the **cross-platform editing fundamentals correctly before any
"fancy"** editing: plain-text editing only (no syntax highlighting yet), robust **encoding** and
**line-ending** handling, **save** / **save-all** with strict **project-tree confinement**, **panel
movement / drag** within the existing docking model, **sub-workspace sync** (mirroring one document across
views exactly like a synced terminal), **unsaved-content indicators**, and **crash/close recovery**. The
chosen editor component MUST be capable of rich editing (syntax highlighting, multiple languages,
extensibility, UI + keyboard actions) so those features can be layered on in a later increment — but they
are **out of scope here**.

The feature also introduces an **active-pane focus model**: the Files & Folders pane becomes a focusable,
highlighted "active pane", and while it is active, panel-level keyboard shortcuts (Ctrl+S, Ctrl+Shift+S,
and any terminal/editor shortcuts) do **not** fire against the active Panel. It adds a new **`editor`
settings category** (click-to-open mode, auto-save, save-all scope), unifies the panel context menus
(**Open In**, **Send to Tab → New Tab**, and a shared **Sync to Sub-workspace** cascade reused across all
panel types), and fixes a Files & Folders **rename-no-op** defect.

Editor Panels obey the same **project-first isolation** (Principle I) and **ownership** rules as terminals:
a project-owned editor's file lives under that project's tree; a sub-workspace-owned editor lives outside
every loaded project; and a project editor synced into a sub-workspace **mirrors one document** across its
views (Principle XI, and the 005 sync model — FR-021 there).

## Clarifications

### Session 2026-07-05

- Q: For brand-new in-memory documents, what default text encoding and line endings? → A: **UTF-8, no
  BOM, LF** — and the **line-ending default MUST be a configurable `editor` setting** (default **LF**); the
  editor MUST support **CRLF, LF, and CR** line-ending styles (existing files still preserve their own
  encoding/endings on save).
- Q: When a user opens a file that is already open in an editor in the active tab, what happens? → A:
  **Focus the existing editor** (one buffer per file, never a duplicate/conflicting buffer). Additionally,
  every **"Open In"** target that would open that file MUST be **disabled while the file is already open**
  in an editor. *(Scope refined in batch 3 below: the rule is application-wide, not tab-scoped.)*
- Q: Default for the new `editor.openOnClick` setting (single/double/none)? → A: **Single-click**.
- Q: When Save All runs with brand-new unpathed documents in scope, what happens? → A: **Save the pathed
  files, skip the unpathed ones, then report them** (bulk save is never interrupted by modal prompts).
- Q: What is an Editor Panel's close/"revert-to-form" lifecycle? → A: **The editor and its document are
  inseparably bound to the Panel** — there is **no** independent "close document" action and an Editor
  Panel **never reverts to the type-selection form**. An editor is removed only by **closing/destroying its
  Panel**, and closing a Panel with unsaved content **prompts to save first** (otherwise the Panel just
  closes). (Opening a different file *replaces* the document, US9 — that is not "closing" it.)
- Q: What happens when the user destroys a dirty Editor Panel, or a Tab containing dirty editors? → A:
  **Always prompt** (save / discard / cancel), naming the affected file(s), before destroying a **dirty
  Editor Panel** or a **Tab that contains any dirty editor Panels**. (App-close remains silent, covered by
  recovery, FR-040.)
- Q: What happens when a file open (and dirty) in an editor is changed on disk by another process? → A:
  **throng holds an OS lock on the backing file while it is dirty** so no other process can modify it; the
  lock is taken when the document becomes dirty (and has a real path) and **released when the file is saved
  (clean) or the Panel is destroyed**. A clean or unpathed document takes no lock.
- Q: What is the scope of the one-buffer-per-file rule? → A: **Whole application** — a given real file path
  may be open in **at most one editor buffer anywhere in throng** (any tab, project, or sub-workspace),
  which is the only scope coherent with the machine-wide dirty-file lock (FR-028). Re-opening an
  already-open file focuses that one editor and disables Open In targets for it (FR-011a).
- Q: What happens when a user deletes/removes a project (or sub-workspace) that contains dirty editor
  Panels? → A: **Prompt (save / discard / cancel)**, naming the affected files, before deleting — the same
  deliberate-destroy prompt as a Tab destroy (FR-006a). (Silent recovery is only for application close.)

### Session 2026-07-05b (post-Delivery-E feedback)

- Q: The active Files & Folders pane highlight border sits *under* the file-selection box, which overlaps
  it. Which should be on top? → A: The **active-pane highlight border MUST render above** the tree row
  selection box (the selection box is clipped/behind the pane border), so the pane border is never obscured.
- Q: "Open In → Editor Here" reuses the active editor even for a clean, non-dirty editor. Is that right? →
  A: **Two** file-tree editor-open targets are needed: **"Editor Here"** (replicates the click action —
  opens into the tab's last active editor, reusing it) **and "New Editor"** (forces a **new** dedicated
  Editor Panel for the file). Both respect the app-wide one-buffer rule: **"New Editor" is available only
  when the file is not already open in an editor anywhere** (FR-011a); an already-open file focuses its one
  editor.
- Q: Default auto-save debounce? → A: **300 ms** (was 500 ms) — `editor.autoSaveDebounceMs` default is now
  **300**.
- Q: Should editor (and terminal) fonts be themeable? → A: **Yes — add themeable font family / size / style
  for the editor** (and for terminals **if the renderer can style them**; write E2E to confirm the terminal
  path either works or is not stylable). Default monospace font is **`Consolas, 'Courier New', monospace`**
  and default size **14 px**. If per-terminal-flavour font styling is feasible it MAY be offered; otherwise
  a single terminal font role suffices.
- Q: Should an editor be able to discard all unsaved changes? → A: **Yes — a "Revert" action** on the editor
  Panel's right-click (header) menu undoes **all** changes since the document was loaded, back to the
  loaded/last-saved content, **after a confirmation**.
- Q: How else can the user save besides Ctrl+S? → A: The editor Panel's right-click (header) menu MUST
  include a **"Save"** item that performs the same action as **Ctrl+S**.
- Q: A sub-workspace-**owned** editor (created inside a sub-workspace, belonging to no project) currently
  cannot be saved or destroyed. Intended behaviour? → A: **Bug.** A sub-workspace-owned editor MUST be
  **saveable to any location outside every loaded project** and **destroyable at will** — the editor
  keybindings and the destroy/save/discard prompts MUST be available in the **sub-workspace window**, not
  only the main window. The new-Editor explanatory copy MUST be **context-aware**: a sub-workspace-owned
  editor does **not** belong to a project, so it must not tell the user to save "within this project".
- Q: When a project-owned editor is saved to a location outside its project tree, it silently fails. What
  should happen? → A: The refusal MUST **surface a visible message** (dialog/message box) explaining that an
  editor can only save inside its project (or, for a sub-workspace-owned editor, outside every project) —
  never a silent no-op.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an Editor Panel and edit an in-memory file (Priority: P1)

A user creates a new Panel and, in the type-selection form, opens the **Panel Type** dropdown, which now
offers **Editor Panel** alongside **Terminal**. Selecting **Editor Panel** and confirming turns the Panel
into a live editor holding a **new, empty, in-memory file** (no file on disk yet) that the user can type
into immediately. The document exists only in memory (and its recovery temp file, US11) until the user
saves it (US3).

**Why this priority**: This is the smallest independently valuable slice — a working inline editor that
plugs into the 005 typed-panel form unchanged — and every other editor story builds on it. It proves the
editor component is embedded, interactive, and multi-instance-capable.

**Independent Test**: Create a Panel, open the Panel-Type dropdown, confirm **Editor Panel** is listed,
select and confirm it, and verify a usable text editor appears inline holding an empty unsaved buffer that
accepts typed input. Create a second Editor Panel in the same tab and confirm both edit independently.

**Acceptance Scenarios**:

1. **Given** the type-selection form, **When** the user opens the Panel Type dropdown, **Then** it lists
   **Editor Panel** in addition to Terminal.
2. **Given** the Editor Panel type is selected, **When** the user confirms, **Then** the Panel becomes an
   editor holding a new empty in-memory document with no associated on-disk path, ready for input.
3. **Given** two Editor Panels in the same tab, **When** the user types into each, **Then** each edits its
   own independent document (multiple editor instances coexist).
4. **Given** a confirmed Editor Panel with an unsaved new document, **When** the workspace layout is
   persisted and restored, **Then** the Panel reopens as an editor and its unsaved content is recovered
   (US11), not lost.

---

### User Story 2 - Open a file from Files & Folders into the last active editor (Priority: P1)

A user left-clicks a file in the Files & Folders pane and it opens in the **last active editor Panel** of
the current tab. Whether a single click, a double click, or no click at all triggers this is controlled by
a new **`editor.openOnClick`** setting (**single** / **double** / **none**). Highlighting a file and
pressing **Enter** does the same as a click-to-open. Folders have no Open action, and **Enter no longer
starts a rename** on any item.

**Why this priority**: Opening real project files into the editor is the headline value of the feature —
without it the editor only edits scratch buffers. It also fixes the incorrect Enter-renames-item
behaviour.

**Independent Test**: Set `editor.openOnClick` to **double**; double-click a file and confirm it opens in
the last active editor. Set it to **single** and confirm a single click opens it; set it to **none** and
confirm neither does. Highlight a file and press **Enter** and confirm it opens (does not rename); press
**Enter** on a folder and confirm nothing opens and no rename begins.

**Acceptance Scenarios**:

1. **Given** `editor.openOnClick = double`, **When** the user double-clicks a file, **Then** the file
   opens in the last active editor Panel of the active tab; a single click does not open it.
2. **Given** `editor.openOnClick = single`, **When** the user single-clicks a file, **Then** the file
   opens in the last active editor Panel.
3. **Given** `editor.openOnClick = none`, **When** the user single- or double-clicks a file, **Then** no
   file opens (the user must use the **Open In** menu, US6).
4. **Given** a highlighted file in the list, **When** the user presses **Enter**, **Then** the file opens
   exactly as a click-to-open would (subject to the same setting, treating `none` as "Enter opens the
   highlighted file" — see FR-013) and **no rename** is started.
5. **Given** a highlighted folder, **When** the user presses **Enter** or clicks it, **Then** no editor
   opens (folders have no Open action) and no rename is started.
6. **Given** no editor Panel exists yet in the active tab, **When** a click/Enter open is triggered,
   **Then** the tab's single dedicated Editor Panel is created and the file opens in it (FR-011).

---

### User Story 3 - Save an editor, confined to the owning project tree (Priority: P1)

With an Editor Panel active, the user presses **Ctrl+S** to save. A project-owned editor may only save
**inside its owning project's folder tree**; a Save-As out of that tree is refused. A **sub-workspace-owned**
editor may save **anywhere outside every loaded project** but **never into a project's tree**. Pressing
**Ctrl+Shift+S** performs **Save All** across a configurable scope (**current tab** / **current project** /
**all projects**), defaulting to **current project**.

**Why this priority**: Saving is the point of an editor; the confinement rules are core to throng's
project-first isolation (Principle I) and must be right from the first pass. Persisting the buffer to disk
is what turns the scratch editor of US1/US2 into a real tool.

**Independent Test**: In a project editor, edit and press **Ctrl+S**; confirm the file is written under the
project root. Attempt a Save-As targeting a folder outside the project and confirm it is refused. Edit
several editors across a tab/project and press **Ctrl+Shift+S**; confirm exactly the editors in the
configured scope are saved. In a sub-workspace-owned editor, confirm it saves to a non-project folder and
is refused when targeting any loaded project's tree.

**Acceptance Scenarios**:

1. **Given** a project-owned Editor Panel with unsaved changes and a known file path, **When** the user
   presses **Ctrl+S**, **Then** the file is written to disk at that path and the Panel becomes clean (no
   unsaved indicator).
2. **Given** a project-owned editor whose document has no path yet (new file), **When** the user presses
   **Ctrl+S**, **Then** a save-location prompt appears restricted to the project's folder tree, and a
   chosen location outside that tree is rejected.
3. **Given** a project-owned editor, **When** the user attempts to save it to a folder outside its owning
   project's tree, **Then** the save is refused with a clear message (never written outside the project).
4. **Given** a **sub-workspace-owned** editor, **When** the user saves, **Then** it may be written to any
   folder that is **not** inside any loaded project's tree, and an attempt to save into a loaded project's
   tree is refused.
5. **Given** several editors with unsaved changes and `editor.saveAllScope = current project`, **When** the
   user presses **Ctrl+Shift+S**, **Then** every editor belonging to the current project is saved and
   editors outside that project are untouched.
6. **Given** `editor.saveAllScope = current tab` (or `all projects`), **When** the user presses
   **Ctrl+Shift+S**, **Then** exactly the editors in the current tab (or across all loaded projects) are
   saved, respecting each editor's own confinement rules.

---

### User Story 4 - Cross-platform correctness: encoding & line endings (Priority: P1)

A user opens, edits, and saves files that use different **text encodings** (e.g. UTF-8 with/without BOM)
and different **line endings** (LF vs CRLF) on any supported OS. The editor reads a file's existing
encoding and line-ending style, preserves them on save by default, and does not corrupt content or
silently rewrite every line's endings.

**Why this priority**: The user explicitly asked to "get the basic cross-platform editor stuff working
properly — encoding, line endings, save" before anything fancy. Silent corruption here would make the
editor untrustworthy, so it is P1 alongside saving.

**Independent Test**: Open a CRLF UTF-8-with-BOM file, edit one line, save, and confirm the byte-level
encoding and the file's line-ending style are preserved (unedited lines unchanged). Repeat with an
LF-no-BOM file. Create a new file and confirm it is saved with the platform-appropriate, documented default
encoding and line ending.

**Acceptance Scenarios**:

1. **Given** a file saved as UTF-8 **with** BOM using CRLF endings, **When** the user edits and saves it,
   **Then** the saved file retains UTF-8-with-BOM and CRLF (no line-ending or BOM churn on untouched
   lines).
2. **Given** a file saved as UTF-8 **without** BOM using LF endings, **When** the user edits and saves it,
   **Then** the saved file retains no-BOM and LF.
3. **Given** a brand-new in-memory document, **When** it is first saved, **Then** it is written as UTF-8
   without BOM using the `editor.defaultLineEnding` setting (default LF), which are recorded on the
   document; the editor can also represent CRLF and CR documents.

---

### User Story 5 - Active-pane focus model gates panel shortcuts (Priority: P2)

Clicking anywhere in the Files & Folders pane makes it the **active pane** and visibly highlights it. While
the Files & Folders pane is active, panel-level keyboard shortcuts (Ctrl+S, Ctrl+Shift+S, and any
editor/terminal shortcuts) do **not** apply to the active Panel — keystrokes are handled by the file list
(navigation, the open-on-Enter of US2), not the editor/terminal. Clicking a Panel makes that Panel the
active target again.

**Why this priority**: The save/open shortcuts of US2/US3 must not fire against an editor while the user is
navigating the file tree; a clear active-pane concept prevents misdirected Ctrl+S and makes the Enter-opens
behaviour unambiguous. It is a prerequisite for the shortcut stories to behave predictably.

**Independent Test**: Click the Files & Folders pane and confirm it is highlighted as active; with an
editor holding unsaved changes, press Ctrl+S and confirm the editor is **not** saved (the shortcut did not
reach it). Click the editor Panel and confirm the pane highlight moves to the Panel and Ctrl+S now saves.

**Acceptance Scenarios**:

1. **Given** the user clicks in the Files & Folders pane, **When** the click lands, **Then** that pane is
   marked the active pane and is visually highlighted (themeable), and any previously active Panel is no
   longer the shortcut target.
2. **Given** the Files & Folders pane is active, **When** the user presses a panel shortcut (e.g. Ctrl+S),
   **Then** the shortcut does **not** act on any Panel; file-list keys (arrows, Enter) act on the list
   instead.
3. **Given** the Files & Folders pane is active, **When** the user clicks a Panel, **Then** the Panel
   becomes the active shortcut target and the pane highlight follows the focus.

---

### User Story 6 - "Open In", "Send to Tab", and unified "Sync to Sub-workspace" menus (Priority: P2)

Right-clicking a file in the Files & Folders pane offers an **Open In** submenu:
**OS File Explorer** (the existing reveal action, moved under here); **Editor Here → New editor** or an
existing editor in the active tab; and **Other Tab → (list of tabs) → New Editor Panel** or an existing
editor in that tab. Every panel's right-click menu additionally gains **Send to Tab → New Tab** (mirroring
a drag onto the tab-strip **+** button) and a **Sync to Sub-workspace** cascade shared by all panel types
(Editor and Terminal): **Sub-workspace → (new or existing) → Tab (new or existing) → New Panel or existing
editors**. All targets are restricted to the current project or an appropriate sub-workspace.

**Why this priority**: These menus are how a user opens files into a chosen editor and arranges editors
across the workspace without the file-click default; unifying the sync cascade across panel types removes
duplication (DRY, Principle VIII). It builds on US1–US3 but is not required for the MVP editing slice.

**Independent Test**: Right-click a file and confirm the **Open In** submenu shows **OS File Explorer**,
**Editor Here** (New + existing editors of the active tab), and **Other Tab** (each tab → New/existing).
Choose each and confirm the file opens in the expected editor. On any Panel, choose **Send to Tab → New
Tab** and confirm it behaves identically to dragging that Panel onto the **+** button. Confirm the **Sync
to Sub-workspace** cascade is identical for an Editor and a Terminal Panel.

**Acceptance Scenarios**:

1. **Given** a right-clicked file, **When** the context menu opens, **Then** it shows an **Open In**
   submenu containing **OS File Explorer**, **Editor Here** (→ New editor / existing editors in the active
   tab), and **Other Tab** (→ each tab → New Editor Panel / existing editors in that tab), all scoped to
   the current project.
2. **Given** the previous **OS File Explorer / reveal** menu item, **When** the menus are refactored,
   **Then** that item lives **only** under **Open In → OS File Explorer** (not duplicated at top level).
3. **Given** any Panel's right-click menu, **When** it opens, **Then** it offers **Send to Tab → New Tab**,
   and choosing it produces the same result as dragging the Panel onto the tab-strip **+** button (a new
   active tab containing only that Panel — 005 FR-027).
4. **Given** an Editor Panel and a Terminal Panel, **When** each panel's **Sync to Sub-workspace** cascade
   is opened, **Then** both present the same cascade shape (Sub-workspace → Tab → New Panel / existing
   editors), driven by shared code.
5. **Given** any **Open In / Sync** target list, **When** it is built, **Then** it offers only targets
   within the current project (or an appropriate sub-workspace); no other project's tabs/editors are
   listed.

---

### User Story 7 - Auto-save edits as you type (Priority: P2)

A user enables the new **`editor.autoSave`** setting. From then on, edits to a saved file are written to
disk automatically a short debounce after the user stops typing, so a file open in an editor never sits in
a "pending changes" state. Disabling the setting (the default) returns to manual saving, where changes stay
pending until the user presses Ctrl+S.

**Why this priority**: A convenience mode explicitly requested, but the manual-save path (US3) is the
default and the MVP; auto-save layers on once saving works.

**Independent Test**: With `editor.autoSave` **off** (default), edit a saved file and confirm it stays
marked unsaved until Ctrl+S. Turn it **on**, edit, stop typing, and confirm the file is written to disk
within the debounce window without an explicit save and the unsaved indicator clears. Toggle it off again
and confirm pending changes return.

**Acceptance Scenarios**:

1. **Given** `editor.autoSave` is **off** (default), **When** the user edits a saved file, **Then** the
   change remains pending (unsaved indicator shown) until Ctrl+S.
2. **Given** `editor.autoSave` is **on**, **When** the user edits and then stops typing for the debounce
   interval, **Then** the file is written to disk automatically and the unsaved indicator clears — subject
   to the same confinement rules as a manual save (a new/unpathed document still requires the confined
   save-location choice before auto-save can write it).
3. **Given** `editor.autoSave` is toggled **on then off**, **When** the user next edits, **Then** the
   pending-changes behaviour returns exactly as before.

---

### User Story 8 - Unsaved-content indicators and editor pills (Priority: P2)

When any editor in a tab or project has unsaved content, a **red (themeable) dot** appears in the relevant
places: on a **Tab**, between the tab name and the panel count; on a **project**, **in place of** the
existing "loaded" indicator dot (the loaded dot is removed — unloaded projects keep their greyed italic
style); and on the **Panel** itself, to the right of the panel name (before any pills). Every Editor Panel
header also shows the **panel type** in a pill (to the right of the unsaved dot), followed by a second pill
with the **file name and its relative folder in brackets** — reusing the terminal-flavour pill style.

**Why this priority**: Users must see at a glance where unsaved work lives before closing tabs/projects;
the pills identify each editor's file. Valuable, but the editor is usable without them, so P2.

**Independent Test**: Edit a file in an editor and confirm a red dot appears on the Panel (right of the
name, before pills), on its Tab (between name and count), and on its project (replacing the loaded dot).
Save and confirm all three dots clear. Confirm the Panel shows a type pill then a `filename (relative/
folder)` pill in the terminal-flavour style. Confirm an unloaded project still shows greyed italics with no
dot.

**Acceptance Scenarios**:

1. **Given** an editor with unsaved content, **When** its dirty state is set, **Then** a red themeable dot
   appears on its Panel (right of the panel name, before any pills), on its Tab (between tab name and panel
   count), and on its project (in place of the loaded dot).
2. **Given** all unsaved content in a tab/project is saved (or discarded), **When** the last dirty editor
   becomes clean, **Then** the corresponding dot disappears from the Panel, Tab, and project views.
3. **Given** the project "loaded" indicator dot, **When** this feature ships, **Then** that loaded dot is
   **removed** (replaced by the unsaved dot when unsaved content exists); unloaded projects keep greyed
   italics and show no dot.
4. **Given** an Editor Panel header, **When** it renders, **Then** it shows the panel-type pill (after the
   unsaved dot) followed by a `filename (relative folder)` pill in the same style as the terminal-flavour
   pill.
5. **Given** all unsaved dots (Panel, Tab, project), **When** they render, **Then** they share one
   identical, themeable style.

---

### User Story 9 - Prompt when opening a file into an editor with unsaved changes (Priority: P2)

The user triggers opening a file (click/Enter/Open In → existing editor) into the last active editor, but
that editor already holds an **unsaved** document. Before replacing it, the user is prompted with four
clearly labelled choices that name the editor and file at risk: **Discard changes** (and open the new
file), **Save existing and open** (save the current file, then open the new one in the same editor),
**Keep changes and open in a new editor** (leave the current editor untouched, open the file in a new
Editor Panel), or **Cancel opening**.

**Why this priority**: Prevents silent loss of unsaved work when reusing an editor — important, but only
reachable once opening-into-an-editor (US2) exists.

**Independent Test**: With an editor holding unsaved changes, trigger opening another file into it and
confirm the four-choice prompt appears naming the current editor/file. Exercise each choice and confirm:
discard opens the new file losing the old; save-existing writes then opens; keep-and-new leaves the old
editor and opens a fresh editor; cancel leaves everything unchanged.

**Acceptance Scenarios**:

1. **Given** the last active editor holds unsaved changes, **When** the user opens another file into it,
   **Then** a prompt appears offering exactly: Discard changes, Save existing and open, Keep changes and
   open in a new editor, Cancel opening — clearly identifying the editor and file being discarded/saved.
2. **Given** the prompt, **When** the user chooses **Discard changes**, **Then** the unsaved changes are
   dropped and the new file opens in that editor.
3. **Given** the prompt, **When** the user chooses **Save existing and open**, **Then** the current file is
   saved (respecting confinement) and the new file then opens in the same editor.
4. **Given** the prompt, **When** the user chooses **Keep changes and open in a new editor**, **Then** the
   current editor is left unchanged and the file opens in a newly created Editor Panel.
5. **Given** the prompt, **When** the user chooses **Cancel opening**, **Then** nothing changes — the
   current editor keeps its unsaved document and no new file opens.

---

### User Story 10 - Sub-workspace ownership, project-panel sync, and confinement (Priority: P2)

Editor Panels obey ownership like terminals. A **project-owned** editor can be **synced into a
sub-workspace** (same panel id) and both views **mirror one document** — shared content, cursor-independent
but same buffer and dirty state — exactly as a synced terminal mirrors one session. A **sub-workspace-owned**
editor (created in a sub-workspace, no project) may only save **outside every loaded project**. A
project's file can **never** be loaded into an editor belonging to another project or into a
sub-workspace-owned editor, except when it originated in the project and was moved via the sync menu. If the
user later creates a project whose root would contain a file currently open in a **sub-workspace-owned**
editor, the app tells them to **save and close that editor first**.

**Why this priority**: This is the sub-workspace arm of the editor lifecycle and the enforcement of
project isolation across editors — essential for correctness, but layered on the single-window editing MVP.

**Independent Test**: Sync a project editor into a sub-workspace and confirm both views edit the same
buffer (a change or dirty-state in one appears in the other). In a sub-workspace-owned editor, confirm it
saves only outside loaded projects. Attempt to open a project A file into a project B editor and confirm it
is refused. Open a file in a sub-workspace-owned editor, then create a project whose root contains that
file, and confirm the app requires saving+closing that editor first.

**Acceptance Scenarios**:

1. **Given** a project-owned Editor Panel synced into a sub-workspace (same panel id), **When** the user
   edits in either view, **Then** both views mirror the same single document (shared content and dirty
   state); there is never a second independent buffer (parallels 005 FR-021).
2. **Given** a **sub-workspace-owned** editor, **When** the user saves, **Then** it may write only to a
   folder outside every loaded project's tree; saving into any loaded project's tree is refused.
3. **Given** a file belonging to project A, **When** the user attempts to open it into an editor owned by
   project B or by a sub-workspace, **Then** the open is refused (a project's file can only be editor-loaded
   from within its own project, and reaches a sub-workspace only via the sync menu).
4. **Given** a file open in a **sub-workspace-owned** editor, **When** the user creates a project whose root
   folder contains that file, **Then** the app blocks/defers the project creation and instructs the user to
   save and close that editor first.
5. **Given** a project-owned editor synced into a sub-workspace, **When** the Panel is destroyed from the
   project, **Then** it is removed from the sub-workspace too (one-directional cascade, 005 FR-026);
   destroying only the sub-workspace copy leaves the project's editor and its document intact.

---

### User Story 11 - Crash/close recovery via temp files (Priority: P2)

The user closes throng (deliberately or via a crash) with unsaved editors open and is **not** warned. Each
open editor's content is continuously mirrored to a **recovery temp file** under `%APPDATA%\throng`
(regardless of the auto-save setting). On next launch, every such editor is restored with its in-progress
content so the user can carry on. The temp file is **not** counted toward the unsaved indicator; it exists
only while a document is open in an editor and is removed once the document is fully saved.

**Why this priority**: Guarantees no lost work across restarts/crashes without nagging the user on close —
a strong safety net, but the core editing/saving MVP works without it.

**Independent Test**: Edit files in several editors (do not save), close throng, and confirm no unsaved
warning. Reopen and confirm each editor is restored with its in-progress content. Save an editor fully and
confirm its recovery temp file is removed; confirm the recovery temp file never affects the unsaved dot.

**Acceptance Scenarios**:

1. **Given** editors with unsaved content, **When** the user closes throng, **Then** no unsaved-editor
   warning is shown (contrast with the terminal running-process warning, which still applies to terminals).
2. **Given** an open editor, **When** its content changes, **Then** the content is written to a recovery
   temp file under `%APPDATA%\throng` (independently of the `editor.autoSave` setting).
3. **Given** a previous session with unsaved editors, **When** throng is relaunched, **Then** each affected
   editor is restored with its recovered in-progress content and its real target path.
4. **Given** an editor whose document is **fully saved**, **When** the save completes, **Then** its recovery
   temp file is removed; a recovery temp file exists only while the document is open in an editor.
5. **Given** an editor with a recovery temp file but no pending user changes, **When** the unsaved indicator
   is evaluated, **Then** the temp file does **not** by itself mark the editor/tab/project as unsaved.

---

### User Story 12 - Rename no-op when the name is unchanged (Priority: P3)

A user starts an in-place rename on a Files & Folders item, then confirms **without changing the name**.
Today this raises a spurious "a file already exists with that name" error. Instead, the app MUST leave the
item alone and show no error — an unchanged name is simply a no-op (no rename attempted).

**Why this priority**: A small, self-contained bug fix that removes a confusing error; independent of the
editor work but bundled here because it touches the same Files & Folders interactions (Enter/rename).

**Independent Test**: Begin renaming a file, press Enter without editing the name, and confirm no error
appears and the item is unchanged. Repeat for a folder.

**Acceptance Scenarios**:

1. **Given** an in-place rename in progress, **When** the user confirms with the name unchanged, **Then**
   no rename is attempted, no error dialog appears, and the item is left exactly as it was.
2. **Given** an in-place rename, **When** the user confirms with a genuinely new (and valid) name, **Then**
   the rename proceeds as before (the fix does not affect real renames or real collisions).

---

### Edge Cases

- **Open with no editor present**: A click/Enter/Open-In-existing open when the active tab has no editor
  Panel MUST create the tab's dedicated Editor Panel and open the file into it (FR-011), not silently do
  nothing.
- **File already open in an editor**: Triggering an open for a file that is already open MUST focus the
  existing editor (never a second buffer), and the corresponding Open In targets MUST be disabled while it
  is open (FR-011a).
- **External modification while dirty is prevented**: While a document is dirty and pathed, its backing
  file is OS-locked (FR-028) so another process cannot change it; the "file changed underneath the editor"
  conflict therefore cannot arise while dirty.
- **File deleted/moved on disk while clean**: Once a document is **clean** the lock is released; an editor
  whose backing file is then deleted or moved externally MUST surface that state (e.g. treat a subsequent
  edit as unsaved against a missing target) rather than overwriting silently or losing the buffer.
- **Destroying a dirty editor / tab / project**: Closing or destroying a dirty Editor Panel, a Tab
  containing dirty editors, or deleting a project/sub-workspace containing dirty editors, MUST prompt
  (save / discard / cancel) before proceeding (FR-006a).
- **Binary / non-text file opened**: Opening a file that is not decodable as text MUST be handled
  gracefully (a clear "cannot open as text" indication), not a corrupted buffer. (Rich/binary editing is
  out of scope.)
- **Very large file**: Opening a very large file MUST either open responsively or clearly indicate it is
  too large, without hanging the UI (the chosen editor component is expected to handle large text
  efficiently).
- **Save target becomes invalid**: If a confined save target no longer exists or is not writable at save
  time, the save MUST fail with a clear message and leave the buffer unsaved (never silently lose content).
- **Sub-workspace editor vs. new project overlap**: Creating a project overlapping a sub-workspace-owned
  editor's file is blocked with the save-and-close instruction (US10 AS4); the reverse — a project editor's
  file — can only reach a sub-workspace via the sync menu, never by direct load (US10 AS3).
- **Enter with `openOnClick = none`**: With clicking disabled, Enter on a highlighted **file** still opens
  it (Enter is the explicit keyboard open and must never rename); see FR-013 for the precise rule.
- **Recovery temp file collision / stale temp files**: Restored/orphaned recovery temp files MUST be
  reconciled on launch (restore live editors, clean up temp files for documents that were fully saved) so
  stale temp files do not accumulate.

## Requirements *(mandatory)*

### Functional Requirements

#### Editor panel type (extends the 005 type system)

- **FR-001**: The Panel-Type dropdown in the type-selection form MUST offer **Editor Panel** as a
  selectable type in addition to Terminal, registered through the existing extensible panel-type catalogue
  (005 FR-002) **without** redesigning the selection/confirm/clear/revert flow.
- **FR-002**: Confirming the **Editor Panel** type MUST create an editor holding a **new, empty, in-memory
  document** with **no on-disk path**, immediately editable; the document is not written to disk until the
  user saves it (FR-020) — its content is meanwhile protected by recovery (FR-041).
- **FR-003**: The editor MUST be provided by a **well-known, cross-platform, embeddable code-editor
  component** with a capable programmatic API supporting both UI/menu actions and keyboard shortcuts,
  syntax highlighting extensible to new languages, and multiple concurrent instances, chosen to be
  **performant and light on resources**. The specific component is a planning decision (see Assumptions);
  the spec requires only these capabilities.
- **FR-004**: This feature MUST configure the editor for **plain-text editing only** (no syntax
  highlighting or language features enabled), while keeping the component capable of enabling those in a
  later increment (tracked as a roadmap deferral).
- **FR-005**: Multiple Editor Panels MUST be able to run concurrently in the same tab, project, and across
  sub-workspaces, each editing its own document (except when explicitly synced — FR-034).
- **FR-006**: An Editor Panel's type and its captured configuration MUST persist with the Panel in the
  per-project workspace layout (005 FR-007). Unlike a Terminal Panel, an Editor Panel **does NOT revert to
  the type-selection form**: the editor and its document are **inseparably bound to the Panel** — there is
  **no** independent "close document" action, and an editor is removed **only** by closing/destroying its
  Panel. (Opening a different file *replaces* the document — FR-014/FR-032 — which is not the same as
  closing it.) An Editor Panel therefore stays an editor for the life of the Panel.
- **FR-006a**: Closing or destroying an Editor Panel that holds **unsaved** content MUST **prompt** the
  user first (save / discard / cancel), clearly naming the affected file. The **same prompt** MUST precede
  any deliberate action that would destroy one or more **dirty** editor Panels: destroying a **Tab**, and
  **deleting/removing a project or a sub-workspace**, that contains dirty editor Panels (listing the
  affected files). Choosing **save** MUST honour confinement (FR-021/FR-022); **cancel** MUST abort the
  action leaving everything unchanged. (This deliberate-destroy prompt is distinct from application close,
  which does not warn and relies on recovery — FR-040.)

#### One dedicated editor per tab & last-active-editor targeting

- **FR-010**: By default each project tab MUST allow a **single dedicated Editor Panel**; a tab MUST NOT
  auto-create more than one editor. Additional Editor Panels exist only when the user **explicitly** creates
  them (via the Panel-Type form, **Open In → Editor Here → New**, or **Keep changes and open in a new
  editor**, FR-032).
- **FR-011**: The system MUST track the **last active editor Panel** per tab. A click/Enter/Open-In-existing
  "open file" action MUST target that last active editor; if the tab has **no** editor Panel, the action
  MUST create the tab's dedicated Editor Panel and open the file into it.
- **FR-011a**: A given real file path MUST have **at most one editor buffer open at a time across the whole
  application** (any tab, project, or sub-workspace window) — the scope required for coherence with the
  machine-wide dirty-file lock (FR-028). When the user triggers opening a file that is **already open** in
  an editor **anywhere**, the system MUST **focus/activate that existing editor** (raising its window if
  needed) rather than loading a second, independent buffer of the same file. Consequently, every **Open In**
  target that would open a given file (FR-030) MUST be **disabled while that file is already open** in an
  editor. (A synced clone across views, FR-034, is the **same** single buffer — not a second one.)

#### Open a file from Files & Folders

- **FR-012**: A new **`editor.openOnClick`** setting MUST control whether left-clicking a file in the Files
  & Folders pane opens it in the last active editor, with values **single**, **double**, or **none**;
  **none** means the file opens only via the **Open In** menu (FR-030). The default is **single**.
- **FR-013**: Highlighting a file in the Files & Folders list and pressing **Enter** MUST open it in the
  last active editor, equivalent to a click-to-open. **Enter MUST NOT initiate a rename** on any item
  (file or folder). Pressing Enter on a **folder** MUST do nothing (folders have no Open action). When
  `editor.openOnClick = none`, **Enter still opens** the highlighted file (Enter is the explicit keyboard
  open; disabling click-to-open does not disable Enter-to-open).
- **FR-014**: Opening a file MUST route through the unsaved-editor prompt (FR-032) when the target editor
  holds unsaved content, and MUST respect ownership/confinement (FR-036) — a file may be loaded only into an
  editor that is allowed to own it.

  > **Repaired by feature 018 (2026-07-14).** This requirement was written correctly and implemented
  > incompletely: the LOAD path did not enforce what the SAVE path enforced. It compared the *unresolved*
  > path against the owner root (so a symlink inside a project resolved out of it and was still admitted),
  > it had no outside-all-projects branch (so a sub-workspace editor could load a project's file), and it
  > SKIPPED the check entirely when the owner root was unknown — turning a missing fact into permission.
  > A file could therefore be opened into an editor that would later REFUSE TO SAVE IT.
  >
  > 018 (US9) makes read scope equal write scope: one rule (`resolveDrop`), applied to the REALPATH-ed
  > path, in the main process, on every route in — the tree, an OS file drop, and restore-on-mount. A
  > refused load now reports `out-of-tree`, which is distinct from a missing file and is never suppressed
  > by the missing-file preference.

#### Active-pane focus model

- **FR-015**: The Files & Folders pane MUST be a focusable **active pane**: clicking anywhere in it MUST
  mark it active and apply a **visible, themeable highlight**, and clicking a Panel MUST move the active
  focus (and highlight) to that Panel.
- **FR-016**: While the Files & Folders pane is the active pane, **panel-level keyboard shortcuts** (Ctrl+S,
  Ctrl+Shift+S, and any editor/terminal panel shortcuts) MUST NOT be delivered to any Panel; the file
  list's own keys (navigation, Enter-to-open per FR-013) apply instead. When a Panel is active, panel
  shortcuts apply to that Panel as normal.

#### Saving (per-editor and Save-All), confined to owning tree

- **FR-020**: Pressing **Ctrl+S** while an **editor Panel is active** MUST save that editor's document to
  disk. A document with no path yet MUST prompt for a save location constrained per FR-021/FR-036. On a
  successful save the Panel becomes **clean** (unsaved indicators clear, FR-050) and its recovery temp file
  is removed (FR-043).
- **FR-021**: A **project-owned** editor MUST be saveable **only within its owning project's folder tree**;
  any attempt (including Save-As) to write outside that tree MUST be refused with a clear message.
- **FR-022**: A **sub-workspace-owned** editor MUST be saveable **only to a folder outside every loaded
  project's tree**; an attempt to save it into any loaded project's tree MUST be refused. (A sub-workspace
  editor that is a **synced clone of a project editor** is governed by the project owner's rules, FR-036.)
- **FR-023**: Pressing **Ctrl+Shift+S** MUST perform **Save All** across a scope set by a new
  **`editor.saveAllScope`** setting with values **current tab**, **current project**, or **all projects**,
  defaulting to **current project**. Save All MUST save every dirty **pathed** editor in scope (each subject
  to its own confinement rules), MUST **skip** brand-new **unpathed** documents rather than interrupting the
  bulk save with a modal prompt, and MUST then **report** the skipped unpathed editors as still needing a
  location. **Sub-workspace-owned editors** (which have no owning project) participate **only** in the
  **current tab** scope, by tab membership; the **current project** and **all projects** scopes cover
  **project-owned** editors only. A sub-workspace-owned editor outside the active tab is saved individually
  via Ctrl+S.
- **FR-024**: Save and Save-All are subject to the active-pane gate — see **FR-016** (the single source for
  "panel shortcuts do not fire while the Files & Folders pane is active"). *(Cross-reference, not a separate
  obligation.)*

#### Cross-platform text fidelity

- **FR-025**: The editor MUST detect and preserve a file's existing **text encoding** (including UTF-8
  with/without BOM) on save, not rewrite it silently; new documents MUST be saved as **UTF-8 without BOM**
  (the documented default), recorded on the document.
- **FR-026**: The editor MUST detect and preserve a file's existing **line-ending style** on save, editing
  only the lines the user changed rather than normalising every line. The editor MUST support the **CRLF,
  LF, and CR** line-ending styles. New documents MUST use the line ending given by the new
  **`editor.defaultLineEnding`** setting (FR-026a), recorded on the document.
- **FR-026a**: A new **`editor.defaultLineEnding`** setting MUST let the user choose the default line
  ending applied to **new** documents, with values **LF**, **CRLF**, and **CR**, defaulting to **LF**. It
  affects only new documents; existing files always preserve their own detected line-ending style on save
  (FR-026).
- **FR-027**: Encoding and line-ending detection/normalisation MUST sit behind the OS-agnostic core /
  platform abstraction where any OS-specific behaviour is involved (Principle II) and be covered by tests
  (Principle V).

#### Locking a dirty file against external modification

- **FR-028** *(revised 2026-07-06e — the hard lock was removed; see below)*: throng MUST **detect** external
  changes to an open editor's backing file rather than **lock** it (so other tools — git, formatters, builds
  — are never blocked). The coordinator watches each open document's file and reconciles: a **clean** editor
  **live-reloads** the new on-disk content (staying clean); a **dirty** editor shows a **one-shot,
  non-fatal "changed on disk" notice** (saving overwrites the external change — last-write-wins, like most
  editors; Revert loads the on-disk version); a file that **vanished** routes through the deleted-while-open
  path (FR-099). Detection MUST sit behind the OS file-watch abstraction (Principle II) and be
  integration-tested. **Rationale:** the earlier OS lock (a per-file PowerShell handle) stalled the main
  loop on each clean→dirty transition and broke external tooling; the recovery buffer already protects
  unsaved work, so a soft notice is the right trade-off.

#### Context menus: Open In, Send to Tab, unified Sync to Sub-workspace

- **FR-030**: The Files & Folders file context menu MUST provide an **Open In** submenu containing:
  (a) **OS File Explorer** — the existing reveal-in-OS action, **moved** under this submenu (removed from
  its previous top-level position, no duplication); (b) **Editor Here → New editor** or a list of existing
  editors in the **currently active tab**; and (c) **Other Tab → (list of tabs in the current project) →
  New Editor Panel** or a list of existing editors in that tab. All targets MUST be scoped to the **current
  project**. Any **Open In** target that would open a file **already open** in an editor MUST be **disabled**
  (FR-011a).
- **FR-031**: **Every** panel right-click menu (all panel types) MUST include **Send to Tab → New Tab**,
  which MUST perform the **same action** as dragging that Panel onto the tab-strip **+** button (a new
  active tab containing only that Panel, moved not copied — 005 FR-027).
- **FR-032**: Opening a file into an editor that holds **unsaved** content MUST present a prompt with
  exactly four choices, each clearly naming the affected editor and file: **Discard changes**, **Save
  existing and open** (in the same editor), **Keep changes and open in a new editor**, and **Cancel
  opening**. **Keep changes and open in a new editor** MUST create a new Editor Panel (FR-010 exception).
- **FR-033**: The **Sync to Sub-workspace** context-menu cascade MUST be **shared across all panel types**
  (Editor and Terminal) via common code (DRY, Principle VIII), presenting: **Sub-workspace → (New
  sub-workspace or existing sub-workspaces) → (New Tab or existing sub-workspace tabs) → (New Panel or list
  of existing editors in that tab)**. The existing Terminal Panel "Sync to Sub-workspace" menu MUST be
  updated to this same shape/behaviour.
- **FR-033a**: All **Open In**, **Send to Tab**, and **Sync to Sub-workspace** target lists MUST offer only
  destinations within the **current project** or an **appropriate sub-workspace**; no other project's tabs,
  panels, or editors may appear (Principle I).

#### Ownership, project isolation & sync (as terminals)

- **FR-034**: A **project-owned** Editor Panel synced into a sub-workspace (via the Sync menu, giving every
  view the **same panel id**) MUST have all its views **mirror one single document** — shared buffer
  content and shared dirty/saved state, with edits from any view applied to the one document — exactly as a
  synced Terminal mirrors one session (005 FR-021). There MUST NOT be a second independent buffer.
- **FR-035**: An Editor Panel belonging to a specific project MUST **never** exist in, or be moved/dragged/
  sent into, another project. This restriction MUST hold for drag-and-drop, **Send to Tab**, and **Sync**
  operations (Principle I; parallels the terminal ownership rules, 005 FR-026/FR-030).
- **FR-036**: A project's file MUST **never** be loaded into an editor owned by another project or by a
  sub-workspace, **except** when it originated in its own project and reached the sub-workspace via the Sync
  menu (FR-034). Directly opening a project A file into a project B / sub-workspace-owned editor MUST be
  refused.
- **FR-037**: A **sub-workspace-owned** Editor Panel (created in a sub-workspace, no owning project) MUST
  behave like a project editor except that its save confinement is "outside every loaded project" (FR-022)
  and it takes no project binding; it participates in destroy/close/recovery like other editors.
- **FR-038**: If the user attempts to create a project whose root folder would **contain a file currently
  open in a sub-workspace-owned editor**, the app MUST **prevent/defer** the project creation and instruct
  the user to **save and close that editor first** (a file cannot become project-owned while a
  sub-workspace editor holds it).

#### Unsaved indicators & editor pills

- **FR-050**: When any editor in a scope has **unsaved content**, a **red, themeable dot** MUST be shown:
  on the **Panel** to the **right of the panel name, before any pills**; on the **Tab** **between the tab
  name and the panel count**; and on the **project** **in place of** the current "loaded" indicator dot.
  All three dots MUST share **one identical themeable style**. The dot MUST clear when the scope has no more
  unsaved editors.
- **FR-051**: The project's existing **"loaded" indicator dot MUST be removed**; the unsaved dot (FR-050)
  then **occupies that same position** when the project has unsaved content, and nothing is shown there
  otherwise. Unloaded projects MUST keep their **greyed-out italic** styling and show **no** dot. *(This is
  the single source for the loaded-dot removal; FR-050's "in place of the loaded dot" refers to this
  position.)*
- **FR-052**: Each Editor Panel header MUST display, after the unsaved dot: a **panel-type pill**, then a
  **file pill** showing the **file name with its relative containing folder in brackets** (e.g.
  `main.ts (src/app)`); a new/unsaved document MUST show an appropriate placeholder name. The file pill
  MUST reuse the **terminal-flavour pill style**.
- **FR-053**: The unsaved indicator MUST reflect only genuine **user-pending changes**; the recovery temp
  file (FR-041) MUST NOT by itself cause an editor/tab/project to appear unsaved.

#### Auto-save

- **FR-060**: A new **`editor.autoSave`** boolean setting MUST, when **enabled**, automatically write an
  editor's changes to disk after a short **debounce** — the **`editor.autoSaveDebounceMs`** setting
  (documented default **500 ms**, injected per Principle X, not hardcoded) — after the user stops editing,
  so a saved file never sits in a pending state. It defaults to **disabled** (manual save). Auto-save MUST respect confinement
  (FR-021/FR-022) and MUST NOT auto-write an unpathed new document until the user has chosen a confined
  location.
- **FR-061**: Toggling `editor.autoSave` MUST take effect for subsequent edits without restart; disabling
  it MUST restore the manual pending-changes behaviour.
#### Large-file open guard

- **FR-062**: Opening a file larger than the injected **`editor.maxOpenFileBytes`** threshold (documented
  default 10 MiB, Principle X — not hardcoded) MUST report it as **too large** rather than opening it (the
  "very large file" edge case), so the UI never hangs; files at or below the threshold open responsively.

#### Crash/close recovery (temp files)

- **FR-040**: Closing the application while editors hold **unsaved** content MUST NOT warn the user about
  the editors (this is standard behaviour with no setting). (The terminal running-process app-close warning,
  005 FR-015e, is unaffected and still applies to terminals.)
- **FR-041**: Every open editor MUST have a **recovery temp file** under `%APPDATA%\throng` to which its
  in-progress content is continuously written (regardless of `editor.autoSave`). Each editor document
  therefore has **two paths**: its **real target path** and its **recovery temp path**.
- **FR-042**: On application launch, editors that had recovery temp content from a prior session MUST be
  **restored** with that in-progress content and their real target path, so the user can resume editing.
- **FR-043**: A recovery temp file MUST exist **only while its document is open in an editor** and MUST be
  **removed once the document is fully saved** (or the editor is closed without unsaved content). Launch-time
  reconciliation MUST clean up temp files for documents that no longer need recovery.

#### Files & Folders rename fix

- **FR-070**: When an in-place rename in the Files & Folders pane is confirmed with the **name unchanged**,
  the app MUST treat it as a **no-op**: no rename is attempted and **no "file already exists" (or any)
  error** is shown. A confirm with a genuinely changed, valid name MUST still rename as before, and a real
  name collision with a **different** name MUST still surface the existing error.

#### Post-Delivery-E refinements (Session 2026-07-05b)

- **FR-071 (active-pane z-order)**: The **active Files & Folders pane highlight** (FR-015/SC-006) MUST render
  **above** the file-tree row **selection box** — the selection box MUST NOT overlay or obscure the pane
  border.
- **FR-072 (two open-into-editor menu targets)**: The file context menu's **"Open In"** group MUST offer
  **two** editor targets: **"Editor Here"** (opens the file into the tab's **last active editor**, reusing
  it — the same as the configured click action) and **"New Editor"** (opens the file into a **new dedicated
  Editor Panel**). Per the app-wide one-buffer rule (FR-011a), **"New Editor" MUST be disabled when the file
  is already open** in an editor anywhere; an already-open file focuses its one editor.
- **FR-073 (auto-save debounce default)**: `editor.autoSaveDebounceMs` default is **300 ms** (updates
  FR-060's documented default).
- **FR-074 (editor & terminal fonts themeable)**: The editor MUST render text using a **themeable font
  family, size, and style** exposed as theme typography role(s) (Principle X). The default monospace font is
  **`Consolas, 'Courier New', monospace`** at **14 px**. Terminals SHOULD likewise be themeable if the
  renderer permits it (per-flavour if feasible); the terminal styling path MUST be covered by an E2E that
  either verifies it applies **or** documents that terminals are not app-stylable, so the capability is
  never silently assumed.
- **FR-075 (editor Revert)**: The editor Panel's right-click (header) menu MUST include a **"Revert"** action
  that, **after a confirmation**, discards **all** unsaved changes and restores the document to its
  loaded/last-saved content (returning it to a clean state).
- **FR-076 (editor Panel Save menu)**: The editor Panel's right-click (header) menu MUST include a **"Save"**
  item that performs the same save as **Ctrl+S** (FR-013).
- **FR-077 (sub-workspace-owned editor save & destroy)**: A **sub-workspace-owned** editor (created inside a
  sub-workspace, belonging to no project) MUST be **saveable to any location outside every loaded project**
  and **destroyable at will**, from the **sub-workspace window** — the editor save/Save-All keybindings and
  the save/discard/cancel destroy prompt MUST be available there, not only in the main window. The
  new-Editor explanatory copy MUST be **context-aware** and MUST NOT tell a sub-workspace-owned editor to
  save "within this project".
- **FR-078 (visible save-refusal message)**: When a save is refused by confinement (a project-owned editor
  targeting outside its project tree, or a sub-workspace-owned editor targeting inside any project), the app
  MUST **surface a visible message** explaining why — never a silent no-op.

#### Post-Delivery-E refinements batch 2 (Session 2026-07-06)

- **FR-079 (drag a file into a new editor Panel) — WITHDRAWN (2026-07-06).** Originally: drag a file out of
  the tree to create a new Editor Panel with the same drag targets/indicators as a Panel drag. **Decision:
  NOT supported.** The Files & Folders tree uses react-arborist's HTML5 drag while workspace Panels use a
  `@dnd-kit` pointer drag + OS ghost window; the two are incompatible on one element, and "drop outside →
  new sub-workspace" is impractical for an HTML5 file drag. Opening a file into a chosen editor is instead
  fully served by the **"Open In"** context menu — **"This editor"** (FR-082), **"New Editor"** (FR-072),
  and **"Other Tab"** — so a file-to-Panel drag adds no capability that the menu lacks. Recorded in
  **Out of Scope**. (The tree's own internal file move/copy drag, incl. the Ctrl-copy cursor FR-081, is
  unaffected.)
- **FR-080 (in-tree drop onto the same folder is a no-op)**: Dropping a file **within** the Files & Folders
  tree onto **its own current parent folder** MUST be a **no-op with no "already exists" error**. A drop
  into a **different** folder MUST still surface the existing name-collision error when the destination
  already contains that name.
- **FR-081 (Ctrl-drag shows a copy cursor)**: Holding **Ctrl** while dragging a file in the tree (the
  copy modifier) MUST show a **copy cursor/indicator** during the drag.
- **FR-082 ("This editor" target + selected-editor disable)**: The file context menu's former **"Editor
  Here"** target MUST be renamed **"This editor"**, and it MUST be **disabled when the file is already open
  in the selected (target) editor** (opening it there would be a no-op). ("New Editor" keeps its FR-072
  disable-when-open-anywhere rule.)
- **FR-083 (default save name = Panel name; message even when unnamed)**: When saving a **new/unpathed**
  editor, the save-location chooser MUST **default the file-name field to the Panel's name**. The
  confinement/refusal message (FR-078) MUST also apply to **unpathed** saves — saving a not-yet-named editor
  MUST never silently do nothing.
- **FR-084 (Save As)**: The editor MUST offer a **"Save As"** action — both a **right-click editor-header
  menu item** and a **keyboard binding** — that saves the current document to a **newly chosen location**
  (subject to the same confinement as Save).
- **FR-085 (folder-in-brackets file pill + right-aligned owner text)**: An editor Panel MUST show the
  file's **containing folder in brackets** next to the file name. The project / sub-workspace **coloured
  owner text** MUST be **right-aligned** in the Panel header and **always visible**; when header space is
  constrained, the **folder-in-brackets text is truncated first** (the owner text wins).
- **FR-086 (New Folder in the tree menu)**: The Files & Folders right-click menu MUST include a **"New
  Folder"** action (creating a folder under the right-clicked folder / the root).

#### Post-Delivery-E refinements batch 3 (Session 2026-07-06b)

- **FR-087 (owner text right-aligned beside the panel controls)**: In every window (main and
  sub-workspace), a Panel's project / sub-workspace **owner text** MUST be aligned to the **right of the
  header, immediately beside the Panel controls** (not floating mid-header). (Supersedes/clarifies the
  right-alignment of FR-085.)
- **FR-088 (editor pill shows the fully-qualified path; per-ownership setting)**: An editor Panel MUST show
  the document's identity in the pill (not only the hover title). What it shows is governed by **two new
  `editor.` settings** (Principle X): **`projectPathDisplay`** and **`subWorkspacePathDisplay`**, each
  `'full' | 'name'` (default **`full`**). For a **project-owned** editor, `full` shows the **project-relative
  path rooted at `/`** — `"/"` for a file at the project root, `"/subfolder/"` for a nested file (the project
  folder name itself is NOT shown) — followed by the file name; `name` shows just the file name. For a
  **sub-workspace-owned** editor, `full` shows the **absolute path**; `name` shows just the file name. The
  directory prefix truncates first (the file name and owner text always win, FR-085/087).
- **FR-089 (context menus stay on-screen)**: A context menu MUST always render **fully within the window
  boundary**. When opened near an edge it MUST **flip** — appearing **above** the cursor when it would
  overflow the bottom and **to the left** when it would overflow the right (then clamped so no part is
  off-screen). This applies to **all** context menus in **any** window (main and sub-workspace).
- **FR-090 (blur commits a rename)**: Clicking away from an in-progress **inline rename** in the Files &
  Folders tree MUST **commit** the new name immediately (the same as pressing Enter), not cancel it.
- **FR-091 (drag highlights the destination folder)**: While dragging a file/folder in the tree, the
  **folder that would receive the drop MUST be highlighted**.
- **FR-092 (live copy/move drag cursor)**: While dragging a file/folder, the cursor MUST indicate the
  effect — a **copy (+)** indicator while **Ctrl** is held, otherwise a **move** indicator — and MUST
  **update live** as the modifier key is pressed and released mid-drag.
- **FR-093 (rename selects the name, not the extension)**: Entering inline rename on a file MUST pre-select
  only the **name stem**, not the extension (a file with a leading dot / no extension selects the whole
  name).
- **FR-094 (delete removes ALL selected items)**: Deleting a multi-selection of **files AND folders** MUST
  remove **every** confirmed item, not only the folders. A single un-deletable or already-removed item (e.g.
  a file inside a folder that was deleted first) MUST NOT abort the rest; genuine failures are reported once.
- **FR-095 (configurable Windows-style drag modifiers)**: Dragging within the Files & Folders tree MUST use
  **Windows-style** copy/move modifiers — **Ctrl-drag copies, Shift-drag (or no modifier) moves** — and the
  drag cursor MUST reflect this **live** as the key is pressed/released mid-drag. Which key copies and which
  moves MUST be **user-configurable** via two new `explorer.` settings **`dragCopyModifier`** and
  **`dragMoveModifier`** (`'ctrl' | 'shift' | 'alt'`, defaults `ctrl` / `shift`). (Supersedes the ambiguous
  copy-only FR-081/092: the built-in react-dnd Alt behaviour is overridden so the configured keys win.)
- **FR-096 (New File in the tree menu)**: The Files & Folders right-click menu MUST include a **"New File"**
  action that creates an empty file under the target (a folder → inside it; a file → its parent folder) and
  immediately enters **inline rename** on it (de-duplicated default name).
- **FR-097 (empty-space context menu)**: Right-clicking **empty space** in the Files & Folders pane (below
  the rows) MUST open a context menu targeting the **project root** — at minimum **New File**, **New
  Folder**, and **Open in file explorer** (plus Paste).

#### Post-Delivery-E refinements batch 6 (Session 2026-07-06d)

- **FR-098 ("Last Active Editor (<Panel>)" label)**: The file "Open In" target formerly labelled **"This
  editor"** MUST read **"Last Active Editor (<Panel name>)"**, naming the panel the file would open into
  (the active tab's last-active editor). (Supersedes the FR-082 label.)
- **FR-099 (deleting an open file marks its editor dirty)**: When a file that is **open in an editor** is
  deleted (directly, or under a deleted folder), that editor MUST be marked **dirty** while **keeping its
  buffer**. **Saving** it MUST write the buffer back to the **original location** (re-creating the file);
  **destroying** the editor/tab/project MUST go through the normal dirty save/discard/cancel prompt
  (FR-006a). The change MUST be reflected immediately (unsaved dot), including in a cross-window mirror.
- **FR-100 (detailed, re-raised, aggregated load-error dialog)** *(extended 2026-07-06f)*: The "Cannot open
  file" dialog MUST state **which file** (path) and **which panel** it concerns, and explain the file may
  have been moved/renamed/deleted with the save-to-recover option. It MUST appear **when a tab is opened or
  re-selected** while a file is missing — and **only then** (NOT on a panel drag/move or any other editor
  remount that doesn't change the active tab). All missing files on the (re-)opened tab MUST appear in a
  **single** dialog with the **same layout regardless of count** — intro text, then a **scrollable box** of
  **distinct bulleted** entries (each entry's **file name bold**, its directory path not); a single missing
  file just lists one entry (not a differently-shaped message).
- **FR-101 (OS-native path separators in the UI)**: Every path shown to the user — editor pill, hover
  **title**, headers, and dialogs — MUST use the **host OS's native separator** consistently: back-slashes on
  Windows (`C:\path\to\file.txt`), forward-slashes elsewhere (`/path/to/file.txt`). Mixed-separator strings
  (e.g. `D:\git/file.txt`, from joining a native root with `/`) MUST NOT appear.
- **FR-102 (a deleted-file editor restores its last content)**: Loading/restoring an editor whose backing
  file no longer exists MUST show the document's **last known content** (the dirty buffer if it was dirty,
  else the last-loaded content) rather than a **blank** editor, so it can be saved back. The recovery temp
  backing this MUST be written **promptly on deletion** and retained so the content survives an app restart.

#### Post-Delivery-E refinements batch 8 (Session 2026-07-06e)

- **FR-103 (remove the dirty-file lock)**: The hard OS dirty-file lock (original FR-028, `IFileLock` /
  `WindowsFileLock`) MUST be **removed** — it must never block external tools from writing an open file. Its
  replacement is the soft external-change detection now specified in the revised **FR-028**.
- **FR-104 (per-user data under `%APPDATA%\throng`)**: All Electron per-user data (recovery temps, window
  state) MUST live under **`%APPDATA%\throng`** — alongside the daemon's `throng.db` — not the dev-default
  `%APPDATA%\Electron`. Achieved by naming the app **"throng"** before any `getPath('userData')`.

#### Post-Delivery-E refinements batch 9 (Session 2026-07-06f)

- **FR-105 (opt out of the missing-file popup)**: A new `editor.` setting **`warnOnMissingFile`** (boolean,
  default **true**) MUST gate the aggregated "Cannot open file" dialog (FR-100). When **false**, a
  missing-file editor restores its recovered content silently (still dirty, still saveable) with **no**
  popup. The popup is raised by a **tab-activation watcher** (not per-editor mount), which is what makes the
  aggregation + the "only on tab (re-)open, never on a drag" guarantees hold.

#### Post-Delivery-E refinements batch 10-11 (Session 2026-07-06g)

- **FR-107 (consistent OS reveal menu item)**: The Files & Folders context menu MUST expose a single,
  top-level **"Open in OS File Explorer"** item for **both files and folders** (same label). The former
  duplicate inside the file "Open In" submenu MUST be removed — "Open In" holds only the editor targets.
  Existing enable/disable rules are unchanged.
- **FR-108 (project-neutral Browse button)**: The create-project form's **"Browse"** button MUST use a
  project-neutral colour (never the active project's `--accent`), at rest and on hover.
- **FR-109 (periodic terminal self-heal repaint)**: A **visible** terminal MUST be **periodically repainted**
  (xterm `refresh` from the buffer) to clear stale-render artifacts that a user otherwise fixes by resizing a
  panel. The repaint MUST be **non-destructive** — no change to content, scrollback, cursor, selection, or
  focus — so it never interrupts typing or work; **hidden** terminals (inactive tabs) are skipped.
- **FR-106 (re-pointing an editor drops the old file's recovery temp)**: When an editor is re-pointed at a
  **different** file (e.g. discard-&-open, opening another file into the last-active editor), UI main MUST
  **delete that panel's recovery temp** for the previous file (awaited, before the load returns). panelIds
  are stable across restarts, so a lingering temp holding the OLD file's content would otherwise be restored
  **over** the new file on a later launch. Verified by a two-session E2E; the "Open in New Editor" path
  (which creates a fresh panel) is covered by a separate regression that asserts the new editor shows the
  **clicked** file.

- **Editor Panel Type**: The registrable panel type "Editor", plugged into the 005 type catalogue. Carries
  its label, its (minimal) type-selection inputs, and its default/validation behaviour. Selectable in the
  Panel-Type dropdown.
- **Editor Document**: The text buffer **inseparably bound to an Editor Panel** (it cannot be closed
  independently of the Panel — FR-006). Carries its **content**, **dirty/saved state**, detected
  **encoding** and **line-ending** style, a **real target path** (may be empty for a new document), a
  **recovery temp path**, and its **ownership** (owning project id, or sub-workspace ownership with the
  "outside all projects" save rule). Holds an **OS lock on its backing file while dirty** (FR-028). Mirrored
  across views when the Panel is synced (FR-034).
- **Dirty-File Lock**: An OS-level lock throng holds on a document's backing file while the document is
  dirty and pathed (file-granularity analogue of the 005 project-root lock), preventing external
  modification; released on save or Panel destroy (FR-028), behind the OS abstraction (Principle II).
- **Editor Settings (`editor` category)**: New settings group with **`openOnClick`** (single/double/none,
  default **single**), **`autoSave`** (boolean, default off), **`autoSaveDebounceMs`** (number, default
  **300**, the injected auto-save debounce for FR-060/FR-073), **`saveAllScope`** (current tab / current project /
  all projects, default current project), **`defaultLineEnding`** (LF/CRLF/CR, default **LF**, applied
  to new documents only), **`maxOpenFileBytes`** (number, default **10485760** = 10 MiB; the injected
  threshold above which a file is reported too-large rather than opened, FR-062), the two pill path
  displays **`projectPathDisplay`** / **`subWorkspacePathDisplay`** (`full`/`name`, default **full**, FR-088),
  and **`warnOnMissingFile`** (boolean, default **true**; gates the missing-file popup, FR-105).
  Stored in the user's externalised config (Principle X).
- **Active Pane**: The currently focused top-level docking zone (Files & Folders pane or a workspace
  Panel). Determines whether panel keyboard shortcuts fire and drives the pane highlight.
- **Unsaved Indicator**: A shared, themeable dot representing "has unsaved editor content", rendered on
  Panels, Tabs, and projects (replacing the project loaded dot).
- **Recovery Temp File**: A per-open-editor file under `%APPDATA%\throng` holding continuously-mirrored
  in-progress content for crash/close restore; not itself an unsaved-state signal; removed on full save.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create an Editor Panel from the type form and begin typing into an empty document
  in **under 10 seconds**, and can have **multiple** editors open at once each editing independently.
- **SC-002**: With `editor.openOnClick` set to each of single/double/none, opening a file from the Files &
  Folders pane behaves per the setting in **100%** of cases; pressing **Enter** on a highlighted file opens
  it (never renames) in **100%** of cases and **never** renames a folder or file.
- **SC-003**: A project-owned editor is saved **only** within its project tree and a sub-workspace-owned
  editor **only** outside every loaded project, in **100%** of save/Save-As attempts (out-of-tree targets
  refused every time); **zero** files are ever written outside the allowed location.
- **SC-004**: Save All (Ctrl+Shift+S) saves exactly the editors in the configured scope (current tab /
  current project / all projects) in **100%** of invocations, touching no editor outside scope.
- **SC-005**: Editing and saving files with different encodings (UTF-8 with/without BOM) and line endings
  (LF/CRLF) preserves the original encoding and line-ending style on untouched lines in **100%** of cases —
  **zero** silent corruption or whole-file line-ending churn.
- **SC-006**: While the Files & Folders pane is active, a panel shortcut (e.g. Ctrl+S) acts on a Panel in
  **0%** of cases; once a Panel is active, its shortcuts act on it in **100%** of cases; the active pane is
  always visibly highlighted.
- **SC-007**: The unsaved red dot appears on the Panel, Tab, and project whenever the scope holds unsaved
  editor content and clears when it does not, in **100%** of cases; the project "loaded" dot is present in
  **0%** of sessions after this feature (replaced by the unsaved dot); all dots share one style.
- **SC-008**: Every Editor Panel header shows the type pill and a `filename (relative folder)` file pill in
  the terminal-flavour style in **100%** of cases.
- **SC-009**: With `editor.autoSave` **off** (default), an edited saved file stays pending until Ctrl+S in
  **100%** of cases; with it **on**, the file is written within the debounce window with no explicit save in
  **100%** of cases, respecting confinement.
- **SC-010**: Opening a file into an editor with unsaved content presents the four-choice prompt (naming the
  editor/file) in **100%** of such cases, and each choice produces its defined outcome with **zero** silent
  loss of unsaved work on Cancel/Keep.
- **SC-011**: A project editor synced into a sub-workspace shows **one** document across all views in
  **100%** of cases (edits and dirty state mirror; never a second buffer). A project's file is loaded into
  another project's or a sub-workspace-owned editor in **0%** of direct-open attempts.
- **SC-012**: Creating a project whose root contains a file open in a sub-workspace-owned editor is blocked
  with the save-and-close instruction in **100%** of cases (the file never becomes project-owned while held
  by a sub-workspace editor).
- **SC-013**: Closing throng with unsaved editors shows an unsaved-editor warning in **0%** of cases, and on
  relaunch every affected editor is restored with its in-progress content in **100%** of cases; a recovery
  temp file remains for **0%** of fully-saved documents (removed on save) and influences the unsaved
  indicator in **0%** of cases.
- **SC-014**: Confirming a Files & Folders rename with the **unchanged** name shows an error in **0%** of
  cases and leaves the item untouched; a real rename with a changed valid name still succeeds in **100%** of
  cases.
- **SC-015**: The **Open In**, **Send to Tab → New Tab**, and unified **Sync to Sub-workspace** menus behave
  as specified, offer only current-project/appropriate-sub-workspace targets in **100%** of cases, and the
  Terminal Panel's Sync menu is driven by the **same shared code** as the Editor's (verified by design
  review / a shared-component test).
- **SC-016**: Adding the Editor type required **no change** to the 005 type-selection form's shared
  selection/confirm/clear/revert flow (verified by design review / the type-registration seam) — only the
  new type's own inputs and body.
- **SC-017**: Every user-facing behaviour above is covered by passing **end-to-end tests** through the
  running application before the feature is considered complete (Constitution Principle V; UI-changes-need-
  E2E rule).
- **SC-018**: Closing/destroying a **dirty** Editor Panel, a Tab containing dirty editors, or **deleting a
  project/sub-workspace** containing dirty editors presents the save/discard/cancel prompt (naming the
  file(s)) in **100%** of such cases; **cancel** leaves everything unchanged and unsaved work is lost only
  after an explicit **discard** (never silently).
- **SC-019**: A given file path is open in more than one editor buffer across the entire application in
  **0%** of cases; opening an already-open file focuses the single existing editor in **100%** of cases.
- **SC-020** *(revised 2026-07-06e)*: External processes are **never** blocked from writing an open file
  (no lock). When a dirty document's backing file changes on disk, throng surfaces a soft "changed on disk"
  notice in **100%** of cases (once per external change); a clean document's external change is live-reloaded
  in **100%** of cases; the unsaved buffer is never silently lost.
- **SC-021**: An editor Panel belonging to a project is loaded, dragged, Sent-to-Tab, or Synced into
  **another** project in **0%** of attempts (cross-project moves are refused; FR-035).
- **SC-022**: Each specified editor **edge case** — a non-text/binary file, a too-large file, a
  clean file deleted/moved on disk, and an invalid/unwritable save target — is handled gracefully (clear
  indication, buffer never corrupted or silently lost) in **100%** of cases, never hanging the UI.

## Assumptions

- **Editor component is a planning decision**: The spec requires a well-known, cross-platform, embeddable,
  multi-instance, performant editor with syntax-highlighting extensibility and a full UI+keyboard API, but
  does **not** name it — the concrete choice (e.g. a CodeMirror- or Monaco-family component; note earlier
  throng features embedded a Monaco-based placeholder body) is selected in `/speckit-plan` research against
  these criteria and the constitution's "reuse components, not the whole IDE" constraint. This first pass
  configures it for **plain text only**.
- **Plain-text-first, rich-later**: Syntax highlighting, language features, and other "fancy" editing are
  explicitly **out of scope** for this feature and tracked as the existing ROADMAP "Rich code editors"
  item; the component chosen must not foreclose them.
- **`editor.openOnClick` default = single** (clarified 2026-07-05): a single left-click on a file opens it
  in the last active editor. Changeable via settings (single/double/none).
- **`editor.saveAllScope` default = current project**, **`editor.autoSave` default = off** — both per the
  user's explicit statements.
- **One buffer per file; already-open focuses the existing editor** (clarified 2026-07-05): a file is never
  opened into two independent buffers — re-opening focuses the existing editor, and Open In targets for an
  already-open file are disabled (FR-011a).
- **Editor and Panel are inseparable** (clarified 2026-07-05): unlike a terminal, an Editor Panel has no
  "close document" / revert-to-form step — the editor lives and dies with the Panel; removing it means
  closing/destroying the Panel, which prompts to save when dirty (FR-006/FR-006a). Opening a different file
  replaces the current document (US9), it does not "close" the editor.
- **Dirty files are locked, not merely watched** (clarified 2026-07-05): rather than detect-and-warn on
  external change, throng OS-locks a document's backing file while it is dirty and pathed, released on save
  or Panel destroy (FR-028) — reusing the 005 lock pattern at file granularity.
- **Enter always opens (never renames)**: Enter on a highlighted **file** opens it even when
  `openOnClick = none` (Enter is the explicit keyboard open); Enter never triggers rename and folders never
  open (FR-013). Rename remains available via the existing rename affordance (e.g. F2 / context menu), just
  not via Enter.
- **"Last active editor" is per active tab**: Opening from the file tree targets the last focused Editor
  Panel in the currently active tab; if none exists, the tab's single dedicated editor is created (FR-011).
- **Ownership mirrors the 005 terminal model**: Project vs sub-workspace ownership, the same-panel-id sync/
  mirror semantics, the one-directional destroy cascade, and drag/send restrictions reuse the terminal
  ownership rules and (where possible) shared code rather than a parallel implementation.
- **Recovery temp files live under `%APPDATA%\throng`** (the existing SQLite/app-data root, distinct from
  the `.throng` JSON config root) and are continuously written regardless of the auto-save setting; they are
  reconciled and cleaned at launch and on full save.
- **Encoding/line-ending defaults are decided** (clarified 2026-07-05): new documents are UTF-8 **without
  BOM** with the line ending given by **`editor.defaultLineEnding`** (default **LF**; also CRLF/CR),
  recorded on the document; the editor supports CRLF, LF, and CR. Existing files always preserve their own
  detected encoding and line-ending style on save (FR-025/FR-026).
- **Save-location prompts are confined by construction**: The save-location chooser for a new/unpathed
  document is constrained to the allowed tree (project tree, or "outside all projects" for a
  sub-workspace-owned editor) rather than validating after the fact where practical.

## Out of Scope

- Any panel type other than **Editor** (and the already-shipped Terminal); the type system already accepts
  more.
- **Syntax highlighting, language services, IntelliSense/completion, formatting, diffing, and other rich
  editing** — deferred to the ROADMAP "Rich code editors" increment (the component must remain capable of
  them).
- The **Markdown (`.md`) preview** capability (Principle I / 004 deferral) — a separate increment.
- The combined **edit list / change review** (Principle VII) reacting to editor-driven file changes.
- Terminal **presets** and other unrelated 005 backlog items.
- Multi-user, remote, or collaborative editing of the same document beyond the single-user same-panel-id
  sync mirror (FR-034).
- **Dragging a file out of the Files & Folders tree to create an editor Panel** (former FR-079, withdrawn
  2026-07-06) — the tree's HTML5 drag and the Panel's `@dnd-kit`/ghost drag are incompatible, and the
  "Open In" context menu ("This editor" / "New Editor" / "Other Tab") already covers opening a file into any
  chosen editor. Not planned.
