import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { editDocument } from './helpers/edit-document.js';

// FR-028 (replaces the removed dirty-file lock): soft external-change detection.
// A CLEAN editor live-reloads the on-disk change; a DIRTY editor gets a one-shot
// "changed on disk" notice; a vanished file routes through the delete path.

const fs = new NodeFileSystem(async () => {});
type Sync = { panelId: string; text?: string; dirty?: boolean; deleted?: boolean; externalChange?: boolean };

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let synced: Sync[];

function meta(panelId: string, absPath: string): DocMeta {
  return {
    panelId, windowId: 'w1', ownerKind: 'project', ownerProjectId: 'A', ownerRoot: root,
    allProjectRoots: [root], tabId: 't1', absPath, encoding: 'utf8', hasBom: false, lineEnding: 'lf',
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

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-ext-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-ext-rec-'));
  synced = [];
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: (_from, msg) => synced.push(msg),
    persistUndoHistory: () => true,
    fileWatcher: new NodeFileWatcher(20),
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('editor soft external-change detection (FR-028)', () => {
  it('a CLEAN editor live-reloads an external edit and stays clean', async () => {
    const file = join(root, 'doc.txt');
    await writeFile(file, 'v1\n');
    await coord.load({ ...meta('p1', file) });
    expect(coord.getContent('p1')).toMatchObject({ text: 'v1\n', dirty: false });

    await writeFile(file, 'v2-external\n'); // edited by another program
    // A REPLACEMENT, not a change: the new content has no relationship to the old, so there is
    // nothing to express as a rebasable edit — and the undo history, which described the file as it
    // was, goes with it (FR-026d).
    const relay = await until(() =>
      synced.find((m) => m.panelId === 'p1' && m.reset?.text === 'v2-external\n'),
    );
    expect(relay).toBeTruthy();
    expect(relay?.reset?.dirty).toBe(false);
    expect(coord.getContent('p1')).toMatchObject({ text: 'v2-external\n', dirty: false });
  });

  it('a DIRTY editor gets a one-shot "changed on disk" notice, buffer untouched', async () => {
    const file = join(root, 'doc.txt');
    await writeFile(file, 'base\n');
    await coord.load({ ...meta('p2', file) });
    editDocument(coord, meta('p2', file), 'my unsaved edit\n');
    synced.length = 0;

    await writeFile(file, 'external edit\n');
    const notice = await until(() => synced.find((m) => m.panelId === 'p2' && m.externalChange === true));
    expect(notice).toBeTruthy();
    // The buffer is NOT overwritten — the user's edit survives.
    expect(coord.getContent('p2')).toMatchObject({ text: 'my unsaved edit\n', dirty: true });

    // Second external write does NOT re-fire the notice (one-shot until save).
    synced.length = 0;
    await writeFile(file, 'external edit 2\n');
    await new Promise((r) => setTimeout(r, 300));
    expect(synced.some((m) => m.externalChange === true)).toBe(false);
  });

  it('routes an external DELETE through the file-missing path', async () => {
    const file = join(root, 'doc.txt');
    await writeFile(file, 'x\n');
    await coord.load({ ...meta('p3', file) });
    await rm(file, { force: true });
    await until(() => (coord.getContent('p3')?.fileMissing ? true : undefined));
    expect(coord.getContent('p3')).toMatchObject({ fileMissing: true, dirty: true });
  });
});

/**
 * The notice must mean what it says (FR-028).
 *
 * "This file changed on disk" is a claim about the DISK. It was being raised whenever the disk
 * disagreed with the BUFFER — which, for a document with unsaved changes, is true by definition and
 * says nothing at all. And because the watch is on the DIRECTORY (it has to be, to notice a delete),
 * any event in the folder woke every open document in it: saving a completely different file raised
 * "changed on disk" on all of them.
 *
 * The comparison has to be against what throng last READ FROM or WROTE TO the disk, which is exactly
 * what the authority tracks as `savedText`.
 */
describe('the "changed on disk" notice is about the DISK, not the buffer', () => {
  it('does NOT fire on a dirty editor when a DIFFERENT file in the same folder is written', async () => {
    const mine = join(root, 'mine.txt');
    const other = join(root, 'other.txt');
    await writeFile(mine, 'v1\n');
    await writeFile(other, 'unrelated\n');
    await coord.load({ ...meta('p1', mine) });

    // Unsaved changes — so the buffer and the disk now differ, legitimately.
    editDocument(coord, meta('p1', mine), 'v1 plus my unsaved edit\n');
    expect(coord.getContent('p1')?.dirty).toBe(true);

    // Somebody saves a DIFFERENT file in the same folder. The folder watcher fires; my file has not
    // been touched.
    await writeFile(other, 'unrelated, changed\n');

    await new Promise((r) => setTimeout(r, 400)); // …well past the watcher's 20 ms debounce
    expect(synced.filter((m) => m.panelId === 'p1' && m.externalChange)).toEqual([]);
    // …and my unsaved work is still exactly where I left it.
    expect(coord.getContent('p1')?.text).toBe('v1 plus my unsaved edit\n');
  });

  it('does NOT fire on a dirty editor when the folder is touched but its own file is unchanged', async () => {
    const file = join(root, 'doc.txt');
    await writeFile(file, 'v1\n');
    await coord.load({ ...meta('p1', file) });
    editDocument(coord, meta('p1', file), 'unsaved\n');

    // A new file appears in the folder — the sort of thing a build, a git checkout, or another
    // editor's temp file does constantly.
    await writeFile(join(root, 'appeared.tmp'), 'x');

    await new Promise((r) => setTimeout(r, 400));
    expect(synced.filter((m) => m.panelId === 'p1' && m.externalChange)).toEqual([]);
  });

  it('DOES still fire when the file itself genuinely changes underneath a dirty editor', async () => {
    // The whole point of the notice, and it must survive the fix above.
    const file = join(root, 'doc.txt');
    await writeFile(file, 'v1\n');
    await coord.load({ ...meta('p1', file) });
    editDocument(coord, meta('p1', file), 'my unsaved edit\n');

    await writeFile(file, 'changed by someone else\n');

    const notice = await until(() =>
      synced.find((m) => m.panelId === 'p1' && m.externalChange === true),
    );
    expect(notice).toBeDefined();
    // …and the user's unsaved work is untouched: the notice warns, it does not overwrite.
    expect(coord.getContent('p1')?.text).toBe('my unsaved edit\n');
  });
});
