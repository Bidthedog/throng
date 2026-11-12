import { lstat, opendir, readlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  isWithinRoot,
  logExpected,
  type FileAttributes,
  type FolderTally,
  type IFileAccessInfo,
  type IFileAttributes,
  type IOsPropertiesDialog,
  type ItemProperties,
} from '@throng/core';

const CACHE_MS = 60_000;
const BATCH_MS = 100;
const LSTAT_CHUNK = 64;
const WATCH_MS = 2000;
const NO_ATTRIBUTES: FileAttributes = { readOnly: false, hidden: false, system: false, archive: false, junction: false };

export type EmitTally = (requestId: string, tally: FolderTally) => void;

export interface PropertiesOpened {
  readonly requestId: string;
  readonly items: ItemProperties[];
  readonly osProperties: { readonly available: boolean; readonly reason?: string };
}

/** The Properties dialog's data (067 FR-046 to FR-054): what is known at once, then a walk that reports as it goes. */
export class PropertiesService {
  private readonly runs = new Map<string, AbortController>();
  private readonly cache = new Map<string, { readonly at: number; readonly tally: FolderTally }>();
  private nextRequest = 1;

  constructor(
    private readonly attributes: IFileAttributes,
    private readonly dialog: IOsPropertiesDialog,
    private readonly accessInfo: IFileAccessInfo,
    private readonly root: () => string | null,
    private readonly now: () => number = Date.now,
    private readonly watchMs: number = WATCH_MS,
  ) {}

  async open(relPaths: readonly string[], emit: EmitTally): Promise<PropertiesOpened> {
    const requestId = `properties-${this.nextRequest++}`;
    const root = this.root();
    const paths = root === null ? [] : relPaths.map((rel) => join(root, rel)).filter((abs) => isWithinRoot(root, abs));
    const items = await Promise.all(paths.map((abs) => this.describe(abs)));
    const osProperties = {
      available: this.dialog.available,
      ...(this.dialog.unavailableReason === undefined ? {} : { reason: this.dialog.unavailableReason }),
    };
    const controller = new AbortController();
    this.runs.set(requestId, controller);
    // After this reply has gone: the renderer must hold the request id before the first tally reaches it.
    setImmediate(() => void this.total(requestId, items, controller.signal, emit));
    return { requestId, items, osProperties };
  }

  close(requestId: string): void {
    this.runs.get(requestId)?.abort();
    this.runs.delete(requestId);
  }

  async showOsProperties(absPath: string): Promise<{ ok: true } | { error: string }> {
    const root = this.root();
    if (root === null || !isWithinRoot(root, absPath)) return { error: 'That item is outside the active project.' };
    const result = await this.dialog.show(absPath);
    return result.ok ? { ok: true } : { error: result.osReason };
  }

  private async describe(path: string): Promise<ItemProperties> {
    try {
      const stats = await lstat(path);
      const attributes = await this.attributes.read(path);
      const access = await this.accessInfo.read(stats);
      const link = stats.isSymbolicLink();
      return {
        name: basename(path),
        path,
        type: link ? (attributes.junction ? 'junction' : 'symlink') : stats.isDirectory() ? 'folder' : 'file',
        ...(link ? { linkTarget: await readlink(path) } : {}),
        sizeBytes: stats.isDirectory() ? 0 : stats.size,
        attributes,
        ...(access === undefined ? {} : { access }),
        created: stats.birthtimeMs,
        modified: stats.mtimeMs,
        accessed: stats.atimeMs,
      };
    } catch (error) {
      logExpected('properties: read an item', 'an item deleted since the menu opened is shown as gone', error);
      return {
        name: basename(path),
        path,
        type: 'file',
        sizeBytes: 0,
        attributes: NO_ATTRIBUTES,
        created: 0,
        modified: 0,
        accessed: 0,
        gone: true,
      };
    }
  }

