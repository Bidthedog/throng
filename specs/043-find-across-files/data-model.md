# Phase 1 Data Model: Find / Replace in Files

**Feature**: 043 | **Date**: 2026-09-08 | **Plan**: [plan.md](./plan.md)

Types are grouped by **where they live**, because that placement is the load-bearing decision: pure
model in `core`, scan lifetime in `ui/src/main`, view state in `ui/src/renderer`. Nothing here reaches
`persistence`, `daemon` or `ipc-contract`.

---

## 1. Match model — `packages/core/src/search/match-model.ts` (hoisted)

Moved verbatim from `packages/ui/src/renderer/search/search-model.ts`, which re-exports it so no
existing caller changes (the `refusal.ts` precedent, R1).

```ts
export interface MatchModes {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface Match {
  from: number;   // absolute offset in the document
  to: number;
}

export const NO_MODES: MatchModes = { caseSensitive: false, wholeWord: false };

export function editorMatches(doc: Text, term: string, modes: MatchModes): Match[];
```

**Invariants**
- `from < to` for every match; matches are non-overlapping and ascending.
- An empty `term` yields `[]`. No scan is started for an empty term.
- Regex is **not** a mode here and is not added (FR-040).

**Why it moves**: main cannot import from renderer, and after this feature the match semantics have
consumers in both processes. Adds `@codemirror/state` + `@codemirror/search` to `core` — declared in
the Constitution Check.

---

## 2. File-search model — `packages/core/src/search/file-search.ts` (new, pure)

The result shapes and every transform over them. All pure functions; no I/O.

```ts
/** Where a search looks. */
export interface SearchScope {
  readonly projectRoot: string;    // absolute, canonical
  readonly subPath: string | null; // root-relative POSIX, or null for the whole root
}

/** One occurrence: one file, one position. */
export interface ResultRow {
  readonly relPath: string;   // root-relative POSIX - the identity of the file
  readonly line: number;      // 1-based, for display
  readonly column: number;    // 1-based, for display
  readonly from: number;      // absolute offset, for the commit
  readonly to: number;
  readonly snippet: SnippetView;
}

/** FR-036: the matched text highlighted inside surrounding context. */
export interface SnippetView {
  readonly before: string;
  readonly matched: string;
  readonly after: string;
  readonly truncatedStart: boolean;  // render an ellipsis
  readonly truncatedEnd: boolean;
}

// NARROWED in round two -> `'file' | 'fileAndFolder'` (FR-073). See §2a below.
export type Grouping = 'file' | 'folder' | 'fileAndFolder';

/** A heading rows sit under. Nests only under 'fileAndFolder'. */
export interface ResultGroup {
  readonly key: string;             // relPath for a file, relDir for a folder
  readonly kind: 'file' | 'folder';
  readonly matchCount: number;      // rendered digit-grouped (FR-014)
  readonly stale: boolean;          // FR-045a - only meaningful for kind 'file'
  readonly rows: readonly ResultRow[];
  readonly children: readonly ResultGroup[];
}

export type ScanStatus = 'notRun' | 'running' | 'complete' | 'cancelled' | 'scopeMissing';

/**
 * The streaming bound. Constants, not settings: nothing asks the user to tune
 * streaming granularity, and Principle X governs values a deployment or a user
 * needs to change - not the internal shape of a stream. Named here rather than
 * inlined so SC-004's scan half has a number to assert against.
 */
export const MAX_ROWS_PER_BATCH = 250;
export const BATCH_FLUSH_MS = 50;
```

**Transforms** (each a unit-tested pure function):

| Function | Requirement |
|---|---|
| `groupRows(rows, grouping): ResultGroup[]` | FR-033 — regrouping never re-runs the search |
| `orderGroups(groups): ResultGroup[]` | FR-035 — at each level, files alphanumerically (digits before letters), then sub-directories the same way |
| `snippetFor(lineText, from, to): SnippetView` | FR-036 — extend to a word boundary each side, flag truncation |
| `markStale(groups, changedRelPaths): ResultGroup[]` | FR-045a — per file, never panel-wide |

