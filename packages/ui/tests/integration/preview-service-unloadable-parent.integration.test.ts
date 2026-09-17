import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS, type PreviewUpdate } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { NavigationHistoryService } from '../../src/main/navigation-history-service.js';
import { PreviewService } from '../../src/main/preview-service.js';
import { editDocument } from './helpers/edit-document.js';
import {
  FakeClock,
  lateListener,
  liveSettings,
  manualWatcher,
  recordingPush,
  recordingWindows,
} from './helpers/preview-harness.js';

/**
 * Adversarial review (main item 1, IMPORTANT) — a preview PARENTED to a document that could not read its
 * file (FR-013, FR-026, FR-106d).
 *
 * "Parented" follows the document, and the document was the one thing that knew the file was not there:
 * a restore whose file had been deleted registers an empty, unloadable document (027 / #161), and Back
 * onto a deleted file puts in the FR-106d stand-in. `PreviewDocuments` exposed only `{ text, dirty }`, so a
 * preview parented to either showed an EMPTY DOCUMENT — no notice, and its Go to Editor button pressed —
 * where a standalone preview of the same missing file says, correctly, that it no longer exists.
 *
 * Every scenario runs over a real coordinator and a real temp tree. The coordinator has no folder watch
 * (the test decides when the disk is looked at); the clock is fake.
 */

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let clock: FakeClock;
let push: ReturnType<typeof recordingPush>;
let settings: ReturnType<typeof liveSettings>;
let coord: EditorCoordinator;
let previews: PreviewService;
let history: NavigationHistoryService;

const VIEWER = 7;

function meta(panelId: string, absPath: string | null): DocMeta {
  return {
    panelId,
    windowId: String(VIEWER),
    ownerKind: 'project',
    ownerProjectId: 'P',
    ownerRoot: root,
    allProjectRoots: [root],
    tabId: 't1',
    absPath,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
  };
}

async function file(name: string, text: string): Promise<string> {
  const path = join(root, name);
  await writeFile(path, text);
  return path;
}

async function openEditor(panelId: string, path: string): Promise<void> {
  expect((await coord.load({ ...meta(panelId, path), absPath: path })).ok).toBe(true);
}

/** Back in an EDITOR onto a file that is gone: the FR-106d stand-in. */
async function editorBackOntoMissing(panelId: string, path: string, index: number): Promise<void> {
  const res = await coord.load({ ...meta(panelId, path), absPath: path, navigation: { kind: 'history', index, filePath: path } });
  expect(res.ok).toBe(false);
  expect(coord.getContent(panelId)).toMatchObject({ absPath: path, text: '', unloadable: true });
}

async function attach(panelId: string, filePath: string, extra: Record<string, unknown> = {}): Promise<PreviewUpdate> {
  const res = await previews.attach(VIEWER, { panelId, projectId: 'P', filePath, ...extra });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  return res.update;
}

const updatesFor = (panelId: string): PreviewUpdate[] =>
  push.updates.filter((u) => u.update.panelId === panelId).map((u) => u.update);
const lastFor = (panelId: string): PreviewUpdate | undefined => updatesFor(panelId).at(-1);

