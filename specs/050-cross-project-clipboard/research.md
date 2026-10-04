# Research: Cross-Project Clipboard

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Every decision below was taken against the code as it stands at `0fc44e5f`. Paths are repo-relative.

## R1 — Who owns the clipboard

**Decision**: a main-process `FileClipboardService` (`packages/ui/src/main/file-clipboard.ts`), in memory only.
It holds `{ mode: 'cut' | 'copy'; items: { absPath; projectId; projectRoot }[] } | null`, answers
`throng:fileClipboard:get / set / clear`, and pushes `throng:fileClipboard:changed` to **every** window on each
change. The renderer reads it through one hook, `useFileClipboard()` (`renderer/explorer/file-clipboard-store.ts`),
which replaces `useState<ClipboardState>` in `use-explorer-data.ts:381`.

**Rationale**: today the clipboard is React state inside `useExplorerData` (`use-explorer-data.ts:381`) holding
**root-relative** paths, so it is per explorer instance and meaningless after a root change — exactly what
FR-001/FR-002 forbid. Main is the one place that outlives every window and project switch, and it already owns
the one OS-clipboard record for the same reason (`clipboard-service.ts`, 016 FR-013a). Not persisted (FR-007):
nothing writes it to the daemon.

**Alternatives considered**: a renderer module-level store — survives a project switch but not FR-002 across
windows, and cannot follow moves made by main (R2). The daemon — would persist (FR-007 forbids) and adds a hop.

### R1a — Following the world (FR-009, FR-011)

- **In-app moves and renames**: `createInAppMoveCallbacks` (`in-app-moves.ts`) gains a fifth consumer,
  `clipboard.followMoves(moves)`, which rewrites every item equal to or under a moved `from` by prefix — the same
  rule 019 FR-005 applies to open editors. Fired from the same `moved` callback, so it is exact and clock-free.
- **In-app deletes**: `FilesService.setOnDeleted` fans out to the coordinator **and** `clipboard.dropDeleted`.
  Prefix rule again: deleting a folder drops every item inside it.
- **Outside throng**: not followed; the item fails at paste time (FR-013).
- **Project removed or re-rooted (FR-011)**: each item records the `projectId` **and** root it was taken from.
  After every `refreshProjectsCache()` (`main.ts:1191`, already run on `throng:projects:changed`) main calls
  `clipboard.retainProjects(idToRoot)`; an item whose project is gone or whose root differs empties the clipboard.

Paths are compared through the existing normaliser (`path-forms.ts` / `normaliseForCompare`) — the #229 trap.

## R2 — Where a paste runs: one transfer engine in main

**Decision**: a main-process `TransferService` (`packages/ui/src/main/transfer-service.ts`) runs every paste and
every drag as a **job** over **absolute** paths. `files.copy` / `files.move` stay for undo application of the
existing entry kinds (R10) but no longer serve paste or drag.

**Rationale**:

- `FilesService` resolves everything against **one** root (`files-service.ts:205`, `absOf`), so a source in
  another project is unreachable through it by construction. FR-010 needs sources from any root and the target in
  the active one, checked on real paths.
- Progress, cancel, queueing, clash prompts and rollback (FR-017 – FR-019f) all need state that outlives one IPC
  call, and the bracket (019) must enclose the whole operation. Both live in main.
- Drag shares the engine (FR-017 clash prompt, FR-018e structure, FR-019e "waits behind a running paste"), so a
  drag is a job with `showProgress: false` and no cancel.

**Serialisation**: `FilesService`'s `moveQueue` / `bracketed` (`files-service.ts:78, 564`) becomes a public
`exclusive(op)`; the transfer engine runs each job inside it. "File operations run one at a time" (FR-019e) is
therefore one queue, not two that could interleave.

