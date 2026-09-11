/**
 * 043 — a scan RUN's lifetime: who owns it, what releases it, and what one window's gesture may
 * reach (FR-018, FR-043, FR-045a, data-model §7).
 *
 * ══ WHY THESE THREE BELONG IN ONE FILE ══
 *
 * They are the same mistake at three depths. A run was keyed by `panelId` alone and released only
 * when a WINDOW was destroyed, so: a closed panel's run lived for the life of the window and kept
 * being re-stated on every watcher tick; a sub-workspace's mirrored view — the same panel id in a
 * second window — shared the parent's run and could cancel it or steal its updates; and a scan that
 * threw had nothing to report the throw to. All three are answered by the same two changes, so they
 * are proved together.
 *
 * ══ WHAT ROUND TWO CHANGED UNDERNEATH THEM (043 R23, FR-078) ══
 *
 * The composite key `(webContentsId, panelId)` is gone: a run is keyed by the panel and carries a SET
 * of viewer windows, because a panel mirrored into a sub-workspace must show the parent's results
 * (#380) and the key made that unreachable. Every claim in this file survives the change and is worth
 * more after it, because the protections are now load-bearing rather than free — they are enforced by
 * reference counting and by viewer membership instead of by two windows never meeting. What each test
 * means NOW is stated on the test; the sibling file
 * `file-search-viewers.integration.test.ts` owns the behaviour the change added.
 *
 * ══ WHY INTEGRATION ══
 *
 * The cost this is about is real I/O: `noteDirectoryChanged` sequentially awaits `modifiedAt` for
 * every file a run holds, on a 150 ms watcher debounce. Asserting "the run was released" against a
 * private field would pass for an implementation that released the map entry and kept the stats
 * going. So the assertion is on the SEAM the cost goes through — the filesystem — over a real tree.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { NO_MODES, type DirEntry, type IFileSystem } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { FileSearchService, type FileSearchUpdate } from '../../src/main/file-search-service.js';

const TERM = 'needle';
/** The SAME panel id in two windows — what a synced sub-workspace view actually is. */
const PANEL = 'panel-1';
const PARENT = 1;
const CHILD = 2;
const BUDGET_MS = 30_000;

