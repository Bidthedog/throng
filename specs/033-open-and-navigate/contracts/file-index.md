# Contract: the project file index

**Modules**: `packages/core/src/explorer/file-index.ts` (new, pure) · `packages/core/src/explorer/exclude.ts` (extended) · `packages/ui/src/main/project-file-index.ts` (new) · `packages/ui/src/main/file-index-ipc.ts` (new) · `packages/ui/src/preload/preload.cts` · `packages/ui/src/renderer/navigate/use-file-index.ts` (new)

**Requirements**: FR-005, FR-006, FR-013, FR-015, FR-016, FR-017 · SC-002, SC-003, SC-005

## 1. Pure core

```ts
// packages/core/src/explorer/exclude.ts  (extended)
/** Compile a glob list ONCE. `isExcluded` becomes `compileExcluder(globs)(relPath)`. */
export function compileExcluder(globs: readonly string[]): (relPath: string) => boolean;

// packages/core/src/explorer/file-index.ts  (new)
export interface WalkOptions {
  /** True when the caller has abandoned the walk (project switch, last unsubscribe). Polled per directory. */
  cancelled: () => boolean;
  /** Root-relative POSIX path of every excluded entry — folders are not descended into. */
  excluded: (relPath: string) => boolean;
}

/** Every FILE beneath `root`, root-relative POSIX, sorted. Depends only on the IFileSystem seam. */
export async function walkFiles(
  fs: IFileSystem,
  root: string,
  options: WalkOptions,
): Promise<string[]>;

export interface FileIndexDelta { added: readonly string[]; removed: readonly string[] }

/** Set difference over two SORTED arrays. Pure, allocation-light, order-stable. */
export function diffPaths(previous: readonly string[], next: readonly string[]): FileIndexDelta;
```

| # | Guarantee | Requirement |
|---|---|---|
| W1 | Files only. A folder appears nowhere in the result | Assumption 1 |
| W2 | Every path is root-relative and POSIX-separated; no absolute path is ever produced | FR-005 |
| W3 | An excluded entry is omitted, and an excluded **folder is not descended into** — the saving that makes `node_modules` free | FR-006, SC-003 |
| W4 | A symlinked directory is not descended into, and no entry outside the root is produced by any route | FR-005 |
| W5 | `cancelled()` is polled per directory; an abandoned walk stops without completing and produces nothing | — |
| W6 | A directory that disappears mid-walk is skipped, not thrown — the tree changes while it is being read | Edge Cases |
| W7 | Output is sorted, so `diffPaths` is a merge rather than a set build | — |
| W8 | `walkFiles` imports no `node:*` module and names no operating system | Principle II |
| D1 | `diffPaths` returns exactly the symmetric difference; equal inputs give two empty arrays | FR-016 |

## 2. UI-main: `ProjectFileIndexService`

```ts
export interface ProjectFileIndexOptions {
  /** Quiet period before the trailing full reconcile. Default 750 ms. */
  quietMs?: number;
  /** Ceiling on postponing that reconcile under sustained churn. Default 10_000 ms. */
  reconcileMaxWaitMs?: number;
}

export class ProjectFileIndexService {
  constructor(
    fs: IFileSystem,
    watcher: IFileWatcher,
    excludeGlobs: () => readonly string[],
    push: (webContentsId: number, payload: FileIndexUpdate) => void,
    options?: ProjectFileIndexOptions,
  );
  subscribe(webContentsId: number, root: string): { status: 'building' | 'ready'; paths?: string[] };
  unsubscribe(webContentsId: number, root?: string): void;
  dispose(): void;
}
```

Constructed **only** in `packages/ui/src/main/main.ts`, beside `FilesService` and `ExplorerWatcher`
(Principle IX).

