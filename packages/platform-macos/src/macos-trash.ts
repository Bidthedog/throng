import { lstat, rename } from 'node:fs/promises';
import { basename } from 'node:path/posix';
import { logExpected, type ITrashRestore } from '@throng/core';
import { foundationTrash, type TrashAnswer } from './foundation-trash.js';

/** One item's answer: where the Trash put it, or why it would not. */
export type TrashOutcome = string | Error;

const UNSAID = 'macOS did not say where the Trash put the item.';

/** What the Trash answered for one item, as the path it now has or the system's reason it did not move. */
export function outcomeOf(answer: TrashAnswer | null): TrashOutcome {
  if (answer === null) return new Error('macOS would not move the item to the Trash: its Foundation framework could not be loaded.');
  if (!answer.ok) return new Error(`macOS would not move the item to the Trash: ${answer.message || `error ${answer.code}`}`);
  return answer.path.startsWith('/') ? answer.path : new Error(UNSAID);
}

async function runTrashItems(paths: readonly string[]): Promise<TrashOutcome[]> {
  const foundation = foundationTrash();
  return paths.map((path) => outcomeOf(foundation ? foundation.trashItem(path) : null));
}

/** The words a restore macOS refused ends with: the item is safe, and Finder can put it back. */
export const PUT_BACK_HINT = "Open the Trash in Finder and choose Put Back.";

export interface MacosTrashDeps {
  /** Trash every path and answer, in the same order, where each went or why it did not. NSFileManager by default. */
  readonly trashItems?: (paths: readonly string[]) => Promise<TrashOutcome[]>;
  /** Trash one path and answer where it went; used for each item when `trashItems` is not given. */
  readonly trashItem?: (path: string) => Promise<string>;
  readonly move?: (from: string, to: string) => Promise<void>;
  readonly exists?: (path: string) => Promise<boolean>;
  readonly now?: () => number;
}

interface Trashed {
  readonly deletedAt: number;
  readonly trashedPath: string;
}

interface Pending {
  readonly path: string;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
}

const existsOnDisk = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false,
  );

/**
 * Delete to the macOS Trash and put back from it (070 FR-022, R6). `trash` records where each item went, and
 * `restore` moves that item back. The record lives for the process: an undo after a restart, or of an item another
 * program trashed, is refused with a reason, as is one the system will not let throng move back (`~/.Trash` is behind
 * Full Disk Access), and each such refusal says that Finder's Put Back restores the item.
 */
export class MacosTrash implements ITrashRestore {
  private readonly trashItems: (paths: readonly string[]) => Promise<TrashOutcome[]>;
  private readonly move: (from: string, to: string) => Promise<void>;
  private readonly exists: (path: string) => Promise<boolean>;
  private readonly now: () => number;
  private readonly trashed = new Map<string, Trashed[]>();
  private pending: Pending[] = [];

  constructor(deps: MacosTrashDeps = {}) {
    const one = deps.trashItem;
    this.trashItems =
      deps.trashItems ??
      (one ? (paths) => Promise.all(paths.map((p) => one(p).then((to): TrashOutcome => to, (error: unknown) => error as Error))) : runTrashItems);
    this.move = deps.move ?? rename;
    this.exists = deps.exists ?? existsOnDisk;
    this.now = deps.now ?? Date.now;
  }

  /**
   * Every item asked for in one turn of the event loop goes to the Trash in one batch, through one `trashItems` call,
   * which an injected implementation may serve in one round trip. Each caller still settles on its own item's outcome.
   */
  trash(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({ path, resolve, reject });
      if (this.pending.length === 1) setImmediate(() => void this.flush());
    });
  }

  private async flush(): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    let outcomes: TrashOutcome[];
    try {
      outcomes = await this.trashItems(batch.map((item) => item.path));
    } catch (error) {
      for (const item of batch) item.reject(error);
      return;
    }
    batch.forEach((item, i) => {
      const outcome = outcomes[i] ?? new Error(UNSAID);
      if (outcome instanceof Error) {
        item.reject(outcome);
        return;
      }
      const list = this.trashed.get(item.path) ?? [];
      list.push({ deletedAt: this.now(), trashedPath: outcome });
      this.trashed.set(item.path, list);
      item.resolve();
    });
  }

  async restore(originalPath: string, deletedAt: number): Promise<void> {
    const candidates = this.trashed.get(originalPath) ?? [];
    const present: Trashed[] = [];
    for (const entry of candidates) if (await this.exists(entry.trashedPath)) present.push(entry);
    if (present.length === 0) {
      throw new Error(`"${basename(originalPath)}" is no longer in the Trash where throng put it. ${PUT_BACK_HINT}`);
    }
    // The closest at or before the deletion asked about, else the newest.
    const atOrBefore = present.filter((e) => e.deletedAt <= deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
    const newest = [...present].sort((a, b) => b.deletedAt - a.deletedAt);
    const entry = atOrBefore[0] ?? newest[0]!;
    if (await this.exists(originalPath)) {
      throw new Error(`"${originalPath}" already exists, so it cannot be restored over.`);
    }
    try {
      await this.move(entry.trashedPath, originalPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES') throw error;
      logExpected('macos-trash: move back', 'macOS keeps the Trash behind Full Disk Access; the user is told to use Put Back', error);
      throw Object.assign(
        new Error(`"${basename(originalPath)}" is in the Trash, but macOS did not let throng move it back. ${PUT_BACK_HINT}`),
        { code },
      );
    }
    this.trashed.set(
      originalPath,
      candidates.filter((e) => e !== entry),
    );
  }
}