  private async total(requestId: string, items: readonly ItemProperties[], signal: AbortSignal, emit: EmitTally): Promise<void> {
    const key = JSON.stringify(items.map((item) => item.path).sort());
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < CACHE_MS) {
      if (signal.aborted) return;
      emit(requestId, cached.tally);
      this.watchForDeletion(requestId, items, cached.tally, signal, emit);
      return;
    }
    const tally = await this.walk(items, signal, (partial) => emit(requestId, partial));
    if (signal.aborted) return;
    this.remember(key, tally);
    emit(requestId, tally);
    this.watchForDeletion(requestId, items, tally, signal, emit);
  }

  /** While the dialog stays open, an item that disappears ends it with a last tally naming what went. */
  private watchForDeletion(
    requestId: string,
    items: readonly ItemProperties[],
    tally: FolderTally,
    signal: AbortSignal,
    emit: EmitTally,
  ): void {
    const present = items.filter((item) => !item.gone).map((item) => item.path);
    if (present.length === 0) return;
    const timer = setInterval(() => {
      void Promise.all(present.map(isMissing)).then((missing) => {
        const gone = present.filter((_path, index) => missing[index]);
        if (gone.length === 0 || signal.aborted) return;
        clearInterval(timer);
        this.runs.delete(requestId);
        emit(requestId, { ...tally, gone });
      });
    }, this.watchMs);
    timer.unref();
    signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  }

  private remember(key: string, tally: FolderTally): void {
    const now = this.now();
    for (const [stale, entry] of this.cache) {
      if (now - entry.at >= CACHE_MS) this.cache.delete(stale);
    }
    this.cache.set(key, { at: now, tally });
  }

  /** Links are never followed: a link is one entry of its own size. Unreadable folders count as skipped (FR-051). */
  private async walk(
    items: readonly ItemProperties[],
    signal: AbortSignal,
    publish: (tally: FolderTally) => void,
  ): Promise<FolderTally> {
    const live = { sizeBytes: 0, files: 0, folders: 0, skipped: 0 };
    const folders: string[] = [];
    for (const item of items) {
      if (item.gone) continue;
      if (item.type === 'folder') {
        folders.push(item.path);
        if (items.length > 1) live.folders += 1;
      } else {
        live.files += 1;
        live.sizeBytes += item.sizeBytes;
      }
    }

    let lastPublished = Date.now();
    const maybePublish = (): void => {
      if (Date.now() - lastPublished < BATCH_MS) return;
      lastPublished = Date.now();
      publish({ ...live, done: false });
    };
    let pending: string[] = [];
    const settlePending = async (): Promise<void> => {
      const sizes = await Promise.all(pending.map(sizeOf));
      pending = [];
      live.sizeBytes += sizes.reduce((sum, size) => sum + size, 0);
      // lstat's completions run together; this is what lets input in between them.
      await new Promise((resolve) => setImmediate(resolve));
      maybePublish();
    };

    while (folders.length > 0 && !signal.aborted) {
      const folder = folders.pop()!;
      try {
        const dir = await opendir(folder);
        for await (const entry of dir) {
          if (signal.aborted) break;
          const path = join(folder, entry.name);
          if (entry.isDirectory()) {
            live.folders += 1;
            folders.push(path);
            continue;
          }
          live.files += 1;
          pending.push(path);
          if (pending.length >= LSTAT_CHUNK) await settlePending();
        }
      } catch (error) {
        logExpected('properties: read a folder', 'an unreadable folder is reported in the skipped count', error);
        live.skipped += 1;
      }
    }
    if (!signal.aborted && pending.length > 0) await settlePending();
    return { ...live, done: true };
  }
}

async function isMissing(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    logExpected('properties: check an item still exists', 'an item that has gone is what this asks', error);
    return true;
  }
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await lstat(path)).size;
  } catch (error) {
    logExpected('properties: size a file', 'a file deleted during the walk adds nothing to the total', error);
    return 0;
  }
}
