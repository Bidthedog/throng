# Contract: File clipboard and transfer IPC

Preload bridge additions on `window.throng`. Channel names follow `throng:<area>:<verb>`. Every handler validates
its payload shape in main and returns an envelope, never throws across the bridge (004 FR-025 style). Shapes are in
[data-model.md](../data-model.md).

## §1 `fileClipboard`

| Bridge | Channel | Kind | Payload → result |
|---|---|---|---|
| `get()` | `throng:fileClipboard:get` | invoke | → `FileClipboard` |
| `set(mode, relPaths)` | `throng:fileClipboard:set` | invoke | `'cut'\|'copy'`, root-relative paths of the **active** project → `{ ok } \| { error }` |
| `clear()` | `throng:fileClipboard:clear` | send | — |
| `onChange(cb)` | `throng:fileClipboard:changed` | push to every window | `FileClipboard` |

`set` takes relative paths and resolves them in main against the active root and the active project id, so the
renderer cannot name a path outside the project it is showing. The root row (`''`) is refused (004 FR-023).

## §2 `transfer`

| Bridge | Channel | Kind | Payload → result |
|---|---|---|---|
| `paste(targetRelDir)` | `throng:transfer:paste` | invoke | → `{ jobId }` — snapshots the clipboard (FR-019d); queued if a job runs |
| `drop(srcRelPaths, targetRelDir, mode)` | `throng:transfer:drop` | invoke | → `TransferResult` when the job ends |
| `cancel(jobId)` | `throng:transfer:cancel` | send | queued → removed; running → current item aborted, state `awaiting-cancel-choice` |
| `finishCancel(jobId, choice)` | `throng:transfer:finishCancel` | send | `'keep' \| 'rollback'` |
| `resolveClash(requestId, answer)` | `throng:transfer:resolveClash` | send | `ClashAnswer` |
| `applyUndo(entry, direction)` | `throng:transfer:applyUndo` | invoke | cross-project or `paste` entry → `{ ok, entry? } \| { error, cause? }`; `entry` is the refreshed entry a `paste` redo returns (it re-recycles at a new time), stored in place of the old one in both stacks (same id) |
| `exists(absPaths)` | `throng:transfer:exists` | invoke | → `boolean[]`, `false` for any path outside every project root |
| `quitChoice(choice)` | `throng:transfer:quitChoice` | send | `'wait' \| 'keep' \| 'rollback' \| 'dismiss'` |
| `onProgress(cb)` | `throng:transfer:progress` | push to owner window | `{ jobId, state, done, total, current, queuedBehind, display }` — `display` true once the card should show (R14, FR-031) |
| `onClash(cb)` | `throng:transfer:clash` | push to owner window | `ClashQuestion` |
| `onCancelChoice(cb)` | `throng:transfer:cancelChoice` | push to owner window | `{ jobId }` — ask Keep finished / Roll back |
| `onDone(cb)` | `throng:transfer:done` | push to owner window | `TransferResult` |
| `onQuitPrompt(cb)` | `throng:transfer:quitPrompt` | push to main window | `{ running: number; queued: number }` |

```ts
interface TransferResult {
  jobId: string;
  outcome: 'completed' | 'kept' | 'rolled-back';
  placed: string[];                       // absolute paths now in the target (FR-025b)
  undo: FileOpUndoEntry | null;           // built from the journal (FR-018b, FR-022, FR-023); null after roll back
  failures: { name: string; dir?: string; message: string; cause?: FailureCause }[];
  rollbackFailures: { name: string; message: string }[];
  sourceProjectId: string;
  targetProjectId: string;
}
```

## §3 Rules main enforces

1. **Confinement (FR-010)**: the target's real path is within the active root; every source's real path within some
   project root; else that item fails (`permission-denied`-free wording: "is not inside a project").
2. **One at a time (FR-019e)**: every job and every `applyUndo` runs inside `FilesService.exclusive`.
3. **Bracket (019)**: `onMoveStarted` before the first change of a job that moves anything; `onMoved` in a `finally`
   with exactly the pairs that moved (cross-volume pairs included, FR-015 pairs excluded).
4. **Continue past failure (FR-013)**: an item's failure never stops the job.
5. **Nothing overwritten without an answer (FR-017, SC-006)**: a clash with no stored decision blocks on
   `throng:transfer:clash`; a lost owner window answers Cancel → Keep finished.
6. **Clipboard after the job**: R7 / data-model transitions.
7. **Progress timing (FR-019)**: `progress` pushes start at job start; the renderer decides the 1 s threshold, so the
   rule lives in one place.
8. **Queued job cancel (FR-019d)**: no cancel-choice question, nothing journaled, `outcome: 'kept'` with empty
   `placed`.
