import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';

const fs = new NodeFileSystem(async () => {});

let root: string;
let otherRoot: string;
let recoveryDir: string;
let relayCalls: { from: number; msg: { panelId: string; text?: string; dirty?: boolean } }[];
let coord: EditorCoordinator;

function meta(over: Partial<DocMeta> = {}): DocMeta {
  return {
    panelId: 'p1',
    windowId: 'w1',
    ownerKind: 'project',
    ownerProjectId: 'A',
    ownerRoot: root,
    allProjectRoots: [root, otherRoot],
    tabId: 't1',
    absPath: null,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
    ...over,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-mo-a-'));
  otherRoot = await mkdtemp(join(tmpdir(), 'throng-mo-b-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-mo-rec-'));
  relayCalls = [];
  coord = new EditorCoordinator(
    new EditorService(fs, () => DEFAULT_APP_SETTINGS),
    new EditorRecovery(recoveryDir),
    { recoveryDebounceMs: 10, relaySync: (from, msg) => relayCalls.push({ from, msg }) },
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(otherRoot, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true });
});

describe('cross-window mirror + ownership (006, FR-034/036, SC-021)', () => {
  it('relays an edit (content + dirty) to other windows, tagged with the origin', async () => {
    coord.register(meta(), '');
    await coord.notifyDirty(7, { ...meta(), dirty: true, text: 'shared edit' });
    // The relay carries the content + dirty and the origin webContents id (so the
    // broadcast can exclude the sender — no echo, FR-034).
    expect(relayCalls).toContainEqual({
      from: 7,
      msg: { panelId: 'p1', text: 'shared edit', dirty: true },
    });
  });

  it('notifySync passes a mirror message through, excluding the origin window', () => {
    coord.register(meta(), 'seed');
    coord.notifySync(3, { panelId: 'p1', text: 'from other window', dirty: true });
    expect(relayCalls).toContainEqual({
      from: 3,
      msg: { panelId: 'p1', text: 'from other window', dirty: true },
    });
    // UI main's stored content reflects the mirrored change.
    expect(coord.getContent('p1')?.text).toBe('from other window');
  });

  it('refuses loading another project’s file into a project editor (FR-036/SC-021)', async () => {
    const foreign = join(otherRoot, 'foreign.txt');
    await writeFile(foreign, 'not yours\n');
    const result = await coord.load({
      panelId: 'p1',
      windowId: 'w1',
      ownerKind: 'project',
      ownerProjectId: 'A',
      ownerRoot: root, // project A
      allProjectRoots: [root, otherRoot],
      tabId: 't1',
      absPath: foreign, // a file in project B
    });
    expect(result.ok).toBe(false);
    expect(coord.isOpen(foreign)).toBe(false);
  });

  it('a sub-workspace-owned editor may hold a file outside every project', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'throng-scratch-'));
    try {
      const file = join(scratch, 'note.txt');
      await writeFile(file, 'free\n');
      const result = await coord.load({
        panelId: 'p9',
        windowId: 'w2',
        ownerKind: 'subworkspace',
        ownerRoot: null,
        allProjectRoots: [root, otherRoot],
        tabId: 't9',
        absPath: file,
      });
      expect(result.ok).toBe(true);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