**Confinement (FR-010)**: main resolves the target folder's real path and requires `isWithinRoot(activeRootReal,
targetReal)` against the root `FilesService` holds; each source's real path must be within **some** root in
`projectsByRoot` (`main.ts:1187`), refreshed before the job starts. A source outside every root is a per-item
failure, not a job failure (FR-013).

**Alternatives considered**: widening `FilesService.move/copy` to absolute sources — keeps one class but turns its
single-root invariant into a special case on every method. A renderer-driven loop of per-item IPC calls (today's
shape) — cannot hold a bracket open across items, and cannot cancel inside a file copy.

## R3 — Planning a job and finding clashes

**Decision**: the **pure** rules live in core, `packages/core/src/explorer/transfer-plan.ts`:

- `classifyTopLevel(source, targetDir, mode)` → `same-folder-duplicate` (copy → non-clobbering name, no prompt;
  cut → no-op; FR-018c / 006's drop-onto-own-parent), `into-own-descendant` (refused, existing rule), or
  `ordinary`.
- `clashKind(incoming, existing)` → `merge` (folder/folder, FR-018c), `replaceable` (file/file, file/folder,
  folder/file — the edge case "clash with a different kind").
- `keepBothName(name, siblings)` → `dedupeName(name, siblings, 'copy')` (`naming.ts`), so Keep both is the name a
  copy has always taken (FR-018a).
- `newerOf(a, b)` → which side to mark newer (FR-018).

Main supplies the filesystem facts and walks: an item whose name is free lands as a unit; a folder/folder clash
recurses one level at a time and asks about each clashing child **at whatever depth it occurs** (FR-018e). Name
equality uses `exists()` on the target, so NTFS case-insensitivity decides a clash the way the OS will.

**Decisions are per job** (Key Entities *Clash decision*): "apply to all remaining clashes" stores one answer for
the rest of that job only.

## R4 — Moving: rename, cross-volume and merge

**Decision**:

- **Same volume**: `fs.move` (a rename). Atomic; there is never a half-moved item.
- **Different volume (FR-014)**: the rename fails with `EXDEV`; the engine then copies (R5) and removes the source.
  The bracket reports the pair exactly as for a rename, so the user sees a move (FR-014, FR-016).
- **Copy landed, source removal failed (FR-015)**: the copy stays, the source stays, the item is a failure naming
  the source and its holder (the `FilesService` holder resolver, 029 FR-013), and the item contributes **nothing**
  to the undo entry and is **not** reported to the bracket (nothing moved).
- **Merge on cut (FR-018c)**: non-clashing children move individually; clashing children follow their decision; the
  source folder is removed afterwards **only if empty**. A skipped child keeps the source folder — and its path —
  alive, and it stays on the clipboard (FR-006).

The bracket opens over every source before the first change and closes in a `finally` with exactly the pairs that
moved (019 FR-001/FR-004) — the contract `moveInBracket` already honours.

## R5 — Cancelling inside a copy

**Decision**: `IFileSystem` gains `copyFileCancellable(src, dest, signal: AbortSignal): Promise<void>`
(`packages/core/src/abstractions/file-system.ts`), implemented in `node-file-system.ts` with
`stream.pipeline(createReadStream, createWriteStream, { signal })`; on abort it removes the partial `dest` before
rejecting. Folder copies walk and copy file by file through it, so Cancel lands inside a large folder or file and
never leaves a half-written item (Assumptions). The existing `copy()` (one `fs.cp`) stays for its current callers.

**Alternatives considered**: `fs.cp` — no cancellation. `copyFile` with `COPYFILE_FICLONE` — no cancellation either.

## R6 — Replace and the new setting (FR-018b, FR-018f)

**Decision**: `explorer.replaceMode: 'recycle' | 'permanent'`, default `'recycle'`, in `app-settings.ts` beside
`deleteMode`, with a `settings-metadata.ts` descriptor placed after `explorer.deleteMode` (FR-018f "shown beside
it"). Replace disposes of the existing item with `fs.trash` (recording the trash time for `restoreFromTrash`) or
`fs.delete`. The prompt's Replace label carries "(cannot be undone)" under `permanent`, and those items are left out
of the undo entry.

Replace disposes of the existing item through the filesystem seam directly, **not** through `FilesService.delete`,
so no `markDeleted` fires: an open editor or preview on the replaced file meets the watcher's change exactly as when
another program replaces a file today, and an editor with unsaved changes keeps them (edge case *Replacing an item
that is open*).

## R7 — The paste run, cancel and roll back (FR-019 – FR-019c)

**Decision**: each job keeps a **journal** in main — `placed[]` (copies it created), `moved[]` (`from`→`to`),
`replaced[]` (`path`, `trashedAt`, `kind`), `inProgress`. That journal is the *Paste run* entity, and both the undo
entry (R10) and roll back are built from it.

- **Cancel** (progress control or the clash prompt's Cancel/Escape) aborts the item in progress at once — its
  partial copy is removed and its source untouched — and the job then waits for the renderer's choice.
- **Keep finished**: the journal so far becomes the result; items not started are reported as skipped.
- **Roll back**: walk the journal in reverse — delete placed copies, move moved items back (cross-volume by R4's
  copy-then-remove), restore replaced items from the Recycle Bin. Each step that fails is collected and named in the
  run's one notice (edge case *Roll back cannot finish*). No undo entry (FR-019b).
- **Clipboard after the run (FR-006, FR-019c)**: a cut leaves exactly its items that did not move; a copy leaves the
  clipboard as it was. Main applies this itself, against the job's own snapshot of items (FR-019d) — so a clipboard
  changed by the user mid-run is left alone unless it still equals that snapshot.

## R8 — Progress, queue and the one notice (FR-019, FR-019d, FR-013)

**Decision**: one notice **per run**, in the window that started it (the main window — the only one that hosts an
explorer, 018 FR-062), owned by a renderer `paste-runs-store.ts` fed by `throng:transfer:progress` pushes.

- Raised once the run is still going **1 s** after it started (FR-019), or immediately as *Queued* for a run
  waiting behind another (FR-019d), so a queued run is visible and cancellable before it starts.
- Its body renders `done of total` (digit-grouped through `number-format.ts`) and the item in progress, with a
  **Cancel** control — a themed icon with a hover title, per the *Action controls* gate (it is a notice control,
  not a dialog decision button).
- When the run ends: no failures → the notice is dismissed; failures → **the same notice** becomes the FR-013
  failure report (error severity, one row per failed item with its 029 cause). A run that ends inside 1 s with
  failures raises that error notice directly — there was no progress notice to become it.

The notification model has no in-place update today: `notify` returns nothing and identical-content repeats only
pulse (`notification.tsx:676-848`). It gains **`notify(...)` returning the notice id** and **`update(id, patch)`**,
which replaces the live notice's fields and files a log record when its severity changes. This is additive; every
existing call site ignores the return value. It is the "one condition, one notice" rule (`CLAUDE.md`): progress
and its failures are one run, so one card.

Shown whichever project is active because the notice lives in the window, not in the explorer pane.

**"Inline, not a toast" (FR-019)** is read against the repo's own rule (`CLAUDE.md` *One condition, one notice*): a
toast is a **timed** card that can vanish before its control is reached. The run's card sits in the window's notice
stack (`.notices`, the window's one notice area) with a `display` override of *until dismissed* while it is
queued or running, and renders its Cancel control **inside** the card's body, where it stays reachable for as long
as the run lasts. It never times out while the action it carries is live. A separate banner elsewhere in the window
would be a second surface for one condition, which the same rule forbids.

## R9 — The clash prompt (FR-017, FR-018)

**Decision**: the existing `useChoose` dialog (`confirm-dialog.tsx`) — no new modal kind (Assumptions). Main asks
the window that started the job (`throng:transfer:clash`, request id); the renderer resolves it
(`throng:transfer:resolveClash`). The `details` slot carries a two-column comparison (size + modified time for a
file, item count for a folder; newer marked) and the **Apply to all remaining clashes** checkbox, whose state is
read when the choice settles. Choices in order *Cancel · Skip · Keep both · Replace*; `initialFocusValue:
'replace'` makes Enter pick Replace; Escape resolves `null`, read as Cancel. Keyboard-operable by construction
(focus trap, buttons, checkbox) — FR-026, Principle VI.

A window that disappears mid-question answers Cancel → Keep finished: the conservative choice that loses nothing.

## R10 — Undo: the entries, and undo across projects (FR-018b, FR-020 – FR-023)

**Decision**: `FileOpUndoEntry` (`packages/core/src/fileop-undo/undo-stack.ts`) gains:

- an optional `id` on every kind (a fresh id is written for every new entry; old entries parse without one);
- an optional `projects: { source: string; target: string }` on `move` — present only on a cross-project move;
- a new kind **`paste`**: `{ moved: {from,to}[]; copied: {from,to}[]; replaced: {path, trashedAt}[]; projects? }`,
  recorded only when a paste or drag **replaced** something (FR-018b). A paste that replaced nothing still records a
  plain `move` (cut) or nothing (copy, FR-022).

`plannedMoves` / `validate` cover the new kind: undo needs every `to` present and every `from` free, then frees
each replaced path by removing what replaced it before restoring; redo re-checks the reverse. `parse` accepts the
new fields and kind; an older blob still parses, and a newer one read by an older build degrades to empty, as
FR-010a already allows.

**Partial pastes (FR-023)**: the entry is built from the run's journal — exactly what moved — not from the request.
Every cut-paste now goes through the engine, so this holds within a project too.

**Applying**: entries of the existing kinds with no `projects` keep their path through the root-relative bridge
(`use-explorer-data.ts:1457`, untouched). An entry with `projects`, or of kind `paste`, is applied by main —
`throng:transfer:applyUndo(entry, direction)` — over absolute paths, each confined to some project root (R2), inside
the same `exclusive` queue and move bracket, so editors follow an undone move across projects (US3 AS1).

**One entry, two stacks (FR-020)**: the renderer records a cross-project entry in the active project's stack and,
through `FileOpUndoClient.load/save`, in the other project's. Undo or redo from either side applies once, then
moves the entry **by id** in the other project's persisted stack (undo → removed from its undo list, pushed onto
its redo list; redo the reverse). Only one explorer is mounted at a time (018 FR-062), so the other stack is never
live in memory. On load, an entry whose `projects` names a project that no longer exists is dropped (Assumptions).
Persistence and the 50-entry bound are the existing ones (FR-021).

**Language overrides across projects (FR-016)**: `documents.movePath` is per project, so a cross-project move reads
the override with `getState(source, rel)`, writes it with `setState(target, rel', state)` and clears the source —
composed in the renderer, no daemon change.

## R11 — Quit while a paste runs (FR-019f)

**Decision**: the main window's `close` handler (`main.ts:1950`) asks `transfer.busy()` first. Busy → it sends
`throng:transfer:quitPrompt`; the renderer asks *Wait · Cancel pastes* (Cancel then asks Keep finished / Roll back);
dismissal abandons the quit. *Wait* sets a quit-when-idle flag; when the queue drains main re-enters the existing
close flow, terminals prompt included. Not busy → the existing flow, untouched. This runs before every other close
prompt (FR-019f).

## R12 — After a paste (FR-025a, FR-025b)

- **Paste label**: `context-menu-items.ts:137` builds `Paste "<name>"` / `Paste N items` (digit-grouped), plus
  `from <project name>` when the items' project differs from the active one, resolved from the renderer's projects
  store. The toolbar carries no Paste control (`toolbar.tsx`), so FR-025's toolbar clause adds nothing and no
  control is added (FR-025a: no other indicator).
- **Greying (FR-004)**: `file-tree.tsx:596` compares the tree's absolute paths with the clipboard's cut items.
- **Reveal and select**: the run's result names its placed paths; a renderer `pending-reveal` map keyed by project
  id is drained by `useExplorerData` the next time that project's tree is ready (open folders → select all → focus
  first), so a run that finished while another project was showing applies when the user returns (FR-025b).

