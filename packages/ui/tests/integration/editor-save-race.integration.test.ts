import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta, type EditorSyncMsg } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { editDocument } from './helpers/edit-document.js';

/**
 * An edit that lands while a save is writing (the save awaits its file I/O; a keystroke's IPC handler
 * runs in that gap).
 *
 * Layer: integration — the window only exists across the real EditorService's awaits around the write.
 */

/** A file system whose writes wait for `release()`, so a test can act while one is in flight. */
class HeldWriteFileSystem extends NodeFileSystem {
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;
  writing: Promise<void> = Promise.resolve();
  private started: (() => void) | null = null;

  hold(): void {
    this.gate = new Promise((r) => (this.open = r));
    this.writing = new Promise((r) => (this.started = r));
  }

  release(): void {
    this.open?.();
    this.gate = null;
  }

  override async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.started?.();
    if (this.gate) await this.gate;
    await super.writeBytes(path, bytes);
  }
}

let root: string;
let recoveryDir: string;
let fs: HeldWriteFileSystem;
let synced: EditorSyncMsg[];
let coord: EditorCoordinator;

function meta(panelId: string, absPath: string): DocMeta {
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
  root = await mkdtemp(join(tmpdir(), 'throng-save-race-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-save-race-rec-'));
  fs = new HeldWriteFileSystem(async () => {});
  synced = [];
  coord = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: (_from, msg) => synced.push(msg),
    persistUndoHistory: () => true,
  });
});

afterEach(async () => {
  fs.release();
  coord.destroy('p1');
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('an edit made while a save is writing', () => {
  it('stays unsaved: the save marks clean only the text it wrote', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'one\n');
    const m = meta('p1', path);
    await coord.load(m);
    editDocument(coord, m, 'two\n');

    fs.hold();
    const saving = coord.save({ panelId: 'p1' });
    await fs.writing;
    editDocument(coord, m, 'two plus typed during the save\n');
    synced.length = 0;
    fs.release();
    expect(await saving).toMatchObject({ ok: true });

    expect(await readFile(path, 'utf8')).toBe('two\n');
    expect(coord.getContent('p1')).toMatchObject({ text: 'two plus typed during the save\n', dirty: true });
    // No window is told the document is clean while it holds text the file does not.
    expect(synced.some((msg) => 'dirty' in msg && msg.dirty === false)).toBe(false);
  });
});