/** Let the service's awaited disk reads settle (real I/O, fake clock). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-unloadable-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-unloadable-rec-'));
  clock = new FakeClock();
  push = recordingPush();
  settings = liveSettings();
  settings.current.editor.previews.updateDelayMs = 300;
  settings.current.editor.previews.maxWaitMs = 1000;
  history = new NavigationHistoryService({ cap: () => 10, broadcastChanged: () => {} });
  const relay = lateListener();
  const service = new EditorService(fs, settings.get);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
  });
  previews = new PreviewService({
    documents: coord,
    reader: service,
    fs,
    fileWatcher: manualWatcher(),
    settings: settings.get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'P' ? root : undefined),
    push,
    windows: recordingWindows(),
    clock,
    history,
  });
  relay.bind(previews);
});

afterEach(async () => {
  for (const id of ['ed1', 'ed2']) coord.destroy(id);
  for (const id of ['v1', 'v2']) previews.destroyed(id);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('a restore whose file is gone registers an unloadable document (027 / #161)', () => {
  it('a preview attaching to it is parented AND carries the deleted notice', async () => {
    const notes = join(root, 'notes.md');
    coord.register(meta('ed1', notes), '', { unloadable: true });

    const update = await attach('v1', notes);

    expect(update).toMatchObject({ filePath: notes, parent: { panelId: 'ed1' }, notice: { kind: 'deleted' } });
  });

  it('a file the editor refused as too large carries the too-large notice, following the editor’s limit', async () => {
    const big = await file('big.md', 'x'.repeat(4096));
    settings.current.editor.maxOpenFileBytes = 1024;
    coord.register(meta('ed1', big), '', { unloadable: true });

    expect(await attach('v1', big)).toMatchObject({ parent: { panelId: 'ed1' }, notice: { kind: 'too-large' } });
  });

  it('a standalone preview of the missing file that becomes parented to it keeps its notice — never an empty document', async () => {
    const notes = join(root, 'notes.md');
    expect((await attach('v1', notes)).notice).toEqual({ kind: 'deleted' });
    push.clear();

    coord.register(meta('ed1', notes), '', { unloadable: true });
    await settle();

    expect(lastFor('v1')).toMatchObject({ parent: { panelId: 'ed1' }, notice: { kind: 'deleted' } });
    expect(updatesFor('v1').filter((u) => u.notice === null)).toEqual([]);
  });

  it('Refresh on it repeats the notice rather than clearing it (FR-026, FR-028)', async () => {
    const notes = join(root, 'notes.md');
    coord.register(meta('ed1', notes), '', { unloadable: true });
    await attach('v1', notes);

    const { update } = await previews.refresh('v1');

    expect(update).toMatchObject({ parent: { panelId: 'ed1' }, notice: { kind: 'deleted', repeat: true } });
  });

  /*
   * Fix round 1 ruling (FR-022 over FR-026 for a document that holds content): recovered text restored into
   * it IS content to follow — the user's own unsaved work — so the notice clears and the preview shows it,
   * exactly as it would for a document that was read and then lost its file.
   */
  it('recovered text restored into it is content to follow: the notice clears and that text is shown', async () => {
    const notes = join(root, 'notes.md');
    coord.register(meta('ed1', notes), '', { unloadable: true });
    expect((await attach('v1', notes)).notice).toEqual({ kind: 'deleted' });
    push.clear();

    coord.restoreRecovered('ed1', '# what the file used to say\n');
    clock.advance(1000);
    await settle();

    expect(coord.getContent('ed1')).toMatchObject({ unloadable: true, contentless: false, dirty: true });
    expect(lastFor('v1')).toMatchObject({
      parent: { panelId: 'ed1' },
      notice: null,
      dirty: true,
      content: { kind: 'text', text: '# what the file used to say\n' },
    });
  });
});

describe('the FR-106d stand-in (Back in an editor onto a deleted file)', () => {
  it('a preview attaching to it is parented AND carries the deleted notice', async () => {
    const a = await file('a.md', '# A\n');
    const b = await file('b.md', '# B\n');
    await openEditor('ed1', a);
    await openEditor('ed1', b);
    await unlink(a);
    await editorBackOntoMissing('ed1', a, 0);

    expect(await attach('v1', a)).toMatchObject({ parent: { panelId: 'ed1' }, notice: { kind: 'deleted' } });
  });

  it('a standalone preview of that file, parented by the step, shows the notice instead of a blank document', async () => {
    const a = await file('a.md', '# A\n');
    const b = await file('b.md', '# B\n');
    await openEditor('ed1', a);
    await openEditor('ed1', b);
    await attach('v1', a);
    await unlink(a);
    push.clear();

    await editorBackOntoMissing('ed1', a, 0);
    await settle();

    expect(lastFor('v1')).toMatchObject({ parent: { panelId: 'ed1' }, notice: { kind: 'deleted' } });
    expect(updatesFor('v1').filter((u) => u.notice === null)).toEqual([]);
  });

  it('the notice clears when the file comes back and the document adopts it — even an EMPTY file (pathCameBack)', async () => {
    const a = await file('a.md', '# A\n');
    const b = await file('b.md', '# B\n');
    await openEditor('ed1', a);
    await openEditor('ed1', b);
    await unlink(a);
    await editorBackOntoMissing('ed1', a, 0);
    await attach('v1', a);
    push.clear();

    // Empty, so the adopted text equals the stand-in's and no TEXT change can carry the news.
    await writeFile(a, '');
    await coord.verifyPath('ed1');
    await settle();

    expect(coord.getContent('ed1')).toMatchObject({ unloadable: false });
    expect(lastFor('v1')).toMatchObject({ parent: { panelId: 'ed1' }, notice: null });
  });

  it('Back in a PREVIEW onto a deleted file whose document is a stand-in is shown parented, with the deleted notice', async () => {
    const a = await file('a.md', '# A\n');
    const b = await file('b.md', '# B\n');
    await openEditor('ed2', a);
    await openEditor('ed2', b);
    await attach('v1', b, { history: { v: 1, entries: [{ filePath: a }, { filePath: b }], index: 1 } });
    await unlink(a);
    await editorBackOntoMissing('ed2', a, 0);

    const res = await previews.navigate(VIEWER, { panelId: 'v1', target: { absPath: a }, intent: { kind: 'history', index: 0 } });

    expect(res).toMatchObject({ kind: 'shown', update: { filePath: a, parent: { panelId: 'ed2' }, notice: { kind: 'deleted' } } });
  });
});

