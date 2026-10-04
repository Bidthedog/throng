import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { FilesService } from '../../src/main/files-service.js';
import { FileClipboardService } from '../../src/main/file-clipboard.js';
import { createInAppMoveCallbacks } from '../../src/main/in-app-moves.js';
import { put } from './helpers/transfer-harness.js';

/**
 * The clipboard follows what throng does to its items (050 FR-009, FR-011 — T039).
 *
 * Through the REAL `FilesService` rename / move / delete, with the clipboard wired as `main.ts` wires
 * it: the last consumer of the in-app move callback, and the second of the delete fan-out.
 */

let root: string;
let files: FilesService;
let clipboard: FileClipboardService;
let markedDeleted: string[][];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-clip-follow-'));
  await put(join(root, 'a.txt'), 'a');
  await put(join(root, 'docs', 'b.txt'), 'b');
  await put(join(root, 'dest', '.keep'), '');
  files = new FilesService(new NodeFileSystem(async () => {}), {} as ConstructorParameters<typeof FilesService>[1]);
  files.setRoot(root);
  clipboard = new FileClipboardService(() => {});
  markedDeleted = [];
  const moves = createInAppMoveCallbacks({
    coordinator: { beginMove: () => {}, markMoved: () => {} },
    previews: { beginMove: () => {}, moved: () => [], announcePath: () => {} },
    history: { rewritePaths: () => {}, announce: () => {} },
    broadcastFilesMoved: () => {},
    clipboard,
  });
  files.setOnMoveStarted(moves.started);
  files.setOnMoved(moves.moved);
  files.setOnDeleted((abs) => {
    markedDeleted.push(abs);
    clipboard.dropDeleted(abs);
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const paths = (): string[] | undefined => clipboard.get()?.items.map((i) => i.absPath);

describe('the clipboard follows in-app changes (FR-009)', () => {
  it('renaming a pending item rewrites its path', async () => {
    clipboard.setFromRelative('cut', ['a.txt'], root, 'P');
    expect(await files.rename('a.txt', 'renamed.txt')).toEqual({ ok: true });
    expect(paths()).toEqual([join(root, 'renamed.txt')]);
  });

  it('renaming a folder that contains a pending item rewrites it by prefix', async () => {
    clipboard.setFromRelative('copy', [join('docs', 'b.txt')], root, 'P');
    await files.rename('docs', 'manual');
    expect(paths()).toEqual([join(root, 'manual', 'b.txt')]);
  });

  it('moving a pending item rewrites its path', async () => {
    clipboard.setFromRelative('cut', ['a.txt'], root, 'P');
    await files.move(['a.txt'], 'dest');
    expect(paths()).toEqual([join(root, 'dest', 'a.txt')]);
  });

  it('deleting a pending item — or its folder — drops it, after the editors are told', async () => {
    clipboard.setFromRelative('cut', ['a.txt', join('docs', 'b.txt')], root, 'P');
    await files.delete(['a.txt'], 'permanent');
    expect(paths()).toEqual([join(root, 'docs', 'b.txt')]);
    await files.delete(['docs'], 'permanent');
    expect(clipboard.get()).toBeNull();
    expect(markedDeleted).toEqual([[join(root, 'a.txt')], [join(root, 'docs')]]);
  });
});

describe('the clipboard empties when its project goes (FR-011)', () => {
  it('the holding project removed, or re-rooted, empties it; an unrelated change does not', () => {
    clipboard.setFromRelative('copy', ['a.txt'], root, 'P');
    clipboard.retainProjects(new Map([['P', root], ['Q', join(root, '..', 'other')]]));
    expect(paths()).toEqual([join(root, 'a.txt')]);
    clipboard.retainProjects(new Map([['P', join(root, '..', 'elsewhere')]]));
    expect(clipboard.get()).toBeNull();

    clipboard.setFromRelative('copy', ['a.txt'], root, 'P');
    clipboard.retainProjects(new Map([['Q', join(root, '..', 'other')]]));
    expect(clipboard.get()).toBeNull();
  });
});
