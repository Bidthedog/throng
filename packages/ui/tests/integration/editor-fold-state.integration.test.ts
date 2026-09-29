import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, SHIPPED_PREVIEW_PROVIDERS, initialFold, type FoldState } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta, type EditorSyncMsg } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService } from '../../src/main/preview-service.js';
import {
  lateListener,
  liveSettings,
  manualWatcher,
  recordingPush,
  recordingWindows,
} from './helpers/preview-harness.js';

/**
 * T038 (047) — one fold state per document, beside word wrap (research R3, data-model.md "FoldState").
 *
 * `EditorCoordinator` holds one map, keyed exactly like word wrap: `file:<path>` for a document (an
 * editor or a PARENTED preview share the entry), `panel:<id>` for a STANDALONE preview — one entry
 * however many windows view it (Principle XI). Driven over a REAL coordinator and a real
 * `PreviewService`, the same pairing `preview-service-parented.integration.test.ts` uses, so the
 * parented/standalone transitions this test is actually about are the real ones, not a stand-in.
 */

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let previews: PreviewService;
let synced: EditorSyncMsg[];
let relay: ReturnType<typeof lateListener>;

function meta(panelId: string, absPath: string | null, windowId = 'w1'): DocMeta {
  return {
    panelId, windowId, ownerKind: 'project', ownerProjectId: 'A', ownerRoot: root,
    allProjectRoots: [root], tabId: 't1', absPath, encoding: 'utf8', hasBom: false, lineEnding: 'lf',
  };
}

async function file(name: string, text: string): Promise<string> {
  const path = join(root, name);
  await writeFile(path, text);
  return path;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-fold-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-fold-rec-'));
  synced = [];
  relay = lateListener();
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: (_from, msg) => synced.push(msg),
    persistUndoHistory: () => true,
    fileWatcher: new NodeFileWatcher(20),
    documentLifecycle: relay,
  });
  previews = new PreviewService({
    documents: coord,
    reader: service,
    fs,
    fileWatcher: manualWatcher(),
    settings: liveSettings().get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'A' ? root : undefined),
    push: recordingPush(),
    windows: recordingWindows(),
    foldRekey: {
      reparent: (panelId, key, parented) => coord.reparentFold(panelId, key, parented),
      forget: (key) => coord.forgetFold(key),
    },
  });
  relay.bind(previews);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const foldMsgs = () =>
  synced.filter((m): m is EditorSyncMsg & { foldState: { key: string; state: FoldState } } => m.foldState !== undefined);

