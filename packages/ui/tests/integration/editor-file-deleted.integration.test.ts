import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { editDocument } from './helpers/edit-document.js';

// FR-099: deleting a file open in an editor marks that editor dirty (keeping the
// buffer) so a save re-creates it; getContent reports it file-missing so the tab
// surfaces the error on (re-)selection.

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coordinator: EditorCoordinator;
let synced: Array<{ panelId: string; deleted?: boolean; dirty?: boolean }>;

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

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-del-int-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-rec-'));
  synced = [];
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  coordinator = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 5,
    relaySync: (_from, msg) => synced.push(msg),
    persistUndoHistory: () => true,
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('editor whose file is deleted while open (FR-099)', () => {
  it('marks the editor dirty + file-missing and mirrors it, keeping the buffer', async () => {
    const file = join(root, 'doc.txt');
    await writeFile(file, 'hello\n');
    coordinator.register(meta('p1', file), 'hello\n');
    expect(coordinator.getContent('p1')).toMatchObject({ dirty: false, fileMissing: false });

    coordinator.markDeleted([file]);

    const content = coordinator.getContent('p1');
    expect(content).toMatchObject({ text: 'hello\n', dirty: true, fileMissing: true });
    // Mirrored to renderers so the unsaved dot appears immediately.
    expect(synced.some((m) => m.panelId === 'p1' && m.deleted === true)).toBe(true);
  });

  it('marks an editor whose file lived under a deleted FOLDER', async () => {
    const file = join(root, 'sub', 'nested.txt');
    coordinator.register(meta('p2', file), 'x');
    coordinator.markDeleted([join(root, 'sub')]); // the folder, not the file
    expect(coordinator.getContent('p2')).toMatchObject({ dirty: true, fileMissing: true });
  });

  it('a save re-creates the file at the original location and clears file-missing', async () => {
    const file = join(root, 'gone.txt');
    await writeFile(file, 'v1\n');
    coordinator.register(meta('p3', file), 'v1\n');
    editDocument(coordinator, meta('p3', file), 'v2\n');
    coordinator.markDeleted([file]);
    await rm(file, { force: true }); // the file really is gone

    const res = await coordinator.save({ panelId: 'p3' });
    expect(res.ok).toBe(true);
    await access(file); // re-created
    expect(await readFile(file, 'utf8')).toBe('v2\n');
    expect(coordinator.getContent('p3')).toMatchObject({ dirty: false, fileMissing: false });
  });

  it('leaves unrelated editors untouched', async () => {
    coordinator.register(meta('keep', join(root, 'a.txt')), 'a');
    coordinator.markDeleted([join(root, 'b.txt')]);
    expect(coordinator.getContent('keep')).toMatchObject({ dirty: false, fileMissing: false });
  });

  it('backs the buffer up to a recovery temp immediately, so it survives a restart (FR-102)', async () => {
    const file = join(root, 'keepme.txt');
    await writeFile(file, 'important\n');
    coordinator.register(meta('p9', file), 'important\n');
    coordinator.markDeleted([file]);
    // Recoverable without waiting on the debounce — a fresh editor could restore it.
    // (The write is a real fs I/O kicked off synchronously, so poll briefly.)
    let text: string | undefined;
    for (let i = 0; i < 50 && text === undefined; i++) {
      await new Promise((r) => setTimeout(r, 10));
      text = (await coordinator.recover()).find((r) => r.panelId === 'p9')?.text;
    }
    expect(text).toBe('important\n');
  });
});