**FR-045c has no transform, deliberately.** "Re-running the search clears staleness for every file it
re-scans" is satisfied three ways that already exist, and a `clearStale(groups, rescanned)` beside them
would be a fourth path to the same state with no caller: `FileSearchService.supersede` empties the
run's stamp maps before the new walk re-stamps whatever it finds; `applyFileSearchUpdate` falls back to
`[]` rather than to the previous set on a new generation, because the rows a marking described have
just been replaced; and the panel re-derives every group from `rows` on each render, so no stale flag
outlives the rows it was attached to. Both `file-search.ts` and `file-search-staleness.test.ts` carry
that reasoning at the point where the function would otherwise be added, and
`packages/ui/tests/component/find-in-files-staleness.test.ts` is where FR-045c is asserted — at the
tier the requirement is observable from, rather than against a function signature.

**Invariants**
- `ScanStatus` distinguishes all five states FR-042 and FR-030a require. `notRun`, `complete` with zero
  rows, and `running` are three different things the panel renders differently; `scopeMissing` is the
  fourth (FR-030a).
- `scopeMissing` in the panel's `results` describes a search **refused before it ran**, never a scope
  that went missing under a finished one. The latter arrives at that run's own generation and leaves
  its status alone, so the readout keeps describing the run while the scope control carries the
  condition — the surface FR-030a names for it.
- Staleness is a **flag on a file group**, never a filter. `markStale` changes no row's presence,
  order or actionability (FR-045b).
- Row identity is `(relPath, from)`. Two panels' rows over one file are independent values.

---

## 3. The panel's persisted query — `packages/core/src/workspace/model.ts`

Rides `Panel.config`, which is `Record<string, unknown>` serialised verbatim into the layout blob. **No
migration** (R11).

```ts
/** Persisted verbatim inside the layout blob (rides `Panel.config`). */
export interface FindInFilesPanelConfig {
  term?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  scopeSubPath?: string | null;   // root-relative POSIX; null = whole root
  replaceShown?: boolean;
  replacement?: string;
}
```

**Every field is optional** — a restored panel with an absent field takes the default, which is what
lets an older layout blob load unchanged.

**What is deliberately NOT here**: results, groups, scan status, the pending preview. Their absence is
what makes FR-023, FR-027b, FR-027c and FR-027d true by construction rather than by cleanup code.

**Registration not to miss**: `scopeSubPath` is root-relative, so it does **not** go in
`CONFIG_PATH_KEYS` (`persisted-paths.ts:33`), which exists for **absolute** paths. Storing it relative
is the reason — it survives a project moving on disk.

---

## 4. The panel type descriptor — `packages/core/src/find-in-files/panel-type.ts`

```ts
export const FIND_IN_FILES_KIND = 'findInFiles';

export const findInFilesPanelType: PanelTypeDescriptor = {
  id: FIND_IN_FILES_KIND,
  label: 'Find in Files',
  icon: 'findInFiles',
  offered: false,          // FR-017 - registered, but absent from the New Panel dialog
  inputs: [],
  defaults: () => ({}),
  // ValidationResult is { ok: true } | { ok: false; errors }, not string | null.
  validate: (_v, ctx) =>
    ctx.projectRoot !== null ? { ok: true } : { ok: false, errors: { root: 'No project is open' } },
  buildConfig: () => ({}),
};
```

**The `offered` field is new on `PanelTypeDescriptor`** (R17). It defaults to `true` so the two existing
descriptors need no change, and `registry.list()` gains a filtered companion the New Panel form uses.
Registering-but-not-offering is required because the registry is also what supplies a panel's **header
label and icon** — leaving the type unregistered would trade FR-017 for a broken header.

---

## 5. Find session — `packages/ui/src/renderer/search/search-store.ts`

The #220 change: one singleton becomes a map.

```ts
export interface FindSession {
  readonly panelId: string;
  readonly panelKind: FindPanelKind;
  readonly term: string;
  readonly replacement: string;
  readonly modes: MatchModes;
  readonly replaceShown: boolean;
  readonly count: SearchCount;
  readonly seeded: boolean;
}

interface FindStoreState {
  readonly sessions: ReadonlyMap<string, FindSession>;
  readonly showingFor: string | null;   // which panel's bar is visible
}
```

