# Contract: preview IPC, the coordinator observer, and the `throng-preview:` protocol

**Feature**: 044 | **Requirements**: FR-010 – FR-028, FR-040 – FR-044, FR-063, FR-074, FR-084, FR-090

All channels are `throng:preview:*`, exposed on `window.throng.preview` in
`packages/ui/src/preload/preload.cts` and typed in `packages/ui/src/renderer/global.d.ts`.
`ipc-bridge-parity.test.ts` fails if a channel literal exists on one side only. Handlers live in
`packages/ui/src/main/preview-ipc.ts`; state in `preview-service.ts` (data-model §10).

**Failures are returned, never thrown across the bridge** (the `EditorService` convention,
`ui/src/main/editor-service.ts:7-8`).

---

## 1. Renderer → main

### `open` — invoke (FR-005, FR-010 – FR-012, FR-014, FR-052/053)

```ts
request:  { absPath: string; projectId: string; requesterPanelId?: string; hasParentLocally: boolean }
response:
  | { kind: 'focused'; panelId: string | null }            // a preview of this file exists or is being opened: main focused it (FR-012, FR-014); null = reservation only, nothing to focus yet
  | { kind: 'placeLocally'; reservation: string; besidePanelId: string | null }   // requester places it
  | { kind: 'placedElsewhere' }                            // main routed placement to another window (§2 place)
  | { kind: 'refused'; reason: 'no-provider' | 'disabled' | 'outside-project' | 'no-file' }   // FR-004, FR-062
```

Main's decision, in order:

1. `enabledProviderFor` and project containment (on the real path) — else `refused`.
2. A run exists for the path (compare form) → focus that panel's window, send `focus` to it, return
   `focused` with its `panelId`. Only a pending **reservation** exists → return `focused` with
   `panelId: null` and send nothing: the preview is already being placed. The renderer treats any
   `focused` as done and never looks a `null` id up. *(Amended 2026-09-15 (u7 review).)*
3. The editor registry holds a document for the path (parent exists):
   - `hasParentLocally` → `placeLocally` with `besidePanelId` = that document's panel id.
   - else → send `place` to the **main window**; on `placeDeclined`, send `place` to the window the
     registry recorded; return `placedElsewhere` (FR-010). A `place` that cannot be **delivered** — its
     window is gone or destroyed, or the send throws — counts as a decline at once, so the next window is
     tried rather than the reservation being held for the timeout. *(Amended 2026-09-15 (adversarial
     review ruling): a place sent to a closed sub-workspace's window was dropped, and Open Preview did
     nothing for 10 s.)*
   - **Open Preview is never a silent no-op.** If every window that might hold the parent is gone while
     `open` is still deciding, `open` answers `placeLocally` with `besidePanelId: null`, keeping the
     reservation for the requester, which places it standalone. If the last of them declines later, main
     sends the **requesting** window a final `place` with `besidePanelId: null`, which it places standalone
     (§2). Parenting is derived (FR-013), so either preview still follows the document. Only a decline, or
     an undelivered send, of that last `place` releases the reservation. *(Amended 2026-09-15 (review of
     fix batch B, M-1): with the parent's window gone, Open Preview released the reservation and then did
     nothing at all.)*
4. No document → `placeLocally` with `besidePanelId: null` (standalone, FR-011).

