import { mkdtemp, mkdir, rm, rename, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta, type EditorSyncMsg } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { editDocument } from './helpers/edit-document.js';

/**
 * The COORDINATOR half of #87 (019, US1 · FR-002/FR-004/FR-005/FR-008 · contracts/move-signal.md §3).
 *
 * Every existing test of the move signal is an E2E that skips itself when the runner is elevated
 * (`skipIfElevated`), which is every CI run — so the whole of `markMoved` executed in NO automated
 * run at all: `markMoved` could have matched nothing and CI would have stayed green. Worse, the ACs
 * are all measured on a CLEAN document, so the one implementation FR-002 forbids by name —
 * `markMoved` as `await this.load({...})` — passes every one of them while destroying the user's
 * unsaved buffer and undo history.
 *
 * These tests are named for the properties a re-load would destroy, and they run wherever vitest
 * runs. The coordinator's dependencies are injectable, so this drives the real thing: a real
 * EditorService over a real filesystem, a real folder watch, and a real recovery store.
 */

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let synced: Array<{ from: number; msg: EditorSyncMsg }>;

function meta(panelId: string, absPath: string | null): DocMeta {
  return {
    panelId,
    windowId: 'w1',
    ownerKind: 'project',
    ownerProjectId: 'A',
    ownerRoot: root,
    allProjectRoots: [root],
    tabId: 't1',
    absPath,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
  };
}

