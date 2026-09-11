# Contract: the file-search IPC channel

**Feature**: 043 | **Realm**: Electron main ↔ preload ↔ renderer

This channel streams scan results. It copies the shipped project-file-index channel
(`packages/ui/src/main/file-index-ipc.ts`, `preload.cts:519-549`) — same subscribe / snapshot / delta
shape, same single-`webContents` targeting, same unsubscribe closure.

**Enforced by `packages/ui/tests/unit/ipc-bridge-parity.test.ts`**: a `throng:*` channel appearing in
`src/main` but not `src/preload` (or the reverse) fails the build. Every channel below goes in both.

---

## Channels

| Channel | Direction | Kind |
|---|---|---|
| `throng:fileSearch:start` | renderer → main | `invoke` |
| `throng:fileSearch:cancel` | renderer → main | `send` |
| `throng:fileSearch:drop` | renderer → main | `send` |
| `throng:fileSearch:update` | main → **one** renderer | push |
| `throng:fileSearch:commit` | renderer → main | `invoke` |

---

## `throng:fileSearch:start`

Starts or **supersedes** the scan for one panel. Idempotent per panel: a second call for the same
`panelId` bumps the generation and abandons the first (FR-043, FR-043c).

```ts
interface StartScanRequest {
  panelId: string;
  projectRoot: string;        // absolute, canonical
  scopeSubPath: string | null;// root-relative POSIX; null = whole root
  term: string;
  modes: MatchModes;
}

type StartScanResult =
  | { started: true }
  | { started: false; reason: 'emptyTerm' | 'noProject' | 'scopeMissing' };
```

**Rules**
- An empty `term` starts nothing and returns `emptyTerm`. The panel keeps its previous results.
- `scopeMissing` maps to `ScanStatus.scopeMissing` (FR-030a): the panel marks the scope, keeps its
  listed results usable, and finds nothing until retargeted.
- The subscriber is `event.sender`, **never** payload-supplied — same rule as the file index.

## `throng:fileSearch:cancel`

```ts
interface CancelScanRequest { panelId: string; }
```

Fire-and-forget. Bumps the generation; the walk's `cancelled()` poll returns `[]` rather than a
truncated set. Cancelling an already-finished scan is a no-op.

The run is **kept**: a cancelled scan's partial results stay on screen and FR-045a's staleness still
applies to them. `drop` is what releases it.

## `throng:fileSearch:drop`

```ts
interface DropScanRequest { panelId: string; }
```

Fire-and-forget. The **panel** has gone (FR-023), so main releases its run: the generation is bumped,
the run leaves the map, and nothing is held for it afterwards (data-model §7).

Separate from `cancel` because `cancel` early-returns for a scan that is no longer running — which is
how a panel is usually closed. Without this channel a finished run kept its whole per-file stamp map
for the life of the window, and `noteDirectoryChanged` re-stated it on every watcher tick.

The subscriber is `event.sender`, so one window cannot drop another's run.

**A run is keyed by `(webContentsId, panelId)`, not by `panelId` alone.** A sub-workspace's synced
view is the same panel mirrored into a second window and carries the same id, so a run keyed by the
id alone is shared between the two: closing the mirror aborted the parent's scan, and a search typed
in the mirror redirected the parent's updates to it (FR-018).

## `throng:fileSearch:update`

Pushed to the one `webContents` that started the scan. **Snapshot at most once, then deltas** —
`status: 'running'` may repeat with successive `rows` batches (FR-041).

```ts
interface FileSearchUpdate {
  panelId: string;
  generation: number;        // renderer discards any update from a superseded generation
  status: ScanStatus;
  rows?: ResultRow[];        // a batch, appended in arrival order
  totalMatches?: number;     // running total; rendered digit-grouped (FR-014)
  filesScanned?: number;
  skipped?: number;          // FR-045f - one count for the whole scan, not per file
  staleFiles?: string[];     // FR-045a - root-relative POSIX, per file, never panel-wide
  adoptQuery?: {             // FR-078b - ABSENT for the window driving the search
    term: string;
    modes: MatchModes;
  };
}
```