A reservation holds the path for `OPEN_RESERVATION_TIMEOUT_MS` (10 s — a Principle X deviation recorded
in the plan's Complexity Tracking) or until `attach` consumes it — so two opens in quick
succession can never produce two previews. The timeout is a guard against a window that dies
between reservation and mount, not a user-facing value.

### `attach` — invoke (FR-066, FR-022 viewers)

```ts
request:  { panelId: string; projectId: string; filePath: string; reservation?: string; history?: PersistedHistory }
response:
  | { ok: true; update: PreviewUpdate }                    // the current snapshot (§2)
  | { ok: false; reason: 'no-provider' | 'disabled' | 'outside-project' }   // FR-067: the renderer clears the panel
  | { ok: false; reason: 'failed' }                        // an unexpected error: the renderer keeps the panel and shows its failure banner (Try again)
```

A refused attach releases the reservation it carried. A `destroyed` that arrives while `attach` is
still in flight wins: the attach leaves no run behind and answers `failed` (the panel is already gone).
If the destroy lands after the path was claimed (during the disk read), `openChanged { open: true }`
is followed by `{ open: false }`; otherwise nothing is broadcast. An
attach whose `projectId` differs from an existing run's is refused `outside-project` (Principle I).
`refresh` for an unknown panel answers `{ update: null }`. *(Amended 2026-09-15 (u7 review).)*

Adopt-if-absent: if main already has a run for `panelId` (another window attached first), the
persisted `filePath` and `history` are ignored and the run's state is returned — one preview, one
state (FR-022, FR-110). The first attach of a brand-new preview records its first history entry
(FR-103b).

**Which persisted field wins on restore.** When main has no run, the file the run opens on is the
**current entry of the persisted `history`** (after `parseHistory`), and `filePath` is used only when
`history` is absent or empty (a layout written before 044, or a first attach). The two can only
disagree if a layout was saved between the two mirror writes, and the history is the one that also
carries Back/Forward; `config.filePath` is a fallback and a convenience for canonicalisation, never a
second authority.

**History record.** `attach` also adopts (or creates) the panel's `NavigationHistoryService` record —
`historyService.attach(panelId, 'preview', history)` — so a preview never calls `throng:history:attach`
itself. `throng:history:changed` is broadcast to every window (contracts/navigation-history.md §2), so
the preview's window receives it for `history-store`, the header buttons and menu items, and
`HistoryMirrorSync` exactly as an editor's window does; no viewer registration is involved.

**Persisted mirror.** Whenever a run's `filePath` changes — a link followed in place (FR-090a), a Save
As re-point (FR-013c), a move — main **broadcasts** `pathChanged` (§2) to every window, and each window
writes `config.filePath` for that panel if its layout holds it, skipping an identical value. It is a
broadcast, not a viewer update, because a preview in a background tab has detached and would otherwise
never hear it — the failure `moved-path-sync.tsx`'s header records for editors.

### `openPaths` — invoke (FR-012, FR-014)

`request: void` → `response: string[]` — the compare-form paths (`normaliseForCompare`) that have a run
now. A window seeds its open-preview store with it once, after subscribing to `openChanged`: broadcasts
that arrive before the reply are buffered and applied **after** the seed, so an `open: false` in flight
wins. Without the seed, a window created after a preview opened (a sub-workspace window, a reload)
would draw Open Preview enabled and the status-bar button unpressed. *(Amended 2026-09-15 (US1 review).)*

### `detach` — send

`{ panelId }` — this window stops viewing the run. The run is dropped when its last viewer leaves **and**
the panel was destroyed (see `destroyed`); a view merely unmounted by a tab switch detaches and
re-attaches.

### `destroyed` — send (FR-042, FR-110)

`{ panelId }` — the preview panel no longer exists. Drops the run, its watch, its reservation and its
path registration, calls `NavigationHistoryService.purge(panelId)` (so every route that removes a
preview — Close Panel, Clear panel type, `PreviewProviderSync` — purges its history in one place), and
broadcasts `openChanged`. **Never prompts and never touches the source document** (FR-042, FR-110).
Sent by the renderer from `destroyPanel`, remote destroy, a preview's **Clear panel type** (before
`clearPanelType`), and `PreviewProviderSync`.

