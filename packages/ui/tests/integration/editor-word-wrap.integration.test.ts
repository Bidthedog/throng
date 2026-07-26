import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta, type EditorSyncMsg } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';

/**
 * US1 / FR-001a (spec 024): word wrap is DOCUMENT state, owned by the document's single authority.
 *
 * The reason it cannot live in a renderer is the case these tests are about: the same file open in
 * two WINDOWS. A per-window store gives each window its own answer, so one Panel wraps and the other
 * does not — two states for one document, which constitution Principle XI forbids. So the authority
 * is the coordinator, and every Panel showing the document is told.
 */
const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let synced: EditorSyncMsg[];

function meta(panelId: string, absPath: string, windowId = 'w1'): DocMeta {
  return {
    panelId, windowId, ownerKind: 'project', ownerProjectId: 'A', ownerRoot: root,
    allProjectRoots: [root], tabId: 't1', absPath, encoding: 'utf8', hasBom: false, lineEnding: 'lf',
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-wrap-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-wrap-rec-'));
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

describe('word wrap is owned by the document authority (024 US1, FR-001a)', () => {
  it('seeds from the preference, and remembers the override', async () => {
    const file = join(root, 'a.txt');
    await writeFile(file, 'x\n');
    await coord.load({ ...meta('p1', file) });

    expect(coord.wordWrapFor('p1', true)).toBe(true);
    expect(coord.wordWrapFor('p1', false)).toBe(true); // seeded once; the seed does not re-apply

    coord.setWordWrap('p1', false);
    expect(coord.wordWrapFor('p1', true)).toBe(false); // the override wins over the preference
  });

  it('tells EVERY panel showing the file — including one in another window', async () => {
    const file = join(root, 'shared.txt');
    await writeFile(file, 'x\n');
    await coord.load({ ...meta('p1', file, 'w1') });
    await coord.load({ ...meta('p2', file, 'w2') }); // same document, a different WINDOW
    synced.length = 0;

    coord.setWordWrap('p1', false);

    const told = synced.filter((m) => m.wordWrap !== undefined);
    expect(told.map((m) => m.panelId).sort()).toEqual(['p1', 'p2']);
    expect(told.every((m) => m.wordWrap === false)).toBe(true);
    // Both panels agree, because there is one value and it is here.
    expect(coord.wordWrapFor('p2', true)).toBe(false);
  });

  it('does not touch a different document', async () => {
    const a = join(root, 'a.txt');
    const b = join(root, 'b.txt');
    await writeFile(a, 'x\n');
    await writeFile(b, 'y\n');
    await coord.load({ ...meta('p1', a) });
    await coord.load({ ...meta('p2', b) });
    synced.length = 0;

    coord.setWordWrap('p1', false);

    expect(synced.filter((m) => m.wordWrap !== undefined).map((m) => m.panelId)).toEqual(['p1']);
    expect(coord.wordWrapFor('p2', true)).toBe(true);
  });

  it('says nothing when the value did not change', async () => {
    const file = join(root, 'a.txt');
    await writeFile(file, 'x\n');
    await coord.load({ ...meta('p1', file) });
    coord.setWordWrap('p1', false);
    synced.length = 0;

    coord.setWordWrap('p1', false); // already false

    expect(synced.filter((m) => m.wordWrap !== undefined)).toEqual([]);
  });

  it('forgets the override once the document is closed EVERYWHERE (FR-003)', async () => {
    const file = join(root, 'a.txt');
    await writeFile(file, 'x\n');
    await coord.load({ ...meta('p1', file, 'w1') });
    await coord.load({ ...meta('p2', file, 'w2') });
    coord.setWordWrap('p1', false);

    coord.destroy('p1');
    // Still open in the other window, so the override must survive — closing one view of a document
    // is not closing the document.
    expect(coord.wordWrapFor('p2', true)).toBe(false);

    coord.destroy('p2');
    await coord.load({ ...meta('p3', file) });
    // Now it was closed everywhere, so it starts from the preference again, not from the override.
    expect(coord.wordWrapFor('p3', true)).toBe(true);
  });

  it('treats a Windows path differing only in case as ONE document', async () => {
    const file = join(root, 'Case.txt');
    await writeFile(file, 'x\n');
    await coord.load({ ...meta('p1', file) });
    await coord.load({ ...meta('p2', file.replace('Case.txt', 'case.txt')) });
    synced.length = 0;

    coord.setWordWrap('p1', false);

    // Two wrap values for one file would show as a panel that refuses to rewrap with its twin.
    expect(synced.filter((m) => m.wordWrap !== undefined).map((m) => m.panelId).sort()).toEqual([
      'p1',
      'p2',
    ]);
  });
});
