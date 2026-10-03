/**
 * Shared fixture for the transfer engine's integration tests (050): two real project roots on a temp
 * disk, a real `FilesService` pointed at the second, and recorders for everything the engine reports.
 */
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  ClashAnswer,
  ClashQuestion,
  DirEntry,
  IFileSystem,
  TransferProgress,
  TransferResult,
} from '@throng/core';
import { NodeFileSystem } from '../../../src/main/node-file-system.js';
import { FilesService, type MovePair } from '../../../src/main/files-service.js';
import { TransferService, type TransferDeps } from '../../../src/main/transfer-service.js';

/** Delegates every call; subclass and override the one a test needs to bend. */
export class FsDecorator implements IFileSystem {
  constructor(readonly inner: IFileSystem) {}
  list(d: string): Promise<DirEntry[]> {
    return this.inner.list(d);
  }
  mkdir(p: string): Promise<void> {
    return this.inner.mkdir(p);
  }
  stat(p: string): Promise<{ kind: 'file' | 'folder'; isSymlink: boolean }> {
    return this.inner.stat(p);
  }
  realpath(p: string): Promise<string> {
    return this.inner.realpath(p);
  }
  rename(p: string, n: string): Promise<string> {
    return this.inner.rename(p, n);
  }
  move(s: string, d: string): Promise<string> {
    return this.inner.move(s, d);
  }
  copy(s: string, d: string, n?: string): Promise<string> {
    return this.inner.copy(s, d, n);
  }
  copyFileCancellable(s: string, d: string, signal: AbortSignal): Promise<void> {
    return this.inner.copyFileCancellable(s, d, signal);
  }
  delete(p: string): Promise<void> {
    return this.inner.delete(p);
  }
  trash(p: string): Promise<void> {
    return this.inner.trash(p);
  }
  restoreFromTrash(p: string, at: number): Promise<void> {
    return this.inner.restoreFromTrash(p, at);
  }
  exists(p: string): Promise<boolean> {
    return this.inner.exists(p);
  }
  readBytes(p: string): Promise<Uint8Array> {
    return this.inner.readBytes(p);
  }
  writeBytes(p: string, b: Uint8Array): Promise<void> {
    return this.inner.writeBytes(p, b);
  }
  size(p: string): Promise<number> {
    return this.inner.size(p);
  }
  modifiedAt(p: string): Promise<{ mtimeMs: number; size: number }> {
    return this.inner.modifiedAt(p);
  }
}

/**
 * A Recycle Bin double on a real disk: `trash` moves the item into a bin folder and records when;
 * `restore` moves it back. Lets undo and roll back of a Replace be proven end to end.
 */
export class FakeBin {
  readonly trashed: { path: string; at: number; binPath: string }[] = [];
  private seq = 0;
  constructor(private readonly binDir: string) {}

  trash = async (path: string): Promise<void> => {
    await mkdir(this.binDir, { recursive: true });
    const binPath = join(this.binDir, `${++this.seq}`);
    const { rename } = await import('node:fs/promises');
    await rename(path, binPath);
    this.trashed.push({ path, at: Date.now(), binPath });
  };

  restore = async (originalPath: string): Promise<void> => {
    const hit = [...this.trashed].reverse().find((t) => t.path === originalPath);
    if (!hit) throw new Error(`"${originalPath}" is not in the Recycle Bin.`);
    const { rename } = await import('node:fs/promises');
    await rename(hit.binPath, originalPath);
    this.trashed.splice(this.trashed.indexOf(hit), 1);
  };
}

export type BracketEvent = { kind: 'started'; paths: readonly string[] } | { kind: 'moved'; moves: readonly MovePair[] };

export interface Harness {
  base: string;
  /** Project A's root (id `A`). */
  rootA: string;
  /** Project B's root (id `B`) — the ACTIVE project. */
  rootB: string;
  /** A folder inside no project. */
  outside: string;
  bin: FakeBin;
  files: FilesService;
  svc: TransferService;
  bracket: BracketEvent[];
  progress: { windowId: number; p: TransferProgress }[];
  done: { windowId: number; r: TransferResult }[];
  cancelChoices: { windowId: number; jobId: string }[];
  questions: ClashQuestion[];
}

export interface HarnessOptions {
  /** Wrap the real filesystem (the bin double is already wired into it). */
  wrapFs?: (fs: IFileSystem) => IFileSystem;
  /** Answer each clash question; default answers Cancel and records it. */
  answer?: (q: ClashQuestion) => ClashAnswer | Promise<ClashAnswer>;
  deps?: Partial<TransferDeps>;
}

export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), 'throng-transfer-'));
  const rootA = join(base, 'alpha');
  const rootB = join(base, 'beta');
  const outside = join(base, 'outside');
  for (const d of [rootA, rootB, outside]) await mkdir(d);
  const bin = new FakeBin(join(base, '.bin'));
  const real = new NodeFileSystem(bin.trash, (p) => bin.restore(p));
  const fs = opts.wrapFs ? opts.wrapFs(real) : real;
  const files = new FilesService(fs, {} as ConstructorParameters<typeof FilesService>[1]);
  files.setRoot(rootB);
  const h: Omit<Harness, 'svc'> & { svc?: TransferService } = {
    base,
    rootA,
    rootB,
    outside,
    bin,
    files,
    bracket: [],
    progress: [],
    done: [],
    cancelChoices: [],
    questions: [],
  };
  files.setOnMoveStarted((paths) => h.bracket.push({ kind: 'started', paths }));
  files.setOnMoved((moves) => h.bracket.push({ kind: 'moved', moves }));
  h.svc = new TransferService({
    fs,
    files,
    projects: async () => [
      { id: 'A', rootFolder: rootA },
      { id: 'B', rootFolder: rootB },
    ],
    events: {
      progress: (windowId, p) => h.progress.push({ windowId, p }),
      cancelChoice: (windowId, jobId) => h.cancelChoices.push({ windowId, jobId }),
      done: (windowId, r) => h.done.push({ windowId, r }),
    },
    clash: {
      ask: async (_windowId, q) => {
        h.questions.push(q);
        return opts.answer ? opts.answer(q) : { choice: 'cancel' };
      },
    },
    ...opts.deps,
  });
  return h as Harness;
}

export async function disposeHarness(h: Harness): Promise<void> {
  await rm(h.base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

/** Write a file, creating its folders. */
export async function put(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** Every file under `dir`, relative, `/`-separated, with its content — a tree's whole shape. */
export async function snapshotTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string, rel: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out[`${r}/`] = '';
        await walk(join(d, e.name), r);
      } else out[r] = await readFile(join(d, e.name), 'utf8');
    }
  };
  await walk(dir, '');
  return out;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A promise plus the switch that settles it. */
export function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