**Which view sends it** (`viewEndsPreview`, editors' `killsSession` rule): every view in the main
window; in a sub-workspace window, the sub-workspace's own panels, and any preview whose
`config.placedInLayoutProjectId` is that window's layout — the previews opened THERE. A project preview
synced into the window is a second view of a run the project still shows, and only forgets this window's
mirror. The placing layout is on the panel rather than in renderer memory because a preview restored
after a relaunch is otherwise indistinguishable from a synced one, and a run no window will end is a run
main keeps for a file the user can no longer preview (FR-012, FR-014). *(Amended 2026-09-16 (review of
the 2026-09-15 iteration, finding 2).)*

### `navigate` — invoke (FR-090a–c, FR-106, FR-115)

```ts
request: {
  panelId: string;
  target: { absPath: string; fragment?: string };
  intent: { kind: 'link' } | { kind: 'history'; index: number } | { kind: 'heading' };   // 'heading': iteration 2026-09-15, FR-115
  leavingViewState?: unknown;                              // stored on the entry being left (FR-107)
  arrivingViewState?: unknown;                             // 'heading' only: where the jump landed (FR-115)
}
response:
  | { kind: 'shown'; update: PreviewUpdate; fragment?: string }   // fragment passed back untouched for the renderer's heading lookup
  | { kind: 'focusedOther'; panelId: string }              // FR-090c, FR-106b: this preview unchanged
  | { kind: 'openedInEditor' }                             // FR-090d: no enabled provider → Files & Folders route
  | { kind: 'refused'; notice: PreviewNotice }             // FR-090e, FR-106c: position does not move
```

- `intent: 'link'` → `leavingViewState` is stored on the current entry, then on `shown`,
  `history.recordOpen`. A missing target file → `refused` with `link-missing-file`; never creates a
  file (FR-090e).
- **An existing target whose `fragment` names no heading is still `shown`**, with the fragment passed
  back untouched: main does not parse headings. The renderer, having rendered the target, finds no
  heading for the slug, shows the file from its top and raises one `link-missing-heading` notice
  through `onNotice` (FR-090e, second sentence). The same applies to `focus` with a fragment
  (FR-090c). A same-document heading (FR-090f) that is **not** found never reaches main; one that is
  found reaches it only as `intent: 'heading'`, below. *(Amended 2026-09-15 (iteration, FR-115): was
  "which never reaches main".)*
- **Every result that changes the run is pushed to the run's other viewers** as an `update`
  (with `viewState` when the intent was `history`) — including a same-file history step, which changes
  only the place, not the content (FR-115) — so a preview shown in two windows (Sync to) moves in both
  when Back is pressed in one (FR-110); the invoking window takes the same update from the response.
- `intent: 'history'` → `leavingViewState` is stored on the **current** entry first (so Forward after
  Back returns to where the reader had scrolled — FR-107, User Story 7 scenario 3), then on `shown`,
  `history.moveTo(index)`; the response's update carries the target entry's `viewState`. On
  `refused` or `focusedOther` the stored view state stays — it describes where the reader still is. A **missing** file still returns `shown`
  with a `deleted` notice, and an **unreadable** one (an I/O error) `shown` with an `unreadable` notice, so
  the position moves (FR-106d, amended). A refused file (binary, too large,
  outside, no enabled provider) returns `refused` and the position does not move (FR-106c).
- `intent: 'heading'` *(iteration 2026-09-15, FR-115)* → sent by the renderer after it has scrolled a
  preview to a heading **found** in the file it already shows — a same-document heading link, or a `file`
  link naming the current file **with** a fragment. `target.absPath` is the run's current file,
  `target.fragment` the heading as written; **both** `leavingViewState` and `arrivingViewState` are sent,
  the top of the document being `{ line: 0, offsetRatio: 0 }`, never omitted. Main checks that
  `target.absPath` is the run's current file (`samePath`, canonicalised); if so it calls
  `NavigationHistoryService.recordJump(panelId, leavingViewState, arrivingViewState)`, which is a no-op for
  an editor record. There is **no read and no `emit`**: other windows follow through
  `throng:history:changed`. The response is always `shown` with the run's **unchanged snapshot** — same
  revision, no `viewState`, no `fragment` — so the renderer's revision check drops it and the reader
  stays where the jump put them. A target that is not the run's current file (a link overtaken by
  another navigation) records nothing and returns the same unchanged snapshot. Never `focusedOther` or
  `openedInEditor`, and never `refused` **for a live run**; a panel whose run was destroyed between the
  click and the call answers `refused` with `link-missing-file`, which the renderer discards (it attaches
  only a `.catch` to a jump). *(Amended 2026-09-16 (converge): was "Never `refused`, `focusedOther` or
  `openedInEditor`", which the destroyed-run guard contradicts; with no run there is no snapshot to
  answer with.)*
