import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, type FileOpUndoEntry, type IFileWatcher } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta, type EditorSyncMsg } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { editDocument } from './helpers/edit-document.js';
import { disposeHarness, exists, makeHarness, put, type Harness } from './helpers/transfer-harness.js';

/**
 * A panel a cross-project move takes out of its project (050 FR-035, FR-036, SC-012 — T092, R18).
 *
 * A REAL `EditorCoordinator` over a REAL `EditorService` on the harness's two project roots, wired to
 * `FilesService`'s move bracket exactly as `in-app-moves.ts` wires it, so a paste and its undo reach the
 * coordinator by the route the app takes.
 */

let h: Harness;
let coord: EditorCoordinator;
let recoveryDir: string;
let synced: EditorSyncMsg[];
/** Folders currently watched, with how many watches each holds. */
let watched: Map<string, number>;

const fileA = (): string => join(h.rootA, 'a.txt');
const fileB = (): string => join(h.rootB, 'dest', 'a.txt');

function metaA(panelId: string, absPath: string | null): DocMeta {
  return {
    panelId,
    windowId: 'w1',
    ownerKind: 'project',
    ownerProjectId: 'A',
    ownerRoot: h.rootA,
    allProjectRoots: [h.rootA, h.rootB],
    tabId: 't1',
    absPath,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
  };
}

function metaB(panelId: string, absPath: string): DocMeta {
  return { ...metaA(panelId, absPath), ownerProjectId: 'B', ownerRoot: h.rootB, tabId: 't2' };
}

const recordingWatcher: IFileWatcher = {
  watch: (dir: string) => {
    watched.set(dir, (watched.get(dir) ?? 0) + 1);
    let live = true;
    return {
      dispose: () => {
        if (!live) return;
        live = false;
        const n = (watched.get(dir) ?? 1) - 1;
        if (n <= 0) watched.delete(dir);
        else watched.set(dir, n);
      },
    };
  },
} as IFileWatcher;

beforeEach(async () => {
  h = await makeHarness();
  await put(fileA(), 'alpha\n');
  await put(join(h.rootB, 'dest', 'keep.txt'), 'keep');
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-moved-out-rec-'));
  synced = [];
  watched = new Map();
  coord = new EditorCoordinator(
    new EditorService(new NodeFileSystem(async () => {}), () => DEFAULT_APP_SETTINGS),
    new EditorRecovery(recoveryDir),
    {
      recoveryDebounceMs: 10,
      relaySync: (_from, msg) => synced.push(msg),
      persistUndoHistory: () => true,
      fileWatcher: recordingWatcher,
    },
  );
  h.files.setOnMoveStarted((paths) => coord.beginMove(paths));
  h.files.setOnMoved((moves) => coord.markMoved(moves));
});
afterEach(async () => {
  for (const id of ['p1', 'p2']) coord.destroy(id);
  await disposeHarness(h);
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

async function cutAToB(): Promise<FileOpUndoEntry> {
  const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
    mode: 'cut',
    items: [{ absPath: fileA(), projectId: 'A', projectRoot: h.rootA }],
  }).result;
  expect(r.failures).toEqual([]);
  return r.undo!;
}

