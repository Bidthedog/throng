# Feature Specification: v1.0.0 Defects & Tweaks

**Feature Branch**: `feature/S026-v1-defects-and-tweaks`

**Created**: 2026-07-30

**Status**: Draft

**Input**: Consolidates five tracked v1.0.0 issues — #194, #186, #197, #166, #165 — each
replicated against the running application before this spec was written.

**Deferred out of this feature (1 of 2)**: #198 (Ctrl+click opens a terminal link twice). It was investigated
and **does not reproduce**; rather than build a fix against a cause that measurement contradicts, it
stays open for whoever can reproduce it. The four "exactly once" tests written while investigating it
remain in the branch as regression fences.

**Deferred out of this feature (2 of 2)**: #161 (a stranded editor never recovers). It was BUILT — the
banner, a Reload from disk action and auto-recovery — and two of its three committed tests went
green. It was then **reverted**, because the change reddened `editor-missing-aggregate.e2e.ts` on
both of its cases: the tab-open "cannot open file" notice began firing on remounts that FR-105
exempts. Trading one issue’s fix for another issue’s regression is not a fix.

Its three tests stay in the branch as retained coverage for a still-open issue. Two are marked
`test.fixme` — known-failing, awaiting #161 — rather than left failing, because they call
`skipIfElevated()` and CI runs ELEVATED: left as-is they would skip in CI and fail on a developer's
machine, making the branch's green depend on which machine ran it. The third is a live green fence.
What was learnt (the reported "empty panel" is really a STALE one; `fileMissing` cannot carry the
banner because FR-105 needs it silent on exactly the remount where the banner must appear) is
recorded on issue #161.

**Related, not fixed here**: #201 (raised from this branch while investigating #186).

---

## Why this spec is unusual

The tests came first. `feature/S026-v1-defects-and-tweaks` already carries 29 committed tests — **16
deliberately failing, 13 green** — written by replicating each issue against the running app before
any requirement was drafted (Constitution Principle V: Red before Green).

That order changed the answers. **Four issues describe a cause that measurement contradicts**, and a
fifth — #198 — describes a defect that does not reproduce at all, which is why it is deferred rather
than fixed. A sixth — #161 — was built and then reverted (below). Had the spec been written from the issue bodies, it would have specified fixes for things
that are not happening.

**Where this spec and an issue body disagree, this spec is authoritative.** Every correction is
recorded as a comment on its own issue, so the record is not confined to this branch.

The committed tests are the acceptance surface, and the suite is green — everywhere, not just in CI.
Deferring #198 removes no tests (it contributed 4 green fences); deferring #161 leaves two marked
`test.fixme`, which is how a known-failing test waits for the issue it belongs to without making the
bar lie.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rename a file or folder to change only its capitalisation (Priority: P1)

A user tidying a project wants `job specs` to read `Job Specs`, or `readme.md` to read `README.md`.
Today the application refuses, telling them a file or folder with that name already exists — which is
true only in the sense that the item collides with *itself*.

**Why this priority**: A legitimate, ordinary operation is refused outright, and the refusal message
actively misleads: it describes a conflict with another item when there is none. There is no
workaround inside the application other than a two-step rename through a throwaway name.

**Independent Test**: Rename a folder and then a file so only their letter casing changes; both
succeed and the tree shows the new casing without a manual refresh. Delivers the whole of #194 with
nothing else in the feature present.

**Acceptance Scenarios**:

1. **Given** a folder named `Job specs`, **When** the user renames it to `Job Specs`, **Then** the
   rename succeeds and the tree shows `Job Specs` without a manual refresh.
2. **Given** a file named `readme.md`, **When** the user renames it to `README.md`, **Then** the
   rename succeeds and the tree shows `README.md`.
3. **Given** a file named `same.txt`, **When** the user confirms the rename without altering a single
   character, **Then** nothing moves, nothing is announced, and no error appears.
4. **Given** two files `one.txt` and `two.txt`, **When** the user renames `one.txt` to `two.txt` or to
   `TWO.TXT`, **Then** the rename is refused with the existing "already exists" message and neither
   file changes.
5. **Given** a file open in an editor, **When** its name is changed only in casing, **Then** the
   editor follows the file to its new path and continues to show its content.

---

### User Story 2 - See the file tree stay correct while the machine is busy (Priority: P1)