async function waitFor<T>(what: string, probe: () => T | undefined, budgetMs = BUDGET_MS): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() - started > budgetMs) throw new Error(`timed out after ${budgetMs}ms: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A real filesystem that COUNTS the stats, because the stats are the cost under test. */
class CountingFs implements IFileSystem {
  stats = 0;

  private readonly inner = new NodeFileSystem(async () => {});

  modifiedAt(path: string): Promise<{ mtimeMs: number; size: number }> {
    this.stats += 1;
    return this.inner.modifiedAt(path);
  }

  list(dir: string): Promise<DirEntry[]> {
    return this.inner.list(dir);
  }

  readBytes(path: string): Promise<Uint8Array> {
    return this.inner.readBytes(path);
  }

  size(path: string): Promise<number> {
    return this.inner.size(path);
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  stat(path: string): Promise<{ kind: 'file' | 'folder'; isSymlink: boolean }> {
    return this.inner.stat(path);
  }

  realpath(path: string): Promise<string> {
    return this.inner.realpath(path);
  }

  mkdir(path: string): Promise<void> {
    return this.inner.mkdir(path);
  }

  rename(path: string, newName: string): Promise<string> {
    return this.inner.rename(path, newName);
  }

  move(src: string, destDir: string): Promise<string> {
    return this.inner.move(src, destDir);
  }

  copy(src: string, destDir: string, newName?: string): Promise<string> {
    return this.inner.copy(src, destDir, newName);
  }

  delete(path: string): Promise<void> {
    return this.inner.delete(path);
  }

  trash(path: string): Promise<void> {
    return this.inner.trash(path);
  }

  restoreFromTrash(originalPath: string, deletedAt: number): Promise<void> {
    return this.inner.restoreFromTrash(originalPath, deletedAt);
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return this.inner.writeBytes(path, bytes);
  }
}

interface Sent {
  id: number;
  payload: FileSearchUpdate;
}

const roots: string[] = [];
const services: FileSearchService[] = [];

class Rig {
  readonly sent: Sent[] = [];

  readonly fs = new CountingFs();

  globs: () => readonly string[] = () => [];

  readonly service: FileSearchService;

  constructor() {
    this.service = new FileSearchService(
      this.fs,
      () => this.globs(),
      () => [],
      () => 10 * 1024 * 1024,
      (id, payload) => this.sent.push({ id, payload }),
    );
    services.push(this.service);
  }

  to(windowId: number): FileSearchUpdate[] {
    return this.sent.filter((s) => s.id === windowId).map((s) => s.payload);
  }

  settled(windowId: number): FileSearchUpdate | undefined {
    return this.to(windowId).find(
      (u) => u.status === 'complete' || u.status === 'cancelled' || u.status === 'scopeMissing',
    );
  }

  /** Start a scan for one window and wait for it to reach a terminal state. */
  async scan(windowId: number, root: string): Promise<FileSearchUpdate> {
    await this.service.start(windowId, {
      panelId: PANEL,
      projectRoot: root,
      scopeSubPath: null,
      term: TERM,
      modes: NO_MODES,
    });
    return waitFor(`a terminal update for window ${windowId}`, () => this.settled(windowId));
  }
}

async function makeRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'throng-fif-life-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
  }
  return root;
}

const FILES = {
  'a.txt': 'needle one\n',
  'b.txt': 'needle two\n',
  'c.txt': 'nothing here\n',
};

afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('a closed panel releases its run (043 data-model §7)', () => {
  it('keeps re-stating a live panel’s results on a directory change', async () => {
    // Anti-vacuity: the stats below are only evidence of a leak because they happen at all.
    const rig = new Rig();
    const root = await makeRoot(FILES);
    await rig.scan(PARENT, root);

    rig.fs.stats = 0;
    await rig.service.noteDirectoryChanged(root, '');
    expect(rig.fs.stats, 'a live run re-stats the files behind its rows').toBe(2);
  });

  it('stats nothing, and pushes nothing, once the panel has been dropped', async () => {
    /*
     * The user's sequence: run a search, read the results, close the panel. The scan has already
     * finished, so `cancel` early-returns and the run survives with its whole `held` map — and
     * `noteDirectoryChanged` then walks it on every watcher tick, sequentially, for the life of the
     * window. Three closed panels over a broad term and a `git checkout` in the project is three
     * times (files matched) stats per 150 ms, stacking.
     */
    const rig = new Rig();
    const root = await makeRoot(FILES);
    await rig.scan(PARENT, root);

    rig.service.drop(PARENT, PANEL);
    rig.fs.stats = 0;
    rig.sent.length = 0;
    await rig.service.noteDirectoryChanged(root, '');

    expect(rig.fs.stats, 'a dropped run must cost nothing per watcher tick').toBe(0);
    expect(rig.sent, 'a dropped panel must not be sent staleness it can no longer render').toEqual(
      [],
    );
  });

  it('drops a run that is still going, and stops it', async () => {
    const rig = new Rig();
    const root = await makeRoot(FILES);
    await rig.service.start(PARENT, {
      panelId: PANEL,
      projectRoot: root,
      scopeSubPath: null,
      term: TERM,
      modes: NO_MODES,
    });
    rig.service.drop(PARENT, PANEL);

    // Give the abandoned walk every chance to push something it should not.
    await new Promise((r) => setTimeout(r, 100));
    expect(rig.to(PARENT).filter((u) => u.status === 'complete')).toEqual([]);
    rig.fs.stats = 0;
    await rig.service.noteDirectoryChanged(root, '');
    expect(rig.fs.stats).toBe(0);
  });
});

describe('one window’s gesture cannot reach a scan it is not watching (FR-018)', () => {
  it('a cancel from a window that is not displaying the panel does not abort the scan', async () => {
    /*
     * A synced sub-workspace panel carries the SAME id in both windows. Closing the mirrored view
     * cancelled the run keyed by that id — which was the parent's — and pushed the parent a
     * `cancelled` status for a scan it was still watching run.
     *
     * After R23 the run IS shared, so the protection moved rather than went: a gesture is honoured
     * only from a window in the run's viewer set, and the window below never attached and never
     * started anything. A window that IS displaying the panel may cancel, and both windows are told,
     * because they are watching one scan — that half is `file-search-viewers.integration.test.ts`'s.
     */
    const rig = new Rig();
    const root = await makeRoot(FILES);
    await rig.service.start(PARENT, {
      panelId: PANEL,
      projectRoot: root,
      scopeSubPath: null,
      term: TERM,
      modes: NO_MODES,
    });
    // `start` returns with the scan at its first await, so this lands while it is running.
    rig.service.cancel(CHILD, PANEL);
    rig.service.drop(CHILD, PANEL);

    const settled = await waitFor('the parent to settle', () => rig.settled(PARENT));
    expect(settled.status).toBe('complete');
    expect(settled.totalMatches).toBe(2);
    expect(rig.to(CHILD), 'the child never started a scan, so it is told nothing').toEqual([]);
  });

  it('a scan started in a second window leaves the first one still hearing its results', async () => {
    /*
     * `supersede` reassigned the run's `webContentsId`. So a search typed in a second window left the
     * first showing `running` for ever, with a Cancel control that reached nothing, while its updates
     * arrived somewhere else.
     *
     * R23 answers it the other way round and the assertion is unchanged: starting ADDS a viewer and
     * never reassigns one, so both windows hear the run. Under FR-078 that is the requirement rather
     * than a bug — a search typed in a mirrored view is a search on that panel — and the reason the
     * two windows below still both hear about `a.txt` is that they are watching ONE run, where they
     * used to be watching two.
     */
    const rig = new Rig();
    const root = await makeRoot(FILES);
    await rig.scan(PARENT, root);
    await rig.scan(CHILD, root);

    expect(rig.settled(PARENT)?.status).toBe('complete');
    expect(rig.settled(CHILD)?.status).toBe('complete');

    // The run is alive and BOTH windows are watching it: a directory change re-states the results to
    // each of them.
    rig.sent.length = 0;
    await writeFile(join(root, 'a.txt'), 'cattle one and then some\n');
    await rig.service.noteDirectoryChanged(root, '');
    expect(rig.to(PARENT).at(-1)?.staleFiles).toEqual(['a.txt']);
    expect(rig.to(CHILD).at(-1)?.staleFiles).toEqual(['a.txt']);
  });

  it('a window going away stops its own stream and nobody else’s', async () => {
    // `release` used to drop every run the dead window owned, which under the composite key was the
    // same sentence. It now removes that window from every viewer set and releases only what is left
    // with none — so the surviving window's scan is untouched, and only ITS files are re-stated.
    const rig = new Rig();
    const root = await makeRoot(FILES);
    await rig.scan(PARENT, root);
    await rig.scan(CHILD, root);

    rig.service.release(CHILD);
    rig.sent.length = 0;
    rig.fs.stats = 0;
    await writeFile(join(root, 'a.txt'), 'cattle one and then some\n');
    await rig.service.noteDirectoryChanged(root, '');

    expect(rig.to(PARENT).at(-1)?.staleFiles).toEqual(['a.txt']);
    expect(rig.to(CHILD)).toEqual([]);
    expect(rig.fs.stats, 'only the surviving run’s files are re-stated').toBe(2);
  });
});

describe('a scan that throws tells the panel (hardening)', () => {
  it('leaves the panel settled rather than spinning for ever', async () => {
    /*
     * `void this.scan(...)` had no rejection handler. Anything that threw inside it — the exclusion
     * globs are read AT SCAN TIME, so a malformed one is the reachable case — left the panel's
     * spinner running with a Cancel that reached nothing, plus an unhandled rejection in main.
     */
    const rig = new Rig();
    const root = await makeRoot(FILES);
    rig.globs = () => {
      throw new Error('exclusion globs unavailable');
    };

    await rig.service.start(PARENT, {
      panelId: PANEL,
      projectRoot: root,
      scopeSubPath: null,
      term: TERM,
      modes: NO_MODES,
    });

    const settled = await waitFor('the panel to be told', () => rig.settled(PARENT));
    expect(settled.status).not.toBe('running');
  });
});
