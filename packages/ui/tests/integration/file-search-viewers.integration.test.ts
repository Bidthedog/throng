/**
 * 043 T127 — one scan, several windows (R23, FR-078, FR-078a, US5 scenario 6, #380).
 *
 * ══ WHAT WENT WRONG, IN THE USER'S WORDS ══
 *
 * You search a project, sync the Find in Files panel into a sub-workspace, and the second window
 * shows an EMPTY panel — indistinguishable from a search that found nothing. So you retype a search
 * that was already correct. The cause was that "one panel in two windows" was never distinguished
 * from "two panels": a run was keyed by `(webContentsId, panelId)`, and the second window's view
 * simply had no run.
 *
 * ══ WHY INTEGRATION, AND NOT A UNIT TEST OVER A FAKE ══
 *
 * Every claim here is about a run's LIFETIME under two subscribers — that a delta reaches both, that
 * a snapshot re-states what a completed walk found, that the first detach keeps the run and the last
 * one reclaims it. The rows, the totals, the per-file stamps and the staleness all come out of a real
 * walk over a real tree, and asserting "the run was released" against a private field would pass for
 * an implementation that deleted the map entry and left the stats running. So the release is asserted
 * where its COST is — the filesystem — exactly as `file-search-run-lifetime.integration.test.ts`
 * does, and this file is its round-two sibling.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { NO_MODES, type DirEntry, type IFileSystem } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { FileSearchService, type FileSearchUpdate } from '../../src/main/file-search-service.js';

const TERM = 'needle';
/** The SAME panel id in two windows — what a synced sub-workspace view actually is (FR-078). */
const PANEL = 'panel-1';
const PARENT = 1;
const CHILD = 2;
/** A window that is displaying something else entirely. It must never be told anything. */
const STRANGER = 3;
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

/** A real filesystem that COUNTS the stats, because a released run is one that costs nothing. */
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

  readonly service: FileSearchService;

  constructor() {
    this.service = new FileSearchService(
      this.fs,
      () => [],
      () => [],
      () => 10 * 1024 * 1024,
      (id, payload) => this.sent.push({ id, payload }),
    );
    services.push(this.service);
  }

  to(windowId: number): FileSearchUpdate[] {
    return this.sent.filter((s) => s.id === windowId).map((s) => s.payload);
  }

  rowsAt(windowId: number): string[] {
    return this.to(windowId).flatMap((u) => (u.rows ?? []).map((r) => r.relPath));
  }

  settled(windowId: number): FileSearchUpdate | undefined {
    return this.to(windowId).find(
      (u) => u.status === 'complete' || u.status === 'cancelled' || u.status === 'scopeMissing',
    );
  }

  start(windowId: number, root: string, term = TERM): Promise<unknown> {
    return this.service.start(windowId, {
      panelId: PANEL,
      projectRoot: root,
      scopeSubPath: null,
      term,
      modes: NO_MODES,
    });
  }

  /** Start a scan for one window and wait for it to reach a terminal state. */
  async scan(windowId: number, root: string, term = TERM): Promise<FileSearchUpdate> {
    await this.start(windowId, root, term);
    return waitFor(`a terminal update for window ${windowId}`, () => this.settled(windowId));
  }
}

async function makeRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'throng-fif-view-'));
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