A user runs a build, an install, or a git operation in their project — the kinds of work that churn
`node_modules`, `.git` and build output. While that runs, the Files & Folders tree silently stops
reflecting the filesystem: files they create do not appear, files they delete do not go. It catches
up later, on some unrelated action, with no indication it was ever behind.

**Why this priority**: The tree is not merely stale, it is *confidently wrong* — it presents an
out-of-date listing with the same authority as a correct one, exactly when the user is most likely to
be acting on it. Every file operation the user performs from a stale tree targets a filesystem that
no longer looks like what they were shown.

**Independent Test**: With a directory being written to continuously, create a file elsewhere in the
project and confirm it appears while the churn is still running. Delivers #186 on its own.

**Acceptance Scenarios**:

1. **Given** a project whose folders are being written to continuously, **When** the user creates a
   file in that project, **Then** it appears in the tree within 1 second, while the churn is still
   running.
2. **Given** a burst of many rapid changes, **When** they settle, **Then** the tree has refreshed a
   small number of times rather than once per change.
3. **Given** a file created outside the application, **When** no user action is taken, **Then** it
   appears in the tree.
4. **Given** a file deleted outside the application, **When** no user action is taken, **Then** it
   disappears from the tree.
5. **Given** a file or folder deleted from inside the application, **When** the delete completes,
   **Then** the node leaves the tree immediately, **even if** no filesystem notification arrives.
6. **Given** the underlying watch reports a runtime failure, **When** the user next changes a file,
   **Then** the change is still reflected — the tree is not dead for the rest of the session.
7. **Given** a project is closed or switched away from, **When** the previous project's folders
   change, **Then** no watching continues on its behalf.

---

### User Story 4 - Return to a project after renaming a folder in it (Priority: P2)

A user expands a folder, renames it, then switches project or restarts. On returning, either an error
tells them a folder they renamed on purpose cannot be listed — naming its old name — or the folder is
silently no longer expanded.

**Why this priority**: Both outcomes are wrong but neither destroys or hides data, so it sits below
the two P1 stories. It is nonetheless a per-session irritation that erodes trust in the tree's
memory.

**Independent Test**: Expand a folder, rename it, leave the project and return; the folder is present
under its new name, still expanded, and no error appears.

**Acceptance Scenarios**:

1. **Given** an expanded folder renamed inside the application, **When** the user leaves the project
   and returns, **Then** the folder is expanded at its new name and no error appears.
2. **Given** the same, **When** the user restarts the application instead of switching project,
   **Then** the same holds.
3. **Given** an expanded folder renamed **outside** the application while the project was closed,
   **When** the user reopens the project, **Then** the tree shows the folder as it actually is and no
   error is raised about the old path.
4. **Given** a user-initiated action that genuinely fails to list a folder, **When** it fails,
   **Then** the user is still told. *(Silencing restore failures must not silence real ones.)*

---

### User Story 5 - Read a status bar that isn't repeating the title bar (Priority: P3)

The status bar shows the project's colour dot, its name, the active `Tab · Panel` context, and an
ADMIN pill — every one of which the title bar two rows above already shows, from the same source.

**Why this priority**: Nothing is broken; the display is correct, merely redundant. It costs the user
nothing but screen space and a moment's double-take.

**Independent Test**: Open a project and confirm the status bar shows only the project's root folder
path, while the title bar is unchanged.

**Acceptance Scenarios**:

1. **Given** an open project, **When** the user looks at the status bar, **Then** it shows the
   project's root folder path and none of: the colour dot, the project name, the `Tab · Panel`
   context, the ADMIN pill.
2. **Given** the same, **When** the user looks at the title bar and the window/taskbar title,
   **Then** both are exactly as before, including the project colour and the `[ADMIN]` marker.
3. **Given** the status bar, **When** its content is reduced, **Then** it keeps its height, theming
   and test hook, and nothing else in the window shifts.

---

### User Story 6 - Use the shell's own keyboard shortcuts in a terminal (Priority: P3)

The two pane toggles ship on `Ctrl+B` and `Ctrl+N` — tmux's prefix key and readline's next-history.
A terminal-centric user meets a collision on chords they press constantly.

**Why this priority**: Both are rebindable today, so a user who notices can fix it in a minute. It is
a poor shipped default rather than a defect.

