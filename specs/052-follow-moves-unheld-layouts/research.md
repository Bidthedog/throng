# Research: Follow Moves Into Unheld Layouts

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

The code map behind these decisions: the walk over unheld layouts is `packages/ui/src/main/moved-layout-walk.ts`
(050 R19). The per-panel rule is core's `moved-paths.ts` (`movedPathOf`, `movedPanelConfig`, `moveLayoutTabs`).
The in-app move fan-out is `packages/ui/src/main/in-app-moves.ts`. The one-buffer registry is
`packages/core/src/editor/open-registry.ts`, held by `editor-coordinator.ts`.

## R1 — One choke point for every in-app move

**Decision**: The unheld-layout rewrite runs from the in-app move callbacks' `moved` step (`in-app-moves.ts`), as
its last isolated consumer. `TransferService`'s `afterMoves` hook is removed.

**Rationale**: A rename (`files.rename`), an in-project move or its undo/redo (`files.move`), and every transfer
bracket (paste, drop, Replace, rollback, main-applied undo/redo) all close through `FilesService.onMoved` →
`createInAppMoveCallbacks().moved`. `afterMoves` sits on `TransferService` only, which is exactly why a plain rename
strands saved layouts today (#397). Hanging the walk off `moved` covers every FR-001 route by construction. The
walk is idempotent (a second walk over the same moves writes nothing), but a duplicate trigger is still removed
rather than tolerated.

**Alternatives considered**: Adding `afterMoves` to `FilesService.rename`/`move` as well — rejected: three
triggers for one event, and the next move route would be a fourth to remember.

## R2 — The rewrite moves into the daemon, as one synchronous transaction

**Decision**: A new daemon RPC, `workspace.followMoves { moves, held }`. It walks every project layout and every
sub-workspace record that `held` does not name, inside one better-sqlite3 transaction. It rewrites each record
through core's `moveLayoutTabs`, writes only the records that changed, and returns the changed ids. Main calls it
fire-and-forget from R1's step. It then broadcasts `throng:subworkspace:changed:push` for the changed
sub-workspaces, as the walk does today. `moved-layout-walk.ts` is reduced to building `held` and making that call.

**Rationale**: FR-005 forbids losing a concurrent change. Today's walk is a chain of RPC round trips:
`workspace.load` → `workspace.save` per project, then `loadSubWorkspaces` → `persistSubWorkspaces` of the whole set.
Any write can land between a read and its matching write, in either direction (`preview-purge.ts` documents both
races as accepted). The daemon is single-threaded and better-sqlite3 is synchronous. So one transaction executed by
one RPC cannot interleave with any other daemon request. `panel-name-service.ts` already does a daemon-side
read-modify-write over every layout on the same grounds.

**Cost (SC-005)**: The work is a JSON parse and rewrite per record. At 50 layouts this is well under 051 FR-021's
100 ms service bound, so it does not reopen 051. A unit-level timing case at 50 records is part of the test.
**Measured (T022, 2026-10-07, workstation, real SQLite)**: 21.3 / 16.3 / 15.6 ms over 50 records (25 projects, 25
sub-workspaces) — under a quarter of the bound.

**Alternatives considered**:
- Optimistic revisions on every layout record — rejected: every client must carry a revision through load and
  save, which is a much wider change for the same guarantee.
- Keeping the walk in main with a mutex — rejected: the mutex would cover only main's own writes. The renderers
  write through other connections.

## R3 — Sub-workspace writers stop replacing the whole set

**Decision**: Two new daemon RPCs:
- `workspace.saveSubWorkspace { subWorkspace }` upserts one record and keeps its position. A new id is appended
  last.
- `workspace.deleteSubWorkspaces { ids }` deletes those records.

Every read-all → modify → persist-all caller outside the daemon is moved onto them:
- `SubWorkspaceWorkspaceClient.save` (the sub-workspace window's own save);
- `detach-context.tsx`'s detach (create), sync-to-existing (update one) and purge-panel (update the survivors,
  delete the emptied);
- `preview-purge.ts`.

`workspace.persistSubWorkspaces` remains for any whole-set reorder, and has no other caller.

**Rationale**: R2 makes the rewrite atomic. A writer that loads the whole set, edits one record and persists the
whole set can still put back a stale copy of every other record, including one R2 just rewrote. That is FR-005's
lost rewrite reached from the other side. SC-003 races exactly this path. A per-record write touches only the record
its caller owns.

## R4 — Who holds a layout

**Decision**: Unchanged from 050 R19 / 044 O6. The active project (`isActive`) and each open sub-workspace window
(`WindowManager.childIds()`) are held. Everything else is the daemon walk's. A loaded-but-inactive project is
therefore unheld, and FR-008 is met by the walk. The renderer keeps no cache of inactive projects' layouts; a switch
re-loads from the daemon.

**The project-switch race, closed by a scoped follow**: a project switch in the same instant as a move.
- The outgoing project's flush is built from the renderer's layout. `throng:files:moved` reaches that renderer
  before main issues `workspace.followMoves` (R1's order), and R5 has already applied the move by then. So a flush
  sent after the broadcast is already followed.
- A flush sent BEFORE the broadcast was built from pre-move paths. If it lands after the walk, it would put them
  back, and the window no longer holds that project to repair it.
- So when the renderer receives `throng:files:moved` while a save of a project is still in flight
  (`layout-saves.ts` already tracks these), it chains one `workspace.followMoves({ moves, only: { projectIds: [that
  project] } })` after that save settles. `only` restricts the walk to the named records, whatever `held` says.
- The call is idempotent: it writes nothing when the save already carried followed paths. FR-005 then holds with no
  accepted residue.

## R5 — Open windows follow every panel, shown or not (FR-007)

**Decision**: On `throng:files:moved`, the renderer applies core's `movedPanelConfig` to every editor panel in its
layout, mounted or not. This covers `filePath` and `movedOut`. Today it reaches only editors with a live coordinator
document (via `movedTo`). `MovedPathSync` gains this pass. `PreviewPathSync` and `HistoryMirrorSync` already cover
every panel.

**Rationale**: An editor in a tab not shown since launch has no coordinator document, so it never receives
`movedTo`. `MovedOutLayoutSync` writes only when the moved-out flag changes. So an in-project rename leaves that
panel's `filePath` stale until the next save persists it. This is US2's stranding. The rule is the walk's own rule,
and it is idempotent, so a mounted editor that has already received `movedTo` is unchanged by the pass.

**Ordering with a held-back preview (044 FR-012)**: unchanged. Main re-announces `pathChanged` and
`history:changed` for held-back previews after the broadcast, and a window receives main's messages in send order.

## R6 — A preview collision inside a saved layout (FR-006)

**Decision**: `moveLayoutTabs` gains 044 FR-012's rule, scoped to the layout being rewritten.
- A preview whose moved path is already shown by another preview in the same layout keeps its old path and its
  history. The other preview must not itself be moved by this batch, which is the "was already there" test in
  `PreviewService.moved`.
- Previews in other layouts are not consulted. A saved layout holds no preview runs. Two layouts that each show the
  same file meet 044's open-time rule (focus the existing preview) when both are opened, which is already today's
  behaviour for two saved layouts naming one file.

## R7 — Replace onto an open file: one document, two panels (FR-010 – FR-013)

The situation: `a.md` is moved with Replace onto `b.md`. Panel A shows `a.md`, panel B shows `b.md`.

**Today**: `dispose` trashes `b.md` under B's editor. Then `markMoved` re-registers `b.md` to A's document and
silently overwrites B's registry claim. Two documents now name `b.md` (#111).

**Decision — a linked panel**. The coordinator gains one concept: a panel may show **another panel's document**.
- In `markMoved`, when a document's new path is claimed by a different panel's document (the replaced file):
  - **The replaced document is clean** (FR-011): it is disposed. Panel B becomes linked to A's document, and the
    coordinator records `linkedTo: A` against B. B's views adopt A's document state through the existing reset
    relay, sent under B's panel id. Every later relay for A's document is sent to B's panel id as well. That is the
    existing multi-view fan-out, keyed by a second panel id. The registry keeps one claim: A's.
  - **The replaced document is dirty** (FR-012): it is not merged and not linked. It becomes **replaced**. The
    buffer, dirty state and undo history are kept, and its claim and watch are released. This is exactly how a
    document moved out of its project is detached (050 FR-035, `moveDetached`).
    - The panel shows one inline notice: the file was replaced, and the changes are kept. Save As is available.
    - A plain Save never writes over the moved file. It answers with the same refusal shape as a moved-out
      document (`saveMovedOut`): use Save As.
    - Discard drops the buffer and links the panel to A's document, which is FR-011's outcome.
- **Persisted**: a linked panel's config carries `linkedTo: <panelId>` and keeps `filePath`, so the path is still
  readable by every path-following rule.
  - On restore, a linked panel whose owner panel is mounted links again.
  - One whose owner is gone loads its `filePath` itself as an ordinary editor. The link is dropped, and nothing is
    shown to the user.
  - Closing the owner while a linked panel remains transfers the document to the linked panel, which becomes the
    owner. No buffer is lost and nothing is reloaded.
- **Undo** (FR-013): the undo moves `b.md` back to `a.md` and restores the original `b.md` from the bin (050).
  - A's document follows to `a.md` (`markMoved`).
  - A linked panel whose shared path is left behind unlinks. Once the restored `b.md` exists (`markRestored`, which
    runs after the bracket), it loads `b.md` as its own document again.
  - A replaced document re-claims `b.md` when it returns: the same reclaim rule `moveDetached` applies to a document
    coming back into its project. Its unsaved changes are still unsaved.

**Why not the alternatives**:
- Re-pointing panel B at A's panel id — rejected: a panel's id is its identity in the layout, history and recovery
  store, and two panels sharing an id breaks every one of them.
- Closing panel B — this is option C, which the user declined (Clarifications, 2026-10-07).

**Only one side open**:
- Only `b.md` open and clean: B reloads from disk through the folder watch and shows the moved content. There is one
  document, at its own path, and today's behaviour already meets FR-011. A test pins it.
- Only `b.md` open and dirty: NOT already met — review found 050's path leaves a plain Ctrl+S free to write over the
  moved file. `markMoved` therefore also settles a pair's destination claimed by a document that did not move
  there: dirty → `replaced`, exactly as when both are open.
- Only `a.md` open: an ordinary move.

## R8 — Failure (FR-009)

**Decision**: Inside `workspace.followMoves`, each record is rewritten in its own try/catch within the transaction.
A record that fails to parse or to serialise is skipped unchanged and logged once (`[workspace] followMoves skipped
<kind> <id>: <reason>`). A record that did not restore is never written, as today. A thrown transaction is logged by
main's caller and never fails the move.

## R9 — Test layers

| What | Layer | Why that layer |
|---|---|---|
| Collision rule, idempotence, segment matching, chains | unit (core) | pure rule |
| `workspace.followMoves` atomic vs a concurrent save, 50 records | integration (daemon, real SQLite) | atomicity is a property of the daemon loop plus the database |
| Per-record sub-workspace writes do not clobber siblings (SC-003) | integration (daemon) | same |
| Rename, `files.move` and undo reach the walk (FR-001) | integration (`packages/ui/tests/integration`, real `createInAppMoveCallbacks`) | the wiring is the defect |
| Unmounted editor follows a move (FR-007) | component (`MovedPathSync`) | renderer state only |
| Linked and replaced panels, undo (FR-010 – FR-013) | integration (`editor-one-buffer`, coordinator with the real registry) | registry plus relays |
| Replaced notice and Save As | component | rendered notice |
| One E2E: close a sub-workspace, rename, reopen | E2E `@extended @persistence` | only a real restart shows the stranded panel; one case |