describe('a synced panel sees the parent’s scan (FR-078, US5 scenario 6, #380)', () => {
  it('sends a window attaching AFTER the scan finished the whole result set, once', async () => {
    /*
     * The #380 sequence exactly: search, then sync. The walk is over and its rows were streamed to
     * one window; without retention (FR-078a) the second window can only be told what happens NEXT,
     * which for a finished scan is nothing at all — an empty panel that looks like a search that
     * missed.
     */
    const rig = new Rig();
    const root = await makeRoot(FILES);
    await rig.scan(PARENT, root);
    rig.sent.length = 0;

    rig.service.attach(CHILD, PANEL);

    const snapshot = await waitFor('the child to be told', () => rig.to(CHILD).at(0));
    expect(snapshot.snapshot, 'a full re-statement, not a delta the child would append').toBe(true);
    expect(snapshot.status).toBe('complete');
    expect(snapshot.totalMatches).toBe(2);
    expect(snapshot.filesScanned).toBe(3);
    expect((snapshot.rows ?? []).map((r) => r.relPath)).toEqual(['a.txt', 'b.txt']);
    // ONE message, not a replay of the batches the walk happened to cut.
    expect(rig.to(CHILD)).toHaveLength(1);
    // And the parent is not re-told anything by a window arriving beside it.
    expect(rig.to(PARENT)).toEqual([]);
  });

  it('carries the cumulative staleness a late window would otherwise never learn', async () => {
    // FR-045a is a statement about the rows on screen, so a window shown those rows must be shown
    // the marking with them. Arriving after the file changed is the ordinary case, not an edge one.
    const rig = new Rig();
    const root = await makeRoot(FILES);
    await rig.scan(PARENT, root);
    await writeFile(join(root, 'a.txt'), 'cattle one and then some\n');
    await rig.service.noteDirectoryChanged(root, '');
    rig.sent.length = 0;

    rig.service.attach(CHILD, PANEL);

    const snapshot = await waitFor('the child to be told', () => rig.to(CHILD).at(0));
    expect(snapshot.staleFiles).toEqual(['a.txt']);
  });

  it('delivers a running scan’s deltas to both viewers', async () => {
    const rig = new Rig();
    const root = await makeRoot(FILES);
    rig.service.attach(CHILD, PANEL); // no run yet — the panel is simply open in both windows
    await rig.scan(PARENT, root);

    await waitFor('the child to settle too', () => rig.settled(CHILD));
    expect(rig.rowsAt(CHILD)).toEqual(['a.txt', 'b.txt']);
    expect(rig.rowsAt(PARENT)).toEqual(['a.txt', 'b.txt']);
    expect(rig.settled(CHILD)?.totalMatches).toBe(2);
    // Both streams are DELTAS: the child was watching, so it has nothing to re-state.
    expect(rig.to(CHILD).filter((u) => u.snapshot === true)).toEqual([]);
  });

  it('supersedes for both windows when the search is typed in either one', async () => {
    /*
     * The round-one composite key called this a bug — "a search typed in the mirror redirected the
     * parent's updates to it". Under FR-078 the mirror IS the panel, so a search typed there is a
     * search on that panel and both windows must follow it (FR-043c, supersession per panel).
     */
    const rig = new Rig();
    const root = await makeRoot(FILES);
    rig.service.attach(CHILD, PANEL);
    await rig.scan(PARENT, root);
    rig.sent.length = 0;

    await rig.scan(CHILD, root, 'haystack');

    const parentLast = rig.to(PARENT).at(-1);
    const childLast = rig.to(CHILD).at(-1);
    expect(parentLast?.generation, 'the parent hears the new run').toBe(2);
    expect(childLast?.generation).toBe(2);
    expect(parentLast?.totalMatches, 'and hears that it found nothing').toBe(0);
    expect(childLast?.totalMatches).toBe(0);
    expect(rig.rowsAt(PARENT)).toEqual([]);
  });

  /*
   * FR-078b — THE QUERY TRAVELS WITH THE RESULTS, and until it did the sharing made things worse.
   *
   * FR-078 shares the RUN. Nothing shared the QUERY, and the gap was invisible while a synced panel
   * had no results: an empty list cannot disagree with the box above it. Now that the child shows
   * the parent's rows, a term changed in the parent — which under FR-074 re-runs 500 ms later with
   * nobody pressing anything — leaves the child listing `haystack` matches under a box still reading
   * `needle`.
   *
   * It is not only a wrong label. The commit sends THIS window's term with the SHARED run's rows,
   * and FR-054 re-checks the term against the bytes before writing, so every file comes back
   * `matchGone` naming matches that are on screen. No wrong bytes are written — that is what bounds
   * this to confusion rather than data loss — but the panel reports a failure that is not one.
   *
   * The direction is what makes it safe: the query goes FROM whichever window last started or
   * retargeted the run TO every other viewer, never back. The window being typed into keeps its own
   * box, which is the same reason `find-in-files-panel.tsx` reads `panel.config` once and never
   * re-reads it.
   */
  it('tells a window attaching to a finished run what the run was searching for', async () => {
    const rig = new Rig();
    const root = await makeRoot(FILES);
    await rig.scan(PARENT, root);
    rig.sent.length = 0;

    rig.service.attach(CHILD, PANEL);

    const snapshot = await waitFor('the child to be told', () => rig.to(CHILD).at(0));
    expect(
      snapshot.adoptQuery,
      'the child is shown rows it did not ask for; it must be told what they are',
    ).toEqual({ term: TERM, modes: NO_MODES });
  });

  it('does not hand the query back to the window that is doing the typing', async () => {
    // The originator's box is the authority. Sending the run's term back to it would fight the
    // user's own keystrokes every time a debounced re-run landed mid-word.
    const rig = new Rig();
    const root = await makeRoot(FILES);
    rig.service.attach(CHILD, PANEL);
    await rig.scan(PARENT, root);

    await waitFor('the parent to settle', () => rig.settled(PARENT));
    for (const update of rig.to(PARENT)) {
      expect(update.adoptQuery, 'the parent started this run and owns its query').toBeUndefined();
    }
  });

  it('moves the query to the other window when the search is retargeted', async () => {
    /*
     * The whole defect in one sequence, and note which way ownership travels: the CHILD types, so
     * from that moment the child owns the query and the PARENT is the one that must adopt.
     * Ownership follows whoever last drove the search, not whichever window is the parent.
     */
    const rig = new Rig();
    const root = await makeRoot(FILES);
    rig.service.attach(CHILD, PANEL);
    await rig.scan(PARENT, root);
    rig.sent.length = 0;

    await rig.scan(CHILD, root, 'haystack');

    const parentLast = rig.to(PARENT).at(-1);
    expect(parentLast?.adoptQuery, 'the parent is now the one following').toEqual({
      term: 'haystack',
      modes: NO_MODES,
    });
    for (const update of rig.to(CHILD)) {
      expect(update.adoptQuery, 'and the child, now typing, is left alone').toBeUndefined();
    }
  });

  it('tells a window that never attached nothing at all (FR-018, Principle I)', async () => {
    // The guarantee the viewer set replaced the key with. A sub-workspace window may be showing a
    // DIFFERENT project, and one project's paths and match text must not reach it.
    const rig = new Rig();
    const root = await makeRoot(FILES);
    rig.service.attach(CHILD, PANEL);
    await rig.scan(PARENT, root);
    await writeFile(join(root, 'a.txt'), 'cattle one and then some\n');
    await rig.service.noteDirectoryChanged(root, '');

    expect(rig.to(STRANGER)).toEqual([]);
  });
});

