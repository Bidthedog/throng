import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { editDocument } from './helpers/edit-document.js';

const fs = new NodeFileSystem(async () => {});
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let root: string;
let recoveryDir: string;

function makeCoordinator(): { coord: EditorCoordinator; recovery: EditorRecovery } {
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  const recovery = new EditorRecovery(recoveryDir);
  const coord = new EditorCoordinator(service, recovery, {
    recoveryDebounceMs: 10,
    relaySync: () => {},
    persistUndoHistory: () => true,
  });
  return { coord, recovery };
}

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
  root = await mkdtemp(join(tmpdir(), 'throng-rec-root-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-rec-dir-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('editor crash recovery (006, FR-041/042/043)', () => {
  it('writes in-progress content to a recovery temp and restores it after relaunch', async () => {
    // Session 1: an unsaved new document with in-progress content.
    const s1 = makeCoordinator();
    s1.coord.register(meta('p1', null), '');
    editDocument(s1.coord, meta('p1', null), 'work in progress');
    await wait(40); // let the debounced recovery write flush

    // Session 2 (simulated relaunch): a fresh coordinator recovers by panelId.
    const s2 = makeCoordinator();
    const recovered = await s2.coord.recover();
    // `toMatchObject`, not an exact shape: the snapshot is STRUCTURED since 016 (it also carries the
    // document version and, unless the user turned it off, the undo history — T088/T089). What this
    // test is about is the CONTENT surviving a relaunch, and that is what it asserts.
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ panelId: 'p1', text: 'work in progress' });
  });

  it('removes the recovery temp on full save (no stale temp)', async () => {
    const { coord } = makeCoordinator();
    const file = join(root, 'doc.txt');
    await writeFile(file, 'seed\n');
    coord.register(meta('p1', file), 'seed\n');
    editDocument(coord, meta('p1', file), 'edited\n');
    await wait(40);
    expect(existsSync(join(recoveryDir, encodeURIComponent('p1')))).toBe(true);

    const result = await coord.save({ panelId: 'p1' });
    expect(result.ok).toBe(true);
    await wait(20);
    expect(existsSync(join(recoveryDir, encodeURIComponent('p1')))).toBe(false);
    expect(await readFile(file, 'utf8')).toBe('edited\n');
  });

  it('removes the recovery temp when the editor is destroyed', async () => {
    const { coord } = makeCoordinator();
    coord.register(meta('p1', null), '');
    editDocument(coord, meta('p1', null), 'temp');
    await wait(40);
    expect(existsSync(join(recoveryDir, encodeURIComponent('p1')))).toBe(true);
    coord.destroy('p1');
    await wait(20);
    expect(existsSync(join(recoveryDir, encodeURIComponent('p1')))).toBe(false);
  });

  it('cleanupRecovery drops temps for panels that are no longer open', async () => {
    const { coord, recovery } = makeCoordinator();
    await recovery.write('gone', { version: 1, text: 'orphan content' });
    await recovery.write('kept', { version: 1, text: 'live content' });
    await coord.cleanupRecovery(['kept']);
    expect((await recovery.list()).map((r) => r.panelId).sort()).toEqual(['kept']);
  });
});
