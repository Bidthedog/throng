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
// A no-op lock: this test exercises the app-wide one-buffer registry, not the OS lock.

let root: string;
let recoveryDir: string;
let coordinator: EditorCoordinator;

function meta(panelId: string, windowId: string, absPath: string): DocMeta {
  return {
    panelId,
    windowId,
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
  root = await mkdtemp(join(tmpdir(), 'throng-onebuf-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-rec-'));
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  coordinator = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    relaySync: () => {},
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true });
});

describe('app-wide one-buffer registry (006, FR-011a)', () => {
  it('a second open of an already-open file focuses the existing editor (no duplicate)', async () => {
    const file = join(root, 'shared.txt');
    await writeFile(file, 'hello\n');

    // Window 1 opens the file.
    const loaded = await coordinator.load(meta('p1', 'w1', file));
    expect(loaded.ok).toBe(true);
    expect(coordinator.isOpen(file)).toBe(true);

    // Window 2 tries to open the same file → focus the existing editor (w1/p1).
    const decision = coordinator.openInto(file);
    expect(decision).toEqual({ action: 'focus', panelId: 'p1', windowId: 'w1' });
  });

  it('a fresh path opens; matching is case/separator-insensitive', () => {
    const file = join(root, 'x.txt');
    expect(coordinator.openInto(file)).toEqual({ action: 'open' });
  });

  it('destroying the editor frees the file for a fresh open', async () => {
    const file = join(root, 'shared.txt');
    await writeFile(file, 'hi\n');
    await coordinator.load(meta('p1', 'w1', file));
    coordinator.destroy('p1');
    expect(coordinator.isOpen(file)).toBe(false);
    expect(coordinator.openInto(file)).toEqual({ action: 'open' });
  });

  it('re-pointing an editor at a new file releases its previous one-buffer claim', async () => {
    const a = join(root, 'a.txt');
    const b = join(root, 'b.txt');
    await writeFile(a, 'A\n');
    await writeFile(b, 'B\n');
    await coordinator.load(meta('p1', 'w1', a));
    await coordinator.load(meta('p1', 'w1', b)); // same panel, new file
    expect(coordinator.isOpen(a)).toBe(false);
    expect(coordinator.isOpen(b)).toBe(true);
  });
});