**Invariants**
- A session's lifetime is its panel's. Created on first open (FR-001), **hidden** rather than
  discarded when focus leaves (FR-002), discarded only on panel destroy (FR-006).
- `showingFor` is presentation only. Changing it MUST NOT mutate any session — that is the exact
  defect, where `openFind` discards the previous panel's term on a panel change.
- Actions take a `panelId`. No action reads "the current session".
- Two sessions may hold different terms simultaneously with no interaction (FR-003).

---

## 6. Replace preview and commit — `packages/ui/src/main`

The preview is **view state in the renderer**; the commit is a **main-side operation**.

```ts
/** One file's worth of intended writes, resolved at commit time. */
export interface CommitRequest {
  readonly projectRoot: string;
  readonly replacement: string;
  readonly term: string;
  readonly modes: MatchModes;
  readonly targets: readonly CommitTarget[];
}

export interface CommitTarget {
  readonly relPath: string;
  /*
   * Offsets as scanned, REBASED past the commits this panel has already made in that file (#378);
   * re-verified before writing either way. The panel is the only thing that knows one of its own
   * commits moved a row, because for adjacent matches whose replacement contains the term the file's
   * bytes cannot say — the stale offset still holds a match, the one the replacement inserted.
   */
  readonly edits: readonly Match[];
}

export interface CommitOutcome {
  readonly changedInBuffer: readonly string[];  // open files - dirty, undoable
  readonly changedOnDisk: readonly string[];    // unopened files - irreversible
  readonly refused: readonly RefusedCommit[];
  readonly failed: readonly FailedCommit[];
  readonly applied: readonly AppliedCommit[];   // #378 - which edits landed, not just which files
}

export interface AppliedCommit {
  readonly relPath: string;
  readonly edits: readonly Match[];   // the offsets the CALLER asked with; one entry per write
}

export interface RefusedCommit {
  readonly relPath: string;
  readonly reason: 'matchGone';   // FR-054a
}

export interface FailedCommit {
  readonly relPath: string;
  readonly reason:
    | 'readOnly'
    | 'locked'
    | 'io'
    | 'missing'
    | 'outOfTree'   // confinement (FR-053) - the target left the project between scan and write
    | 'binary'      // the NUL-scan guard, re-applied at write time
    | 'encoding';   // not valid UTF-8 - refused, never transcoded (contract rule 6a)
}
```

> **Corrected 2026-09-09** (convergence baseline, Session 2026-09-09). This document listed **four**
> reasons where `packages/ui/src/main/replace-commit-service.ts:81` ships **seven**. The code is
> authoritative and `contracts/file-search-ipc.md` already agreed with it — rule 6a describes the
> `encoding` refusal in full. This is a documentation correction, not a requirement change: nothing
> about the commit's behaviour moves. Recorded as **F2** in the plan's Complexity Tracking because the
> three artefacts disagreed for a whole round and only a convergence pass found it.
>
> `encoding` carries the reasoning that makes it non-obvious, at
> `replace-commit-service.ts:72-80`: the binary guard is a NUL scan, a single-byte legacy encoding
> has no NULs, and decoding one non-fatally then writing it back stores `EF BF BD` for every
> non-ASCII byte — *"the whole file's accented text destroyed, in a file the user never opened, with
> no undo"*.

**Invariants that are the whole point**
- **Every match is re-verified against current content immediately before its write** (FR-054),
  unconditionally — not only for files marked stale. `RefusedCommit` is what a failed verification
  produces, and it leaves every other target's outcome unchanged (FR-054a).
- **The open/unopened partition and the write are one main-side turn**, with `isOpen` re-checked
  immediately before each `writeBytes` (R8). The partition is never computed in the renderer.
- **Open files never receive a disk write** (FR-052), and the edit is applied through the authority
  with `mergeClass: null`, which is what makes it one undo step (FR-057).
- **A commit saves nothing** (FR-053a). `changedInBuffer` files are left dirty.
- `CommitOutcome` is reported **once**, from the operation that owns it (FR-058) — the arrays that
  describe files are one notice, not three.