/*
 * Fix round 1 ruling — FR-022 wins for a document that HOLDS CONTENT. A document that was read and then lost
 * its file keeps its buffer (FR-099), and the editor's banner already owns that condition (one condition,
 * one notice). So its parented preview keeps following the buffer, with no FR-026 notice and nothing
 * covering the body. The notice is only for a document with no content to follow (above).
 */
describe('a parented preview whose document was READ keeps following its buffer when the file goes', () => {
  it('deleted under an open editor: no notice, the buffer stays on screen; restored: still no notice (markRestored)', async () => {
    const a = await file('a.md', '# A\n');
    await openEditor('ed1', a);
    await attach('v1', a);
    push.clear();

    await unlink(a);
    coord.markDeleted([a]);
    await settle();
    expect(updatesFor('v1').filter((u) => u.notice !== null)).toEqual([]);
    expect((await previews.refresh('v1')).update).toMatchObject({
      parent: { panelId: 'ed1' },
      notice: null,
      content: { kind: 'text', text: '# A\n' },
    });

    await writeFile(a, '# A\n');
    await coord.markRestored([a]);
    await settle();
    expect(updatesFor('v1').filter((u) => u.notice !== null)).toEqual([]);
    expect(lastFor('v1')).toMatchObject({ parent: { panelId: 'ed1' }, notice: null });
  });

  it('the user’s own unsaved work stays on screen while the file is gone and after it comes back', async () => {
    const a = await file('a.md', '# A\n');
    await openEditor('ed1', a);
    editDocument(coord, meta('ed1', a), '# mine\n');
    await attach('v1', a);
    await unlink(a);
    coord.markDeleted([a]);
    clock.advance(1000);
    await settle();

    await writeFile(a, '# disk\n');
    await coord.verifyPath('ed1');
    await settle();

    expect(coord.getContent('ed1')).toMatchObject({ text: '# mine\n', unloadable: false });
    expect(updatesFor('v1').filter((u) => u.notice !== null)).toEqual([]);
    expect((await previews.refresh('v1')).update).toMatchObject({
      notice: null,
      dirty: true,
      content: { kind: 'text', text: '# mine\n' },
    });
  });

  it('a failed verify of a document that was read adds no notice either', async () => {
    const a = await file('a.md', '# A\n');
    await openEditor('ed1', a);
    await attach('v1', a);
    push.clear();

    await unlink(a);
    await coord.verifyPath('ed1');
    await settle();

    expect(coord.getContent('ed1')).toMatchObject({ unloadable: true });
    expect(updatesFor('v1').filter((u) => u.notice !== null)).toEqual([]);
  });
});

describe('a link followed onto a file whose document could not read it', () => {
  it('is shown parented with the notice saying why, not as an empty document', async () => {
    const a = await file('a.md', '# A\n[c](c.md)\n');
    const c = await file('c.md', 'x'.repeat(4096));
    settings.current.editor.maxOpenFileBytes = 1024;
    coord.register(meta('ed2', c), '', { unloadable: true });
    await attach('v1', a);

    const res = await previews.navigate(VIEWER, { panelId: 'v1', target: { absPath: c }, intent: { kind: 'link' } });

    expect(res).toMatchObject({ kind: 'shown', update: { filePath: c, parent: { panelId: 'ed2' }, notice: { kind: 'too-large' } } });
  });
});