**Independent Test**: Check the shipped defaults and confirm the pane toggles respond to the new
chords and that the old ones are unclaimed.

**Acceptance Scenarios**:

1. **Given** a fresh installation, **When** the user presses the new pane-toggle chords, **Then** the
   Projects and Files & Folders panes toggle.
2. **Given** a fresh installation, **When** the user presses `Ctrl+B` or `Ctrl+N`, **Then** no
   application command claims them.
3. **Given** a user who has explicitly saved their own bindings, **When** they upgrade, **Then** those
   bindings are unchanged — including when they still hold the old `Ctrl+B` / `Ctrl+N` values.
4. **Given** the new chords, **When** they are checked against every shipped binding, **Then** neither
   collides in any scope, and both remain rebindable.

---

### Edge Cases

- **A rename to a name differing only in casing, where a *different* sibling already holds that
  spelling.** Must still be refused — self-collision and real collision have to be told apart.
- **A rename that changes casing while an editor is open on the file.** The path changes, so the
  editor must follow it; treating a case-only rename as "nothing moved" would strand the editor.
- **Churn that never stops.** The tree must refresh on a bounded schedule rather than waiting for a
  quiet moment that may never come.
- **A burst of changes.** Must not become one refresh per change — coalescing has to survive the fix.
- **A watch that fails at runtime, then a project switch.** Retrying must not outlive the switch, or
  a closed project keeps being watched.
- **A watch that cannot be re-established at all.** Retrying must terminate and tell the user, rather
  than looping silently — a tree that is permanently wrong without saying so is the original defect.
- **An intermittent failure nobody can reproduce.** Anything this feature hides from the user must
  still be reconstructable from the diagnostic record; four of this feature's six issues were
  mis-diagnosed precisely because the failure left nothing behind.
- **An in-application delete that fails.** The item must come back into the tree, because an
  optimistic removal left in place is a file the user believes is gone while it sits on disk.
- **A restored path whose file has changed while it was away.** The editor must show what is on disk
  now, not what it remembers.
- **A restored path where the editor holds unsaved edits.** Recovery must not discard the user's work
  without asking.
- **Saving while an editor cannot read its file.** The remembered text must not go over the
  unreadable path without the user confirming — this is the data-loss route the banner exists to
  interrupt.
- **A user who saved their bindings back when `Ctrl+B` was the default.** They keep the colliding
  chord; nothing rewrites it. Accepted, and stated where they will see it.
- **A persisted expansion for a folder deleted outside the application.** Discarded silently — the
  user has already stopped caring about it.
- **Hiding the status bar.** Must not remove the user's only route to anything (Constitution
  Principle VI); the root folder path is the only thing it will carry.