- `intent: 'history'` onto an entry whose file **is the run's current file** *(iteration 2026-09-15,
  FR-115)* → stores `leavingViewState` on the current entry, then `history.moveTo(index)` and `emit` to
  every viewer with that entry's `viewState` — **no re-read, no `moveRun`, no `pathChanged`** broadcast;
  the response's update carries the same `viewState`. `emit` bumps the run's revision, so the step
  arrives at `revision + 1` with `content: null` and is applied by the ordinary revision-advance path
  (`preview-store.ts:85-101`); the body restores the entry's place without redrawing, because the
  content is unchanged. The same-revision rule (`preview-store.ts:72-84`) only de-duplicates the pair
  that reaches the invoking window twice — once as the response, once as the push — by dropping the copy
  whose `viewState` is already applied. *(Amended 2026-09-16 (converge): was "The renderer applies a
  `viewState` that differs on the same revision (`preview-store.ts:69-78`)", which described a mechanism
  the code does not use — `emit` cannot leave the revision unchanged, and `preview-service-navigate.integration.test.ts:601`
  asserts `revision + 1`.)* The stale-intent rule below applies unchanged.
- **A history step always carries `viewState`** *(amended 2026-09-16, iteration round 2, FR-121e)*: in
  both branches above, an entry with no saved place is sent as `viewState: null`, never omitted, so every
  viewer can tell a step onto the top of a document from a followed link (§2 `update`; research R32). A
  stale intent's unchanged snapshot still carries no `viewState`. The scroll relay of FR-121 does **not**
  cross IPC — it stays inside one window (FR-121a) — so this is the contract's only change for the
  iteration.
- **A stale history intent** — `index` no longer names `target.absPath`, because the history changed
  after the renderer read it — still stores `leavingViewState` first, moves nothing, and returns `shown`
  with the run's **unchanged snapshot**: the same revision the renderer last applied, no `viewState`, no
  `fragment`, so the renderer's revision check drops it. *(Amended 2026-09-15 (US7a fix round 1).)*
- `openedInEditor` is decided in main (no enabled provider) but performed by the renderer through
  the Files & Folders open path, with `markdownHeadingLine` placing the caret when a fragment is
  given.

### `refresh` — invoke (FR-028)

`{ panelId }` → `{ update: PreviewUpdate }`. Re-reads the source (document or disk) and flushes the
scheduler, ignoring the update delay.

### `isOpen` — invoke (FR-012)

`{ absPath }` → `boolean`. For menus built at open time (Files & Folders).

### `publishEditorTitle` — send (FR-031)

`{ panelId: string; title: string }` — sent by the window that mounts an **editor** panel whenever
its display title changes. Main keeps the latest per editor panel and forwards it as `parent.title`.

### `placeDeclined` — send (FR-010)

`{ requestId: string }` — this window's layout does not hold the parent named by `place`.

## 2. Main → renderer

### `update` — to the run's viewers only (FR-022, FR-040, Principle I)