describe('fold state is document state, held beside word wrap (047 R3)', () => {
  it('seeds initialFold(seed) once per key, and remembers what is set', async () => {
    const a = await file('a.md', '# A\n');
    await coord.load({ ...meta('e1', a) });
    const key = coord.foldKeyForPanel('e1')!;
    expect(key).toBe(`file:${a.replace(/\\/g, '/').toLowerCase()}`);

    expect(coord.foldStateFor(key, 'expanded')).toEqual(initialFold('expanded'));
    // Seeded once: asking again with a different seed does not re-seed.
    expect(coord.foldStateFor(key, 'collapsed')).toEqual(initialFold('expanded'));

    const next: FoldState = { base: 'expanded', flipped: ['heading-1'] };
    coord.setFoldState(key, next, -1);
    expect(coord.foldStateFor(key, 'expanded')).toEqual(next);
  });

  it('relays a set to every window, synchronously, describing the KEY (not one message per panel)', async () => {
    const a = await file('a.md', '# A\n');
    await coord.load({ ...meta('e1', a, 'w1') });
    await coord.load({ ...meta('e2', a, 'w2') }); // a mirrored editor on the SAME document
    const key = coord.foldKeyForPanel('e1')!;
    synced.length = 0;

    const state: FoldState = { base: 'collapsed', flipped: [] };
    coord.setFoldState(key, state, 5); // exclude webContents 5 (the sender's window)

    const msgs = foldMsgs();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.foldState).toEqual({ key, state });
  });

  it('says nothing when the value did not change', async () => {
    const a = await file('a.md', '# A\n');
    await coord.load({ ...meta('e1', a) });
    const key = coord.foldKeyForPanel('e1')!;
    const state: FoldState = { base: 'collapsed', flipped: [] };
    coord.setFoldState(key, state, -1);
    synced.length = 0;

    coord.setFoldState(key, state, -1);

    expect(foldMsgs()).toEqual([]);
  });

  it('a PARENTED preview reads the document key — no second entry', async () => {
    const a = await file('a.md', '# A\n');
    await coord.load({ ...meta('e1', a) });
    await previews.attach(1, { panelId: 'v1', projectId: 'A', filePath: a });

    const docKey = coord.foldKeyForPanel('e1')!;
    const state: FoldState = { base: 'collapsed', flipped: [] };
    coord.setFoldState(docKey, state, -1);

    expect(previews.foldKeyFor('v1')).toBe(docKey);
    expect(coord.foldStateFor(docKey, 'expanded')).toEqual(state);
  });

  it('a STANDALONE preview maps to panel:<id>, one entry however many windows view it', async () => {
    const a = await file('a.md', '# A\n');
    await previews.attach(1, { panelId: 'v1', projectId: 'A', filePath: a }); // no document: standalone

    const key = previews.foldKeyFor('v1');
    expect(key).toBe('panel:v1');

    const state: FoldState = { base: 'collapsed', flipped: ['s1'] };
    coord.setFoldState(key!, state, -1);
    // A second window viewing the SAME standalone panel reads the SAME entry (Principle XI): there is
    // no second key to view it under, so attaching another viewer changes nothing about the map.
    await previews.attach(2, { panelId: 'v1', projectId: 'A', filePath: a });
    expect(coord.foldStateFor(key!, 'expanded')).toEqual(state);
  });

  it('becoming PARENTED drops the panel: entry; the document state applies (R3)', async () => {
    const a = await file('a.md', '# A\n');
    await previews.attach(1, { panelId: 'v1', projectId: 'A', filePath: a }); // standalone first
    const standaloneKey = previews.foldKeyFor('v1')!;
    coord.setFoldState(standaloneKey, { base: 'collapsed', flipped: [] }, -1);

    await coord.load({ ...meta('e1', a) }); // a document now exists for the file — v1 parents (FR-013a)

    expect(previews.foldKeyFor('v1')).toBe(coord.foldKeyForPanel('e1'));
    // The panel: entry is gone; a fresh read of it would only ever re-seed, never resurrect the old value.
    expect(coord.foldStateFor(standaloneKey, 'expanded')).toEqual(initialFold('expanded'));
  });

  /*
   * MT-04 (review, 2026-09-29): "if I have a preview open that has some areas closed, then open a
   * linked editor, the areas open. The newly opened editor should follow the preview's outlining."
   */
  it('a FIRST editor opened on a standalone preview\'s file takes the preview\'s fold state, and it is relayed (FR-078)', async () => {
    const a = await file('a.md', '# A\n\n## B\n');
    await previews.attach(1, { panelId: 'v1', projectId: 'A', filePath: a }); // standalone first
    const collapsed: FoldState = { base: 'expanded', flipped: ['b'] };
    coord.setFoldState(previews.foldKeyFor('v1')!, collapsed, -1);
    synced.length = 0;

    await coord.load({ ...meta('e1', a) }); // the document's first view — v1 parents

    const docKey = coord.foldKeyForPanel('e1')!;
    expect(previews.foldKeyFor('v1')).toBe(docKey);
    expect(coord.foldStateFor(docKey, 'expanded')).toEqual(collapsed);
    expect(foldMsgs().map((m) => m.foldState)).toContainEqual({ key: docKey, state: collapsed });
  });

  it('a document that already has a fold state keeps it when a standalone preview parents to it (FR-034 stands)', async () => {
    const a = await file('a.md', '# A\n\n## B\n');
    await previews.attach(1, { panelId: 'v1', projectId: 'A', filePath: a });
    coord.setFoldState(previews.foldKeyFor('v1')!, { base: 'expanded', flipped: ['b'] }, -1);
    const docKey = `file:${a.replace(/\\/g, '/').toLowerCase()}`;
    const documentState: FoldState = { base: 'collapsed', flipped: [] };
    coord.setFoldState(docKey, documentState, -1);

    await coord.load({ ...meta('e1', a) });

    expect(coord.foldStateFor(docKey, 'expanded')).toEqual(documentState);
  });

  it("becoming STANDALONE seeds panel:<id> from the document's CURRENT state (R3)", async () => {
    const a = await file('a.md', '# A\n');
    await coord.load({ ...meta('e1', a) });
    await previews.attach(1, { panelId: 'v1', projectId: 'A', filePath: a }); // parented from birth
    const docKey = coord.foldKeyForPanel('e1')!;
    const state: FoldState = { base: 'expanded', flipped: ['deep'] };
    coord.setFoldState(docKey, state, -1);

    coord.destroy('e1'); // the document closes — v1 falls back to standalone (FR-013b)

    const standaloneKey = previews.foldKeyFor('v1');
    expect(standaloneKey).toBe('panel:v1');
    expect(coord.foldStateFor(standaloneKey!, 'collapsed')).toEqual(state); // kept what it showed
  });

  it('forgets a document key once no editor shows it any more', async () => {
    const a = await file('a.md', '# A\n');
    await coord.load({ ...meta('e1', a, 'w1') });
    const key = coord.foldKeyForPanel('e1')!;
    coord.setFoldState(key, { base: 'collapsed', flipped: [] }, -1);

    coord.destroy('e1');

    // Reading it again starts fresh from the preference — the override did not survive.
    expect(coord.foldStateFor(key, 'expanded')).toEqual(initialFold('expanded'));
  });
});