describe('a cut-paste takes an open editor out of its project (FR-035)', () => {
  it('the document is moved out: its path is the new one, and every window is told movedOut', async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });
    synced.length = 0;

    await cutAToB();

    expect(coord.getContent('p1')).toMatchObject({ absPath: fileB(), movedOut: true, unloadable: false });
    expect(synced.filter((m) => m.movedTo !== undefined)).toEqual([
      { panelId: 'p1', movedTo: fileB(), movedOut: true },
    ]);
  });

  it('lets go of the file: no registry claim, no watch, so the destination opens it (006 FR-011a)', async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });

    await cutAToB();

    await expect(coord.openInto(fileB())).resolves.toEqual({ action: 'open' });
    expect(coord.isOpen(fileB())).toBe(false);
    expect(watched.has(dirname(fileB()))).toBe(false);
    // …and B's editor then loads it as an ordinary document.
    const loaded = await coord.load({ ...metaB('p2', fileB()), absPath: fileB() });
    expect(loaded.ok).toBe(true);
    await expect(coord.openInto(fileB())).resolves.toMatchObject({ action: 'focus', panelId: 'p2' });
  });

  it('reads nothing: a remount verification raises no could-not-read state', async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });
    await cutAToB();
    synced.length = 0;

    await coord.verifyPath('p1');

    expect(synced.some((m) => m.unloadable === true)).toBe(false);
    expect(coord.getContent('p1')).toMatchObject({ unloadable: false, movedOut: true });
  });

  it('keeps unsaved text, refuses Save, and leaves the file in B untouched (FR-036)', async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });
    editDocument(coord, metaA('p1', fileA()), 'alpha + unsaved\n');

    await cutAToB();

    expect(coord.getContent('p1')).toMatchObject({ text: 'alpha + unsaved\n', dirty: true, movedOut: true });
    const saved = await coord.save({ panelId: 'p1', ownerKind: 'project', ownerRoot: h.rootA, allProjectRoots: [h.rootA, h.rootB] });
    expect(saved.ok).toBe(false);
    expect(await readFile(fileB(), 'utf8')).toBe('alpha\n');
    expect(coord.getContent('p1')?.dirty).toBe(true);
  });

  it('Save As anywhere in B succeeds and leaves the document moved out, clean, at the saved path (FR-036 amended)', async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });
    editDocument(coord, metaA('p1', fileA()), 'alpha + unsaved\n');
    await cutAToB();
    synced.length = 0;

    const target = join(h.rootB, 'elsewhere.txt');
    const saved = await coord.save({
      panelId: 'p1',
      absPath: target,
      ownerKind: 'project',
      ownerRoot: h.rootA,
      allProjectRoots: [h.rootA, h.rootB],
    });

    expect(saved).toMatchObject({ ok: true, absPath: target });
    expect(await readFile(target, 'utf8')).toBe('alpha + unsaved\n');
    expect(coord.getContent('p1')).toMatchObject({ absPath: target, dirty: false, movedOut: true });
    // Still detached: the saved file is B's to open, not this panel's.
    await expect(coord.openInto(target)).resolves.toEqual({ action: 'open' });
    expect(watched.has(dirname(target))).toBe(false);
    expect(synced).toContainEqual({ panelId: 'p1', movedTo: target, movedOut: true });
  });

  it('Save As outside both projects is refused', async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });
    editDocument(coord, metaA('p1', fileA()), 'alpha + unsaved\n');
    await cutAToB();

    const target = join(h.outside, 'x.txt');
    const saved = await coord.save({
      panelId: 'p1',
      absPath: target,
      ownerKind: 'project',
      ownerRoot: h.rootA,
      allProjectRoots: [h.rootA, h.rootB],
    });

    expect(saved).toMatchObject({ ok: false, reason: 'out-of-tree' });
    expect(await exists(target)).toBe(false);
    expect(coord.getContent('p1')).toMatchObject({ dirty: true, movedOut: true, absPath: fileB() });
  });

  it('Save As back into its own project is ordinary 006 FR-084: the panel becomes an editor of that new file', async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });
    editDocument(coord, metaA('p1', fileA()), 'alpha + unsaved\n');
    await cutAToB();
    synced.length = 0;

    const target = join(h.rootA, 'kept.txt');
    const saved = await coord.save({
      panelId: 'p1',
      absPath: target,
      ownerKind: 'project',
      ownerRoot: h.rootA,
      allProjectRoots: [h.rootA, h.rootB],
    });

    expect(saved).toMatchObject({ ok: true, absPath: target });
    expect(await readFile(target, 'utf8')).toBe('alpha + unsaved\n');
    expect(coord.getContent('p1')).toMatchObject({ absPath: target, dirty: false, movedOut: false });
    await expect(coord.openInto(target)).resolves.toMatchObject({ action: 'focus', panelId: 'p1' });
    expect(watched.has(dirname(target))).toBe(true);
    expect(synced).toContainEqual({ panelId: 'p1', movedTo: target, movedOut: false });
    // The file in B is B's, untouched.
    expect(await readFile(fileB(), 'utf8')).toBe('alpha\n');
    // …and it is an ordinary editor again: edits and Save work.
    editDocument(coord, metaA('p1', target), 'edited at home\n');
    expect(await coord.save({ panelId: 'p1' })).toMatchObject({ ok: true });
    expect(await readFile(target, 'utf8')).toBe('edited at home\n');
  });

  it('refuses edits while moved out (read-only)', async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });
    await cutAToB();

    editDocument(coord, metaA('p1', fileA()), 'typed while moved out\n');

    expect(coord.getContent('p1')).toMatchObject({ text: 'alpha\n', dirty: false });
  });
});

