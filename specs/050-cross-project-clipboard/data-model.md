# Data Model: Cross-Project Clipboard

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Nothing here is a new table or migration. Two shapes are new in memory (main), one persisted shape widens
(the file-operation undo blob, migration v8, unchanged schema), and one setting is added.

## File clipboard (main, memory only — R1)

```ts
type FileClipboard =
  | null
  | {
      mode: 'cut' | 'copy';
      items: readonly ClipboardItem[]; // ordered as selected; never empty
    };

interface ClipboardItem {
  absPath: string;      // OS-spelled absolute path (FR-001)
  projectId: string;    // the project it was taken from
  projectRoot: string;  // that project's root when taken — FR-011's re-root check
}
```

Rules: every item shares one `projectId` (a selection never spans projects). `set` replaces (FR-003). Never
persisted (FR-007). Transitions:

| Event | Effect |
|---|---|
| cut / copy | replace |
| Escape in any explorer | clear (FR-005) |
| in-app move / rename of an item or an ancestor | rewrite `absPath` by prefix (FR-009) |
| in-app delete of an item or an ancestor | drop that item; empty list → `null` |
| project of the items removed, or its root changed | clear (FR-011) |
| copy run finished or cancelled | unchanged |
| cut run finished / cancelled | keep exactly the snapshot items that did not move; `null` if all moved (FR-006, FR-019c) — only while the clipboard still equals the run's snapshot |

## Transfer job / paste run (main, memory only — R2, R7)

```ts
interface TransferJob {
  id: string;
  kind: 'paste' | 'drag';           // drag: no progress, no cancel (FR-019e)
  mode: 'cut' | 'copy';
  sources: readonly ClipboardItem[]; // snapshot at start (FR-019d)
  targetDir: string;                 // absolute, inside the active root (FR-010)
  ownerWindowId: number;             // where prompts and progress go
  state: 'queued' | 'running' | 'awaiting-cancel-choice' | 'rolling-back' | 'done';
  progress: { done: number; total: number; current: string | null }; // total = top-level items
  decisions: { all?: ClashChoice };  // "apply to all" for this job only
  journal: {
    placed: { from: string; to: string }[];     // copies this run created
    moved: { from: string; to: string }[];      // items this run moved
    replaced: { path: string; trashedAt: number | null; kind: 'file' | 'folder' }[]; // null = permanent
    inProgress: string | null;
  };
  failures: { path: string; cause?: FailureCause; message: string }[];
}

type ClashChoice = 'replace' | 'skip' | 'keep-both';
```

Queue: FIFO; at most one job `running` at a time, inside `FilesService.exclusive` (R2).

## Clash (crosses IPC — R9)

```ts
interface ClashQuestion {
  jobId: string;
  requestId: string;
  name: string;            // the clashing leaf
  targetDir: string;       // display path of the folder it would land in
  existing: ClashSide;
  incoming: ClashSide;
  permanentReplace: boolean; // FR-018f: Replace says it cannot be undone
}
interface ClashSide { kind: 'file' | 'folder'; size?: number; modifiedMs?: number; itemCount?: number; newer: boolean }

type ClashAnswer = { choice: ClashChoice; applyToAll: boolean } | { choice: 'cancel' };
```

## File-operation undo entry (persisted, widened — R10)

```ts
type FileOpUndoEntry =
  | { kind: 'move'; id?: string; items: { from: string; to: string }[]; projects?: CrossProject; at: number }
  | { kind: 'rename'; id?: string; from: string; to: string; at: number }
  | { kind: 'delete'; id?: string; items: { originalPath: string }[]; at: number }
  | {
      kind: 'paste';                 // NEW — only when something was replaced (FR-018b)
      id: string;
      moved: { from: string; to: string }[];
      copied: { from: string; to: string }[];
      replaced: { path: string; trashedAt: number }[]; // recycled only; permanent ones are omitted (FR-018f)
      projects?: CrossProject;
      at: number;
    };

interface CrossProject { source: string; target: string } // project ids

// Iteration 2 (R16, FR-033): `move` and `paste` gain an optional
//   createdDirs?: string[]   // absolute folders the paste created, parents first
// Undo removes each once empty (children first); redo recreates them. An entry carrying
// createdDirs is applied by main (transfer.applyUndo), like a cross-project one.
```

- A cross-project entry lives in **both** projects' stacks, matched by `id` (FR-020). It counts toward each stack's
  bound of 50 (FR-021).
- `validate(paste, 'undo')`: every `moved.to` and `copied.to` present; every `moved.from` free. Redo: every
  `moved.from` and `copied.from` present, every `to` free except where a `replaced.path` will be re-disposed.
- Parse: old blobs (no `id`, no `projects`, no `paste`) parse unchanged. An entry naming a project id that no longer
  exists is dropped on load (Assumptions).

## Setting

| Key | Type | Default | Descriptor |
|---|---|---|---|
| `explorer.replaceMode` | `'recycle' \| 'permanent'` | `'recycle'` | after `explorer.deleteMode` in `settings-metadata.ts`; documented in `docs/preferences.md` |

## Renderer stores

- `file-clipboard-store` — mirror of main's clipboard, updated by push.
- `paste-runs-store` — per run: state, progress, queue position, notice id, failures; drives the notice (R8).
- `pending-reveal` — `projectId → absolute paths` placed by the last finished run, drained on that project's next
  ready tree (FR-025b).