- **`applied` names writes, the other arrays name files** (#378). It is what the panel's FR-051
  marking is built from, and what lets it rebase the rows it has not committed yet: a file-level
  answer left a partially-refused file's rows all unmarked and left the next commit naming offsets
  the previous one had already moved.
- The empty replacement is valid and deletes (FR-046a); nothing in these types treats it specially.

---

## 7. Scan service state — `packages/ui/src/main/file-search-service.ts`

Copies `ProjectFileIndexService`'s shape (R2, R4).

```ts
interface ScanRun {
  readonly id: string;            // panel id - one live scan per panel
  generation: number;             // bumped to supersede (FR-043c)
  status: ScanStatus;
  readonly scope: SearchScope;
  readonly term: string;
  readonly modes: MatchModes;
  skipped: number;                // FR-045f - one count for the whole scan
}
```

**Invariants**
- **One live scan per panel.** Starting another bumps `generation`; the abandoned walk polls
  `cancelled()` and returns nothing rather than a truncated set. Supersession is free (FR-043c).
- `skipped` is a **single count**, never a per-file notice (FR-045f).
- The service holds **no** results after a panel is destroyed, and never persists any.

---

## Entity relationships

```
Project 1 ──── * FindInFilesPanel        (FR-018: exactly one project)
                    │
                    ├── 1 FindInFilesPanelConfig   (persisted in Panel.config)
                    ├── 1 ScanRun                  (main-side, never persisted)
                    └── 1 ResultSet
                            ├── * ResultGroup       (shape depends on Grouping)
                            └── * ResultRow

Panel (editor|terminal) 1 ──── 0..1 FindSession     (FR-001, renderer-side)
```

**Cardinality worth stating**: there is no limit on Find in Files panels (FR-019), a Tab may hold
several, and each owns its own scan and results. Nothing is shared between them — the two-panels-one-
file case resolves through staleness plus the pre-write re-check, with no coordination (Edge Cases).

---

# Round two — entity and state changes (Session 2026-09-09)

**Date**: 2026-09-09 | Research **R23–R30**. Everything above still holds except where a change below
names it. Nothing is renumbered.

## R2. `ScanRun` — one run, many viewers, and rows that outlive the batch (FR-078, FR-078a)

Replaces §7's shape. The change is in two places: the **key**, and what the run **keeps**.

```ts
interface ScanRun {
  readonly id: string;            // panel id - AND now the whole key (was `${webContentsId}:${id}`)
  /**
   * Every window currently displaying this panel. Populated by `start` and by `attach`,
   * emptied by `drop` and by `release`; the run dies when it empties (FR-023 unchanged).
   * FR-018 is enforced HERE rather than by the key: a window that is not in this set
   * receives nothing, and no update is ever broadcast.
   */
  viewers: Set<number>;           // webContents ids
  generation: number;             // bumped to supersede (FR-043c) - unchanged
  status: ScanStatus;
  readonly scope: SearchScope;
  readonly term: string;
  readonly modes: MatchModes;
  skipped: number;
  filesScanned: number;
  totalMatches: number;
  /**
   * FR-078a - retained for the life of the run, so a window that attaches AFTER the scan
   * finished is sent a snapshot rather than an empty panel. Appended as batches are emitted;
   * previously `pending` was drained and the rows forgotten (`file-search-service.ts:175`).
   */
  rows: ResultRow[];
  staleFiles: Set<string>;        // cumulative for the run, as the channel already describes
  held: Map<string, FileStamp>;   // unchanged - the per-file stamps staleness re-stats against
}
```

**Invariants, revised**

- **One live scan per PANEL, not per (window, panel).** Starting from either window bumps
  `generation` and supersedes; both windows see the new generation and discard the old one under the
  rule the channel already states. This is what makes a search typed in the mirror correct rather than
  a redirection bug.
- **`viewers` is registered, never inferred.** Main cannot see which windows have a panel mounted;
  the renderer says so. The sender is always `event.sender`.
- **The run is released on the LAST detach**, not the first. `drop` from the mirror leaves the parent's
  scan alone — the failure the composite key was introduced to fix, re-solved here.
- **FR-023 is untouched.** Closing the panel unmounts it in every window, every window detaches, the
  set empties, and `rows`, `held` and `staleFiles` all go with the run. Nothing is retained for a panel
  that no longer exists, and nothing crosses `Panel.config`, so a restored panel still comes back with
  no results (§3 unchanged).
- **Peak memory is now one main-side copy plus one per attached window**, where it was one per window.
  With no match ceiling this is unbounded in the same way the renderer's copy already is — the bound
  FR-078a claims, and the only one claimed.

## §5a. `FindInFilesPanelState` — renderer changes

| Field | Change | Requirement |
|---|---|---|
| `ranScope: string \| null` | **Removed**, with the `.fif-scope__ran` element it fed | FR-072 supersedes FR-030's second clause; this state existed only to satisfy it |
| `scopeMissing: boolean` | **Becomes** `scopeNotice: 'missing' \| 'outsideProject' \| null` | FR-030a keeps the `missing` case; FR-070 adds the refusal, in the same slot, most-recent-wins (R27) |
| `grouping: Grouping` | Narrowed with the union | FR-073 |
| — | No new field for zoom | It is read from `Panel.zoom`, which is already persisted and already per-panel (R26) |
| — | No new field for the title | The term is already in `Panel.config`; `panelDisplayTitle` reads it (R30) |

## §2a. `Grouping` narrows, in two declarations (FR-073)

```ts
// packages/core/src/search/file-search.ts:50 - the domain type
export type Grouping = 'file' | 'fileAndFolder';

// packages/core/src/config/app-settings.ts:470,472-477 - the settings type and its allowed set
export type FindInFilesGrouping = 'file' | 'fileAndFolder';
export const FIND_IN_FILES_GROUPINGS: readonly FindInFilesGrouping[] = ['file', 'fileAndFolder'];
```

The two are deliberately separate declarations with identical literals, per the reasoning at
`app-settings.ts:442-451`; both narrow. `FIND_IN_FILES_GROUPINGS` is what the descriptor's
`allowedValues` points at, which is what makes a stored `'folder'` coerce to `'file'` with no new code
(R25). `optionLabels.folder` in `settings-metadata.ts:870-879` goes with it.

`ResultGroup.kind` keeps both `'file'` and `'folder'` — folder headings still exist under
`fileAndFolder`. What goes is the top-level grouping that produced folder headings with no file
heading beneath them, and with it the **per-row** staleness marking, which existed only because that
shape had no file heading to carry the flag (FR-073's own note). `ResultGroup.stale` is unchanged.

## §7a. The zoomed row height (FR-062)

Not a persisted entity — a derived value, recorded because two consumers must agree on it exactly.

```ts
// find-in-files-panel.tsx - computed once, from state that already exists
const factor = zoomFactor(panelZoomLevel(panel));            // 1.2 ** level, level in [-5, 5]
const rowHeightPx = Math.round(RESULT_ROW_HEIGHT_PX * factor);
```

`rowHeightPx` is passed into the results list, threaded through `visibleRange`, `maxScrollTop`, the
sizer height, the `translateY` offset and the keyboard scroll-into-view, **and** published as
`--fif-row-height`. `RESULT_ROW_HEIGHT_PX` (22) remains exported as the unzoomed base — what level 0
produces. The rounding happens once, in JavaScript; CSS is told the answer and never asked to compute
it (R26).

## §6a. `FailedCommit` — see the correction in §6

Seven reasons, not four. Corrected in place above; no behaviour changes.

## Entity relationships — revised

```
Project 1 ──── * FindInFilesPanel        (FR-018: exactly one project)
                    │
                    ├── 1 FindInFilesPanelConfig   (persisted in Panel.config; unchanged)
                    ├── 1 ScanRun                  (main-side, keyed by panelId, never persisted)
                    │       └── * viewer window    (FR-078 - the set the key used to be part of)
                    └── 1 ResultSet
                            ├── * ResultGroup       ('file' | 'fileAndFolder' only)
                            └── * ResultRow

Panel (editor|terminal) 1 ──── 0..1 FindSession     (FR-001, renderer-side; unchanged)
```

**The cardinality that moved**: a Find in Files panel had exactly one `ScanRun` **per window that had
run it**; it now has exactly one, shared, with a set of windows watching. Two panels over one file
still coordinate through nothing at all — that half of §7 is unchanged, and FR-078 is about one panel
in two windows, never two panels.

---

## Round five (2026-09-11) — additive

**`SearchScope.subPath` may name a FILE (FR-092).** §2's comment reads *"root-relative POSIX, or null
for the whole root"*, and that stands. What it may point at widens: a directory beneath the root, as
before, or a single file beneath it. The type does not change, because the kind of path is asked of
the file system at scan time rather than recorded. A value recorded when the scope was set would be
the stale answer if the path were replaced by the other kind before the next run.

**`FindInFilesPanelConfig.scopeSubPath` is persisted as the user typed it.** The box keeps the text
the user entered (FR-092b), and `readScopeInput` reads it where a scan starts. So a persisted value
may now be:

- root-relative, which is what the tree's route and the folder chooser write;
- an absolute path the user typed.

§ *Registration not to miss* still holds for the first: it is relative, so it stays out of
`CONFIG_PATH_KEYS`. The second is the user's own text. It is read against the project root at every
run, so a project that moves turns a typed absolute scope into FR-070's *outside the project*
refusal, not a silent search somewhere else. That is the correct failure, and it is recorded here so
it is not rediscovered as a bug.

**A cleared panel (FR-091).** No new field. The tree's route empties `term` and `replacement` and
sets `scopeSubPath` and `replaceShown`, all fields this config already has, so a restored panel
comes back exactly as the route left it. The results were never persisted (§ *What is deliberately
NOT here*), so there is nothing to clear on disk.

**Main-side run (§R2): `clear`.** It moves the run on one generation and keeps it. Releasing it
would restart the generation below what every renderer has seen. See
`contracts/file-search-ipc.md`, *Round five*.

---

## Correction (2026-09-11) — §6's commit result, reconciled with what ships (043 T240)

§6 is **stale in two places**, and this corrects both beside the text rather than over it. It is the
Phase 10 T119 precedent: the design artifact and the code disagreed while every test passed.

**1. "A commit saves nothing (FR-053a). `changedInBuffer` files are left dirty" is no longer true.**
FR-086 superseded FR-053a for one case. A document that was **clean** before the commit is saved
straight after it, and ends clean with the replacement still one undo step. A document that was
**already dirty** is not saved (FR-086a), so FR-053b's guarantee stands: a commit never writes out
the user's own unsaved work.

**2. The `CommitOutcome` shape is missing four members.** The shipped type
(`replace-commit-service.ts`) is:

```ts
interface CommitOutcome {
  readonly changedInBuffer: readonly string[];
  readonly changedOnDisk: readonly string[];
  readonly refused: readonly { relPath: string; reason: 'matchGone' }[];
  readonly failed: readonly FailedCommit[];          // seven reasons, see §6's own correction
  readonly notSaved: readonly { relPath: string; reason: string }[];   // FR-086: replaced, save failed
  readonly saved: readonly string[];                 // FR-086: replaced, then saved
  readonly applied: readonly {                       // #378: which edits landed, per file
    relPath: string;
    edits: readonly { from: number; to: number; snippet?: SnippetView }[];  // FR-083b
  }[];
}
```

- **`notSaved` and `saved`** are both subsets of `changedInBuffer`, and they are **not** inverses.
  A file missing from `notSaved` means *saved, or no save was owed*. That cannot tell a file now on
  disk from one still holding the user's own work, so the summary counts `saved` directly.
- **A failed save is `notSaved`, never `failed`.** The replacement succeeded: it is in the buffer,
  it is undoable, and the file is named in `changedInBuffer`. What did not happen is the save.
- **`notSaved[].reason` is a `string`.** It carries `EditorService`'s own save reason in the words
  the notice uses. It is not typed as that enum at this boundary.
- **`applied[].edits[].snippet`** is what each committed row now reads (FR-083b). It is derived from
  one new text per file and bounded by `MAX_COMMIT_SNIPPET_CHARS`. Past the bound it is absent, and
  the row renders from the replacement it recorded.