### The batch bound

A batch carries **at most 250 rows**, and the service flushes whatever it holds at least every
**50 ms** even when short of that, so a slow filesystem still shows progress. A file yielding more than
250 matches is split across successive batches; no batch is ever the whole result set.

Both are named constants in `packages/core/src/search/file-search.ts`
(`MAX_ROWS_PER_BATCH`, `BATCH_FLUSH_MS`), **not settings**: nothing in the spec asks the user to tune
streaming granularity, and Principle X's externalisation rule governs values a deployment or a user
needs to change, not the internal shape of a stream. They are constants with a stated reason rather
than magic numbers, which is what makes T053b assertable — "size-bounded" alone is a property no
implementation can fail.

**Rules**
- **`generation` is mandatory on every update** and the renderer drops any update whose generation is
  not the current one. This is the race guard `use-file-index.ts:37-150` spells out, and it is why
  supersession is free rather than needing a cancel handshake.
- **No `rows` array exceeds `MAX_ROWS_PER_BATCH`.** This is the bound SC-004's scan half asserts and
  the size the renderer half is measured against. This is the race guard `use-file-index.ts:37-150` spells out, and it is the
  reason supersession is free rather than needing a cancel handshake.
- `rows` arrive in walk order, which is already the ordering FR-035 requires; the renderer does not
  re-sort on every batch.
- `staleFiles` is cumulative for the run and may arrive at any time, including after `complete`
  (a file can change after the scan finishes — that is the whole point of FR-045a).
- **`adoptQuery` is present exactly when the recipient is NOT the run's originator** (FR-078b), and
  its absence is as much of the contract as its presence. The originator is whichever window last
  **started or retargeted** the run — the one being typed into — so the query travels one way, and a
  window that receives it is being told: *these rows are somebody else's search, and this is what
  that search was*. Sending it back to the originator would overwrite a half-typed word every time a
  debounced re-run landed.

  It carries `term` and `modes` and deliberately **not** `replacement`: the replacement is not part
  of the query, nothing about it can contradict the rows, and a user composing one in a second window
  would lose it every time the first window re-ran.

  Without it, FR-078's sharing makes the panel worse than the empty list it replaced — a populated
  list under a stale term, whose Replace All is refused file by file as `matchGone` by FR-054's
  re-check while the matches sit on screen. No wrong bytes are written; the report is what is false.
- No update ever carries the full result set after the first batch. There is no match ceiling
  (Assumptions), so the channel must never try to send everything at once.

## `throng:fileSearch:commit`

The one call that writes. Everything about the partition, the re-check and the write happens **inside
this handler**, in one main-side turn.

```ts
interface CommitRequest {
  panelId: string;
  projectRoot: string;
  term: string;
  modes: MatchModes;
  replacement: string;          // may be empty - a valid deletion (FR-046a)
  targets: { relPath: string; edits: { from: number; to: number }[] }[];
  confirmedIrreversible: boolean;  // FR-057b
}

type CommitResult =
  | { committed: false; reason: 'needsConfirmation'; unopenedFileCount: number }
  | { committed: true; outcome: CommitOutcome };

interface CommitOutcome {
  changedInBuffer: string[];
  changedOnDisk: string[];
  refused: { relPath: string; reason: 'matchGone' }[];
  failed: { relPath: string; reason: FailureReason }[];
  // FR-086 - the replacement landed and the save that owed it did not. A SUBSET of changedInBuffer,
  // never a fifth kind of file, and never reported under `failed`: the replacement succeeded.
  notSaved: { relPath: string; reason: SaveReason }[];
  // #378 - which edits were written, at the offsets the CALLER asked with. Not a count: two rows
  // naming one match are one write. The renderer refuses an outcome that omits it.
  applied: { relPath: string; edits: { from: number; to: number }[] }[];
}
```

