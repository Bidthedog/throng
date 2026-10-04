import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS, type FileOpUndoEntry } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService, type LoadRequest } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService } from '../../src/main/preview-service.js';
import { createInAppMoveCallbacks, type InAppMoveDeps } from '../../src/main/in-app-moves.js';
import { lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';
import { disposeHarness, exists, makeHarness, put, settle, type Harness } from './helpers/transfer-harness.js';

/**
 * Undo of a cross-project move while the file is open in an editor AND a linked Markdown preview
 * (050 FR-020, research R27 — T112).
 *
 * Reported: undoing a cross-project move "reports an error". Not reproduced from the code alone, so this
 * drives the user's path with the REAL `EditorCoordinator` and `PreviewService`, wired to the move
 * bracket through the real `createInAppMoveCallbacks`, exactly as `main.ts` wires them: cut A→B, undo,
 * redo, undo — each must answer `{ ok: true }` and leave the file, the editor and the preview where the
 * direction says. And a move callback that throws while the bracket closes must never turn a move that
 * LANDED into a reported failure: the file has moved, so the stacks must move with it.
 */

const VIEWER = 7;
let h: Harness;
let recoveryDir: string;
let coord: EditorCoordinator;
let previews: PreviewService;
/** Swapped in by a test to make one consumer of the bracket throw. */
let broadcast: InAppMoveDeps['broadcastFilesMoved'];
/** What the clipboard — the LAST consumer of a bracket — was told. */
let followed: unknown[];

const docA = (): string => join(h.rootA, 'doc.md');
const docB = (): string => join(h.rootB, 'dest', 'doc.md');

function metaA(panelId: string, absPath: string): DocMeta {
  return {
    panelId,
    windowId: String(VIEWER),
    ownerKind: 'project',
    ownerProjectId: 'A',
    ownerRoot: h.rootA,
    allProjectRoots: [h.rootA, h.rootB],
    tabId: 't1',
    absPath,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
  };
}

beforeEach(async () => {
  h = await makeHarness();
  await put(docA(), '# alpha\n');
  await put(join(h.rootB, 'dest', 'keep.md'), 'keep');
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-undo-panels-rec-'));
  broadcast = () => {};
  followed = [];
  const settings = liveSettings();
  const service = new EditorService(new NodeFileSystem(async () => {}), settings.get);
  const relay = lateListener();
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
  });
  previews = new PreviewService({
    documents: coord,
    reader: { load: (req: LoadRequest) => service.load(req) },
    fs: new NodeFileSystem(async () => {}),
    fileWatcher: manualWatcher(),
    settings: settings.get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'A' ? h.rootA : id === 'B' ? h.rootB : undefined),
    push: recordingPush(),
    windows: recordingWindows(),
  });
  relay.bind(previews);
  const callbacks = createInAppMoveCallbacks({
    coordinator: coord,
    previews,
    history: { rewritePaths: () => {}, announce: () => {} },
    broadcastFilesMoved: (moves) => broadcast(moves),
    clipboard: { followMoves: (moves) => followed.push(...moves) },
  });
  h.files.setOnMoveStarted(callbacks.started);
  h.files.setOnMoved(callbacks.moved);
});
afterEach(async () => {
  coord.destroy('ed1');
  previews.destroyed('v1');
  await disposeHarness(h);
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** An editor of the file, and a preview of it — linked to that editor, as opening one from it makes. */
async function openEditorAndPreview(): Promise<void> {
  expect((await coord.load({ ...metaA('ed1', docA()), absPath: docA() })).ok).toBe(true);
  const res = await previews.attach(VIEWER, { panelId: 'v1', projectId: 'A', filePath: docA() });
  expect(res.ok).toBe(true);
  await settle(40);
}

async function cutAToB(): Promise<FileOpUndoEntry> {
  const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
    mode: 'cut',
    items: [{ absPath: docA(), projectId: 'A', projectRoot: h.rootA }],
  }).result;
  expect(r.failures).toEqual([]);
  expect(r.undo).toMatchObject({ kind: 'move', projects: { source: 'A', target: 'B' } });
  return r.undo!;
}

describe('undo of a cross-project move with an editor and a linked preview open (FR-020)', () => {
  it('undo, redo and undo again each answer ok and land the file where the direction says', async () => {
    await openEditorAndPreview();
    const entry = await cutAToB();
    await settle(40);

    expect(await h.svc.applyUndo(entry, 'undo', VIEWER)).toEqual({ ok: true });
    await settle(40);
    expect(await readFile(docA(), 'utf8')).toBe('# alpha\n');
    expect(await exists(docB())).toBe(false);
    expect(coord.getContent('ed1')).toMatchObject({ absPath: docA(), movedOut: false });
    expect(previews.run('v1')?.filePath).toBe(docA());

    // The entry is still good for a redo: the stacks it moved between are coherent.
    expect(await h.svc.applyUndo(entry, 'redo', VIEWER)).toEqual({ ok: true });
    await settle(40);
    expect(await exists(docB())).toBe(true);
    expect(await exists(docA())).toBe(false);
    expect(coord.getContent('ed1')).toMatchObject({ absPath: docB(), movedOut: true });

    expect(await h.svc.applyUndo(entry, 'undo', VIEWER)).toEqual({ ok: true });
    await settle(40);
    expect(await exists(docA())).toBe(true);
    expect(coord.getContent('ed1')).toMatchObject({ absPath: docA(), movedOut: false });
    expect(previews.run('v1')?.filePath).toBe(docA());
  });

  it('a move callback that throws while the bracket closes does not fail an undo that landed', async () => {
    await openEditorAndPreview();
    const entry = await cutAToB();
    await settle(40);
    broadcast = () => {
      throw new Error('a window went away mid-broadcast');
    };

    const undone = await h.svc.applyUndo(entry, 'undo', VIEWER).catch((e: unknown) => ({ rejected: String(e) }));

    expect(undone).toEqual({ ok: true });
    expect(await exists(docA())).toBe(true);
    // One consumer throwing does not starve the ones after it: the clipboard still followed the move.
    expect(followed).toContainEqual({ from: docB(), to: docA() });
    // …and the redo the stacks now offer works.
    broadcast = () => {};
    expect(await h.svc.applyUndo(entry, 'redo', VIEWER)).toEqual({ ok: true });
  });

  it('a move callback that throws while the bracket closes does not fail a paste that landed', async () => {
    await openEditorAndPreview();
    broadcast = () => {
      throw new Error('a window went away mid-broadcast');
    };

    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'cut',
      items: [{ absPath: docA(), projectId: 'A', projectRoot: h.rootA }],
    }).result;

    expect(r.failures).toEqual([]);
    expect(r.placed).toEqual([docB()]);
    expect(r.undo).toMatchObject({ kind: 'move' });
    expect(await exists(docB())).toBe(true);
  });
});