## R13 — Test layers

| Layer | What |
|---|---|
| core unit | transfer-plan rules; undo `paste` kind and `projects` (plan, validate, parse round-trip); clipboard prefix-follow |
| ui unit | settings descriptor + docs currency (existing guards), paste label builder |
| integration (real temp fs, single fork) | `TransferService`: cross-root copy/move, clash decisions, merge at depth, EXDEV fallback (fs double), FR-015, continue-past-failure, cancel keep/rollback with an abort mid-file, queue order, bracket pairs; `FileClipboardService` follow/drop/retain; `applyUndo` across roots |
| component (jsdom) | clash prompt (Enter = Replace, Escape = Cancel, apply-to-all, newer marked); progress notice update → failure morph; cut greying via the store; quit prompt |
| E2E `@extended` | cross-project copy, cross-project move with an open editor following, undo from the other project; clash prompt in-app. Budget re-seeded in the same commit |

#448's fix and its component test are already on the branch (`0fc44e5f`).

---

*Iteration 2 (Session 2026-10-03, fifth): FR-031 – FR-034.*

## R14 — When progress shows (FR-031, SC-009)

**Decision**: main decides, and says so on the progress event. `TransferProgress` gains `display: boolean`. In
`prepare`, the engine sums the size of every file the job will paste (a `stat` walk of the sources; a folder counts
its files). Over 5 MB (`5 * 1024 * 1024` bytes), it runs a **work clock** — a timer that starts with the first
item and **pauses** while a clash question or the cancel choice is open — and when that clock reaches 1 s it emits
progress with `display: true`, and every later event for the job carries it. A queued paste emits `display: true`
at once (FR-019d), and the flag stays true once it runs. The size counts the items *selected*, before any
clash decision — a skipped item still counted is a card shown a little early, never a card hidden. The `stat` walk
is the same walk the copy makes anyway and costs nothing a paste of that size does not already spend. [derived] The renderer raises the card when `display` is first true, and never on its own timer.

