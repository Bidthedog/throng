import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS, samePath, type FileOpUndoEntry, type PreviewUpdate } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService, type LoadRequest } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService } from '../../src/main/preview-service.js';
import { createInAppMoveCallbacks } from '../../src/main/in-app-moves.js';
import { lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';
import { disposeHarness, makeHarness, put, settle, type Harness } from './helpers/transfer-harness.js';

/**
 * A preview a cross-project cut takes out of its project (050 FR-035, SC-012 — T094, R18).
 *
 * The REAL coordinator and `PreviewService` on the harness's two roots, wired to `FilesService`'s move
 * bracket through the real `createInAppMoveCallbacks` order, so a paste and its undo reach the previews
 * exactly as they do in the app.
 */

const VIEWER = 7;
let h: Harness;
let recoveryDir: string;
let coord: EditorCoordinator;
let previews: PreviewService;
let push: ReturnType<typeof recordingPush>;
let watcher: ReturnType<typeof manualWatcher>;
/** Every path the preview's reader was asked to load. */
let reads: string[];

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
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-moved-out-rec-'));
  reads = [];
  push = recordingPush();
  watcher = manualWatcher();
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
    reader: {
      load: (req: LoadRequest) => {
        reads.push(req.absPath);
        return service.load(req);
      },
    },
    fs: new NodeFileSystem(async () => {}),
    fileWatcher: watcher,
    settings: settings.get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'A' ? h.rootA : id === 'B' ? h.rootB : undefined),
    push,
    windows: recordingWindows(),
  });
  relay.bind(previews);
  const callbacks = createInAppMoveCallbacks({
    coordinator: coord,
    previews,
    history: { rewritePaths: () => {}, announce: () => {} },
    broadcastFilesMoved: () => {},
    clipboard: { followMoves: () => {} },
  });
  h.files.setOnMoveStarted(callbacks.started);
  h.files.setOnMoved(callbacks.moved);
});
afterEach(async () => {
  coord.destroy('ed1');
  for (const id of ['v1', 'v2']) previews.destroyed(id);
  await disposeHarness(h);
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

async function attach(panelId: string, projectId: string, filePath: string): Promise<void> {
  const res = await previews.attach(VIEWER, { panelId, projectId, filePath });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
}

async function cutAToB(): Promise<FileOpUndoEntry> {
  const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
    mode: 'cut',
    items: [{ absPath: docA(), projectId: 'A', projectRoot: h.rootA }],
  }).result;
  expect(r.failures).toEqual([]);
  return r.undo!;
}

const updatesFor = (panelId: string): PreviewUpdate[] =>
  push.updates.filter((u) => u.update.panelId === panelId).map((u) => u.update);
const lastUpdate = (panelId: string): PreviewUpdate | undefined => updatesFor(panelId).at(-1);

async function expectMovedOut(panelId: string): Promise<void> {
  expect(previews.run(panelId)?.filePath).toBe(docB());
  const last = lastUpdate(panelId);
  expect(last).toMatchObject({ filePath: docB(), notice: { kind: 'moved-out', movedTo: docB() } });
  // Never the could-not-read notices, at any point after the move.
  for (const u of updatesFor(panelId)) expect(['unreadable', 'deleted']).not.toContain(u.notice?.kind);
  // It reads and watches nothing of the file's new home…
  expect(reads.some((p) => samePath(p, docB()))).toBe(false);
  expect(watcher.watched.some((d) => samePath(d, dirname(docB())))).toBe(false);
  // …and lets go of the path, so B opens its own preview of it (FR-012 per project).
  expect(previews.isOpen(docB())).toBe(false);
  // Every window learns it, viewer or not — a held layout writes `config.movedOut` from this.
  expect(push.pathChanged).toContainEqual({ panelId, filePath: docB(), movedOut: true });
}

describe('a cut-paste takes a preview out of its project (FR-035)', () => {
  it('a standalone preview publishes moved-out with the new path, and reads nothing', async () => {
    await attach('v1', 'A', docA());
    push.clear();

    await cutAToB();
    await settle(60);

    await expectMovedOut('v1');
  });

  it('a preview parented to an editor of the file does the same', async () => {
    expect((await coord.load({ ...metaA('ed1', docA()), absPath: docA() })).ok).toBe(true);
    await attach('v1', 'A', docA());
    push.clear();

    await cutAToB();
    await settle(60);

    await expectMovedOut('v1');
  });

  it("the destination project's own preview of the file attaches normally", async () => {
    await attach('v1', 'A', docA());
    await cutAToB();
    await settle(60);

    await attach('v2', 'B', docB());
    await settle(60);

    expect(previews.isOpen(docB())).toBe(true);
    expect(lastUpdate('v2')?.notice ?? null).toBeNull();
  });

  it('an undo brings it back: an ordinary preview of the file again, at the old path', async () => {
    await attach('v1', 'A', docA());
    const entry = await cutAToB();
    await settle(60);
    push.clear();
    reads.length = 0;

    expect(await h.svc.applyUndo(entry, 'undo')).toMatchObject({ ok: true });
    await settle(60);

    expect(previews.run('v1')?.filePath).toBe(docA());
    expect(lastUpdate('v1')).toMatchObject({ filePath: docA(), notice: null });
    expect(reads.some((p) => samePath(p, docA()))).toBe(true);
    expect(watcher.watched.some((d) => samePath(d, dirname(docA())))).toBe(true);
    expect(previews.isOpen(docA())).toBe(true);
    expect(push.pathChanged).toContainEqual({ panelId: 'v1', filePath: docA(), movedOut: false });
  });

  it('a move within the project is unchanged — pathChanged carries no movedOut', async () => {
    await attach('v1', 'A', docA());
    push.clear();
    h.files.setRoot(h.rootA);
    await put(join(h.rootA, 'sub', '.keep'), '');

    expect(await h.files.move(['doc.md'], 'sub')).toMatchObject({ ok: true });
    await settle(60);

    const to = join(h.rootA, 'sub', 'doc.md');
    expect(previews.run('v1')?.filePath).toBe(to);
    expect(lastUpdate('v1')?.notice ?? null).toBeNull();
    for (const p of push.pathChanged) expect(p).not.toHaveProperty('movedOut');
  });
});