```ts
type PreviewUpdate = {
  panelId: string;
  revision: number;                     // a renderer drops an update whose revision ≤ the last applied
  filePath: string;
  providerId: string;
  content: PreviewContent | null;       // null: unchanged since the last revision (a dirty-only or title-only update)
  dirty: boolean;                       // FR-040 — false whenever standalone (FR-043)
  parent: { panelId: string; title: string } | null;   // null = standalone (FR-013)
  notice: PreviewNotice | null;         // FR-026, FR-027; a repeat sets `repeat: true` so the notice flashes
  /**
   * Set only when the body must restore a position: on `attach` (the current history entry's view
   * state, after a restart) and on a `navigate` with a history intent (the target entry's). Absent on
   * every other update, which keeps the reader where they are (FR-024, FR-107).
   */
  viewState?: unknown;
  // Iteration 2026-09-16 (FR-121e, research R32): on a `history` navigate this is ALWAYS present — the
  // target entry's place, or `null` when the entry has no saved place (the top of its document). A link,
  // a live update and every other non-history update still omit it; `attach` still omits it when there is
  // no place. Both branches of `navigateHistory` (same-file and cross-file) send it. No type change.
  /**
   * Main's count of this run's navigations — raised only when the run moves to another file through
   * `moveRun` (a followed link or a history entry). Present on every update once the run has one.
   * A `filePath` that changes while this count is unchanged is a **re-point**, not a navigation: an
   * in-app rename or move, or a Save As from the parent editor. The body keeps the reader's place
   * there (FR-024, FR-013c) and starts a navigation at the top or at its named heading (FR-090b).
   * *(Added 2026-09-15, T177.)*
   */
  navigationSeq?: number;
};
```

Content updates for a parented preview are **scheduled** (research R13); `dirty`, `parent` and
`notice` changes are sent **immediately** with `content: null`.

`PreviewUpdate` carries **no** Back/Forward state: the enabled state of a preview's Back and Forward
comes only from `history-store`, fed by `throng:history:changed`, exactly as an editor's does — one
source, so the buttons and menu items cannot disagree with each other.

### `pathChanged` — broadcast to every window (FR-066, FR-013c, FR-090a)

`{ panelId: string; filePath: string }` — a run now shows a different file. Each window whose layout
holds `panelId` writes `config.filePath`, skipping an identical value. Carries a path and nothing else,
like `openChanged`.

### `openChanged` — broadcast to every window (FR-012, FR-014)

`{ path: string; open: boolean }` — the path in **compare form**, `normaliseForCompare(path)` from core
(forward slashes, lower-cased), not the persisted canonical form. A renderer store keys by the same
function and normalises every lookup through it, or FR-012 greying and FR-014's pressed state never
match on Windows. `open: false` is broadcast only when **no** run remains for that path.
Carries no content and no project detail. *(Amended 2026-09-15 (u7 review).)*

### `focus` — to one window

`{ panelId: string; fragment?: string }` — bring the panel's tab to the front, focus it, scroll to
the fragment's heading if given (FR-014, FR-090c).

### `place` — to one window (FR-010)

`{ requestId: string; absPath: string; projectId: string; besidePanelId: string | null; reservation: string }`
— if this window's layout holds `besidePanelId`, place a new preview panel to its right with
`addPanelBeside`, bring its tab to the front, and mount (which attaches with `reservation`);
otherwise reply `placeDeclined`. `besidePanelId: null` (main's last resort, §1) places it standalone where
`placeLocally` with no parent would. Main focuses the window that places it.

## 3. The coordinator observer — in-process, UI main

`EditorCoordinator` gains an optional injected listener. `relaySync` is unchanged.

```ts
interface DocumentLifecycleListener {
  registered(absPath: string, documentPanelId: string): void;      // coordinator.load, register, FIRST Save As of an unpathed document
  unregistered(absPath: string, documentPanelId: string): void;    // destroy, load re-point
  repointed(from: string, to: string, documentPanelId: string): void;   // markMoved, Save As of a pathed document
  changed(documentPanelId: string): void;                          // every change of canonical text: edit, bulk replace, undo/redo, AND every reset (revert, restore recovered, live disk reload, reload from disk)
  dirtyChanged(documentPanelId: string, dirty: boolean): void;     // exactly once per flip of the document's dirty state, whatever caused it
}
```

*(Amended 2026-09-15 (implementation, u4 review).)* Three rules the first cut left implicit:

- **Exactly once per transition.** The coordinator keeps the last dirty value it reported per document
  and fires `dirtyChanged` only when it differs; `changed` fires whenever canonical text changed,
  including reset paths that relay only through `broadcastReset`.
- **A document with no content to follow.** A parented preview follows the document's current content,
  never the disk (FR-022) — including a document whose file was deleted after it was read, which keeps
  its buffer (**006 FR-099**) while the editor's banner owns that condition (one condition, one notice).
  FR-026's notice applies to a parented run only while the document has **no content to follow**:
  `getContent().contentless` — its path cannot be read and has never been read in its panel (the FR-106d
  stand-in; a restore-time `register(…, { unloadable: true })`, including a failed verify before the
  document was ever read). While it holds, the run carries FR-026's notice (`deleted`, `too-large`,
  `not-text` or `unreadable`, as a read of the disk says) instead of the document's text; `changed` fires
  once per flip of it, text or no text, and the flip back — the path reads and the document adopts it —
  clears the notice at once, not on the settle schedule. *(Amended 2026-09-15 (adversarial review, main
  item 1): a preview parented to such a document showed an empty document with no notice, and a file
  coming back empty changed no text, so nothing cleared. Narrowed the same day (fix round 1 ruling): the
  first cut keyed on `unloadable` and covered a read document's buffer with `deleted` too, against
  FR-022.)*