async function until<T>(get: () => T | undefined, ms = 4000): Promise<T | undefined> {
  for (let i = 0; i < ms / 25; i++) {
    const v = get();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return get();
}

const msgs = (): EditorSyncMsg[] => synced.map((s) => s.msg);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-move-'));
  await mkdir(join(root, 'dest'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-move-rec-'));
  synced = [];
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: (from, msg) => synced.push({ from, msg }),
    persistUndoHistory: () => true,
    fileWatcher: new NodeFileWatcher(20),
  });
});
afterEach(async () => {
  // Tear the coordinator's documents down BEFORE removing their directories. Each open doc
  // holds a folder watch and a debounced recovery timer; left alive they outlast the test, and
  // because `relaySync` closes over the module-level `synced` (reassigned every `beforeEach`),
  // a leaked watch woken by the `rm` below pushes a stray `{deleted, dirty}` into the NEXT
  // test's messages — the exact contamination that reddened "a clean move is not news" under CI
  // load — while a debounced snapshot fires into a directory that is already gone (ENOENT).
  // `destroy` disposes the watch, clears the timer and drops the doc, so any watch callback
  // already in flight finds no doc and no-ops. This suite only ever opens p1 and p2.
  coord.destroy('p1');
  coord.destroy('p2');
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** What `FilesService.move` does around the filesystem: bracket open, move, bracket closed. */
async function moveFile(from: string, to: string): Promise<void> {
  coord.beginMove([from]);
  await rename(from, to);
  coord.markMoved([{ from, to }]);
}

describe('markMoved re-points the document — it does not reload it (FR-002)', () => {
  it('a DIRTY document keeps its buffer, its dirty flag and its undo history across the move', async () => {
    // The property `markMoved` implemented as `load()` destroys, and the one no AC measures:
    // every AC starts from a clean document, so a re-load passes them all.
    const from = join(root, 'note.txt');
    const to = join(root, 'dest', 'note.txt');
    await writeFile(from, 'v1\n');
    await coord.load({ ...meta('p1', from), absPath: from });
    editDocument(coord, meta('p1', from), 'v1 + my unsaved edit\n');

    await moveFile(from, to);

    // The same document, at a new path — not a second original read off the disk.
    expect(coord.getContent('p1')).toMatchObject({
      text: 'v1 + my unsaved edit\n',
      dirty: true,
      fileMissing: false,
      absPath: to,
    });
    // …and the user's past is still theirs: a reload would have dropped the history with the buffer.
    coord.undo('p1', 'view-1');
    expect(coord.getContent('p1')?.text).toBe('v1\n');
  });

  it('tells every window where the document went, once (FR-002)', async () => {
    const from = join(root, 'note.txt');
    const to = join(root, 'dest', 'note.txt');
    await writeFile(from, 'body\n');
    await coord.load({ ...meta('p1', from), absPath: from });
    synced.length = 0;

    await moveFile(from, to);

    const moved = synced.filter((s) => s.msg.movedTo !== undefined);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.msg).toEqual({ panelId: 'p1', movedTo: to });
    // -1: the authority's ordered stream reaches EVERY window, the originator included.
    expect(moved[0]?.from).toBe(-1);
  });

  it('the one-buffer registry and the folder watch both follow the file', async () => {
    const from = join(root, 'note.txt');
    const to = join(root, 'dest', 'note.txt');
    await writeFile(from, 'body\n');
    await coord.load({ ...meta('p1', from), absPath: from });

    await moveFile(from, to);

    // FR-011a: the file is still open — at its new path, and the old path is free again.
    expect(coord.openInto(to)).toMatchObject({ action: 'focus', panelId: 'p1' });
    expect(coord.openInto(from)).toEqual({ action: 'open' });
    // The watch is per-FOLDER, so a cross-folder move must re-watch or the document stops
    // noticing external edits to the file it now points at (FR-028).
    await writeFile(to, 'edited by another program\n');
    const reset = await until(() =>
      msgs().find((m) => m.panelId === 'p1' && m.reset?.text === 'edited by another program\n'),
    );
    expect(reset).toBeTruthy();
  });

  it('a clean move is not news: no dirty, no delete, no notice, and no recovery snapshot (FR-003/AC5)', async () => {
    const from = join(root, 'note.txt');
    const to = join(root, 'dest', 'note.txt');
    await writeFile(from, 'body\n');
    await coord.load({ ...meta('p1', from), absPath: from });
    synced.length = 0;

    await moveFile(from, to);
    await new Promise((r) => setTimeout(r, 300)); // well past the watch + the recovery debounce

    expect(coord.getContent('p1')).toMatchObject({ dirty: false, fileMissing: false });
    expect(msgs().filter((m) => m.deleted || m.externalChange || m.dirty === true)).toEqual([]);
    // A snapshot beside a moved document strands it at its old path on the next launch.
    expect(await coord.recover()).toEqual([]);
  });
});

/**
 * The view restates its metadata with every change it dispatches, and one field of it is a lie the
 * moment a move lands: `absPath`. A keystroke dispatched BEFORE the view received `movedTo` arrives
 * AFTER `markMoved` — and it used to reset `doc.absPath` back to the path the file has just left.
 * The next Ctrl+S then wrote the buffer to the OLD path, re-creating the moved-from file: #87's
 * exact symptom, surviving #87's own fix, and the thing AC3 prohibits by name.
 *
 * `absPath` is the authority's (contract §5). A view does not restate it, any more than it restates
 * the file's encoding (`refreshMeta`'s docstring, same reason).
 */
describe('an in-flight keystroke cannot drag the document back to its old path (FR-002/AC3)', () => {
  it('a change carrying the pre-move path leaves the document at its NEW path', async () => {
    const from = join(root, 'note.txt');
    const to = join(root, 'dest', 'note.txt');
    await writeFile(from, 'v1\n');
    await coord.load({ ...meta('p1', from), absPath: from });

    await moveFile(from, to);
    // The keystroke the user typed a moment before the move landed. Its meta is the view's, and
    // the view has not been told yet.
    editDocument(coord, meta('p1', from), 'typed while it moved\n');

    expect(coord.getContent('p1')?.absPath).toBe(to);
  });

  it('and the save that follows writes to the NEW path, re-creating nothing at the old one', async () => {
    const from = join(root, 'note.txt');
    const to = join(root, 'dest', 'note.txt');
    await writeFile(from, 'v1\n');
    await coord.load({ ...meta('p1', from), absPath: from });

    await moveFile(from, to);
    editDocument(coord, meta('p1', from), 'typed while it moved\n');
    const res = await coord.save({ panelId: 'p1' });

    expect(res.ok).toBe(true);
    expect(await readFile(to, 'utf8')).toBe('typed while it moved\n');
    expect(existsSync(from), `the save re-created the moved-from file at ${from}`).toBe(false);
  });

  it('an unpathed document is still not given a path by the view', async () => {
    // The other half of the same rule: the path comes from load/save, never from a dispatched
    // change. A view that could invent one could bind a buffer to a file nobody opened.
    coord.register(meta('p2', null), 'scratch\n');
    editDocument(coord, meta('p2', join(root, 'invented.txt')), 'scratch!\n');
    expect(coord.getContent('p2')?.absPath).toBeNull();
    expect(coord.openInto(join(root, 'invented.txt'))).toEqual({ action: 'open' });
  });
});

describe('a folder move re-points every document beneath it (FR-005/AC6)', () => {
  it('rewrites the path by prefix, in the destination folder’s own spelling', async () => {
    await mkdir(join(root, 'pack'));
    const one = join(root, 'pack', 'one.txt');
    await writeFile(one, 'ONE\n');
    // The tree hands the renderer FORWARD-slashed paths; `node:path.join` in UI main produces the
    // native ones. Both name the same file (FR-007) — and the result must not be a mongrel of the
    // two, because it is what lands in the persisted layout (FR-008).
    await coord.load({ ...meta('p1', null), absPath: one.replace(/\\/g, '/') });

    coord.beginMove([join(root, 'pack')]);
    await rename(join(root, 'pack'), join(root, 'dest', 'pack'));
    coord.markMoved([{ from: join(root, 'pack'), to: join(root, 'dest', 'pack') }]);

    expect(coord.getContent('p1')?.absPath).toBe(join(root, 'dest', 'pack', 'one.txt'));
    expect(coord.getContent('p1')).toMatchObject({ text: 'ONE\n', dirty: false });
  });

  it('matches by identity, never by spelling: `pack-lock.txt` is not under `pack`', async () => {
    const sibling = join(root, 'pack-lock.txt');
    await writeFile(sibling, 'LOCK\n');
    await coord.load({ ...meta('p1', sibling), absPath: sibling });

    coord.beginMove([join(root, 'pack')]);
    coord.markMoved([{ from: join(root, 'pack'), to: join(root, 'dest', 'pack') }]);

    expect(coord.getContent('p1')?.absPath).toBe(sibling);
  });
});

describe('the move bracket (FR-004) opens and closes exactly', () => {
  it('suppresses the watch’s delete while the file is in flight', async () => {
    const from = join(root, 'note.txt');
    const to = join(root, 'dest', 'note.txt');
    await writeFile(from, 'body\n');
    await coord.load({ ...meta('p1', from), absPath: from });

    coord.beginMove([from]);
    await rename(from, to);
    await new Promise((r) => setTimeout(r, 300)); // the watch fires, and finds nothing there

    expect(coord.getContent('p1')).toMatchObject({ dirty: false, fileMissing: false });
    coord.markMoved([{ from, to }]);
  });

  it('closes on a doc the move never reached, so a later external delete still dirties it (FR-009)', async () => {
    const other = join(root, 'other.txt');
    await writeFile(other, 'body\n');
    await coord.load({ ...meta('p1', other), absPath: other });

    // Bracketed for a move that then did not include it — `move` returns on the first disallowed
    // item, so this is the ordinary case, not an edge one.
    coord.beginMove([other]);
    coord.markMoved([]);

    // AC7's property: a file that vanishes behind throng's back is still kept, dirtied and
    // recoverable. A flag left set would have suppressed that for the rest of the session.
    await rm(other, { force: true });
    await until(() => (coord.getContent('p1')?.fileMissing ? true : undefined));
    expect(coord.getContent('p1')).toMatchObject({ text: 'body\n', dirty: true, fileMissing: true });
    // …and it is recoverable (FR-102). Awaited rather than assumed: the snapshot is a real fs write
    // kicked off synchronously, and the teardown would otherwise remove the recovery dir out from
    // under it.
    let snapshot: string | undefined;
    for (let i = 0; i < 50 && snapshot === undefined; i++) {
      await new Promise((r) => setTimeout(r, 10));
      snapshot = (await coord.recover()).find((s) => s.panelId === 'p1')?.text;
    }
    expect(snapshot).toBe('body\n');
  });
});
