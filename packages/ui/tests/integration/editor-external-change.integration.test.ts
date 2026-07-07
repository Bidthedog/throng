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
    fileWatcher: new NodeFileWatcher(20),
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true });
});

describe('editor soft external-change detection (FR-028)', () => {
  it('a CLEAN editor live-reloads an external edit and stays clean', async () => {
    const file = join(root, 'doc.txt');
    await writeFile(file, 'v1\n');
    await coord.load({ ...meta('p1', file) });
    expect(coord.getContent('p1')).toMatchObject({ text: 'v1\n', dirty: false });

    await writeFile(file, 'v2-external\n'); // edited by another program
    const relay = await until(() => synced.find((m) => m.panelId === 'p1' && m.text === 'v2-external\n'));
    expect(relay).toBeTruthy();
    expect(relay?.dirty).toBe(false);
    expect(coord.getContent('p1')).toMatchObject({ text: 'v2-external\n', dirty: false });
  });

  it('a DIRTY editor gets a one-shot "changed on disk" notice, buffer untouched', async () => {
    const file = join(root, 'doc.txt');
    await writeFile(file, 'base\n');
    await coord.load({ ...meta('p2', file) });
    await coord.notifyDirty(0, { ...meta('p2', file), dirty: true, text: 'my unsaved edit\n' });
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