- **Isolation.** Each listener call is made after the coordinator's own state and relays have settled,
  inside a try/catch that logs; a throwing listener never aborts a save, move, load, destroy or relay.
- **Save As onto a file a standalone preview shows.** `registered(to)` (unpathed source) or
  `repointed(from, to)` (pathed source) both mean a document now exists for `to`; `PreviewService`
  therefore makes any **standalone** run on `to` parented in place (FR-013a) in either case. A run that
  was parented to the document at `from` does **not** re-key onto `to` when `to` already has a run
  (FR-012: one preview per file); it stays bound to `from` and falls back to standalone there, as if the
  document had left it (FR-013b). No panel is closed by main. *(Amended 2026-09-15 (u7): "merge" in the
  first amendment would have needed main to close a renderer panel, which no channel does.)*

**FR-013c.** On `repointed(from, to, documentPanelId)`, `PreviewService` rebinds any run parented to
that document: re-keys `byPath` from `from` to `to`, sets the run's `filePath`, calls
`history.rewriteCurrent(to)`, re-matches the provider, and sends an immediate update (new `filePath`,
re-derived parent title, and — if `to` has no enabled provider — `notice: { kind: 'no-provider' }`,
FR-027). `openChanged` is broadcast for both paths. A **standalone** preview follows an in-app move
the way an editor does (FR-013c, standalone sentence): `PreviewService.beginMove(absPaths)` suppresses
the `deleted` notice its disk watch would otherwise raise for those paths, and
`PreviewService.moved(moves)` rebinds each run and ends the bracket. An external rename, with no
bracket, reads as a delete (FR-026), as it does for editors.