describe('the run is released on the LAST detach, not the first (FR-023, FR-078a)', () => {
  it('leaves the other viewer’s stream intact when one window drops', async () => {
    /*
     * The failure the composite key was introduced to fix, now answered by reference counting:
     * closing the sub-workspace view must not abort the scan the parent is watching.
     */
    const rig = new Rig();
    const root = await makeRoot(FILES);
    rig.service.attach(CHILD, PANEL);
    await rig.scan(PARENT, root);

    rig.service.drop(CHILD, PANEL);
    rig.sent.length = 0;
    await writeFile(join(root, 'a.txt'), 'cattle one and then some\n');
    await rig.service.noteDirectoryChanged(root, '');

    expect(rig.to(PARENT).at(-1)?.staleFiles, 'the parent’s run is untouched').toEqual(['a.txt']);
    expect(rig.to(CHILD), 'the window that left is told nothing more').toEqual([]);
  });

  it('reclaims everything once the last viewer has gone (FR-023)', async () => {
    /*
     * FR-023 is unchanged by the retention FR-078a introduces: the run dies with the panel, and the
     * panel is gone when it is gone in every window. Asserted on the COST — a released run stats
     * nothing on a watcher tick and pushes nothing — because that is what a leak would show up as.
     */
    const rig = new Rig();
    const root = await makeRoot(FILES);
    rig.service.attach(CHILD, PANEL);
    await rig.scan(PARENT, root);

    rig.service.drop(CHILD, PANEL);
    rig.service.drop(PARENT, PANEL);
    rig.sent.length = 0;
    rig.fs.stats = 0;
    await rig.service.noteDirectoryChanged(root, '');

    expect(rig.fs.stats, 'a released run costs nothing per watcher tick').toBe(0);
    expect(rig.sent, 'and nothing is pushed to a panel that no longer exists').toEqual([]);
  });

  it('takes a dead window out of the set without taking the run', async () => {
    // `release` is what main calls when a window is destroyed. It used to drop every run that window
    // owned; it now removes the window from every viewer set and releases only what is left empty.
    const rig = new Rig();
    const root = await makeRoot(FILES);
    rig.service.attach(CHILD, PANEL);
    await rig.scan(PARENT, root);

    rig.service.release(CHILD);
    rig.sent.length = 0;
    rig.fs.stats = 0;
    await writeFile(join(root, 'a.txt'), 'cattle one and then some\n');
    await rig.service.noteDirectoryChanged(root, '');

    expect(rig.to(PARENT).at(-1)?.staleFiles).toEqual(['a.txt']);
    expect(rig.to(CHILD)).toEqual([]);
    expect(rig.fs.stats, 'ONE run’s files are re-stated, not two').toBe(2);
  });

  it('re-attaching after a drop is answered with a fresh snapshot', async () => {
    // A sub-workspace closed and synced again, or a tab switched away from and back. Idempotent by
    // contract: the window rejoins the set and is re-told what the run holds.
    const rig = new Rig();
    const root = await makeRoot(FILES);
    await rig.scan(PARENT, root);
    rig.service.attach(CHILD, PANEL);
    rig.service.drop(CHILD, PANEL);
    rig.sent.length = 0;

    rig.service.attach(CHILD, PANEL);

    const snapshot = await waitFor('the child to be re-told', () => rig.to(CHILD).at(0));
    expect(snapshot.snapshot).toBe(true);
    expect((snapshot.rows ?? []).map((r) => r.relPath)).toEqual(['a.txt', 'b.txt']);
  });

  it('says nothing to a window that attaches to a panel with no run', async () => {
    // The panel is open in both windows and nobody has searched yet. There is nothing to re-state,
    // and a snapshot of nothing would be a `notRun` panel told it had run.
    const rig = new Rig();
    await makeRoot(FILES);

    rig.service.attach(CHILD, PANEL);

    expect(rig.sent).toEqual([]);
  });
});