- **Terminal links.** Out of scope (#198 deferred), but the retained fences mean any incidental change
  must still leave every link shape opening exactly once, a plain click doing nothing, and non-HTTP
  schemes refused.

---

## Requirements *(mandatory)*

### Functional Requirements

**Renaming (#194)**

- **FR-001**: The system MUST complete a rename in which only the letter casing of the name changes,
  for both files and folders.
- **FR-002**: The system MUST continue to treat a rename to the byte-identical current name as a
  silent success that moves nothing and announces nothing.
- **FR-003**: The system MUST continue to refuse a rename that would collide with a **different**
  existing sibling, in any casing, with the existing message.
- **FR-004**: The system MUST re-point any editor open on a renamed item to its new path, including
  when only the casing changed.
- **FR-005**: The system MUST resolve the inconsistent name-collision rule that is currently exposed
  as shared public logic but not used by the rename path, so that only one collision rule exists.

**File tree liveness (#186)**

- **FR-006**: The system MUST report a filesystem change **no more than 1 second** after it occurs,
  regardless of how continuously changes are arriving.
- **FR-007**: The system MUST continue to coalesce bursts of changes, so that a burst produces far
  fewer refreshes than it does changes — quantified by SC-003.
- **FR-008**: The system MUST reflect a file or folder created, deleted, renamed or moved outside the
  application, with no user action.
- **FR-009**: The system MUST remove a deleted item from the tree immediately on an in-application
  delete, without depending on a filesystem notification arriving.
- **FR-009a**: If that delete then fails, the system MUST restore the item to the tree and report the
  failure — an optimistic removal MUST NOT be left standing for an item still on disk.
- **FR-010**: On a runtime failure of the underlying watch, the system MUST re-establish watching,
  retrying with a backoff, so the tree keeps working through transient failures.
- **FR-010a**: If re-establishment is exhausted without success, the system MUST tell the user, rather
  than continuing to retry silently against a tree it can no longer keep current.
- **FR-010b**: The system MUST write a diagnostic record for each watch failure, each retry, and the
  final escalation — so an intermittent failure that is correctly silent to the user still leaves
  evidence for whoever investigates it.
- **FR-011**: The system MUST NOT continue watching, or retrying a failed watch, after watching has
  been stopped or re-pointed.
- **FR-012**: Refreshing MUST preserve the tree's expansion state and selection.

**Project re-entry (#197)**

- **FR-020**: The system MUST carry a folder's expansion state across a rename, so the folder is still
  expanded afterwards and remains so on re-entry.
- **FR-021**: The system MUST discard silently any remembered tree state that can no longer be
  resolved on restore — a stale restore MUST NOT raise a user-facing error — and MUST write a
  diagnostic record of what was discarded and for which project.
- **FR-022**: The system MUST continue to report a failure of a **user-initiated** listing.
- **FR-023**: FR-020 to FR-022 MUST hold across both a project switch and an application restart.

**Status bar (#166)**

- **FR-024**: The status bar MUST NOT show the project colour dot, the project name, the
  `Tab · Panel` context, or the ADMIN pill.
- **FR-025**: The status bar MUST continue to show the active project's root folder path, and MUST
  keep its height, theming and test hook.
- **FR-026**: The title bar and the operating-system window title MUST be unchanged.
- **FR-027**: The requirements that currently mandate the removed status-bar content MUST be amended
  so specification and implementation agree.

**Pane toggle defaults (#165)**

- **FR-028**: The shipped default chords for the two pane toggles MUST move off `Ctrl+B` and
  `Ctrl+N`, and no shipped default MUST claim those two chords in any platform set.
- **FR-029**: The new chords MUST NOT collide with any other shipped binding in any scope, and both
  toggles MUST remain rebindable with unchanged reassignment behaviour.
- **FR-030**: Existing user-saved bindings MUST be left untouched — only the shipped defaults change
  — and that behaviour MUST be stated where users will see it.
- **FR-031**: Documentation and tests citing the old chords MUST be updated.

**Deferred: terminal links (#198)**

- **FR-032**: Terminal link routing MUST NOT be changed by this feature. #198 is deferred unreproduced;
  its four "exactly once" tests stay in the branch as fences, so any incidental change must still
  leave every link shape opening exactly once, a plain click doing nothing, and non-HTTP addresses
  refused.

**Feature-wide**

- **FR-033**: All 16 currently-failing committed tests MUST pass, and all 13 currently-passing
  committed tests MUST continue to pass.
- **FR-034**: Every user-visible change in this feature MUST ship with end-to-end coverage, per
  Constitution Principle V.

### Key Entities

- **Tracked item**: a file or folder shown in the tree. Identified by its path relative to the project
  root — which is what makes a rename able to strand state keyed to it.
- **Remembered tree state**: per project, which folders are expanded and what is selected. Survives
  project switches and restarts; must follow items when they are renamed or moved.
- **Open document**: a file open in an editor, holding the path, the text on screen, and the
  application's belief about what is on disk. The gap between the last two is what makes an
  unreadable path dangerous rather than merely inconvenient.
- **Change notification**: the signal that something under a project root changed. Has a delivery
  deadline (FR-006) and a coalescing budget (FR-007), and can fail (FR-010).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can change a file or folder's capitalisation and see the new name in the tree, on
  100% of attempts, with no intermediate name and no manual refresh.
- **SC-002**: While a project is being continuously written to, a change made by the user is visible
  in the tree **within 1 second** — where today, under the same conditions, it is never shown at all
  for as long as the writing continues.
- **SC-003**: A burst of 40 rapid changes produces fewer than 10 tree refreshes.
- **SC-004**: An item deleted in the application leaves the tree immediately, on 100% of deletions,
  including when no filesystem notification is delivered.
- **SC-007**: Renaming a folder, leaving the project and returning produces zero error messages and
  leaves the folder expanded.
- **SC-008**: The status bar and title bar share no text.
- **SC-009**: Zero shipped default chords collide with `Ctrl+B` or `Ctrl+N`.
- **SC-010**: One Ctrl+click on a link still opens the browser exactly once, for every link shape
  tested — unchanged by this feature, and proven so.
- **SC-011**: All five in-scope issues close with a fix; #198 and #161 remain open, each with the
  evidence for why it was not fixed here recorded on the issue.
- **SC-012**: A failed in-application delete leaves the item visible in the tree, on 100% of failures.
- **SC-013**: Every behaviour this feature makes deliberately invisible to the user — a discarded
  stale restore, a watch failure and its retries — is recoverable from the diagnostic record without
  reproducing it.

---

## Assumptions

- **The corrections in this spec outrank the issue bodies.** Where an issue names a cause that
  measurement contradicts, the measurement governs. Each correction is recorded on its own issue.
- **#194's shared naming logic is corrected, not deleted.** It is exported public logic carrying the
  same faulty assumption; correcting it is lower-risk than removing an export, and FR-005 requires
  only that one rule survive.
- **#186 keeps coalescing.** The fix bounds the delay; it does not remove the batching. Removing it
  would trade a stale tree for one that refreshes on every write.
- **#186's in-application delete is fixed even though it currently appears to work.** It is the one
  mutation that relies wholly on a filesystem notification; today a working watch hides that, and any
  gap exposes it.
- **#198 is deferred, not closed.** It does not reproduce, so there is nothing to fix responsibly.
  Building a de-duplication against the reported cause would change link routing to solve something
  that is not happening. It stays open for whoever can reproduce it; the four fences stay in the
  branch regardless.
- **The six issues are independent.** They share no code and can be delivered and released in any
  order; the priorities express user impact, not sequencing.
- **#201 is out of scope.** Raised from this branch while investigating #186 and related to it, but
  neither caused nor fixed here.
- **Windows is the target.** Case-insensitive filesystem behaviour is assumed throughout; anything
  platform-specific stays behind the existing platform boundary.
- **Diagnostics use the existing diagnostic record**; this feature adds entries to it and does not
  introduce a new logging surface, retention rule or format.
- **The committed tests define done.** Where a test and prose disagree, the test is the requirement.
  The exception is the three `editor-stranded-recovery` tests: they belong to deferred #161, two are
  `test.fixme` pending it, and they are NOT a claim about this feature.

---

## Clarifications

### Session 2026-07-31

- Q: #161 (stranded editor) was implemented and then REVERTED — should it stay in this feature scope?
  → A: **No — deferred, exactly as #198 is.** The banner, Reload from disk and auto-recovery all
  worked and two of its three tests went green, but the change reddened the tab-open missing-file
  notice on both of its cases (FR-100/FR-105 — the notice fired on remounts that rule exempts).
  Trading one issue fix for another issue regression is not a fix. User Story 3, FR-013 to FR-019
  and SC-005/SC-006 are removed; the three tests stay as retained RED coverage for the still-open
  issue, and what was learnt is recorded on #161.

### Session 2026-07-30

- Q: Do existing user-saved keybindings holding the old `Ctrl+B` / `Ctrl+N` defaults get migrated to
  the new chords, or left untouched? → A: **Left untouched.** Only the shipped defaults change. A
  saved binding is an explicit choice, and nothing on disk distinguishes "the user chose `Ctrl+B`"
  from "`Ctrl+B` was the default when this was written" — so rewriting it would silently override
  some users' decisions in order to help others. Accepted consequence: a user with a saved config
  keeps colliding with their shell until they rebind by hand.
- Q: How does an editor that cannot read its file present that? → A: **A persistent banner above the
  content, which stays visible.** The banner names the path, says the text below is the last content
  read rather than the file, and offers **Reload from disk**. The remembered text is kept because it
  may be the user's only surviving copy; what is removed is its ability to pass for the file. Saving
  is guarded while the editor is in this state.
- Q: What is the longest a filesystem change may go unreported while the project is being written to
  continuously? → A: **1 second.** Under continuous churn the tree refreshes at least once per
  second; when quiet it still coalesces on the existing short delay, so ordinary editing is
  unaffected.
- Q: When the filesystem watch fails at runtime, does it resume watching or tell the user? → A:
  **Re-establish with a backoff, and escalate to the user only once retries are exhausted.** The tree
  survives the transient Windows failures that prompted the original error handler, and the user is
  interrupted only when the failure is genuinely unrecoverable. Retrying must stop on dispose.
- Q: #198 does not reproduce — when does that investigation stop? → A: **It is deferred out of this
  feature now.** 026 covers six issues; #198 stays open for whoever can reproduce it. Its four
  "exactly once" tests remain in the branch as regression fences, and link routing is not touched.
- Q: What does "saving is guarded" mean when an editor cannot read its file? → A: **Confirm, then
  proceed.** The user is warned that the content is what was last read rather than the file, and the
  save goes ahead if they confirm. Saving is never blocked or silently redirected — the buffer may be
  their only copy, so the hazard is saving it unknowingly, not saving it.
- Q: An in-application delete removes the node optimistically; what if the delete then fails? → A:
  **Restore the node and report the failure.** Leaving it removed would show the user a file as gone
  while it sits on disk — the same class of untruth this feature exists to remove.
- Q: Two requirements deliberately hide things from the user (FR-021 discards stale tree state
  silently; FR-010 retries a failed watch quietly). Should either leave a diagnostic trace? → A:
  **Both are logged to diagnostics.** Silent to the *user* is the right behaviour; silent to
  *everyone* is how #186 survived four wrong candidate causes. The discarded state and every watch
  failure, retry and escalation go to the existing diagnostic record.

---

## Context: what was measured *(informative, non-normative)*

Recorded so planning starts from evidence rather than from the issue text. Nothing here is a
requirement; the requirements are above.

| Issue | The issue says | What was measured |
|---|---|---|
| #194 | Two collision checks reject it, one in shared naming logic | Only the file-operation path rejects. The shared helper is called from nowhere in the application, so it is not a live cause — though it carries the same faulty rule |
| #186 | Four candidate causes, led by a watch that dies on error | None of the four is what fires. Every reported symptom passes in isolation. The reproduced cause is that the refresh delay restarts on every change and has no ceiling: 180 changes across 3 seconds of continuous writing produced **zero** refreshes, the first arriving only once the writing stopped |
| #186 | A second window re-points the one watcher | Impossible — the tree exists in one window only, so there is a single caller |
| #186 | In-application delete has no optimistic update | Correct, and currently masked by a working watch. Exposed by any gap |
| #197 | Re-entry raises an error naming the old path | True only for a rename made **outside** the application. A rename made **inside** it loses the expansion **silently** instead — two defects, one report |
| #161 | The panel comes up empty | It comes up **populated with remembered text**, looking ordinary, over a path that cannot be read. Worse than empty |
| #161 | Does move-away-and-back while running also strand it? *(open question)* | **No — it already recovers.** Answered; now a regression fence |
| #198 | Ctrl+click opens the browser twice | **Does not reproduce.** One click, one open, for all three link shapes. The two link mechanisms cannot both fire for one click — the second is consulted only when the first found nothing. **This measurement is why #198 is deferred rather than fixed** |

### The committed tests

| Layer | File | Red / Green |
|---|---|---|
| unit | `packages/core/tests/unit/pane-toggle-defaults.test.ts` | 4 / 0 |
| unit | `packages/ui/tests/unit/file-watcher-error-recovery.test.ts` | 1 / 1 |
| integration | `packages/ui/tests/integration/rename-case-only.integration.test.ts` | 3 / 2 |
| integration | `packages/ui/tests/integration/file-watcher-liveness.integration.test.ts` | 1 / 1 |
| e2e | `packages/ui/tests/e2e/status-bar-deduped.e2e.ts` | 2 / 0 |
| e2e | `packages/ui/tests/e2e/explorer-live-sync.e2e.ts` | 0 / 4 |
| e2e | `packages/ui/tests/e2e/explorer-rename-reentry.e2e.ts` | 3 / 0 |
| e2e | `packages/ui/tests/e2e/terminal-link-once.e2e.ts` | 0 / 4 — *#198 deferred; fences only* |
| e2e | `packages/ui/tests/e2e/editor-stranded-recovery.e2e.ts` | 2 / 1 |
| | **Total** | **16 / 13** |

Each file's header records what was measured, which of its issue's claims it contradicts, and — where
a test passes — why it is kept.