**A move onto a path another preview already shows.** `moved` does not rebind a run whose destination
is held by a run that was already there before this batch of moves (FR-012, one preview per file — the
same rule as a Save As onto a previewed file, above). The **moved** run stays standalone on its **old**
path, where its file no longer is, so it re-reads and shows `deleted` (FR-026); the run **already at the
destination** keeps it and shows the file that arrived. Two runs of one file that move together (a
restored sub-workspace's) are not a collision: both follow. A parented run that `repointed` sent back to
its old path, because its document moved onto a previewed file, is held back the same way. For every
held-back run, its **navigation history and every window's `config.filePath` and `config.history` stay on
the old path**: `moved` returns the held-back panel ids, `rewritePaths` skips them, and after the
`throng:files:moved` broadcast (which windows apply to every panel in their layouts) main re-broadcasts
`pathChanged` and `throng:history:changed` for each, putting each window's copy back — so a relaunch
restores one preview per file. *(Amended 2026-09-15 (adversarial review ruling, then review of fix
batch B, I-1): the first cut held the run back in main only, and the layout persisted the destination.)*

**One callback per setter.** `FilesService.setOnMoveStarted` and `setOnMoved` each hold a single
callback (`files-service.ts:194-201`), already registered at `main.ts:1409-1410` for the coordinator.
Main replaces each with **one** combined callback (`createInAppMoveCallbacks`, `in-app-moves.ts`), in
order: `beginMove` → coordinator then previews; `onMoved` → `editorCoordinator.markMoved`,
`previewService.moved` (the held-back ids), `historyService.rewritePaths(moves, heldBack)`, the
`throng:files:moved` broadcast, then `pathChanged` and `history:changed` for each held-back panel.
Calling a setter twice would silently drop 019 FR-008's handling.

`PreviewService` reads text with `coordinator.getContent(panelId)` (`editor-coordinator.ts:1241`) when
its scheduler fires — it never holds a copy of the buffer between flushes.

`NavigationHistoryService` is **not** a `DocumentLifecycleListener` — that slot holds one listener, and
it is `PreviewService`'s. An editor's Save-As re-point reaches history because `EditorCoordinator`,
which already holds the injected history service for `load` (T152), calls
`historyService.rewriteCurrent(documentPanelId, to)` itself at the Save-As site (`:1168`), next to where
it calls the listener's `repointed`. `rewritePaths` over every history is called from the one combined
`onMoved` callback above — never from `markMoved`, so a move rewrites each history once.

## 4. The `throng-preview:` protocol

Registered privileged before `app.ready` (`standard: true, secure: true, supportFetchAPI: false,
corsEnabled: false, stream: true`) and handled with `protocol.handle` on the default session.

| URL | Serves | Refusal |
|---|---|---|
| `throng-preview://asset/<previewPanelId>/<percent-encoded root-relative path>` | an image beside the document (FR-084) | `403` outside the project after `realpath`; `404` missing; `415` extension not in the image allowlist |
| `throng-preview://source/<previewPanelId>?rev=<n>` | the previewed file's bytes, **binary providers only** | `403` if the run's provider is text; `415` if the MIME type is not in the provider's `sourceMimeTypes` |

- The panel id is looked up in `PreviewService`; an unknown id is `404`. **The project root and the
  document folder come from main's run**, never from the URL.
- Image allowlist: `.png .jpg .jpeg .gif .webp .avif .bmp .ico .svg`.
- Size cap: `editor.maxOpenFileBytes`, read live on every request; a larger file is `413`.
- Response headers: `Content-Type` from the allowlist, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: sandbox`, `Cache-Control: no-store`.
- The handler is `createPreviewProtocolHandler({ fs, previews, settings, registry })` →
  `(Request) => Promise<Response>`, so it is integration-tested in Node against a temp tree with no
  Electron.

*(Amended 2026-09-15 (implementation, u6 review).)* What shipped, where the first cut was silent:

- **`registry`** is a dependency. `previews` is a narrow `PreviewLookup { run(previewPanelId) }` that
  answers `{ projectRoot, filePath, providerId }` — the run's own fields (data-model §10) — and the
  handler resolves `providerId` through the registry to choose the source route's allowlist.
- **Containment is decided twice.** `resolvePreviewAsset` on the spelling, then again over the
  `realpath` of both the root and the file; the second pass also re-reads the type from the real name,
  so a `logo.png` link to `page.html` is `415`.
- **`413`** for a file over the size cap (the table above names no status for it).
- **Every response carries the three hardened headers, refusals included**, and any unexpected throw —
  from the lookup as much as from the filesystem — answers `404` rather than rejecting the handler.

## 5. Settings transition: provider disabled (FR-063, FR-064)

On every settings change main calls `providersTurnedOff(previous, next, registry)` (data-model §3,
unit-tested); for each id it returns, main:

1. drops every run whose provider it is (each viewer receives `update` with `notice: null`, then the
   window's `PreviewProviderSync` removes the panel);
2. runs `purgeUnloadedPreviews(extensions)` over every project layout and sub-workspace record **not
   held by a window** (research R19), with `removePanelsWhere`, through the existing
   `workspace.load/save/loadSubWorkspaces/persistSubWorkspaces` RPCs;
3. broadcasts `openChanged { open: false }` for each dropped path.

Re-running step 2 over already-purged records writes nothing (idempotence assertion in
`preview-purge.integration.test.ts`).