// ── `throng:editor:setFoldState` / `throng:editor:foldState` (contracts/preview-ipc-047.md §5) ──────
//
// `editor-ipc.ts` imports `ipcMain` directly (unlike `preview-ipc.ts`, which takes it as a parameter),
// so exercising the real handlers needs the module mocked — the `clipboard-ipc.test.ts` precedent.

const editorIpcHandles = new Map<string, (event: unknown, payload: unknown) => unknown>();
const editorIpcOns = new Map<string, (event: unknown, payload: unknown) => void>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => void editorIpcHandles.set(channel, fn as never),
    on: (channel: string, fn: (...args: unknown[]) => void) => void editorIpcOns.set(channel, fn as never),
  },
}));

const { registerEditorIpc } = await import('../../src/main/editor-ipc.js');

const fakeEvent = (senderId: number) => ({ sender: { id: senderId, isDestroyed: () => false } });

describe('throng:editor:setFoldState / throng:editor:foldState — the wire (contracts/preview-ipc-047.md §5)', () => {
  beforeEach(() => {
    registerEditorIpc(coord, { listProjects: async () => [], previewFold: previews });
  });

  it('an editor panel resolves to file:<path>; a set is stored and relayed excluding the sender', async () => {
    const a = await file('a.md', '# A\n');
    await coord.load({ ...meta('e1', a) });
    const key = coord.foldKeyForPanel('e1')!;
    synced.length = 0;

    const state: FoldState = { base: 'collapsed', flipped: ['s1'] };
    editorIpcOns.get('throng:editor:setFoldState')!(fakeEvent(9), { panelId: 'e1', state });

    expect(coord.foldStateFor(key, 'expanded')).toEqual(state);
    const msgs = foldMsgs();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.foldState).toEqual({ key, state });

    const seeded = await editorIpcHandles.get('throng:editor:foldState')!(fakeEvent(9), { panelId: 'e1', seed: 'collapsed' });
    expect(seeded).toEqual(state);
  });

  it('a standalone preview panel resolves to panel:<id>', async () => {
    const a = await file('a.md', '# A\n');
    await previews.attach(1, { panelId: 'v1', projectId: 'A', filePath: a });

    const seeded = await editorIpcHandles.get('throng:editor:foldState')!(fakeEvent(1), { panelId: 'v1', seed: 'expanded' });
    expect(seeded).toEqual(initialFold('expanded'));
    expect(coord.foldStateFor('panel:v1', 'collapsed')).toEqual(initialFold('expanded'));
  });

  it('drops an invalid state: a bad base, over 2,000 slugs, or a slug over 256 chars', async () => {
    const a = await file('a.md', '# A\n');
    await coord.load({ ...meta('e1', a) });
    const key = coord.foldKeyForPanel('e1')!;

    editorIpcOns.get('throng:editor:setFoldState')!(fakeEvent(1), { panelId: 'e1', state: { base: 'sideways', flipped: [] } });
    editorIpcOns.get('throng:editor:setFoldState')!(fakeEvent(1), {
      panelId: 'e1',
      state: { base: 'collapsed', flipped: Array.from({ length: 2001 }, (_, i) => `s${i}`) },
    });
    editorIpcOns.get('throng:editor:setFoldState')!(fakeEvent(1), {
      panelId: 'e1',
      state: { base: 'collapsed', flipped: ['x'.repeat(257)] },
    });

    // None of the three stored: the key is still whatever it was seeded to (never touched).
    expect(coord.foldStateFor(key, 'expanded')).toEqual(initialFold('expanded'));
  });

  it('an unresolvable panelId is a no-op — never creates a stray entry', async () => {
    editorIpcOns.get('throng:editor:setFoldState')!(fakeEvent(1), {
      panelId: 'ghost',
      state: { base: 'collapsed', flipped: [] },
    });
    expect(foldMsgs()).toEqual([]);

    const seeded = await editorIpcHandles.get('throng:editor:foldState')!(fakeEvent(1), { panelId: 'ghost', seed: 'expanded' });
    expect(seeded).toEqual(initialFold('expanded'));
    // Nothing was actually stored under a stray key.
    expect(coord.foldStateFor('panel:ghost', 'collapsed')).toEqual(initialFold('collapsed'));
  });
});
