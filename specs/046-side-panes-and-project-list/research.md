# Research: Side Panes and Project List

**Feature**: 046 | **Date**: 2026-09-23 | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

Every finding here comes from reading the code at `e582b775`. Paths are repo-relative. Each item
uses the same format: **Decision**, **Rationale**, and **Alternatives considered**. Open items are
listed at the end.

---

## R1 — The four default chords, checked against FR-021

**Decision**: ship **Ctrl+Alt+PageDown** (`project.next`), **Ctrl+Alt+PageUp** (`project.previous`),
**Ctrl+Alt+F** (`focus.explorer`, replacing the spec's Ctrl+Alt+E) and **Ctrl+Alt+P**
(`focus.projects`). The replacement is recorded in spec.md under FR-021, as FR-021 requires.

**What a terminal would have received.** The window listener consumes these chords in capture
phase before xterm sees them (`packages/ui/src/renderer/app.tsx:316`, registered at `:553`), so the
question FR-021 asks is what the shell would have got otherwise. xterm.js encodes Ctrl+Alt+letter
as `ESC` followed by the control character, i.e. Meta-Ctrl-letter
(`node_modules/@xterm/xterm/src/common/input/Keyboard.ts:325-337`, `keyCode - 64` when `ctrlKey`).
Ctrl+Alt+PageUp and PageDown arrive as `CSI 5;7~` and `CSI 6;7~`.

| Chord | bash / readline (Git Bash, WSL) | zsh (WSL) | fish (WSL) | PSReadLine (pwsh 5 and 7) | cmd | AltGr layouts | Verdict |
|---|---|---|---|---|---|---|---|
| Ctrl+Alt+PageDown | unbound | unbound | unbound | unbound | no line-editor meaning | no character on any layout (not a character key) | **pass** |
| Ctrl+Alt+PageUp | unbound | unbound | unbound | unbound | none | none | **pass** |
| Ctrl+Alt+E | **M-C-e = `shell-expand-line`** (Bash Reference Manual, *Miscellaneous Commands*) | unbound | unbound | unbound | none | **€** on German, French, Spanish, Italian, Portuguese, Nordic, Czech, Slovak and Croatian; **ę** on Polish Programmer; **é** on US-International and UK Extended | **fail** (both tests) |
| Ctrl+Alt+P | unbound | unbound | unbound | unbound | none | **ö** on US-International. No character on the other layouts checked | **pass** (see below) |
| Ctrl+Alt+F (replacement) | unbound | unbound | unbound | unbound | none | **[** on Czech, Slovak, Hungarian, Croatian and Slovenian. Free on US, US-International, UK, German, French, Nordic and Polish | **pass** |

**Why an AltGr hit on P and F is a pass, not a fail.** FR-021's AltGr test is whether the chord
*stops a character being typed*. It cannot here, by construction. A letter chord is matched on the
**produced** key (`chordKey` returns `e.key` for everything except the backtick,
`packages/ui/src/renderer/config/chord-key.ts:15-22`). On an AltGr layout, Ctrl+Alt+P therefore
arrives as `e.key === 'ö'`, builds the token `Ctrl+Alt+ö`, matches nothing, and the character is
typed. The cost is that the chord is **dead** on that layout, and the user can rebind it. Ctrl+Alt+E
fails anyway, on bash alone.

The shipped `Ctrl+Alt+B/N/T/M/W` chords already accept the same trade. Ctrl+Alt+N is ñ on
US-International and `}` on Czech. No spec before this one names AltGr at all (searched
`specs/*/spec.md`, `research.md` and `plan.md`). This feature is the first to write the rule down.

**Why F.** Mnemonic: "File". The candidates were every letter not already in throng's `Ctrl+Alt`
family (`B N T M S W`, the arrows, `0 = + -`, Enter; `packages/core/src/config/keybindings.ts:341-490`)
and not bound as Meta-Ctrl in readline or zsh. Readline binds `M-C-e/g/h/i/j/m/r/y`; zsh binds
`^[^D/G/H/I/J/L/M/_`. X is Polish ź and `#` on Czech and Hungarian. H and J are readline bindings.
F collides only on the Central-European group, and there only as a dead chord.

**Alternatives considered**
- *Ctrl+Alt+Home / Ctrl+Alt+End* (never a character on any layout). Rejected: an RDP client in full
  screen captures both (Ctrl+Alt+End is the remote Ctrl+Alt+Del), and neither is memorable for "File
  Explorer".
- *Ctrl+Shift+E*, VS Code's chord. Rejected: FR-021 requires the replacement to be a `Ctrl+Alt`
  chord.
- *Keep Ctrl+Alt+E and treat bash's `shell-expand-line` as shadowable*. Rejected: Principle IV makes
  Meta-Ctrl-E a recorded exception at best, and FR-020 requires the exception list to stay at four.

**Verification that could not run here.** A live `bind -p` in Git Bash was refused by this session's
worktree guard, so the bash row comes from the Bash Reference Manual's documented defaults, not from
a shell. [quickstart.md](./quickstart.md) §2 has the one-line check to run by hand.

**Correction (recorded at implementation; live O3 check, `bind -p` in Git Bash, 2026-09-23).** Two
claims above were wrong. (1) M-C-f is **not** unbound: readline binds `"\e\C-f"` to
`shell-forward-word`, and `"\e\C-e"` to `shell-expand-line` as stated; nothing is bound on
`"\e\C-p"`, `CSI 5;7~` or `CSI 6;7~`. (2) The "ESC followed by the control character" premise does
not hold in throng: on Windows, xterm.js treats Ctrl+Alt+letter as AltGr (third-level shift) and
sends only a produced character, never `ESC ^F`, and the window listener captures the chord first
anyway. So the table's Meta-Ctrl cells describe a byte sequence throng never sends. Ctrl+Alt+F
ships: no user loses `shell-forward-word` to it (Esc then Ctrl+F still reaches it). Ctrl+Alt+E stays
rejected on the AltGr € collision alone. Recorded in spec.md under FR-021.

---

## R2 — Ctrl+Shift+0: physical-key matching for the digit keys (FR-025 – FR-027)

**Decision**: the window listener builds up to **two** candidate tokens for a keydown and resolves
the first one that names a command.

1. **Physical digit token**, only when all three hold: `e.code` is `Digit0`–`Digit9`, Ctrl is held,
   and **Alt is not held**. Its key is the digit from the code, and it **keeps Shift**. So
   Ctrl+Shift+0 gives `Ctrl+Shift+0` on any layout.
2. **Produced token**, exactly as today: `chordKey(e)`, with the existing Shift rule
   (`app.tsx:339-352`).

A new pure helper in `packages/ui/src/renderer/config/chord-key.ts` (`chordCandidates(e)`) returns
the list. `app.tsx`, the Preferences capture modal (`preferences/capture-modal.tsx:35`) and the test
helper that mirrors the Shift rule (`packages/ui/tests/shared/window-chords.ts:100-102`) all move to
it together.

**Rationale**
- *Why it is needed.* Ctrl+Shift+0 produces `)` on US and UK layouts. Shift is dropped for
  non-letters, so the token is `Ctrl+)` and matches nothing.
- *Only `Digit0`–`Digit9`.* FR-026 says "digit-row key", but the Minus and Equal keys sit on that row
  too. Matching those physically would turn German `Ctrl+ß` (the Minus-code key) into zoom out, a new
  meaning that FR-022 forbids. It would also turn Ctrl+Shift+= into `Ctrl+Shift+=`, which the
  produced fallback then has to rescue. Keeping those two keys on produced matching is how FR-026's
  second sentence ("Ctrl++ and Ctrl+= … Ctrl+- keep matching") holds without special cases.
- *Physical first, produced second.* Several layouts put `+` on a Shift+digit: Swiss (Shift+1),
  Hungarian (Shift+3), and Czech, where `+` is unshifted Digit1. Produced-only fails Ctrl+Shift+0.
  Physical-only would lose Ctrl++ on all three. Trying both, physical first, keeps every match that
  works today and adds the new one. Physical wins a tie so that a user's explicit `Ctrl+Shift+N`
  binding outranks a produced-character reading, which is also what the capture modal records.
- *Never with Alt held.* On AltGr layouts, Ctrl+Alt+digit is how characters are typed: `}` is
  AltGr+0 on German, `@` is AltGr+0 (the à key) on French AZERTY, `{` is AltGr+7 on German. Matching
  those physically would make `Ctrl+Alt+0` (`panel.zoomReset`) swallow `}` and `@` in every editor
  and terminal. FR-021 names exactly that collision. With Alt held, matching stays produced-only and
  is unchanged from today. This is how the plan reads FR-026 alongside FR-021 (open item O2).
- *Capture modal.* Pressing Ctrl+Shift+0 in the key binder records `Ctrl+Shift+0`, not the
  unmatchable `Ctrl+Shift+)`. That is required for US3 scenario 3 to round-trip.

**Alternatives considered**
- *Add `Ctrl+)` as the default.* Rejected: it is US and UK only, which is the defect FR-026 is
  written against.
- *Physical matching for every key* (VS Code's `keyCode` dispatch). Rejected: it would change what
  every letter chord means on AZERTY and QWERTZ, and FR-022 forbids that.
- *Detect AltGr with `getModifierState('AltGraph')`.* Rejected as the only guard. Chromium on Windows
  reports it for right-Alt, but a left-Ctrl+left-Alt emulation does not reliably set it. "Alt held"
  is the stronger condition and costs nothing, because no Ctrl+Alt+digit chord needs physical
  matching.

---

## R3 — The Projects pane becomes a focus target, with a sixth dispatch scope (FR-015)

**Decision**
- `ActivePane` becomes `'files' | 'workspace' | 'projects'`
  (`packages/ui/src/renderer/workspace/active-pane.ts:11`).
- `DispatchScope` gains a sixth member, **`projects`**, which is added to `EVERYWHERE` and nothing
  else (`packages/core/src/config/keybindings.ts:169,180`).
- `SCOPE_NAMES` and `SCOPE_ORDER` gain `projects: 'Projects'` (`:690,700`), so that "Everywhere"
  still collapses to a single pill.
- `currentScope` returns `'projects'` when the active pane is `projects`
  (`packages/ui/src/renderer/keybindings/scope.ts:55-58`).

**Rationale.** The spec's Assumptions reuse the non-workspace scope "unless the plan finds a command
that needs a scope of its own". The plan found five. Today `currentScope` returns `'explorer'` for
any pane that is not the workspace, and `explorer` is where `file.rename` (F2), `file.delete`
(Delete), `file.cut`, `file.copy` and `file.undo` are live (`keybindings.ts:281-287`).

With the Projects pane in that scope, **F2 on a project row would rename the File Explorer's
selected file, and Delete would delete it.** That is the defect 043 R14 found for Find in Files and
044 R16 found for previews, one pane along. It is fixed the same way: a scope of its own, joined to
`EVERYWHERE` only, so zoom, focus movement, the view toggles, the new commands and `menu.open` all
stay live. FR-015 asks for "a scope in which no text-editing command is live", and `projects`
satisfies that by construction.

**The outline** reuses the File Explorer's mechanism: a `--active` modifier on the pane body, drawn
as the `::after` overlay in `packages/ui/src/renderer/panes/panes.css:41-48`, with
`--active-pane-colour`. The active pane becomes `projects` on `pointerdown` **and** on `focusin` in
the Projects panel. `focusin` matters because `focus.projects` moves focus without a pointer. The
File Explorer gets the same `focusin` hook. Today only `pointerdown` sets `files`
(`file-explorer-pane.tsx:58`), which would leave FR-017's "file.* commands act with no click in
between" false after `focus.explorer`.

**Alternatives considered**
- *Reuse `explorer`, and guard `file.*` with "is the tree focused?"* Rejected: it is the ad-hoc guard
  `scope.ts:5-8` was written to retire.
- *A `sidebar` scope shared with the Sub-workspaces panel.* Rejected (YAGNI): nothing in scope focuses
  the Sub-workspaces panel.

---

## R4 — Keyboard model inside the Projects pane (FR-018, FR-030)

**Decision**
- The list becomes an ARIA **tree** with roving tabindex. Category headers are `treeitem`s at
  `aria-level=1` carrying `aria-expanded`. The default category's header carries none, because it
  cannot collapse. Projects are `treeitem`s at `aria-level=2`.
- The component handles, itself: ArrowUp and ArrowDown (one row), Home and End, Enter (switch to the
  project, or toggle a non-default header), and Space on a header.
- The selection is a **focused-row** pointer, separate from the active project. Moving it never
  switches (FR-018).
- Shift+F10 and the ContextMenu key reach the row through the existing `menu.open` dispatch
  (`app.tsx:510-546`). It already redirects the synthetic `contextmenu` for the tree's focused row.
  This feature adds the same redirect for `[data-project-row-focused]`.

**Rationale.** A group that collapses is what `role="tree"` and `aria-expanded` exist for. A listbox
cannot make its group headers focusable. The keys are navigational input, and Principle VI exempts
those from the menu rule. As in the File Explorer tree (react-arborist's own arrows), they are not
rebindable commands. That keeps the keybindings editor free of four rows nobody would rebind.

**Alternatives considered**
- *Rebindable `projects.selectNext` and similar commands.* Rejected: no precedent, and the spec's
  Out-of-scope excludes keyboard commands for managing the list.
- *ArrowLeft and ArrowRight to collapse and expand.* Not added. FR-018 names the keys it requires,
  and Enter and Space already toggle a header.

---

## R5 — Cycle semantics (FR-011 – FR-014)

**Decision**
- A pure core module, `packages/core/src/projects/project-list.ts`, owns the list model.
  - `listRows(projects, categories, activeId)` gives the visible rows in list order.
  - `reachableProjectIds(...)` gives every project that is listed and not hidden. The active one
    always counts (FR-052).
  - `stepProject(reachable, activeId, ±1)` gives `string | null`.
- The command dispatcher calls `switchProject(id)`, the same store call a click makes
  (`packages/ui/src/renderer/state/projects-store.tsx:231-253`). That covers FR-014.
- **With no active project**, `project.next` goes to the first reachable project and
  `project.previous` to the last.

**Rationale.** The spec does not cover the no-active case. After FR-036 unloads the active project,
a chord that did nothing would look broken, and there is no "end" to stop at when nothing is
selected. FR-011's no-op rule still holds at the real ends and with zero or one reachable project.
The cog menu enables or disables Next and Previous from the same `stepProject` result (FR-019), so
the menu and the chord cannot disagree.

**Alternatives considered**: do nothing when no project is active. Rejected, for the reason above.

**Reading of FR-011 (analysis I1).** FR-011's "zero or one reachable project → do nothing" governs
when a project is active. With no active project and exactly one reachable project, both commands
switch to it, because there is nothing to stop at. Recorded under FR-011 in spec.md.

---

## R6 — What "reveal" means for the focus commands (FR-016)

**Decision**
- `focus.projects` calls the same setter as the left pane's show control: `usePersistedBool`
  `throng.sidebarVisible`, reached through `toggleLeft`'s show branch (`app.tsx:791-905`).
- `focus.explorer` does the same for the right pane. That is `throng.explorerVisible`, or
  `throng.explorerVisibleNoProject` when no project is open, which is the key the show control writes
  in that state.
- Both are exposed from `App` as `revealLeft()` / `revealRight()`. They are idempotent, so they never
  toggle a visible pane closed.
- After the reveal renders, focus lands on:
  - the active project row, or the first row, or the create control with no projects (spec Edge
    Cases);
  - the tree's selected node, or its first node, through react-arborist's `focus`
    (`packages/ui/src/renderer/explorer/file-tree.tsx:595-624`);
  - with no project open, the File Explorer's empty placeholder.

**Rationale.** FR-016 says the reveal is "the same state change the pane's show control makes, so it
persists the same way". Reusing the setter makes that literally true. A pane auto-collapsed to its
rail by the ResizeObserver (`autoLeft` / `autoRight`, `app.tsx:801-886`) is revealed the way a click
on the rail reveals it.

---

## R7 — Unload: what it releases and how (FR-032 – FR-038)

**Decision.** One renderer orchestrator, `packages/ui/src/renderer/sidebar/unload-project.ts`,
receives its collaborators as parameters, following the `projects-panel.tsx` `confirmDelete` shape.
It runs these steps:

1. **Unsaved guard (FR-035).** This is exactly Remove's first step (`projects-panel.tsx:233-272`):
   `dirtyProjects.has(id)`, then `promptDirtyClose(name, [])`, then save through `editor.saveAll`,
   or discard, or cancel.
2. **Terminal plan (FR-034c).**
   - Ask the daemon which sessions are busy: `terminal.list {projectId, includeBusy: true}`
     (`packages/ipc-contract/src/terminal.ts:256-300`), excluding sub-workspace panels (step 5).
   - Name each busy session from the live foreground command in `terminal/command-store.ts`
     (`peekTerminalCommand`), falling back to the panel's title.
   - Choose the dialogs with `planUnload(...)` (R8).
3. **Release the view.** If the project is active, `openedId` becomes `null` (FR-036). The workspace
   effect (`workspace-store.tsx:294-400`) then flushes pending layout saves and sets the layout to
   null. The views unmount and send `terminal.detach`, exactly as a switch-away does. Nothing is
   deleted from the saved layout (FR-033).
4. **Release editors.** Call `disposeEditor(panelId)` (`editor/use-editor.ts:2058`) for every editor
   state owned by the project (`allEditorStates()` filtered on `ownerProjectId`), except panels held
   by a sub-workspace. This is the same teardown a panel destroy performs. The next load re-reads
   each file from disk.
5. **Terminals.** Pass the panels to spare as `exceptPanelIds`, computed by a new core helper
   `projectPanelIdsInSubWorkspaces(projectId, subWorkspaces)` beside
   `findProjectPanelsInSubWorkspaces` (`packages/core/src/workspace/destroy.ts:72-95`).
   - Keep running: `terminal.closeIdle {projectId, exceptPanelIds}`.
   - End terminals: `terminal.killAll {projectId, exceptPanelIds}`.
6. **Mark unloaded.** `unmarkLoaded(id)` in the projects store. It becomes a public `unloadProject`
   that combines `unmarkLoaded` with clearing `openedId` when the project is active.

*Step order superseded by [contracts/unload.md](./contracts/unload.md) §2, which is the authority:
mark-unloaded happens with the view release, before the terminal call.*

**Daemon changes (additive).** `terminal.closeIdle` and `terminal.killAll`
(`packages/daemon/src/terminal-service.ts:896-926`) gain optional `exceptPanelIds: string[]`. When
scoped to a project they also skip `rootless` sessions, as `killForProject` already does (`:349-360`).
Both RPCs already exist:
- `closeIdle` is documented as "used on project/app close", but **has no UI caller today**. This
  feature is its first.
- `killAll` is what app close's "Terminate all" sends.

**Rationale**
- *Principle III, Keep running.* This is `closeIdle` word for word. A busy session is spared by the
  daemon's own `isBusy` check, which runs at action time. That answers the spec's Edge Case "a
  process exits while the dialog is open" with no renderer race: the daemon decides at the moment it
  acts. Reattach is the existing `terminal.attach {explicit:false}` path (`terminal.ts:130-164`),
  which is what US4 scenario 7 exercises.
- *Principle III, End terminals.* The kill goes through `host.kill`, the same call app close's
  Terminate-all path makes. The panels are closed with it, so no view outlives its process.
- *FR-037.* `closeIdle` and `killAll` filter on `projectId` alone today. A panel of the project that
  is open in a sub-workspace window shares that `projectId`, so without `exceptPanelIds` Unload would
  close its terminal. The daemon does not know which window a view belongs to, and the renderer
  does, which is why the renderer computes the exclusion. The same reasoning applies to editors
  (step 4).
- *The daemon's `is_active`* is left alone when the active project is unloaded. Startup never opens
  it (`projects-store.tsx:82-86`), so clearing it would be a write with no effect.

**Alternatives considered**
- *A new `projects.unload` RPC in the daemon.* Rejected: the daemon holds no editors and no view
  state, so it could do only step 5, and step 5 is two existing RPCs with one new optional field.
- *The renderer lists sessions and kills the idle ones one by one.* Rejected: a session can become
  busy between the list and the kill, and the rule "never kill a running process on Keep running"
  would then depend on timing.

---

## R8 — The unload dialogs, and the menu's variant rows (FR-034a – FR-034d, Principle VI)

**Decision**
- **Planner.** `planUnload({level, defaultAction, busyCount, variant?})` in
  `packages/core/src/workspace/unload.ts` returns the step list. It is pure and sits beside
  `planConfirmations` (`destroy.ts:41-57`).
  - With `busyCount === 0` it returns no dialog.
  - With `level: 'none'` it returns no dialog and uses the default action.
  - With `single` it returns one choice dialog.
  - With `double` it returns the choice dialog, and a second confirmation after **End terminals**
    only.
- **Choice dialog.** It uses the existing n-way `useChoose` from `confirm-dialog.tsx`, with the
  `details` slot listing the busy processes. Its buttons are Keep running, End terminals and Cancel.
  Initial focus is on the button for `projects.unloadTerminalAction`.
- **Second confirmation.** It reuses the wry wording of the other double confirmations: *"Are you
  absolutely sure?"* with *"Yes, I'm absolutely sure"* and *"No, I concede"*
  (`projects-panel.tsx:233-272`), as FR-034b's "dialog wording and labels follow the other
  confirmations" requires.
- **Variant rows.** The project menu carries three unload rows: **Unload** (the plain item, which
  runs the preference), **Unload and Keep Terminals Running**, and **Unload and End Terminals**.
  - A variant row runs the same dialog sequence as the plain item, with its own button focused
    instead of the preference's.
  - With the confirmation level at `none`, a variant row performs its action directly. That is the
    case the rule exists for.

**Rationale.** Principle VI's *"A preference picks the default; the menu offers every variant"*
applies here word for word: `projects.unloadTerminalAction` decides which variant the action
performs, so the menu MUST list each one by name, and the plain item MUST be labelled for the
action. Without the variant rows, a user with confirmations at `none` could end their terminals only
by visiting Settings. Adding rows does not contradict FR-030 – FR-032, which name what the menu
**must** offer, not all it may offer. FR-053 adds Move to Category in the same way.

Variant rows keep the dialogs so that SC-005a holds: with shipped defaults, no running process ends
without two explicit confirmations, whichever row was chosen.

**Alternatives considered**
- *Only the plain Unload row.* Rejected: it violates the constitution rule above.
- *Variant rows that skip the dialogs.* Rejected: *Unload and End Terminals* would then end processes
  on a single click at shipped defaults, which contradicts SC-005a.

---

## R9 — Persisting categories (FR-050 – FR-059)

**Decision**: migration **v9**, `packages/persistence/src/migrations/v9-project-categories.ts`,
registered in `migration-runner.ts:20-59`.

- **New table**:
  `project_categories (id TEXT PRIMARY KEY, owner_user TEXT NOT NULL, name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0, minimised INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT
  NULL, updated_at TEXT NOT NULL)`.
  - It is created with `CREATE TABLE IF NOT EXISTS`, plus `idx_project_categories_owner`.
  - A partial unique index `ON project_categories(owner_user) WHERE is_default = 1` makes "exactly
    one default" a database fact.
- **New column**: `projects.category_id TEXT NOT NULL DEFAULT ''`. It is registered in
  `ADDITIVE_COLUMNS` (`packages/persistence/src/schema-guard.ts:43-67`) and applied through
  `addColumnsFor`, because the guard's invariant requires every `ADD COLUMN` to go through it.
- **Backfill (idempotent)**:
  - For every `owner_user` in `projects`, insert a default category **only when that owner has
    none** (`INSERT … SELECT … WHERE NOT EXISTS`). Its name comes from
    `SHIPPED_DEFAULT_CATEGORY_NAME` in core (Principle X).
  - Then `UPDATE projects SET category_id = <default> WHERE category_id = ''`.
  - A re-run finds nothing to do.
- **Heal rule at read time.** A project whose `category_id` names no category of its owner belongs
  to the default category. `category_id = ''` covers a drift-healed column; a dangling id covers a
  delete interrupted halfway. Either way the project is never lost.
- **Default on demand.** `ProjectCategoryRepository.ensureDefault(owner)` runs inside `list` and
  `create`, so an owner with no projects yet (a fresh database) still gets one (FR-050: "MUST always
  exist").
- **Order.** `projects.position` stays a **global total order**, as `projects.reorder`
  (`packages/core/src/projects/project-service.ts:97`) already writes it. A category's projects are
  that order filtered to the category. Categories are ordered `is_default DESC, created_at, id`
  (FR-056). There is no category position column; reordering categories is out of scope (YAGNI).
- **Names.** Trimmed, non-empty, and unique per owner by `trim().toLowerCase()` (changed at
  implementation from `toLocaleLowerCase`, to match data-model §1 and keep the answer independent of the
  machine's locale; recorded at implementation). This is checked
  in core `ProjectCategoryService` and refused with an `RpcError`, the pattern
  `PROJECTS_UPDATE_METHOD` uses (`packages/daemon/src/project-service.ts:87-103`).

**RPCs (additive; `packages/ipc-contract/src/projects.ts`)**:

| Method | Params | Result |
|---|---|---|
| `projects.categories.list` | none | categories in list order |
| `projects.categories.create` | `{name}` | the new category |
| `projects.categories.rename` | `{id, name}` | the renamed category |
| `projects.categories.delete` | `{id}` | moves its members to default (appended after default's members, relative order kept) and deletes the row, in one transaction (FR-054); refused for the default |
| `projects.categories.setMinimised` | `{id, minimised}` | refused for the default |
| `projects.move` | `{id, categoryId, orderedIds}` | one transaction: set the category, then rewrite the global order (FR-055 and the menu's Move to Category) |

`ProjectDto` gains `categoryId: string`, which is always resolved and never `''`.

**Rationale**
- *Why the database and not localStorage.* Minimised state must survive a restart (FR-057), belongs
  to the project list, and must carry an owner key ("Per-user local storage", Technology &
  Architecture Constraints). Pane visibility lives in localStorage because it is window chrome, not
  data.
- *`''` rather than a nullable reference.* The guard's invariant requires `NOT NULL DEFAULT`, and a
  foreign key cannot be added by `ALTER TABLE` with a non-null default. The read-time heal rule is
  what makes `''` safe.
- *A global order rather than a per-category one.* It reuses `reorder` and its validation unchanged,
  and a category's order is derived rather than stored twice (DRY).

**Tests owed**
- `migration-v9.integration.test.ts`: fresh, from v8, re-run, interrupted mid-backfill.
- `migration-drift-repair.integration.test.ts` gains `projects.category_id`.
- `user-version-pin.integration.test.ts:36` moves **8 → 9**.
- Repository and service integration tests for delete-merges-order and case-insensitive uniqueness.

**Alternatives considered**
- *Store the category on the project as a free-text label.* Rejected: an empty category must still
  be listed (FR-056), and a rename would have to rewrite every project row.
- *A `category_position` column.* Rejected (YAGNI).

---

## R10 — Categories in the list (FR-051 – FR-061)

**Decision**
- Headers render from `listRows` (R5). Each is a row carrying a **chevron `IconButton`** (existing
  `chevron` token, rotated as `panes/chevron.tsx` already does) with the hover title "Minimise
  category" or "Expand category", the name, and a **count**.
- The count is formatted by the shared locale formatter, because it is a quantity (the digit-grouping
  gate).
- The default category's header draws **no** toggle and **no** Delete item. Both are structurally
  meaningless for it, so under *Disabled when unavailable, absent when meaningless* they are absent,
  not disabled. That matches US5 scenario 4.
- **Drag.** Each category section becomes a dnd-kit droppable, and so does a minimised header.
  `trackReorder` (`projects-panel.tsx:274-295`) learns the category of the slot it computes, and
  `onDragEnd` calls `projects.move` when the category changed and `reorderProjects` otherwise.
- **Active project in a minimised category (FR-052).** `listRows` emits the active row under the
  collapsed header with `data-pinned-active`. The rows disappear when the active project changes,
  because `listRows` is recomputed from `activeId`.

---

## R11 — Menus (FR-019, FR-030, FR-053; Principle VI section vocabulary)

**Decision**, with sections from `packages/core/src/workspace/menu-sections.ts`:

| Menu | content | destroy | navigate | viewState | application |
|---|---|---|---|---|---|
| Project row | Edit (`editVisual`), Rename (`rename`) | Remove (`destroy`) | — | Move to Category ▸ (`category`), Unload / Unload and Keep Terminals Running / Unload and End Terminals (`unload`) | — |
| Category header (non-default) | Rename Category (`rename`) | Delete Category (`destroy`) | — | Minimise Category ✓ (`collapse` / `expand`) | — |
| Category header (default) | Rename Category | — | — | — | — |
| Cog | — | — | **Next Project** (`moveDown`), **Previous Project** (`moveUp`), **Focus File Explorer** (`folder`), **Focus Projects** (`projectList`) | — | existing five |

- Move to Category ▸ lists every category except the project's own, then **New Category…**
  (`add`), which opens an inline name field in the list and then moves the project into it.
- **Cog chords.** The cog's Navigate items set `shortcut` from the live keybindings, so they show the
  user's current chord (Principle VI). Next and Previous are `disabled` from `stepProject` (R5).
- **Section pins.** `packages/ui/tests/unit/menu-sections.test.ts` gains `shapeOf` pins for the two
  new menus and the cog's new two-section shape. The cog gains its first divider.

**Rationale.** Move to Category and Unload are per-item *state* rather than content or destruction.
Unload removes nothing (FR-033), so it is not Destroy. Minimise is a toggle, and View & state is
where the vocabulary puts toggles.

**Icons.** Three new icon tokens are added: `unload`, `category` and `projectList`. No existing
token denotes those actions. The rest are reused. New tokens need `theme-copy.ts` descriptions,
`SVG_SHAPES` art (`packages/ui/src/main/icon-pack-service.ts:87`), and a `SHIPPED_DEFAULTS_VERSION`
bump from 11 to 12 (`packages/core/src/config/shipped-defaults.ts:181`, whose comment says new icon
tokens need one).

---

## R12 — The rename sweep (FR-001 – FR-004)

**Decision**
- Every occurrence under `packages/*/src`, `README.md`, `CONTRIBUTING.md` and `docs/` becomes "File
  Explorer". **Comments are included.**
- A new unit guard, `packages/ui/tests/unit/file-explorer-name.test.ts`, reads those trees and fails
  on any of the three spellings.
- Excluded, and why:
  - `specs/` and `.specify/memory/constitution.md`: FR-004.
  - `CHANGELOG.md`: past release notes are a record, like specs.
  - `packages/*/tests`: they are not shipped. They are updated wherever they locate the pane by name.
- **Nothing that identifies changes** (FR-003): `view.toggleExplorer`, `explorer.*`,
  `panes.fileExplorer.*`, `file.*`, the `pane-explorer` CSS classes and every `data-testid` stay
  as they are.

**Rationale.** Including comments makes the guard a plain text scan with no parser and no
exceptions list, and a stray old name in a comment is how the old name gets copied into new UI
strings.

**Who owns it**
- The research sweep found about 40 source files (listed in plan.md, *Source Code*).
- About 50 test files locate the pane by its accessible name or carry the old name in a comment. The
  E2E ones matter most, because a heading locator that is not updated simply fails.

---

## R13 — Test layers (Principle V)

| What | Layer | Where |
|---|---|---|
| Chord tiers, the four-entry exception list, no collisions, scope completeness, the `projects` scope and "Everywhere" collapse | unit | `packages/core/tests/unit/keybindings.test.ts`, `terminal-reserved-keys.test.ts`, `keybindings-scope.test.ts`, `keybindings-collision.test.ts` |
| `chordCandidates` for US, UK, Swiss, Czech, Hungarian, German and AZERTY shapes, including the Alt exclusion | unit | `packages/ui/tests/unit/chord-candidates.test.ts` |
| `listRows`, `reachableProjectIds`, `stepProject`, category-name validation, delete-merge order | unit | `packages/core/tests/unit/project-list.test.ts` |
| `planUnload` truth table, `projectPanelIdsInSubWorkspaces` | unit | `packages/core/tests/unit/unload-plan.test.ts` |
| New settings descriptors, new keybinding descriptors, icon-token copy | unit (existing completeness tests go red first) | `settings-metadata.test.ts`, `keybindings-metadata.test.ts`, `theme-copy.test.ts` |
| Old-name guard | unit | `packages/ui/tests/unit/file-explorer-name.test.ts` |
| Pane header, rail and tooltip text; the menu item label | component | `file-explorer-pane.test.ts`, the panel-header-menu tests |
| Projects tree keyboard (arrows, Home, End, Enter, Space), row and header menus, disabled Unload, minimise hides rows but not the active one, count formatting, outline class on focus | component | `packages/ui/tests/component/projects-panel-*.test.ts` |
| `focus.explorer` then F2 starts rename; `focus.projects` reveals and focuses the active row; the cog Navigate section with chords and disabled state | component | `KeybindingsHandler` via `packages/ui/tests/shared/window-chords.ts`; `title-bar.test.ts` (tasks T035; this row first said `cog-menu.test.ts`) |
| Unload orchestrator: dirty prompt then cancel; none / single / double; the variant rows; sub-workspace exclusion passed through | component (mocked bridge) | `packages/ui/tests/component/unload-project.test.ts` |
| Migration v9, drift heal, version pin, category repository and service, `projects.move` | integration | `packages/persistence/tests/integration/`, `packages/daemon/tests/integration/` |
| `closeIdle` / `killAll` with `exceptPanelIds` and the rootless skip, against real sessions | integration | `packages/daemon/tests/integration/terminal-service-*.test.ts` |
| New settings round-trip through the config write path | contract | the existing `config-write-patch.contract.test.ts` pattern |
| **E2E +1**: a real Ctrl+Shift+0, Ctrl+Alt+PageDown and Ctrl+Alt+F reaching the window handler from a focused **terminal**, and the shell receiving nothing | E2E `@extended @window @reserve:input` | `window-chord-resolution.e2e.ts` (new declaration) |
| **E2E +1**: Unload with End terminals, and Keep running with an idle shell, reap the conhosts | E2E `@extended @terminal @reserve:process` | `terminal-no-orphans.e2e.ts` (new declaration) |

**E2E budget**: `e2e-budget.json` total **573 → 573** (net 0); `@window` 197 → 196; `@terminal`
108 → 109; `core` unchanged. *(Superseded 2026-09-23, analysis C1: this first read 573 → 575.
Principle V says the budget "may fall and MUST NOT rise", so the two additions are offset first.)*

| Offset | Declaration removed | Where its assertion lives |
|---|---|---|
| T048a | `pane-shortcuts.e2e.ts:72` *"Ctrl+Alt+B toggles the Projects pane and Ctrl+Alt+N toggles the Files & Folders pane"* | `window-chord-resolution.e2e.ts:175`, an exact duplicate that survives (de-duplication; no lower layer mounts the pane rails) |
| T048b | `loaded-projects.e2e.ts:13` *"indicates loaded vs not-loaded projects"* | component: `projects-panel-loaded-style.test.ts` (new). Loaded state is session-only, so a fresh store over a persisted project IS a restart. The painted italic (`getComputedStyle`) cannot be held by a component test, so it moves as an extra case into T065's new declaration (analysis K1) |

Each addition carries its one-sentence reason in `measuredFrom`:

- *Input.* Only a real engine reports what `e.key` and `e.code` are for a shifted digit, and Principle
  V names "layout-dependent chords" as the case a synthesised event cannot prove.
- *Process.* Principle III requires a process-level E2E after **each** end path. Unload is a new
  path, and `closeIdle` has never had a caller, let alone a conhost assertion.

**Tier plan: no change.** Both host files are already in the serial tier of `parallel-plan.json`:
`terminal-no-orphans.e2e.ts` is listed as CPU, and `window-chord-resolution.e2e.ts` as UNATTRIBUTED.
That covers the process spec driving a context menu, which `tier-plan.test.ts` requires to be
serial.

**Not tested at E2E, and why**: the Projects tree keyboard (component; one window, one document);
cycling (unit plus component); category persistence (integration); the rename (unit guard plus
component); the dialogs (component).

---

## R14 — Requirements that already govern this behaviour (repo rule)

These searches were run before any design decision above that changes behaviour.

| Behaviour touched | Governing requirement found | Outcome |
|---|---|---|
| Pane name | 003 FR-007; 006 FR-015/016/070; 023 FR-022; 044 *Reveal File in …* | Superseded by S1 |
| "Loaded" stays for the session | 003 FR-035; constitution *Lazy project loading* ("MAY remain in memory") | S2. The constitution says MAY, so there is no conflict |
| Flat drag reorder | 002 FR-046 | S3 |
| No wrap at the ends | 012 FR-015 (`focus.*` does not wrap) | Followed by FR-011 |
| Unloaded style | 006 FR-051 | Reused (`project-item--unloaded`, `theme.css:2225-2228`) |
| Right-click rename | 002 FR-041 | Now true (FR-031) |
| Confirmation levels | 003 FR-023/024; 011 FR-030–035 | Followed by FR-034b |
| Remove's unsaved guard | 006 FR-006a | Reused (FR-035) |
| Saved keybindings not rewritten | 026 FR-030 | Followed by FR-023 |
| `projects.*` keys; a "default action" preference | none (`keepRunning` has no match; retired `editor.links.defaultAction` is the only precedent) | New keys, no conflict |
| Keys that act while a non-workspace pane is focused | 043 R14, 044 R16 (a scope of its own for a non-text surface) | Followed by R3 |

**Not superseded, but worth naming**: 003 FR-025a says Remove is refused while the project's panels
sit in a sub-workspace. `projects-panel.tsx:245` records that it is not wired. Unload deliberately
does not inherit that refusal, because FR-037 tells it to leave those panels alone rather than refuse.

## R15 — The chord audit under the v5.6.0 modifier convention (iterate round 1; FR-076 – FR-079)

**Source**: every entry of `WINDOWS_BINDINGS` and `COMMAND_SCOPES` in
`packages/core/src/config/keybindings.ts` at `186176f5`, plus the groups in `keybindings-metadata.ts`.
Each command is classified by **what it changes**, not by where it is live. That test is written
into constitution v5.6.0 IV.

**Panel or pane** (acts on the active surface's content, state or view): `panel.zoomIn/Out/Reset`,
`panel.rename`, `editor.save`, `editor.saveAs`, `editor.cutLine`, `editor.indentLines` /
`outdentLines`, `editor.columnSelect*`, `editor.toggleWordWrap` (it toggles the focused editor's
document, per `use-editor.ts`), every `search.*` bar command, `terminal.scroll*`, `terminal.redraw`,
`file.*` (they act on the File Explorer's selection), `navigate.gotoLine`, `navigate.back` /
`forward`, `preview.open`, `preview.followLink`, `preview.toggleSyncScroll` and `menu.open`.

**Global** (acts on the app, the window, the workspace layout or the project, or moves the user
between surfaces): `zoom.in/out/reset` (the window's page zoom), `view.fullscreen`,
`view.toggleProjects` / `toggleExplorer`, `focus.left/right/up/down/cycle/cycleBack`,
`focus.notice`, `focus.explorer`, `focus.projects`, `project.next` / `previous`,
`tabs.openPicker` (031 calls it "a WINDOW-level navigation aid"), `navigate.quickOpen`,
`search.findInFiles`, `search.replaceInFiles` (043: "these two act on the PROJECT"), and
`editor.saveAll` (its scope is the `editor.saveAllScope` setting, not the active panel).

**Violations found (11 commands)**: the global commands on Ctrl+Shift are `zoom.reset`
(Ctrl+Shift+0), `navigate.quickOpen` (T), `search.findInFiles` (F), `search.replaceInFiles` (H)
and `editor.saveAll` (S). The panel commands on Ctrl+Alt are `panel.zoomIn` (=, +),
`panel.zoomOut` (-), `panel.zoomReset` (0), `editor.saveAs` (S), `editor.toggleWordWrap` (W) and
`search.replaceAll` (Enter).

**Judgement calls, flagged**:
- `focus.left/right/up/down` (Ctrl+Alt+Arrow) are classified global because they move between
  panels. Classifying them as pane actions would force Ctrl+Shift+Arrow, which is CodeMirror's
  select-by-word in every editor and `terminal.scrollLine*` in a terminal.
- `focus.cycleBack` (Ctrl+Shift+`) is the direction-reversal carve-out: Shift reverses
  `focus.cycle`'s Ctrl+`. Ctrl+Alt+` would be matched physically (`chordKey`) and would take UK's
  AltGr+` (`¦`).
- `zoom.in` keeps `Ctrl++`: `chordCandidates` tries the physical candidate first, so on US/UK
  Ctrl+Shift+= resolves to `panel.zoomIn` (FR-078), while a `+` produced without Shift (numpad, the
  German `+` key) still reaches the app-wide zoom-in.
- Ctrl+Shift+C / Ctrl+Shift+V are **not** throng bindings. `use-terminal.ts` `isPasteChord` accepts
  only Ctrl+V and Shift+Insert, and leaves Ctrl+Shift+V to the shell. Nothing is claimed.

**The remap** is FR-077's table. Checks on each proposed chord:

| Chord | Reserved tier? | Collision (any scope) | What a hosted line editor loses | AltGr: unreachable on (UK, DE, FR, ES, IT, Nordic, PL) |
|---|---|---|---|---|
| Ctrl+Alt+0 (`zoom.reset`) | no | none (freed by `panel.zoomReset`) | nothing: the window listener captures first, as it does today | DE (`}`), FR (`@`), Nordic (`}`). Ctrl+0 still works there |
| Ctrl+Alt+= / ++ (`zoom.in`) | no | none (freed) | as above | DE, FR, Nordic, ES (no unshifted `=` key, or AltGr gives `}` / `~`). Ctrl+= / Ctrl++ still work there. Unchanged from today's panel binding |
| Ctrl+Alt+- (`zoom.out`) | no | none (freed) | as above | FR (`|` on the 6 key). Ctrl+- still works |
| Ctrl+Shift+= (`panel.zoomIn`) | no | none | xterm sends nothing for Ctrl with `+` | none: physical, Alt not held |
| Ctrl+Shift+- (`panel.zoomOut`) | no, **shadowable** | none | xterm sends `^_` (`Keyboard.ts`, `C0.US`) = readline `undo`. Recorded exception, v5.6.0. Still reachable on Ctrl+X Ctrl+U; PSReadLine undo is Ctrl+Z | none |
| Ctrl+Shift+0 (`panel.zoomReset`) | no | none (freed by `zoom.reset`) | nothing: `)` with Ctrl sends nothing | none: physical Digit0 |
| Ctrl+Shift+S (`editor.saveAs`) | no | none (freed by `saveAll`) | xterm sends nothing for Ctrl+Shift+letter | none |
| Ctrl+Alt+S (`editor.saveAll`) | no | none (freed by `saveAs`) | as today for Save As | PL (`ś`), unchanged from today |
| Ctrl+Shift+W (`editor.toggleWordWrap`) | no | none, EDITOR_ONLY | no shell sees it | none |
| Ctrl+Shift+Enter (`search.replaceAll`) | no | none. CodeMirror's `defaultKeymap` binds Mod-Enter only | consumed only while an editor's find bar is open (`search-keybindings.tsx`) | none |
| Ctrl+Alt+G (`navigate.quickOpen`) | no | none. `navigate.gotoLine` is Ctrl+G, a different token; `@codemirror/search`'s Mod-Alt-g keymap is not installed | readline M-C-g (`abort`, also on C-g); on Windows xterm treats Ctrl+Alt+letter as AltGr and the window listener captures first (FR-021 note) | none of the seven. HU has `]` on G |
| Ctrl+Alt+F (`search.findInFiles`) | no | none (freed by `focus.explorer`) | as FR-021's recorded note for this exact chord | none of the seven. HU has `[` on F |
| Ctrl+Alt+H (`search.replaceInFiles`) | no | none | readline M-C-h (`backward-kill-word`, also on M-DEL); same capture reasoning | none of the seven |
| Ctrl+Alt+D (`focus.explorer`) | no | none | readline M-C-d is unbound in default bash; same capture reasoning | none of the seven. HU has `Đ` on D |

`bind -p` was **not** re-run for G, H and D in this session, because the iterate round runs no
commands. The live check FR-021 requires is owed at implementation, as O3 was.

**Upgrade** (FR-079): shipped-defaults version 13 rewrites a saved array only when it is
set-identical to the version-11 value, or, for `zoom.reset` only, the version-12 value `[Ctrl+0,
Ctrl+Shift+0, Ctrl+MiddleClick]`. It refuses when any other action already binds one of the new
chords. This is the `planKeybindingsUpgrade` / `COLLIDING_ZOOM_RESET_TOKENS` shape, generalised to
every row of the table.

**Alternative considered**: keeping Find in Files on Ctrl+Shift+F / H and Quick Open on Ctrl+Shift+T,
which are the near-universal editor chords, as recorded exceptions to the convention. Rejected
because the maintainer stated the convention without exceptions. The cost is flagged at the
checkpoint: users arriving from VS Code lose three chords they know.

## R16 — What `zoom.reset` actually resets (iterate round 1; FR-080)

**Reading of the code at `186176f5`**:
- `app.tsx` `KeybindingsHandler` dispatches `zoom.reset` as `window.throng.zoomReset()`, and
  `panel.zoomReset` as `wsRef.current.resetZoom(activePanelId)`, which is the per-panel store.
- `preload.cts` sends `zoom.reset` as the IPC `throng:zoomReset`. `main.ts` `registerZoomIpc` →
  `resetZoom(event.sender)` → `webContents.setZoomLevel(0)`: the **window's page zoom**, which scales
  chrome and every panel (012 FR-008 composes the two).
- Ctrl+MiddleClick goes to the same IPC (`renderer/main.tsx`).
- `window-chord-resolution.e2e.ts` (T049) already asserts that a real Ctrl+Shift+0 "resets a zoomed
  window".

**So, by the code, a global reset exists, and Ctrl+Shift+0 is it.** The maintainer's report that
Ctrl+Shift+0 "appeared to reset a panel's zoom" and that "there does not seem to be a global zoom
reset" is **not explained by this reading**. Two hypotheses, neither verified:
- **H1**: the maintainer pressed **Ctrl+Alt+0**, which is the panel reset on the Ctrl+Alt family
  today, expecting the convention they had just stated. That reset the panel and left the window
  zoom alone.
- **H2**: 012's composition rule. A terminal's grid is computed from its per-type zoom only, and
  global zoom raster-scales it (012 spec, Edge Cases). So a window reset seen from a terminal can
  read as that panel changing.

No probe was run (this round runs nothing). FR-080 makes the answer a test: the component layer
proves `zoom.reset` reaches `zoomReset` and not the store, and the converse for `panel.zoomReset`.
The integration layer proves the IPC handler resets the sender's zoom level. Under the remap, the
maintainer's expected chord, Ctrl+Alt+0, becomes the window reset either way.

## R17 — Keypad + and − (after the maintainer's review; FR-090)

Nothing in `packages/core/src` or `packages/ui/src` mentions `Numpad`. Chords resolve on `e.key`,
with the physical-first exception for `Digit0–9` only (`chord-key.ts` `chordCandidates`,
`resolveKeydown`). The keypad keys report `key` `+` / `-` and `code` `NumpadAdd` / `NumpadSubtract`.

**Already working, by the produced character**: Ctrl+Num + becomes `Ctrl++`, which is `zoom.in`, and
Ctrl+Num − becomes `Ctrl+-`, which is `zoom.out`. Ctrl+Alt+Num + / − become `Ctrl+Alt++` /
`Ctrl+Alt+-`, which is `panel.zoom*` today and `zoom.*` after the remap.

**Not working**: Ctrl+Shift+Num + / −. The window listener drops Shift for any key that is not a
backtick, F-key, letter or arrow, so the keypress arrives as `Ctrl++` / `Ctrl+-` and reaches the
**app-wide** zoom, not the panel zoom the Ctrl+Shift family now means.

**Not recordable**: the capture modal (`capture-modal.tsx:37`, `fromDomEvent`) records `Ctrl++`
for a keypad press, so a user cannot bind the keypad separately either.

**To add**: a physical-first candidate for `NumpadAdd` / `NumpadSubtract` that keeps Shift and does
not exclude Alt (the keypad has no AltGr characters); explicit keypad tokens in the shipped
defaults; capture and display of those tokens; and the FR-079 guarded rewrite to deliver them.
xterm sends nothing for Ctrl with the keypad `+` or `-` (`Keyboard.ts`: neither is `_`), so no
shell loses anything.

## R18 — Why Ctrl+Alt+Enter "does not replace all" (after the maintainer's review; FR-093)

**It is a real binding, and it is wired.**
- `keybindings.ts:492`: `'search.replaceAll': ['Ctrl+Alt+Enter']`, scope `PANELS` (`:328`).
- `search-keybindings.tsx:41–56`: `HANDLED` includes it. `:194` is a **bubble-phase** window listener.
- `:86–90`: it resolves the key with `resolveKeydown` against the active panel's kind, and returns
  unless the active pane is `workspace`.
- `:157–161`: it acts only `if (findOpen && activeKind === 'editor')`, then calls `replaceAll`.
- `search-store.ts:277` → `editor-search.ts:193` performs one transaction over every match.
- The find bar's own `onKeyDown` (`find-bar.tsx:124`) ignores any Enter with Ctrl or Alt, so it
  does not swallow the chord.
- CodeMirror binds no `Ctrl-Alt-Enter`: `defaultKeymap` has `Mod-Enter`, and `@codemirror/search`'s
  keymap is not installed.
- It is not an AltGr casualty either: Enter has no AltGr character, and CodeMirror's AltGr guard
  applies only to character keys.

**By design, it is inert unless an editor's in-panel find bar is already open**
(`search-keybindings.tsx:130–131`: "the remaining commands act on a live session only"). Ctrl+H
opens that bar with its replace section. Ctrl+Shift+F / Ctrl+Shift+H open the **project-wide**
Find in Files panel, which is a different surface, and `search.replaceAll` never acts on it.

**No test presses the chord.** `menu-sections.test.ts:984` checks only the menu label's shortcut
text. `keybindings-preview.test.ts:143` checks only that the chord is kept out of the preview scope.

**Verdict: an unreproduced defect report.** Reading the code does not explain it, so the cause is
not asserted. Hypotheses:
- **H1**: the maintainer pressed it in Find in Files, or in an editor with no bar open. Both are
  inert by design.
- **H2**: the active pane was not `workspace` when the chord was pressed. The `:90` gate returns
  silently.
- **H3**: a real-engine event difference that only a pressed key shows.

At implementation, a component test presses the chord through `SearchKeybindings` with focus in the
bar's find field, its replace field and the document. It is observed failing first if the defect is
real (replicating-bugs). If it passes, the E2E rung, `@reserve:input`, is the next step up.

**Ctrl+Shift+Enter is free**:
- CodeMirror: `defaultKeymap` binds `Mod-Enter` (`insertBlankLine`) and plain Enter. No
  `Shift-Mod-Enter`.
- throng: no binding.
- Terminal: the handler returns before `preventDefault` unless an editor's bar is open, so a shell
  still receives it, and xterm sends plain CR for Enter with Ctrl.

## R19 — Two-stroke chords (after the maintainer's review; FR-091, FR-092)

**throng has none today.**
- A binding token is ONE keydown: `eventToToken` (`keybindings.ts:608`) and `normalizeToken`
  (`:628`).
- `resolveAction` (`:644`) matches one event against one token.
- `chordCollisions` (`:684`) compares whole tokens.
- The capture modal commits one chord on key-up and rejects a bare key (`capture-modal.tsx:15–22`,
  FR-033a).
- `toCodeMirrorKey` (`editor/commands.ts:612`) splits on `+` and would mangle `Ctrl+E W`.
- 024's Assumptions say it outright: "a binding is one token … No sequence/pending-prefix engine is
  needed". 024 rejected `Ctrl+E` then `W` for that reason and for the terminal shadow.

**CodeMirror already has the engine.**
- `@codemirror/view` `runHandlers` keeps a `storedPrefix`, with a 4-second `PrefixTimeout`.
- It accepts space-separated keymap names such as `"Ctrl-e w"`.
- It consumes an unbound second stroke: `prevented = true` once a prefix is stored.
- It works only while the editor view has focus, which is the scope FR-091 wants.
- So the smallest implementation bridges a two-stroke token into `editorCommandKeymap`, the command
  being `EDITOR_ONLY`, and adds the pending indication and the Escape handling. The model-side work
  (parse, display, capture, collisions, upgrade) is still new.

**Ctrl+E today**:
- No throng binding.
- In the editor, CodeMirror's `Ctrl-e` (`cursorLineEnd`) sits in `emacsStyleKeymap`, which
  `standardKeymap` maps as **`mac:` only** (`@codemirror/commands` `index.js:1770`). On Windows it is
  unbound, and throng installs `defaultKeymap` (`use-editor.ts:13`).
- In a terminal, Ctrl+E is readline's `end-of-line`, in the constitution's reserved tier. The
  command's scope is `EDITOR_ONLY` (`keybindings.ts:358`), so the prefix is never live there.
- 024 FR-003b says the terminal scope would activate only with spike #169. That is why FR-091
  forbids the prefix in any terminal scope ahead of time.

**VS Code precedent**:
- Ctrl+K chords: the status bar shows "(Ctrl+K) was pressed. Waiting for second key of chord...".
- An unbound second key shows "The key combination (Ctrl+K, X) is not a command" and is consumed.
- There is no timeout.
- FR-092 takes the indication and the consumption, and takes CodeMirror's 4-second timeout in place
  of none, because that is the engine it would ride on. Both are derived.

## R21 — The chord audit under the three tiers (second review, 2026-09-24; FR-094 – FR-100)

**What Ctrl+Shift costs in a terminal.** xterm.js 6.0.0 builds the bytes (`@xterm/xterm`,
`src/common/input/Keyboard.ts`, `evaluateKeyboardEvent`):
- **Letters send nothing.** The Ctrl-letter branch requires `!ev.shiftKey`. The Ctrl fallback
  (`else if (ev.key && ev.ctrlKey)`) maps only `_` → `^_` and `@` → `NUL`. So
  Ctrl+Shift+<letter> sends **no bytes**. The common belief that "Ctrl+Shift+letter arrives as
  Ctrl+letter" is true of legacy console encodings, not of the terminal throng hosts. Readline and
  PSReadLine never see these chords, so taking one costs no shell anything.
- **Punctuation sends nothing either**, except Ctrl+Shift+2 (`NUL`, readline `set-mark`) and
  Ctrl+Shift+- (`^_`, readline `undo`). Ctrl+Shift+[ and ] produce `{` and `}`, and send nothing.
- **Named keys carry xterm's modifier-encoded sequences.** Arrows, Home, End and Delete send
  `CSI 1;6 X`, which PSReadLine binds as select-by-word on Left/Right. F-keys send `CSI 1;6 P`, and
  Tab sends `ESC [ Z`, the same backtab as Shift+Tab. PageUp and PageDown with Shift are handled
  inside xterm as viewport scrolling, which `Shift+PageUp/PageDown` keep.
- **Consequence.** A tier-1 chord on a letter or a bracket takes nothing from a shell. Ctrl+Shift+Tab
  duplicates Shift+Tab's backtab, so nothing is lost there either. Ctrl+Shift+PageUp/PageDown
  duplicate xterm's own Shift+PageUp/PageDown scroll, which stays on Shift alone. Ctrl+Shift+Arrow
  would take PSReadLine's word selection, which is why directional focus stays an exception.
- Ctrl+Shift+C and Ctrl+Shift+V also send nothing from xterm. Whether Chromium's native
  paste-and-match-style on Ctrl+Shift+V still reaches xterm's paste handler through its textarea is
  a **hypothesis**, unverified. Neither chord is claimed.

**What Ctrl+Shift costs in the editor** (CodeMirror `defaultKeymap` on Windows, plus throng's own
keymaps):
- Ctrl+Shift+Arrow, Home and End select, as the shift variants of `Mod-Arrow`, `Mod-Home` and
  `Mod-End`.
- `Shift-Mod-k` is `deleteLine`, and `Shift-Mod-\` is `cursorMatchingBracket`.
- `Mod-Shift-z` is redo (`use-editor.ts:1366`).
- throng binds Ctrl+Shift+S, T, F and H.

None of the proposed tier-1 chords (E, P, B, N, M, [, ], Tab, PageUp, PageDown) is among these.
`Ctrl-Shift-PageUp/PageDown` are unbound in CodeMirror: its `PageUp` binding's `shift:` variant
registers `Shift-PageUp` only.

**Windows and Chromium.**
- Ctrl+Shift+Esc (Task Manager) is avoided.
- Ctrl+Shift alone, or Ctrl+Shift+digit, may be the input-language hotkey where configured. That is
  one more reason to drop Ctrl+Shift+0.
- Electron's default menu, with its Ctrl+Shift+I devtools accelerator, is removed (`main.ts`).
- No Chromium editing command uses Ctrl+Shift with E, P, B, N, M or the brackets.
- AltGr does not apply to Ctrl+Shift.

**What the matcher needs.** Today the window listener keeps Shift only for the backtick, F-keys,
letters and arrows (`chord-key.ts` `chordCandidates`).
- Letters work already: Ctrl+Shift+T has shipped since 033.
- PageUp, PageDown and Tab need adding to that list, or Ctrl+Shift+Tab resolves as Ctrl+Tab.
- The brackets need physical matching, because Shift changes the character (`{` on US). That is
  FR-097, the FR-026 digit rule applied to two more keys.

**The `+` / `-` keys** (FR-098):
- Main-row US Ctrl+Plus is Ctrl+Shift+=. It produces `+`, and the window listener drops Shift, so it
  becomes `Ctrl++`. Keypad Ctrl++ produces `+` without Shift, and also becomes `Ctrl++`. The two are
  identical in the listener, and the same holds for Ctrl+Alt.
- The capture modal passes `e.shiftKey` straight to `captureToken` (`capture-modal.tsx:37–38`,
  `core/config/chord-capture.ts:46`). So it records the main-row press as **`Ctrl+Shift++`**, which
  the window listener never matches, and the keypad press as `Ctrl++`. That is the "modifier
  dropped" divergence FR-098 fixes.
- The editor-chrome and search resolvers pass Shift unconditionally too. No shipped `+` / `-` chord
  resolves there today, but a user rebind could.
- One residual asymmetry is inherent, not a drop. Shift+main-row minus produces `_`, while
  Shift+keypad minus stays `-`. So Ctrl+Shift+keypad-minus arrives as `Ctrl+-` (the window zoom
  out), while Ctrl+Shift+main-row-minus arrives as `Ctrl+_` (nothing). With no shipped Ctrl+Shift
  chord on these keys the only effect is that the keypad is more forgiving. It is recorded, not
  specified away.

**Directional focus: the one choice without a clean answer** (FR-096 carries a derived default):
- (a) Keep Ctrl+Alt+Arrow as a noted exception. This is the default: it changes nothing, and
  CodeMirror's Ctrl+Alt+Up/Down add-cursor is already shadowed today.
- (b) Ctrl+Shift+I / J / K / L. This is tier-correct, but K takes CodeMirror's `deleteLine`
  (Ctrl+Shift+K, also VS Code's chord) in every editor.
- (c) Ctrl+Shift+Arrow. This takes word selection from editors, PSReadLine and every text input.

**Upgrade** (FR-100): seven actions come from their version-11 values and five from their
version-12 values, under FR-079's guard. None of the new chords is bound to anything else by
default, so the collision refusal fires only for a user who bound one of them themselves.

*R21's chord choices are superseded by R22 (iterate round 1 checkpoint). Its terminal and editor
findings for Ctrl+Shift still hold, and R22 relies on them for tier 2.*

## R22 — The chord audit under the agreed convention (iterate round 1 checkpoint, 2026-09-24; FR-101 – FR-110)

**Source**: `WINDOWS_BINDINGS` and `COMMAND_SCOPES` in `packages/core/src/config/keybindings.ts`,
`packages/ui/src/renderer/config/chord-key.ts` and `keybindings/scope.ts` at `3b04ec33`, and
`@xterm/xterm` 6.0.0 in `node_modules`. Nothing was run; every "owed" item below is a check for
implementation.

**Token form.** `eventToToken` builds `Ctrl+Shift+Alt+<key>` (`keybindings.ts:607`), and a token is
displayed as written (`firstBinding`, "tokens are already the display form"). So the new defaults
are spelled `Ctrl+Shift+Alt++`, `Ctrl+Shift+Alt+ArrowLeft`, and so on, and that is what the Key
Bindings editor and menu shortcuts show.

**What Ctrl+Shift+Alt costs in a terminal.**
- `CoreBrowserTerminal._isThirdLevelShift`: on Windows, `ev.altKey && ev.ctrlKey && !ev.metaKey` is
  a third-level (AltGr) shift, and on keydown it applies when `keyCode > 47`. So for letters,
  digits, `=`/`+`, `-` and the keypad keys xterm sends nothing on keydown and waits for a produced
  character.
- Arrows (37–40) are below 47: `Keyboard.ts` sends `CSI 1;8 A`–`D` (modifiers Shift 1 + Alt 2 +
  Ctrl 4, plus 1). PageUp / PageDown (33 / 34) with Shift held are xterm's own viewport scroll
  (`KeyboardResultType.PAGE_UP` / `PAGE_DOWN`), which `Shift+PageUp/PageDown` keeps.
- The window listener captures a bound chord before xterm (FR-021's recorded note), so a shell
  gives up `CSI 1;8` arrows and nothing else. No default readline binding and no default PSReadLine
  handler is known to use a `1;8` sequence. **Owed**: `bind -p | grep '1;8'` in Git Bash and
  `Get-PSReadLineKeyHandler` in PowerShell 7, as O3 was.
- Freeing `Ctrl+Alt+Arrow` and `Ctrl+Alt+PageUp/PageDown` hands `CSI 1;7` sequences back to the
  shell; freeing `Ctrl+Alt+letter` changes nothing there, because xterm treats those as AltGr.

**What it costs in the editor.** CodeMirror's `defaultKeymap` binds nothing on Shift-Mod-Alt. The
freed `Ctrl+Alt+ArrowUp/Down` reach CodeMirror's own binding again (R21 noted it was shadowed).

**Windows and Chromium.** No OS or Chromium accelerator uses Ctrl+Shift+Alt with these keys. The
Office key sends Ctrl+Shift+Alt+**Win**, which a listener sees with `metaKey` set; FR-104 requires
the tier-1 match to decline an event with `metaKey` set, so an Office-key press never resolves as a
throng chord *(derived)*.

**Physical matching.** Today `chordCandidates` tries a physical candidate only for `Digit0`–`Digit9`
with Ctrl held and **Alt not held** (R2's AltGr reason) and for the backtick. Tier 1 needs one with
Alt held. That is safe where R2's case was not because Shift is part of the chord: AltGr+Shift is
the fourth level, rarely populated, and the chord is deliberate on every layout. The cases:
- **Letters.** Matched as `KeyA`–`KeyZ`, the US-QWERTY position. AZERTY moves `M` to the `,` key,
  and A/Q, Z/W (none bound); QWERTZ swaps Y/Z (none bound). So `focus.notice` on AZERTY is
  Ctrl+Shift+Alt with the key labelled `,`. **Open for the maintainer**: whether the Key Bindings
  editor should label the local key (Chromium's `navigator.keyboard.getLayoutMap()`), which throng
  does not use today.
- **`+`, `-`, `0`.** `Equal` / `NumpadAdd`, `Minus` / `NumpadSubtract`, `Digit0` / `Numpad0`. US and
  UK carry `+` and `-` there; French carries `+` on `Equal` and `-` on the 6 key; German puts `ß`
  on `Minus` and `´` on `Equal`, and the Nordic, Spanish and Italian layouts put other characters in
  those positions too, with `+` on a key of its own. The keypad is the same on every layout. `Numpad0` with Shift and NumLock on reports `key` `Insert`; `code` is
  still `Numpad0`, which is why the match is on `code`.
- **AltGr+Shift characters.** The bound letters are B, F, M, N, P, T. Polish (programmer's) has
  AltGr+N `ń`, so AltGr+Shift+N is `Ń`: a physical tier-1 match on N takes it. The others carry no
  AltGr+Shift character on the seven common layouts, as far as the published layouts show *(owed:
  a check against each layout's fourth level)*. **Hypothesis**: Chromium on Windows sets
  `getModifierState('AltGraph')` for the right-hand AltGr key and not for left Ctrl+Alt. If it holds,
  FR-104's decline rule keeps `Ń` typeable and the chord still fires from left Ctrl+Alt. It is
  unverified, and FR-104 requires a test at the lowest layer that can observe the real modifier
  state before either behaviour ships.
- This is the inverse of today's Ctrl+Alt trade. A produced-character match loses the CHORD on an
  AltGr layout (Polish AltGr+S types `ś` and `editor.saveAs` never fires, R15); a physical match
  keeps the chord and can lose the CHARACTER. The maintainer chose the physical side for tier 1.

**The fourth-level check (T148, 2026-09-25; closes the *owed* item above).** Source: the published
Windows layout tables (the KBD layout definitions as Microsoft publishes them), read, not typed. The
tier-1 keys are the letters B, F, M, N, P, T, the digit `0` (`zoom.reset`; no other digit is bound
at tier 1), `=` / `+` (`Equal`), `-` (`Minus`), the four arrows and PageUp / PageDown. For each,
the character AltGr+Shift types on that physical key, which a tier-1 match takes instead:

| Key | UK | German | French | Spanish | Italian | Nordic | Polish (programmer's) |
|---|---|---|---|---|---|---|---|
| B, F, M, P, T | none | none | none | none | none | none | none |
| N | none | none | none | none | none | none | **`Ń`** |
| `0` (`Digit0`) | none | none | none | none | none | none | none |
| `Equal` / `Minus` | none | none | none | none | none | none | none |
| Arrows, PageUp / PageDown | none (no character on any layout) | | | | | | |

So on the seven layouts constitution IV names, the only character lost is Polish `Ń`. Two layouts
outside the seven lose more, and are recorded because users on them exist: **US-International**
loses `Ñ` (N), `Ö` (P) and `Þ` (T), and **Romanian (Programmers)** loses `Ț` (T). AltGr alone,
without Shift, is untouched on every layout: German `µ` on M, Nordic `µ` on M, and the digit-row
brackets all still type, because a tier-1 chord needs Shift.

What the physical match costs besides characters, from the same tables:
- **The dedicated `+` / `-` keys.** German, Spanish and Italian put `+` on `BracketRight` and `-` on
  `Slash`, and something else on `Equal` / `Minus` (`´` / `ß`, `¡` / `'`, `ì` / `'`). Their labelled
  `+` / `-` keys therefore fire no tier-1 zoom; the keypad `+` / `-` / `0` and the cog menu's Zoom
  row (FR-107) do. **Nordic** is the sharper case: the key labelled `+` is `Minus`, so Ctrl+Shift+Alt
  with it resolves as `Ctrl+Shift+Alt+-` and zooms the window **out**, and the `´` key beside it
  (`Equal`) zooms in *(derived from the table; not observed on a keyboard)*.
- **AZERTY letters.** `M` is the key labelled `,` (A/Q and Z/W also move, none bound).

Whether the `Ń`, `Ñ`, `Ö`, `Þ` and `Ț` losses are recovered is the AltGraph hypothesis above: if
T149 finds Chromium reports `AltGraph` for the right-hand key only, T151 / T152 decline those events
and the characters type again. Until T149 reports, the disclosure in `docs/quick-start.md` states
the losses as they are.

**The iterate-round-3 check (2026-09-25; spec FR-117, T148's disclosure extended).** Source:
`WINDOWS_BINDINGS` / `COMMAND_SCOPES` in `packages/core/src/config/keybindings.ts` on the branch at
`69127230`, constitution IV's two terminal tiers, and the published layout tables T148 read. Nothing
was typed or run. FR-117 re-assigns the tier-1 letters as `focus.projects` B, the new
`focus.workspace` N, `focus.explorer` M, `view.toggleProjects` J, `view.toggleExplorer` K and
`focus.notice` V, and it unbinds F and P.
- **Reserved or already taken?** No shipped default binds J, K or V with any modifier (the only V
  token is `file.paste` `Ctrl+V`, a different token). `Ctrl+Shift+Alt+J/K/V` is in neither of
  constitution IV's terminal tiers. The reserved `Ctrl+K` and the shadowable tier are exact
  `Ctrl+<letter>` tokens without Alt, and `terminal-reserved-keys.test.ts` matches exact tokens. No
  Windows or Chromium accelerator uses Ctrl+Shift+Alt with these letters. The Office key's
  Ctrl+Shift+Alt+Win is declined by FR-104's `metaKey` rule. **V is free**, so the maintainer's
  condition holds.
- **Terminal.** Letters are key codes above 47, so xterm's `_isThirdLevelShift` sends nothing on
  keydown for any of B, N, M, J, K, V. The window listener captures a bound chord first. As for T,
  no shell sees any of them.
- **Fourth level (AltGr+Shift), the seven layouts:**

  | Key | UK | German | French | Spanish | Italian | Nordic | Polish (programmer's) | Owner after FR-117 |
  |---|---|---|---|---|---|---|---|---|
  | B | none | none | none | none | none | none | none | `focus.projects` |
  | N | none | none | none | none | none | none | **`Ń`** | `focus.workspace` |
  | M | none | none | none | none | none | none | none | `focus.explorer` |
  | J, K, V | none | none | none | none | none | none | none | toggles, `focus.notice` |
  | F, P | — | — | — | — | — | — | — | unbound: nothing lost |

  Outside the seven: US-International keeps losing `Ñ` (N) and `Þ` (T), and gets **`Ö` (P)** back.
  Romanian (Programmers) still loses `Ț` (T). J, K and V carry no AltGr+Shift character on either
  layout *(derived from the tables, as T148's were; not typed on a keyboard)*.
- **Positions.** B, N, J, K and V sit in the same places on AZERTY and QWERTZ. AZERTY's `KeyM` is
  the key labelled `,`, so `focus.explorer` is pressed there. The maintainer's "left to right" is a
  statement about key positions, and physical matching keeps it true on every layout, including
  where a label differs.

**T149 NumLock probe result (maintainer, 2026-09-25, physical keyboard; answers probes (a) and
(b)).** Verbatim: "Ctrl+Shift+Alt+Numpad0 does not reset the window zoom — with NumLock ON it resets
the active panel's zoom instead; with NumLock OFF nothing happens."
- (a) NumLock **ON**: the **panel** resets and the window does not. This is what the recorded
  hypothesis predicted: Windows' synthesised Shift key-up makes the press arrive as
  `Ctrl+Alt+Numpad0`, which is `panel.zoomReset`. It is still a hypothesis. No probe has read the
  event's modifier state.
- (b) NumLock **OFF**: **nothing** resets. That contradicts this section's own claim, carried into
  FR-114, that `code` is still `Numpad0` whatever NumLock says. Whether Chromium reports a different
  `code` or `key` here, or the Shift synthesis drops the chord entirely, is unknown. No hypothesis
  is recorded until the repro reads the real event.

Spec FR-120 records the defect. tasks.md T189 is the reproduction, pending the maintainer's
confirmation, and T190 is the fix, not yet specified. Probe (c) (AltGraph) and the `CSI 1;8` probe
are still owed by T149.

**T149 follow-up (2026-09-25): measured, and (b) withdrawn.** The maintainer re-tested on a fresh
build: NumLock OFF resets the window, so (b)'s "nothing happens" came from a **stale build** and is
not a defect. This section's claim that `code` is `Numpad0` whatever NumLock says stands. (a) is
confirmed, and the hypothesis above is now measured. Hardware scan codes were injected with
`SendInput` (`KEYEVENTF_SCANCODE`: LCtrl 0x1D, LShift 0x2A, LAlt 0x38, keypad 0 0x52 without the
extended flag) into a bare Electron 44.4.3 window on Windows 11 that logged every DOM keydown/keyup
and `before-input-event`:
- NumLock ON, Ctrl+Shift+Alt+Numpad0: a **keyup Shift**, then keydown `{code Numpad0, key "Insert",
  ctrl, alt, shift false}` with `getModifierState('NumLock')` true, then Shift down again;
- NumLock ON, Ctrl+Alt+Numpad0: `{Numpad0, key "0", shift false}`;
- NumLock OFF, Ctrl+Shift+Alt+Numpad0: `{Numpad0, key "Insert", shift true}`;
- NumLock OFF, Ctrl+Alt+Numpad0: `{Numpad0, key "Insert", shift false}`, NumLock false.

Windows inverts the keypad to its navigation keys while Shift is held with NumLock on, and hides the
Shift from the event. A navigation `key` on a keypad digit, NumLock ON and `shiftKey` false can only
be that case, because NumLock on without Shift reports the digit. FR-120 specifies reading it that
way, and T190 is the fix.

**`Ctrl+Alt++` on a US or UK keyboard.** The `+` key is `=` there; pressing it with Shift and
Ctrl+Alt is now tier 1 (`Ctrl+Shift+Alt++`, the window zoom). So a user pressing "Ctrl+Alt and the
+ key" without a keypad presses Ctrl+Alt+`=`, and FR-105 matches that as `Ctrl+Alt++`. This is the
one-binding rule applied to the key the `+` lives on, not a second token *(derived)*.

**Collisions.** None of the tier-1 tokens is bound elsewhere. `Ctrl+WheelUp` / `WheelDown` /
`MiddleClick` leave `zoom.*` in the same change that gives them to `panel.zoom*`, so no default
collides; a user who kept one in a customised `zoom.*` array keeps it, and FR-108 refuses to hand
it to `panel.zoom*`.

**`isPanelScoped` audit (FR-110).** EVERYWHERE commands: `zoom.*`, `panel.zoom*`, `focus.*`,
`view.*`, `project.next` / `previous`, `focus.explorer` / `projects`, `menu.open`,
`tabs.openPicker`, `navigate.quickOpen`, `search.findInFiles` / `replaceInFiles`. All are exempt by
prefix or exact match except `menu.open`. Whether `menu.open` should yield to a focused textarea (a
terminal) is not decided by reading; the FR-110 test makes it an explicit classification.

**The unload prompt (FR-111).** `confirmations.unloadProject` exists only on this branch; 046 has
not been released, so withdrawing it owes no user migration. A development `settings.json` that
holds it keeps the key, per `settings-validity.test.ts:57` ("A hand-added key is legitimate — the
write path preserves it").
*Corrected in implementation (2026-09-25, spec FR-111's supersede note):* that citation does not
govern the settings write. `writeConfigPatch` (`config-write-ipc.ts`) normalises through
`parseSettingsGuarded`, which drops unmodelled keys, so the key is dropped by the next write, the
019 FR-023 precedent for a retired key. `config-write-patch.contract.test.ts` asserts it.

## R20 — `focus.cycleBack`, for the maintainer

It is the reverse of `focus.cycle` (012 FR-015):
- **Ctrl+`** moves focus to the next panel of the active tab in layout order.
- **Ctrl+Shift+`** moves it to the previous panel.
- Both wrap at the ends.

It is scoped `EVERYWHERE` and handled by the window listener (`app.tsx` `dispatchCycle(-1)`). The
backtick is matched on its physical key (`chord-key.ts` `chordKey`), so Shift survives on UK and US
layouts alike. `window-chord-resolution.e2e.ts:283` presses both directions, and
`docs/quick-start.md:819` documents it. With a single panel in the tab there is nowhere to go, so it
does nothing.

---

## Open items

- **O1 — `Ctrl+Alt+M` (`focus.notice`, 041) shadows bash's `M-C-m` (`vi-editing-mode`).** This was
  found while building R1's table. It is a pre-existing shipped chord and not this feature's to
  change. `M-C-j` is the same command, so the capability is not lost. Recorded, not fixed.
- **O2 — how FR-026 is read.** R2 matches digit keys physically only without Alt, so that FR-026 does
  not break FR-021's "must not stop a character being typed" on AltGr layouts. If "a chord on a
  digit-row key" was meant to include `Ctrl+Alt+digit`, that literal reading would stop German and
  French users typing `}` and `@`. *Closed 2026-09-23 by controller ruling: Digit0–Digit9, Ctrl held,
  Alt not held. Recorded under FR-026 in spec.md.*
- **O3 — live verification of R1's bash row** could not run in this session (the worktree guard
  refused `bash -i -c 'bind -p'`). [quickstart.md](./quickstart.md) §2 carries the check.
  *Closed 2026-09-23 by a live check (recorded at implementation): see R1's Correction and spec.md
  FR-021.*