describe('a moved-out editor restored after a restart (FR-035, FR-036)', () => {
  it('register with movedOut creates a detached document: no claim, no watch, and Save As into B works', async () => {
    await cutAToB(); // no editor open: the panel is only in a layout, as after a restart
    coord.register({ ...metaA('p1', fileB()) }, '', { movedOut: true });
    coord.restoreRecovered('p1', 'recovered unsaved\n');

    expect(coord.getContent('p1')).toMatchObject({ absPath: fileB(), movedOut: true, dirty: true, unloadable: false });
    await expect(coord.openInto(fileB())).resolves.toEqual({ action: 'open' });
    expect(watched.has(dirname(fileB()))).toBe(false);
    expect((await coord.save({ panelId: 'p1' })).ok).toBe(false);

    const target = join(h.rootB, 'rescued.txt');
    expect(await coord.save({ panelId: 'p1', absPath: target })).toMatchObject({ ok: true });
    expect(await readFile(target, 'utf8')).toBe('recovered unsaved\n');
    expect(coord.getContent('p1')).toMatchObject({ absPath: target, movedOut: true, dirty: false });
  });
});

describe('an undo brings the file back (FR-035)', () => {
  it('the document is an ordinary editor again, at the old path, claimed and watched', async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });
    const entry = await cutAToB();
    synced.length = 0;

    expect(await h.svc.applyUndo(entry, 'undo')).toMatchObject({ ok: true });

    expect(coord.getContent('p1')).toMatchObject({ absPath: fileA(), movedOut: false });
    expect(synced.filter((m) => m.movedTo !== undefined)).toEqual([
      { panelId: 'p1', movedTo: fileA(), movedOut: false },
    ]);
    await expect(coord.openInto(fileA())).resolves.toMatchObject({ action: 'focus', panelId: 'p1' });
    expect(watched.has(dirname(fileA()))).toBe(true);
    editDocument(coord, metaA('p1', fileA()), 'back home\n');
    expect(await coord.save({ panelId: 'p1' })).toMatchObject({ ok: true });
    expect(await readFile(fileA(), 'utf8')).toBe('back home\n');
  });

  it("B's own editor of the file is the one moved out by the undo; A's comes back", async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });
    const entry = await cutAToB();
    await coord.load({ ...metaB('p2', fileB()), absPath: fileB() });

    expect(await h.svc.applyUndo(entry, 'undo')).toMatchObject({ ok: true });

    // The undo takes the file out of B, so FR-035 now applies to B's editor — and frees the path for p1.
    expect(coord.getContent('p2')).toMatchObject({ absPath: fileA(), movedOut: true });
    expect(coord.getContent('p1')).toMatchObject({ absPath: fileA(), movedOut: false });
    await expect(coord.openInto(fileA())).resolves.toMatchObject({ action: 'focus', panelId: 'p1' });
  });

  it('stays moved out when another editor holds the path it returns to', async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });
    await cutAToB();
    // Another editor of A has its own file at the old path meanwhile.
    await put(fileA(), 'a new a\n');
    await coord.load({ ...metaA('p2', fileA()), absPath: fileA() });
    synced.length = 0;

    // The return move as the coordinator receives it once an undo lands.
    coord.beginMove([fileB()]);
    coord.markMoved([{ from: fileB(), to: fileA() }]);

    expect(coord.getContent('p1')).toMatchObject({ absPath: fileA(), movedOut: true });
    expect(synced.filter((m) => m.panelId === 'p1' && m.movedTo !== undefined)).toEqual([
      { panelId: 'p1', movedTo: fileA() },
    ]);
    await expect(coord.openInto(fileA())).resolves.toMatchObject({ action: 'focus', panelId: 'p2' });
  });

  it('a move within the project is unchanged — no movedOut on the relay', async () => {
    await coord.load({ ...metaA('p1', fileA()), absPath: fileA() });
    synced.length = 0;
    const to = join(h.rootA, 'sub', 'a.txt');
    await put(join(h.rootA, 'sub', '.keep'), '');
    h.files.setRoot(h.rootA);
    expect(await h.files.move(['a.txt'], 'sub')).toMatchObject({ ok: true });

    expect(synced.filter((m) => m.movedTo !== undefined)).toEqual([{ panelId: 'p1', movedTo: to }]);
    expect(coord.getContent('p1')).toMatchObject({ absPath: to, movedOut: false });
  });
});