**Rationale**: only main knows the bytes and when a question is open. A renderer timer cannot see either, which is
the bug the user hit. Pausing the clock keeps SC-008 for real work while a prompt costs nothing.

**Alternatives**: the renderer pausing its own timer around the clash prompt (still blind to size); counting the
bytes in the renderer (it holds no paths outside the active root).

## R15 — The clash prompt layout (FR-032)

**Decision**: `clash-prompt.tsx` renders two `.clash-side` boxes in a row, incoming first, an arrow (`→`, an
`aria-hidden` glyph, the boxes carry the words) between them pointing at the existing box, the newer box with a
`.clash-side--newer` class (accent border and tint, plus the existing "Newer" label for non-colour readers).
Styles live in `theme.css` beside the dialog's, using theme tokens only — the dialog surface forbids literal
colours. Spacing: a gap between message, boxes, the apply-to-all row and the button row. 
**Alternatives**: a table (today's markup — what the user found unclear).

## R16 — Keeping structure across folders (FR-033, SC-010)

**Decision**: a pure core rule, `landingPlan(sources, targetDir)` in `transfer-plan.ts`: drop every source inside
another selected source; take the deepest folder containing all remaining sources' parents (case-insensitive on
Windows, by `path-id`); each source lands in `targetDir` joined with its parent's path relative to that folder. One
parent → every item lands in `targetDir` (today). The engine asks the rule once per job, creates a missing
intermediate folder with `mkdir` and journals it as `createdDir`; an existing folder is merged into (FR-018c), a
file where a folder is needed fails that item (named, FR-013). Roll back removes `createdDir`s newest first when
empty. The undo entry gains optional `createdDirs` on `move` and `paste`; undo removes them once empty, redo
recreates them; an entry carrying `createdDirs` is applied by main (`transfer.applyUndo`), like a cross-project one,
because the root-relative bridge cannot remove folders. Drag uses the same rule (FR-018e covers drag).
Undo leaves a created folder that is no longer empty in place, silently — what is in it now is the user's, and the
undo itself succeeded [derived]. The duplicate and no-op rules of FR-018c are judged per item at its landing
folder: `/test/a.md` pasted with `/b.md` onto the project root lands `a.md` back in `/test` as a copy-duplicate
(`a copy.md`) or a cut no-op, while `b.md` lands as usual [derived].