| # | Guarantee | Requirement |
|---|---|---|
| S1 | One `RootIndex` per absolute root, ref-counted by `webContentsId`. Two windows on one root share one walk and one watch | FR-017 |
| S2 | The walk starts on the **first subscribe** for a root and runs to completion off the renderer's thread. The UI is never blocked by it | FR-013, FR-015 |
| S3 | Subscribing while the walk is in flight returns `{ status: 'building' }` **with no paths**, and the modal says so rather than showing a partial list as if it were whole | FR-015 |
| S4 | When the walk finishes, every subscriber of that root receives `{ status: 'ready', paths }` | FR-015 |
| S5 | On a watch signal for `relDir`, that directory is re-listed and the difference pushed as a delta | FR-016, SC-005 |
| S6 | A **full reconcile** is scheduled on every signal, debounced by `quietMs` and forced after `reconcileMaxWaitMs` regardless — so sustained churn cannot postpone it indefinitely | FR-016 (R5) |
| S7 | A reconcile that finds no difference sends **nothing**. A quiescent project costs no messages | — |
| S8 | A delta is computed against the snapshot last **sent**, never the one last built | — |
| S9 | The last unsubscribe for a root disposes its watch and drops its array; a destroyed `webContents` unsubscribes from every root | Principle III's hygiene rule, applied to a watch |
| S10 | `excludeGlobs()` is read at walk time and at each rescan, so changing the setting takes effect on the next reconcile without a restart | FR-006 |
| S11 | A watch that fails permanently marks the root `'building'` again and re-walks on the next subscribe rather than serving a set it can no longer maintain | FR-016 |

## 3. IPC

| Channel | Kind | Payload |
|---|---|---|
| `throng:fileIndex:subscribe` | `invoke` | `{ root: string }` → `{ status: 'building' \| 'ready'; paths?: string[] }` |
| `throng:fileIndex:unsubscribe` | `send` | `{ root: string }` |
| `throng:fileIndex:update` | push (per-window) | `{ root: string; status: 'building' \| 'ready'; paths?: string[]; added?: string[]; removed?: string[] }` |

| # | Guarantee | Requirement |
|---|---|---|
| I1 | Pushes go to the **subscribing** `webContents` only, never `broadcastToWindows` — two windows on different roots must not see each other's sets | FR-017 |
| I2 | The renderer receives a full `paths` array at most once per root per subscription; everything after is `added`/`removed` | R7 |
| I3 | The preload subscription returns an unsubscriber, matching every other push channel's idiom | — |
| I4 | The channels are **new**, not additions to `files.*`, because `throng:files:setRoot` sets one process-wide root and this index is keyed by root | plan Complexity Tracking |

## 4. The renderer's side

```ts
// packages/ui/src/renderer/navigate/use-file-index.ts
export interface FileIndexView { status: 'idle' | 'building' | 'ready'; paths: readonly string[] }
/** Subscribes for `root` while `active`; unsubscribes on unmount or root change. */
export function useFileIndex(root: string | null, active: boolean): FileIndexView;
```

| # | Guarantee | Requirement |
|---|---|---|
| R1 | The hook is the **only** consumer of the `fileIndex` bridge. No component calls it directly | — |
| R2 | `root` comes from the active panel's origin project in a sub-workspace, and from the active project in the main window | FR-017 (R6) |
| R3 | `root === null` → `status: 'idle'`, no subscription, and the Quick Open command does not open the modal at all | FR-018 |
| R4 | A root change unsubscribes the old root before subscribing the new one, and clears `paths` — no window ever holds two roots' files | FR-005, FR-013 |
| R5 | **Typing performs no IPC.** The candidate array is already in memory; a keystroke reads it and nothing else | FR-013, SC-002 |

## 5. Where each success criterion is proved

| Criterion | Layer | How |
|---|---|---|
| SC-002 (<100 ms per keystroke at 50,000 files) | **unit** (core) | `compileQuery` → filter → `rankFilePath` → `rankStable` → cap, over a synthetic 50,000-path corpus, worst sample not mean |
| SC-002 (no keystroke triggers a filesystem walk) | **E2E** | Instrument the preload bridge in-page; type ten characters; assert **zero** `files.*` and `fileIndex:subscribe` calls |
| SC-003 (never outside the root, never an excluded file) | **unit** + **E2E** | `walkFiles` against a fake filesystem containing both; then a real fixture with an excluded folder and a second project |
| SC-005 (a disk change reflected within 2 s) | **integration** | The service over a real temp tree and a real `NodeFileWatcher`: create, rename, delete; assert the delta arrives inside the budget |
| FR-015 (opened before enumeration finishes) | **E2E** | Subscribe against a large fixture and assert the modal renders its "still listing" state, then its results |