**Rules that are the contract's whole reason for existing**

1. **The partition is computed here, not in the renderer.** The renderer cannot answer "does this file
   have an open editor" without a race, and inactive tabs are unmounted so it cannot even see every
   open document (R7).
2. **`needsConfirmation` is returned before anything is written** when any target has no open editor
   and `confirmedIrreversible` is false and the warning preference is on (FR-057b, FR-057c).
   `unopenedFileCount` is what the warning states, digit-grouped (FR-014).
3. **Every edit is re-verified against the file's current content immediately before its write**
   (FR-054), unconditionally. A match whose text has gone becomes a `RefusedCommit`, and the rest of
   the commit proceeds (FR-054a). A match that has merely **moved** because this same operation
   already committed in that file is **re-resolved**, not refused — the shift is `|replacement| -
   |term|` per prior replacement, so only offsets on that arithmetic ladder are candidates, and an
   edit reaching two of them is refused rather than guessed.
3a. **The panel rebases its own rows, and this reports what it needs to (#378).** The ladder was
   originally the whole answer, on the assumption that nothing rebased a panel's rows after a commit.
   It cannot be: for ADJACENT matches whose replacement contains the term, a stale offset still holds
   a match — the one the previous replacement inserted — and no rule over the bytes can separate that
   from an untouched file, because the bytes are identical. So the panel shifts the rows it has not
   committed yet past the ones it has (`commit-replace.ts`) and sends offsets that are already
   current, which take the "the position still holds" path. That is possible only because `applied`
   names the edits that landed rather than the files, so the panel knows what it has written and by
   how much the text moved. The ladder stays as the fallback for callers with no such ledger — a
   second panel over the same file, or anything invoking this channel directly.
4. **`isOpen` is re-checked immediately before each `writeBytes`** (R8), following
   `EditorCoordinator.save`'s Save-As precedent. A file that became open in the interval takes the
   buffer path instead.
5. **Open files go through the authority** with a synthetic view id and `mergeClass: null`, relayed to
   every window — never a disk write behind a live buffer (FR-052), and one undo step (FR-057).
6. **Unopened files are `decode` → replace → `encode`** with the same `{encoding, hasBom, lineEnding}`
   the decode reported, plus confinement (FR-053, FR-056). A plain read/write would silently rewrite
   CRLF as LF and drop the BOM. A file that **mixes** endings keeps each of them, not the dominant
   one applied to every line.
6a. **A file that is not valid UTF-8 is refused** with `reason: 'encoding'` and left untouched. The
   binary guard is a NUL scan, and a single-byte legacy encoding (Windows-1252, Latin-1) has no NULs
   — so it passes as text, decodes non-fatally to `U+FFFD`, and is written back as `EF BF BD`,
   destroying every non-ASCII byte in the file. Never transcoded: guessing the code page is a second
   chance to destroy the same bytes.
7. **Nothing is saved** (FR-053a). Buffer edits are left dirty.
7a. **Superseded (2026-09-10) by FR-086, for one case.** A document that was **clean immediately
   before** the commit is saved right after its edit lands, through `EditorCoordinator.save` — the
   authority stays the only writer, and the edit stays a single undoable one (FR-086b: this is not a
   new class of irreversible write, so FR-057b's warning is unaffected). A document that was
   **already dirty** is still not saved (FR-086a), so FR-053b stands word for word. The sample is
   taken inside `bulkReplace`, in the same turn as the dispatch, because the dispatch itself dirties
   the document and a later reading finds every document dirty.
7b. **A save that fails is reported as `notSaved`, never as `failed`.** The replacement succeeded and
   is in the buffer, undoable; the file stays in `changedInBuffer`. Reporting it under `failed` would
   tell the user their text was not replaced, which is false.
8. **The outcome is reported once** (FR-058) — one notice carrying all of the arrays, from the
   operation that owns them.

---

## What this contract deliberately does not have

- **No daemon involvement.** The scan is UI-main only (R2); `ipc-contract` is untouched.
- **No cancellation token type.** `AbortController` exists nowhere in the codebase; the generation
  counter is the shipped idiom (R4).
- **No progress percentage.** The walk does not know its own size until it ends, and inventing a total
  would mean walking twice.
- **No result persistence.** Results never cross into `persistence` — FR-023 and FR-027b are satisfied
  because there is nowhere for them to be written.

---

# Round two — cross-window delivery (Session 2026-09-09)

**Date**: 2026-09-09 | Research **R23**. Everything above stands except the three rules this section
names. The style follows rule 3a's: the earlier text keeps its place and the supersession is stated
where the change is.

## What changes, in one paragraph

A run stops belonging to a window. It is keyed by **`panelId`** and carries a **set of viewer
windows**; every update goes to every viewer and to nobody else. A window joins by starting a scan
(as before) or by the new **`attach`** message, and is sent a **snapshot** of whatever the run holds
so a window arriving after a scan finished sees its results (FR-078, FR-078a). `drop` becomes a
detach, and the run is released when the set empties.

## Channels — revised table

| Channel | Direction | Kind | Change |
|---|---|---|---|
| `throng:fileSearch:start` | renderer → main | `invoke` | Also adds the sender to `viewers` |
| `throng:fileSearch:attach` | renderer → main | `send` | **New** |
| `throng:fileSearch:cancel` | renderer → main | `send` | Now cancels the panel's run whichever viewer asks |
| `throng:fileSearch:drop` | renderer → main | `send` | Now a **detach**; releases the run on the last one |
| `throng:fileSearch:update` | main → **every viewer** | push | Was "one renderer"; may now be a snapshot |
| `throng:fileSearch:commit` | renderer → main | `invoke` | Unchanged |

Both new and changed channels go in `src/main` **and** `src/preload`, or
`packages/ui/tests/unit/ipc-bridge-parity.test.ts` fails the build — the rule stated at the top of
this file is unchanged and now covers one more channel.

## `throng:fileSearch:attach`

```ts
interface AttachScanRequest { panelId: string; }
```

Fire-and-forget. The sender joins the run's `viewers` and is **immediately sent one
`FileSearchUpdate` carrying the run's full retained state** — status, every row, the running totals
and the cumulative `staleFiles` — at the run's current generation. If no run exists for that panel,
nothing is sent and the panel keeps rendering `notRun`; the attach still registers, so the window
receives the next scan whoever starts it.

The subscriber is `event.sender`, **never** payload-supplied — the same rule `start`, `cancel` and
`drop` already follow, and the reason `file-search-ipc.ts`'s own header gives for it.

Called by the panel component on mount, beside the `ensureFindInFilesPanel` call that already runs
there and whose comment already anticipates *"a panel remounted in another window"*. Idempotent: a
second attach from the same window re-sends the snapshot and changes nothing else.

**The weakening this introduces, stated rather than found later.** Today a window can only receive
results for a scan it started. After this it can receive results for any `panelId` it names, and a
window that named a panel it is not displaying would receive another project's file paths and match
text. The only caller is the panel component, mounted from the workspace layout — the same authority
in both windows — but the guarantee is weaker by exactly the amount FR-078 asks for, and it is
recorded here rather than in a commit message.

## `throng:fileSearch:update` — superseded targeting

> **Superseded (2026-09-09) by FR-078.** *"Pushed to the one `webContents` that started the scan"*
> becomes **pushed to every window in the run's `viewers` set**. The payload shape is unchanged. The
> guarantee that replaced it is not weaker in the direction FR-018 cares about: a window that is not
> displaying the panel is not in the set and receives nothing, and there is still **no broadcast** —
> `broadcastToWindows` is not used, and `getAllWindows()` is never asked.

Two clarifications the snapshot makes necessary:

- **"Snapshot at most once, then deltas" becomes "at most once *per viewer*".** Each window's stream
  begins with a snapshot and continues with deltas. A viewer that has already had its snapshot never
  receives a second one for the same generation.
- **A snapshot is distinguishable from a delta** by carrying the run's totals together with a `rows`
  array that is the whole result set rather than a batch. The renderer **replaces** its rows on a
  snapshot and **appends** on a delta, so the batch bound below does not apply to a snapshot — it is
  the one message that may carry everything, and it is sent to exactly one window.

```ts
interface FileSearchUpdate {
  panelId: string;
  generation: number;
  status: ScanStatus;
  snapshot?: true;           // NEW - `rows` replaces rather than appends; totals are authoritative
  rows?: ResultRow[];
  totalMatches?: number;
  filesScanned?: number;
  skipped?: number;
  staleFiles?: string[];
}
```

## `throng:fileSearch:drop` — superseded meaning

> **Superseded (2026-09-09) by FR-078.** `drop` meant *"the panel has gone, release the run"*. It now
> means **"this window is no longer displaying the panel"**: the sender leaves `viewers`, and the run
> is released — generation bumped, rows and stamps discarded, entry removed from the map — only when
> the set empties. FR-023 is unaffected, because closing the panel unmounts it in every window and
> every window drops.

`release(webContentsId)`, which main calls when a window dies, changes the same way: it removes that
window from every `viewers` set rather than releasing every run it owned. A closed sub-workspace
window therefore stops the mirror without touching the parent's scan — the failure the composite key
was introduced to prevent, now prevented by the set instead.

## The keying rule — superseded

> **Superseded (2026-09-09) by FR-078.** The rule above reads *"A run is keyed by
> `(webContentsId, panelId)`, not by `panelId` alone"*, and lists the two failures that produced it:
> closing the mirror aborted the parent's scan, and a search typed in the mirror redirected the
> parent's updates to it. **The key becomes `panelId`.** Both failures are answered without it, and
> one of them stops being a failure:
>
> - *Closing the mirror aborted the parent's scan* — answered by reference counting: `drop` and
>   `release` detach one viewer, and only the last one releases the run.
> - *A search typed in the mirror redirected the parent's updates* — under FR-078 the mirror **is**
>   the panel, so a search typed there is a search on that panel, and both windows must see its
>   results. Supersession stays per panel, which is what one logical panel wants (FR-043c).
>
> What the composite key was actually protecting — that one window's gesture cannot reach another
> window's scan — is preserved for the case that still matters: two *different* panels, in two
> windows, on two projects, have two different `panelId`s and two unrelated runs. It is no longer
> preserved for the same panel in two windows, and that is the requirement.

## What this section deliberately still does not have

- **No broadcast.** `broadcastToWindows` (`packages/ui/src/main/broadcast.ts:33-49`) is this
  repository's normal answer for one object seen by many windows, and it is not used here. A scan
  update carries one project's file paths and the text around every match; a sub-workspace window may
  hold a different project, and a broadcast would deliver that payload into it and filter afterwards.
  FR-018 and Principle I both read at the delivery layer, not the rendering layer.
- **No retention outside the run.** No cache, no eviction policy, no retrieval surface — FR-078a
  bounds retention to a scan whose panel still exists and to nothing else.
- **No renderer-to-renderer relay.** The parent's window may be torn down while the mirror lives, and
  making a renderer the authority for state main owns is the shape *one condition, one notice* rejects
  for the same reason: the report belongs to whatever owns the state.

---

# Round three — what the commit answers with (Session 2026-09-10)

**Date**: 2026-09-10 | **FR-083, FR-083b, FR-083c**. Everything above stands except the two things
this section names, and the style follows rule 3a's: the earlier text keeps its place and the
supersession is stated where the change is.

## `throng:fileSearch:commit` — a widened request and a widened answer

```ts
interface CommitRequest {
  panelId: string;               // NOW READ - see rule 9
  projectRoot: string;
  term: string;
  modes: MatchModes;
  replacement: string;
  targets: { relPath: string; edits: { from: number; to: number }[] }[];
  confirmedIrreversible: boolean;
}

interface CommitOutcome {
  changedInBuffer: string[];
  changedOnDisk: string[];
  refused: { relPath: string; reason: 'matchGone' }[];
  failed: { relPath: string; reason: FailureReason }[];
  // ADDED (FR-086): documents that were clean, were replaced, and could not then be saved.
  notSaved: { relPath: string; reason: SaveReason }[];
  applied: {
    relPath: string;
    // WIDENED: each edit now also carries the snippet its line reads AFTER the commit.
    edits: { from: number; to: number; snippet?: SnippetView }[];
  }[];
}
```

> **`panelId` was always sent and never read.** `asCommitRequest` dropped it, because nothing in the
> commit depended on WHICH panel was writing. Rule 9 below is the first thing that does. An
> unreadable one coerces to `''`, which matches no run — so the commit still writes, and nothing is
> spared a staleness marking it has earned.

**9. The commit tells the scan service which files it wrote (FR-083c).** After each direct write, and
before the next one, `FileSearchService.noteOwnWrite(panelId, relPath)` re-takes that file's stamp in
that panel's run. The next watcher tick then compares the file against what it looks like NOW and
marks nothing — while a file changed by the commit **and then by something else** differs from that
stamp and goes stale exactly as it always did. It is a re-stamp rather than a suppression for that
reason, and it is per panel: a second panel searching the same project is told its file changed,
because it did, by a writer it knows nothing about.

Only the DISK path needs it. A buffer edit changes no file, so no watcher sees it — until FR-086's
save, which is `EditorCoordinator.save`'s to report the same way.

The one race, stated rather than found later: a tick can land between the write and the re-stat, and
the file is then marked before anything can say who wrote it. The window is one stat wide against a
debounce of tens of milliseconds, and the failure mode is the pre-FR-083c behaviour — an
over-reported stale file, which this service already prefers to under-reporting. A file **already**
marked is left marked: the marking may have come from a real second writer.

**10. Every write answers with the snippet its line now reads (FR-083b).** Derived from ONE new text
per file — the disk path's is `applyReplacements`' output, the buffer path's is the document
authority's own text after the dispatch — using `snippetFor`, the same function the scan used. Two
matches on one line each carry the other's old text in their surrounding context, and deriving each
row's snippet independently of the row beside it is what produces that; deriving them all from one
new text is what removes it. Nothing is re-read from disk and nothing is re-searched.

**The size bound this owes, and what happens past it.** One budget for the whole commit:
`MAX_COMMIT_SNIPPET_CHARS` (200,000 characters, beside `MAX_ROWS_PER_BATCH` and for the same reason).
Characters rather than a count of snippets, because a count does not bound this — each snippet's
context is capped at `SNIPPET_CONTEXT_CHARS` a side, but its matched half is the replacement the user
typed, which may be a pasted block of any size.

Past the budget, `snippet` is **absent** on each further edit. The writes all happen: this bounds the
report, never the commit. The panel then renders that row from the replacement it recorded — plainly,
so the row is still visibly committed (FR-083a) — which is right about the row itself and may still
show a same-line neighbour's pre-commit text. That is the defect FR-083b removes, surviving past the
bound rather than being hidden, and it is asserted by a test rather than discovered from a screen.

---

# Round five (2026-09-11) — a seventh channel, and a scope that may name a file

## `throng:fileSearch:clear`

| Channel | Direction | Kind |
|---|---|---|
| `throng:fileSearch:clear` | renderer → main | `send` |

```ts
// preload
clear: (panelId: string) => ipcRenderer.send('throng:fileSearch:clear', { panelId });
```

**What it is for (FR-091a).** The tree's *Open In → Search* route leaves the panel with an empty
query and no results. Main keeps a panel's run so a synced sub-workspace view can be shown it
(FR-078a), so a renderer-only clear would leave that view listing the old rows under an empty box,
which FR-078b forbids. `clear` empties the run in main and tells **every** viewer.

**What main does.** Only a viewer may clear, for `cancel`'s reason: one window's gesture must not
reach a panel it is not displaying. Main then:

1. Moves the run on **one generation**. The generation is what stops a scan still walking (`stale()`
   compares generations) and what makes its late batches drop on arrival.
2. Sets the status to `notRun`.
3. Empties the rows, the pending batch, the counts, `held` and `staleFiles`.
4. Makes the clearing window the query's owner and empties the term, so every other viewer is sent
   `adoptQuery: { term: '' }`.
5. Emits one `notRun` update with no rows.

If the panel has no run, there is nothing on screen anywhere to clear, so nothing is sent.

**Why the run is kept rather than released — the one thing not to "simplify".** `drop` releases a
run, which is right for a panel that has gone. Releasing here would let the next `start` open a fresh
run at generation **1**, while every renderer watching still holds the cleared run's higher number
and drops anything lower as superseded. The panel would never show another result.
`file-search-scan.integration.test.ts` reads the stream back through the renderer's own fold to
prove the next search is shown.

**Neither sibling will do.** `cancel` keeps the rows a synced view is showing. `drop` detaches only
the asking window.

A cleared run also never raises its **old** scope as missing: `noteScopeMissingIfGone` skips a
`notRun` run, because the box no longer names that path.

## `throng:fileSearch:start` — `scopeSubPath` may name a file (FR-092)

The shape is unchanged. What `scopeSubPath` may **mean** is wider:

- **A directory** is walked, as before.
- **A file** is visited as exactly one entry. Its row path is `scopeSubPath` itself, root-relative
  like every other row. No excluder is consulted for it. The size, read and binary rules still
  apply, from the same loop, so a binary or over-limit file scoped by name counts as **one skipped
  file**.

Main asks the scope's kind once, through `IFileSystem.stat`.

Before this, a file scope passed `start`'s existence check and was then walked as a directory. The
`readdir` failure was swallowed, and the scan completed with no rows, which the panel reads as "No
matches". `start`'s comment said a non-directory scope was `scopeMissing`, which was never checked.

**The renderer sends a READ scope, never the raw box text (FR-092b).** `readScopeInput` in core reads
the box before `start` is called:

- Root-relative and absolute-inside-the-project are the same scope.
- `\`, a leading `./` and a trailing separator are tolerated.
- Absolute-outside-the-project, or any `..`, is FR-070's refusal. The renderer puts that on the
  control and never calls `start`.

Main therefore still receives only root-relative POSIX or `null`, exactly as this contract has always
said.

---

## Correction (2026-09-11) — the round-three `CommitOutcome`, reconciled with what ships (043 T240)

The round-three `CommitOutcome` above differs from the code in two ways. Both are corrected here,
beside the text rather than over it.

1. **It lacks `saved: readonly string[]`.** These are documents that were clean before the commit,
   were replaced, and **were then saved** (FR-086). They are a subset of `changedInBuffer`. The
   summary notice counts this array: it reports *X on disk, Y in open editors with unsaved changes*,
   and the split falls on what the user must still do, not on which path wrote the file. Without it
   the notice could not tell a file that is now on disk from one still holding the user's own work.
   `notSaved`'s absence means *saved or nothing was owed*, and cannot answer that.
2. **It types `notSaved[].reason` as `SaveReason`.** The shipped type
   (`replace-commit-service.ts`, `UnsavedCommit`) carries a plain `string`: the editor's save reason,
   in the words the notice uses. The enum does not cross this boundary.

Nothing about the channel's direction, timing or confirmation changes. This is a documentation
correction; the code and its tests were already consistent with each other.