**Alternatives**: structure relative to the project root (lands `/test2/test/...` only by luck of depth); a flat
landing with renamed items (what the user rejected).

## R17 — No-entry cursor (FR-034, SC-011)

**Decision**: a drag's cursor comes from the last `dropEffect` set in `dragover`. Two places set a non-`none`
effect over things that cannot take a drop: the tree's window listener falls back to `'copy'` when no target chose
an effect (`file-tree.tsx`), and `useNoDropNavigation` calls `preventDefault` on every window `dragover`, which
makes the whole window a copy target for an OS drag. Both now set `dropEffect = 'none'` when no target chose one;
`useNoDropNavigation` keeps refusing the `drop` (navigation) itself. Real drop targets keep setting their own effect
(and the tree's store) as today. The flicker across panel gaps the old fallback avoided is accepted: the user asked
for no-entry everywhere a drop does nothing.

## R18 — A panel a move takes out of its project (FR-035, FR-036, SC-012)

**Decision**: main decides, in `EditorCoordinator.markMoved`. A project-owned document whose new path is outside its
owner project's root becomes **moved out**: `doc.absPath` takes the new path (the header shows it), `doc.movedOut`
is set, its registry claim is released (`unregisterPanel`, no `registerOpen`), its folder watch is dropped, and the
relay carries `{ panelId, movedTo, movedOut: true }` to every window. A moved-out document refuses Save and reads
nothing. Save As (FR-036) opens in the new path's folder and may save anywhere inside the project root that holds
the new path — the coordinator passes that root to the Save As confinement check as well as the owner's. A Save As
there leaves the document moved out, clean, at the saved path (FR-036 as amended); a Save As into its own project is
ordinary Save As and makes it an ordinary editor again. When a later `markMoved`
(undo or redo) brings the document's path back inside its owner root, it is re-registered and re-watched and
`movedOut` clears — unless the registry already has another panel on that path, in which case it stays moved out.
Previews follow the same rule in `PreviewService`: a run whose new path leaves `run.projectRoot` publishes a
`moved-out` state carrying the new path instead of reading (it is never `unreadable`).

**Rationale**: the owner check is the same confinement the load and save paths already run (006 FR-084, 018
FR-060), so moved-out is exactly "the path this panel can no longer serve". Releasing the claim is what lets the
destination project open the file (006 FR-011a) — the undo failure of MT-05 was the claim pointing at a panel the
active window does not hold.

**Alternatives**: re-owning the panel to the destination project — rejected by the user (Session 2026-10-04);
closing the panel — rejected by the user.

## R19 — Layouts no window holds (FR-016, FR-035)

**Decision**: after a transfer's moves land (paste, undo, redo, roll back), main walks the project layouts no
window holds — the `held` set and record-by-record load/save of `preview-purge.ts`, one writer per record — and
in each editor and preview panel config rewrites `filePath` (and navigation `history` entries) by the same
`movedPathOf` rule; a rewritten path outside that layout's project root also sets `movedOut: true` in the config.
The held layout is patched by the window, as today (`MovedPathSync`, `PreviewPathSync`, `HistoryMirrorSync`),
which now also copy `movedOut` into the config. A panel that mounts with `movedOut` in its config shows the moved
notice without reading the file, and `MissingFileWatcher` skips it. A rewritten path that comes back INSIDE that
layout's project root (an undo or redo) clears `movedOut` — an unheld layout holds no live claim, so FR-035's
"another editor has it" exception is settled when the panel next mounts and `openInto` answers.

**Rationale**: the "Couldn't open … (missing)" toast of MT-02 was a layout no window held keeping the old path; the
defect is FR-016's ("including for panels in other windows"), and FR-035 needs the same walk so a project shown
later, or after a restart, already says the file moved.

## R20 — Copy reproduces what a notice shows (FR-037, SC-013)

**Decision**: `notice-text.ts` builds copy text in two blocks from the same ordered part list the render walks:
first every shown part in shown order (heading, message, the affected list's groups AND ungrouped rows, the
banner's headline, path, note, retry-failed and pointer sentences), then a blank line, `Details`, and the parts
never rendered: the full 030 FR-022 subject, each row's detail (path and reason), and the raw system errors.
`panelFailureText` takes the banner's shown parts rather than four fixed facts. Every surface with a Copy control
goes through these two builders: toasts (`notification.tsx`), the shared panel banner (`panel-failure-banner.tsx`,
which the editor's `editor-failure-banner.tsx` and the preview's notices render), and the moved notice (FR-035),
which is a panel banner with Close and Copy.

**Rationale**: one list for render and copy is 030 FR-049's mechanism; the omissions were parts the copy walk
skipped (`ungrouped`) or never received (the banner's note and sentences).

## R21 — A file dropped on + (FR-038)

**Decision**: `NewTabButton` gains native `onDragOver`/`onDrop` like `TabChip`: a single file from the tree store
sets `copy`; anything else — a folder, several items, a drag from outside throng — `none`. On drop: if the file is already open in an editor (`editor.isOpen`), open it
through the existing open path, which focuses that editor; otherwise `ws.addTab()` without the rename box and
`openFileInTab` into the new tab.

## R22 — Test layers for Phase 11

**Decision**: main's rules at integration with a REAL `EditorCoordinator` + `EditorService` + `PreviewService`
on `rootA`/`rootB` (`transfer-harness.ts`, `editor-move.integration.test.ts`), the layout walk against a fake
daemon holding real layouts (`preview-purge.integration.test.ts`); the renderer's notice, read-only state, Save
gating, `MissingFileWatcher` skip and the + drop at component layer; copy text at unit (`notice-text.test.ts`).
No new E2E; `failure-copy.e2e.ts` and `explorer-cross-project.e2e.ts` assertions that encode the superseded
behaviour are updated and proven on CI only.

## R23 — Progress by bytes (FR-039, SC-014)

**Decision**: `TransferProgress` gains `bytesDone: number` and `bytesTotal: number | null`. Main already sizes the
job for FR-031 (`job.bytes`); `bytesTotal` is null until that sizing finishes, and `bytesDone` advances per file
copied and, for a large file, per chunk the cancellable copy reports. A cut within one volume is a rename, so its
bytes count as done when the item lands. The renderer draws the bar from these two numbers only.

## R24 — The progress notice (FR-039)

**Decision**: `paste-progress-notice.tsx` renders a `role="progressbar"` element: determinate
(`aria-valuenow` = percent of `bytesDone / bytesTotal`) when `bytesTotal` is known, indeterminate and animated
otherwise, using the `loading.css` shimmer and its reduced-motion rule; colours from `--accent`, `--border`,
`--bg-raised`. Text: "N of M files · <done> of <total>". Cancel is an `IconButton` on a dedicated themed icon
token (a cancel / stop glyph, not `destroy`), in a right-aligned slot of the notice body, set apart from the text,
titled "Cancel paste" (constitution: themeable icon controls).

## R25 — A file dropped on + is a drop on the new tab's empty panel (FR-038 as amended)

**Decision**: `addTab()` already creates one empty panel; the + drop fills THAT panel by the same rule a drop on an
empty panel uses (`panel-body.tsx` `openDropped`, 047 FR-077): preview when the file's default open action is
Preview (`requestPreviewOpen` with `intoPanelId`), else `setPanelType(placeholder, 'editor', { filePath })`. The
rule moves into a shared helper both call. The already-open focus applies only when it opens as an editor.

## R26 — A preview mounted moved out wins over its remembered state (FR-035)

**Decision**: a preview panel whose config says `movedOut` shows the moved notice whatever the window's preview
store remembers from before the panel unmounted, until main reports the file back inside the panel's project
(`pathChanged` with `movedOut: false`, or a config with the flag cleared); and every
"open the linked editor" entry point (header menu, content menu, status bar, panel body) is disabled for a
moved-out preview, while the route itself refuses and re-shows the notice.

## R27 — Defects not yet reproduced (FR-020 undo error, FR-033 cut)

**Decision**: each starts with a reproduction at the lowest layer that exercises the user's path end to end: the
undo of a cross-project move with a REAL coordinator and preview service holding an editor and a linked Markdown
preview; the cut through `registerTransferIpc` with the real `FileClipboardService`, within a project and across,
and the renderer's cut path in a component test. A move callback that throws during the bracket must not turn a
landed undo into a failure. A defect no test reproduces is reported to the user with what was tried.
