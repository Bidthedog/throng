import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import {
  EditorCoordinator,
  type DocMeta,
  type EditorSyncMsg,
} from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { editDocument } from './helpers/edit-document.js';

const fs = new NodeFileSystem(async () => {});

let root: string;
let otherRoot: string;
let recoveryDir: string;
let relayCalls: { from: number; msg: EditorSyncMsg }[];
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
    {
      recoveryDebounceMs: 10,
      relaySync: (from, msg) => relayCalls.push({ from, msg }),
      persistUndoHistory: () => true,
    },
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(otherRoot, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('cross-window mirror + ownership (006, FR-034/036, SC-021)', () => {
  it('broadcasts an edit to EVERY window as one canonical change (016, FR-028f)', () => {
    // 006 relayed the whole document to every OTHER window, excluding the sender. Both halves of
    // that are gone. What goes out is the CHANGE, and it goes to every window INCLUDING the one
    // that sent it: a view that were left out of the stream defining the document could not know
    // its edit had been accepted, could not learn the version to base its next edit on, and would
    // drift out of step on its very next keystroke.
    coord.register(meta(), '');
    editDocument(coord, meta(), 'shared edit');

    const relayed = relayCalls.filter((c) => c.msg.change);
    expect(relayed).toHaveLength(1);
    expect(relayed[0].from).toBe(-1); // -1 excludes nobody
    expect(relayed[0].msg.change).toMatchObject({
      documentId: 'p1',
      kind: 'edit',
      origin: 'view-1',
      version: 1,
      dirty: true,
    });
    // The document itself lives in UI main, and is read from the authority — never relayed.
    expect(coord.getContent('p1')?.text).toBe('shared edit');
  });

  it('derives dirty from the authority — a view cannot relay it', () => {
    // A relayed dirty flag would be a second peer-owned value (constitution XI). There is no
    // channel to send one, and the coordinator would have nowhere to put it.
    coord.register(meta(), 'seed');
    expect(coord.getContent('p1')?.dirty).toBe(false);

    editDocument(coord, meta(), 'edited');
    expect(coord.getContent('p1')?.dirty).toBe(true);
    expect(coord.getContent('p1')?.version).toBe(1);
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
