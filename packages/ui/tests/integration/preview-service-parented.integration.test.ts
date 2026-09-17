import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { editorAutoTitle, normaliseForCompare, samePath, type EditorOwnerKind } from '@throng/core';
import { SHIPPED_PREVIEW_PROVIDERS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
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
 * T057 (044) — `PreviewService` over a REAL `EditorCoordinator`: a preview is parented exactly while a
 * document exists for its file (FR-013), follows that document's identity (FR-013a/b/c, FR-066), its
 * content on the settle schedule (FR-022, FR-060, FR-060a), its dirty state and its title immediately
 * (FR-031, FR-040) — and never changes the document (FR-041).
 *
 * The clock is fake: the scheduler IS the behaviour under test, and a test that sleeps to observe it
 * flakes. The coordinator has no folder watch, so a write to an open file cannot race a live reload.
 */

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let clock: FakeClock;
let push: ReturnType<typeof recordingPush>;
let windows: ReturnType<typeof recordingWindows>;
let settings: ReturnType<typeof liveSettings>;
let coord: EditorCoordinator;
let previews: PreviewService;
let watcher: ReturnType<typeof manualWatcher>;
let relay: ReturnType<typeof lateListener>;

const VIEWER = 7;

function meta(panelId: string, absPath: string | null, ownerKind: EditorOwnerKind = 'project'): DocMeta {
  return {
    panelId,
    windowId: String(VIEWER),
    ownerKind,
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
  const res = await coord.load({ ...meta(panelId, path), absPath: path });
  expect(res.ok).toBe(true);
}

async function attach(panelId: string, filePath: string, viewer = VIEWER) {
  const res = await previews.attach(viewer, { panelId, projectId: 'P', filePath });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  return res.update;
}

const updatesFor = (panelId: string) => push.updates.filter((u) => u.update.panelId === panelId).map((u) => u.update);
const lastFor = (panelId: string) => updatesFor(panelId).at(-1);

/** Let the service's awaited disk reads settle (real I/O, fake clock). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-parented-'));
  await mkdir(join(root, 'dest'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-parented-rec-'));
  clock = new FakeClock();
  push = recordingPush();
  windows = recordingWindows();
  settings = liveSettings();
  settings.current.editor.previews.updateDelayMs = 300;
  settings.current.editor.previews.maxWaitMs = 1000;
  relay = lateListener();
  watcher = manualWatcher();
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
    fileWatcher: watcher,
    settings: settings.get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'P' ? root : undefined),
    push,
    windows,
    clock,
  });
  relay.bind(previews);
});

afterEach(async () => {
  for (const id of ['ed1', 'ed2', 'ed3']) coord.destroy(id);
  for (const id of ['v1', 'v2', 'v3']) previews.destroyed(id);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('parented is derived from the editor registry (FR-013)', () => {
  it('a preview of a file with a document is parented to that document; one without is standalone', async () => {
    const a = await file('a.md', '# A\n');
    const b = await file('b.md', '# B\n');
    await openEditor('ed1', a);

    const parented = await attach('v1', a);
    const standalone = await attach('v2', b);

    expect(parented).toMatchObject({
      panelId: 'v1',
      filePath: a,
      providerId: 'markdown',
      content: { kind: 'text', text: '# A\n' },
      dirty: false,
      parent: { panelId: 'ed1', title: editorAutoTitle(a) },
      notice: null,
    });
    expect(standalone).toMatchObject({
      panelId: 'v2',
      filePath: b,
      content: { kind: 'text', text: '# B\n' },
      dirty: false,
      parent: null,
      notice: null,
    });
  });

  it('a standalone preview becomes parented IN PLACE when its file is opened in an editor (FR-013a)', async () => {
    const a = await file('a.md', '# A\n');
    await attach('v1', a);
    push.clear();

    await openEditor('ed1', a);

    const update = lastFor('v1');
    expect(update).toMatchObject({
      panelId: 'v1',
      filePath: a,
      dirty: false,
      parent: { panelId: 'ed1', title: editorAutoTitle(a) },
    });
    expect(previews.run('v1')?.filePath).toBe(a);
  });

  it('registered reads a DIRTY document’s text and dirty state from getContent, not from assumption (§3)', async () => {
    const a = await file('a.md', '# on disk\n');
    await attach('v1', a);
    // `registered` carries no dirty flag; deliver it only once the document is already dirty, so the
    // only way the preview can learn either is to read the document.
    relay.muted = true;
    await openEditor('ed1', a);
    editDocument(coord, meta('ed1', a), '# unsaved\n');
    relay.muted = false;
    push.clear();

    previews.registered(a, 'ed1');

    expect(updatesFor('v1')).toEqual([
      expect.objectContaining({
        filePath: a,
        content: { kind: 'text', text: '# unsaved\n' },
        dirty: true,
        parent: { panelId: 'ed1', title: editorAutoTitle(a) },
        notice: null,
      }),
    ]);
  });

  it('a standalone run watches its folder; becoming parented disposes the watch; falling back re-creates it', async () => {
    const a = await file('a.md', '# A\n');
    await attach('v1', a);
    expect(watcher.watched).toEqual([root]);

    await openEditor('ed1', a);
    expect(watcher.watched).toEqual([]);

    coord.destroy('ed1');
    await settle();
    expect(watcher.watched).toEqual([root]);

    previews.destroyed('v1');
    expect(watcher.watched).toEqual([]);
  });

  it('a title published by an editor is forgotten when its document goes (no stale parent title)', async () => {
    const a = await file('a.md', '# A\n');
    await openEditor('ed1', a);
    previews.publishEditorTitle('ed1', 'Old custom name');
    coord.destroy('ed1');
    await attach('v1', a);
    push.clear();

    await openEditor('ed1', a);

    expect(lastFor('v1')?.parent).toEqual({ panelId: 'ed1', title: editorAutoTitle(a) });
  });

  it('a same-panel re-point (a new file loaded into the same editor panel) keeps the panel’s newly published title (item 9)', async () => {
    const a = await file('a.md', '# A\n');
    const b = await file('b.md', '# B\n');
    await openEditor('ed1', a);
    previews.publishEditorTitle('ed1', 'Custom A');
    await attach('v1', a);

    // Load a DIFFERENT file into the SAME panel: `unregistered(a)` then `registered(b)`, with the new
    // document already in place when `unregistered` fires (`announceReplacement`,
    // editor-coordinator.ts:1277-1280) — the title this panel just published must survive that.
    await openEditor('ed1', b);

    const parented = await attach('v2', b);
    expect(parented.parent).toEqual({ panelId: 'ed1', title: 'Custom A' });
  });

  it('a parented preview falls back to disk, clean and standalone, when its document closes (FR-013b)', async () => {
    const a = await file('a.md', '# on disk\n');
    await openEditor('ed1', a);
    await attach('v1', a);
    editDocument(coord, meta('ed1', a), '# unsaved\n');
    clock.advance(1000);
    expect(lastFor('v1')).toMatchObject({ dirty: true });
    push.clear();

    coord.destroy('ed1');
    await settle();

    expect(lastFor('v1')).toMatchObject({
      filePath: a,
      dirty: false,
      parent: null,
      content: { kind: 'text', text: '# on disk\n' },
    });
  });
});

describe('a handed-over run is parented exactly while a document exists (FR-013a, u7 fix round 2)', () => {
  it('two previews attached before any document exists are BOTH parented when it registers, so the survivor stays parented once the holder is destroyed', async () => {
    const a = await file('a.md', '# on disk\n');
    // Both attach while standalone — neither is the document's parent yet. `claimPath` gives the
    // path to whichever attaches first (v1); v2 is the non-holder this fix is about.
    await attach('v1', a);
    await attach('v2', a);
    push.clear();

    await openEditor('ed1', a);

    // Not only the holder (v1) becomes parented — the non-holder (v2) must too (FR-013a).
    expect(lastFor('v1')).toMatchObject({ parent: { panelId: 'ed1', title: editorAutoTitle(a) } });
    expect(lastFor('v2')).toMatchObject({ parent: { panelId: 'ed1', title: editorAutoTitle(a) } });

    // Destroy the byPath holder: the key hands over to v2, which was already parented above — no
    // extra parenting step is needed at handover time.
    previews.destroyed('v1');
    push.clear();

    editDocument(coord, meta('ed1', a), '# unsaved\n');
    clock.advance(1000);

    expect(lastFor('v2')).toMatchObject({
      content: { kind: 'text', text: '# unsaved\n' },
      dirty: true,
      parent: { panelId: 'ed1', title: editorAutoTitle(a) },
    });
    expect(previews.isOpen(a)).toBe(true);
  });

  it('two previews that attach AFTER their document already exists are both parented from the start, and handover after a destroy still follows the document', async () => {
    const a = await file('a.md', '# on disk\n');
    await openEditor('ed1', a);

    const first = await attach('v1', a);
    const second = await attach('v2', a);

    expect(first.parent).toEqual({ panelId: 'ed1', title: editorAutoTitle(a) });
    expect(second.parent).toEqual({ panelId: 'ed1', title: editorAutoTitle(a) });

    previews.destroyed('v1');
    push.clear();

    editDocument(coord, meta('ed1', a), '# unsaved\n');
    clock.advance(1000);

    expect(lastFor('v2')).toMatchObject({
      content: { kind: 'text', text: '# unsaved\n' },
      dirty: true,
      parent: { panelId: 'ed1', title: editorAutoTitle(a) },
    });
  });
});

describe('a parented preview follows its document’s identity (FR-013c, FR-066)', () => {
  it('an in-app move re-keys the run, re-derives the title and broadcasts both paths and pathChanged', async () => {
    const from = await file('a.md', '# A\n');
    const to = join(root, 'dest', 'renamed.md');
    await openEditor('ed1', from);
    await attach('v1', from);
    push.clear();

    coord.beginMove([from]);
    await rename(from, to);
    coord.markMoved([{ from, to }]);

    expect(lastFor('v1')).toMatchObject({
      filePath: to,
      parent: { panelId: 'ed1', title: editorAutoTitle(to) },
      notice: null,
    });
    expect(previews.run('v1')?.filePath).toBe(to);
    expect(previews.isOpen(to)).toBe(true);
    expect(previews.isOpen(from)).toBe(false);
    expect(push.openChanged.some((c) => samePath(c.path, from) && c.open === false)).toBe(true);
    expect(push.openChanged.some((c) => samePath(c.path, to) && c.open === true)).toBe(true);
    expect(push.pathChanged).toEqual([{ panelId: 'v1', filePath: to }]);
  });

  /*
   * 044 T177 (FR-024 with FR-013c) — every update carries how many times the run has been NAVIGATED. A
   * re-point leaves that number alone, which is how the renderer tells "the same document under a new
   * path" from a link followed, and keeps the reader where they were reading.
   */
  it('a re-point leaves the run’s navigation count alone, on a move and on a Save As', async () => {
    const from = await file('a.md', '# A\n');
    const moved = join(root, 'dest', 'renamed.md');
    const savedAs = join(root, 'saved-as.md');
    await openEditor('ed1', from);
    const attached = await attach('v1', from);
    expect(attached.navigationSeq).toBe(0);

    coord.beginMove([from]);
    await rename(from, moved);
    coord.markMoved([{ from, to: moved }]);
    expect(lastFor('v1')).toMatchObject({ filePath: moved, navigationSeq: 0 });

    await coord.save({ panelId: 'ed1', absPath: savedAs });
    expect(lastFor('v1')).toMatchObject({ filePath: savedAs, navigationSeq: 0 });
  });

  it('a Save As re-points the run exactly as a move does', async () => {
    const from = await file('a.md', '# A\n');
    const to = join(root, 'saved-as.md');
    await openEditor('ed1', from);
    await attach('v1', from);
    editDocument(coord, meta('ed1', from), '# A edited\n');
    push.clear();

    const saved = await coord.save({ panelId: 'ed1', absPath: to });
    expect(saved.ok).toBe(true);

    expect(lastFor('v1')).toMatchObject({
      filePath: to,
      dirty: false,
      parent: { panelId: 'ed1', title: editorAutoTitle(to) },
    });
    expect(previews.isOpen(to)).toBe(true);
    expect(previews.isOpen(from)).toBe(false);
    expect(push.pathChanged).toEqual([{ panelId: 'v1', filePath: to }]);
    expect(push.openChanged).toEqual([
      { path: normaliseForCompare(from), open: false },
      { path: normaliseForCompare(to), open: true },
    ]);
  });

  it('a Save As with two runs on the path moves both, and announces the old path closed exactly once', async () => {
    const from = await file('a.md', '# A\n');
    const to = join(root, 'saved-as.md');
    await openEditor('ed1', from);
    await attach('v1', from);
    await attach('v2', from, 8);
    push.clear();

    await coord.save({ panelId: 'ed1', absPath: to });

    expect(previews.run('v1')?.filePath).toBe(to);
    expect(previews.run('v2')?.filePath).toBe(to);
    expect(previews.isOpen(from)).toBe(false);
    expect(previews.isOpen(to)).toBe(true);
    expect(push.openChanged.filter((c) => c.path === normaliseForCompare(from))).toEqual([
      { path: normaliseForCompare(from), open: false },
    ]);
    expect(push.openChanged.filter((c) => c.path === normaliseForCompare(to))).toEqual([
      { path: normaliseForCompare(to), open: true },
    ]);
    previews.destroyed('v1');
    expect(previews.isOpen(to)).toBe(true);
  });

  it('a Save As to a type with no provider raises the no-provider notice (FR-027)', async () => {
    const from = await file('a.md', '# A\n');
    const to = join(root, 'a.txt');
    await openEditor('ed1', from);
    await attach('v1', from);
    push.clear();

    await coord.save({ panelId: 'ed1', absPath: to });

    expect(lastFor('v1')).toMatchObject({ filePath: to, notice: { kind: 'no-provider' } });
    expect(push.pathChanged).toEqual([{ panelId: 'v1', filePath: to }]);
  });

  it('a Save As onto a file a standalone preview shows parents THAT run, and leaves one run per path (§3)', async () => {
    const from = await file('a.md', '# A\n');
    const to = await file('b.md', '# B on disk\n');
    await openEditor('ed1', from);
    await attach('v1', from);
    await attach('v2', to);
    push.clear();

    await coord.save({ panelId: 'ed1', absPath: to });
    await settle();

    expect(lastFor('v2')).toMatchObject({ filePath: to, parent: { panelId: 'ed1' } });
    // The run that was following `from` does not become a second preview of `to` (FR-012).
    expect(previews.run('v1')?.filePath).toBe(from);
    expect(lastFor('v1')).toMatchObject({ filePath: from, parent: null, dirty: false });
    expect(previews.isOpen(to)).toBe(true);
    expect(previews.isOpen(from)).toBe(true);
  });

  it('the first Save As of an unpathed document onto a standalone preview’s file parents it in place', async () => {
    const to = await file('b.md', '# B on disk\n');
    await attach('v2', to);
    coord.register(meta('ed1', null), '# new\n');
    push.clear();

    await coord.save({ panelId: 'ed1', absPath: to });

    expect(lastFor('v2')).toMatchObject({ filePath: to, parent: { panelId: 'ed1' } });
  });
});

describe('content is scheduled; dirty and title are immediate (FR-022, FR-031, FR-040, FR-060, FR-060a)', () => {
  it('content settles the update delay after the last change, dirty goes at once with content: null', async () => {
    const a = await file('a.md', 'v0\n');
    await openEditor('ed1', a);
    await attach('v1', a);
    push.clear();

    editDocument(coord, meta('ed1', a), 'v1\n');

    expect(updatesFor('v1')).toEqual([expect.objectContaining({ dirty: true, content: null })]);
    clock.advance(299);
    expect(updatesFor('v1').filter((u) => u.content !== null)).toEqual([]);
    clock.advance(1);
    expect(updatesFor('v1').filter((u) => u.content !== null)).toEqual([
      expect.objectContaining({ content: { kind: 'text', text: 'v1\n' }, dirty: true }),
    ]);
  });

  it('continuous typing still shows a change within the maximum wait', async () => {
    const a = await file('a.md', 'v0\n');
    await openEditor('ed1', a);
    await attach('v1', a);
    push.clear();

    for (let i = 1; i <= 5; i++) {
      editDocument(coord, meta('ed1', a), `v${i}\n`);
      clock.advance(200);
    }

    const shown = updatesFor('v1').filter((u) => u.content !== null);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.content).toEqual({ kind: 'text', text: 'v5\n' });
  });

  const shownTexts = (): string[] =>
    updatesFor('v1').flatMap((u) => (u.content?.kind === 'text' ? [u.content.text] : []));

  function changeTiming(delayMs: number, maxWaitMs: number): void {
    settings.current = structuredClone(settings.current);
    settings.current.editor.previews.updateDelayMs = delayMs;
    settings.current.editor.previews.maxWaitMs = maxWaitMs;
  }

  it('a settings change after a burst has settled applies to the next burst', async () => {
    const a = await file('a.md', 'v0\n');
    await openEditor('ed1', a);
    await attach('v1', a);
    // A first burst on the shipped timing builds the run's scheduler…
    editDocument(coord, meta('ed1', a), 'v1\n');
    clock.advance(300);
    expect(shownTexts()).toEqual(['v1\n']);

    // …so this change can only land if the scheduler is rebuilt from the live settings.
    changeTiming(50, 50);
    editDocument(coord, meta('ed1', a), 'v2\n');
    clock.advance(49);
    expect(shownTexts()).toEqual(['v1\n']);
    clock.advance(1);
    expect(shownTexts()).toEqual(['v1\n', 'v2\n']);
  });

  it('a settings change during a pending burst leaves that burst on its old timing', async () => {
    const a = await file('a.md', 'v0\n');
    await openEditor('ed1', a);
    await attach('v1', a);

    editDocument(coord, meta('ed1', a), 'v1\n');
    changeTiming(50, 50);
    // A change INSIDE the pending burst is what would rebuild the scheduler, if anything did.
    clock.advance(10);
    editDocument(coord, meta('ed1', a), 'v1b\n');
    clock.advance(50);
    expect(shownTexts()).toEqual([]);
    clock.advance(250); // t = 310: the old 300 ms delay after the last change
    expect(shownTexts()).toEqual(['v1b\n']);

    // The next burst takes the new timing.
    editDocument(coord, meta('ed1', a), 'v2\n');
    clock.advance(50);
    expect(shownTexts()).toEqual(['v1b\n', 'v2\n']);
  });

  it('refresh on a parented preview pushes the document’s current text at once, ignoring the delay (FR-028)', async () => {
    const a = await file('a.md', 'v0\n');
    await openEditor('ed1', a);
    await attach('v1', a);
    editDocument(coord, meta('ed1', a), 'typed\n');
    push.clear();

    const { update } = await previews.refresh('v1');

    expect(update).toMatchObject({ content: { kind: 'text', text: 'typed\n' }, dirty: true });
    expect(push.updates).toEqual([{ to: VIEWER, update }]);
    clock.advance(1000);
    expect(push.updates).toHaveLength(1);
  });

  it('revisions increase on every update', async () => {
    const a = await file('a.md', 'v0\n');
    await openEditor('ed1', a);
    const first = await attach('v1', a);

    editDocument(coord, meta('ed1', a), 'v1\n');
    clock.advance(300);
    previews.publishEditorTitle('ed1', 'Renamed');

    const revisions = [first.revision, ...updatesFor('v1').map((u) => u.revision)];
    expect(revisions).toEqual([...revisions].sort((x, y) => x - y));
    expect(new Set(revisions).size).toBe(revisions.length);
  });

  it('the forwarded parent title follows publishEditorTitle, immediately and with content: null', async () => {
    const a = await file('a.md', '# A\n');
    await openEditor('ed1', a);
    await attach('v1', a);
    push.clear();

    previews.publishEditorTitle('ed1', 'My notes');

    expect(updatesFor('v1')).toEqual([
      expect.objectContaining({ parent: { panelId: 'ed1', title: 'My notes' }, content: null }),
    ]);
    // An unchanged title is not news.
    previews.publishEditorTitle('ed1', 'My notes');
    expect(updatesFor('v1')).toHaveLength(1);
  });

  it('a title published before the preview attached is the one it starts with', async () => {
    const a = await file('a.md', '# A\n');
    await openEditor('ed1', a);
    previews.publishEditorTitle('ed1', 'Early');

    expect((await attach('v1', a)).parent).toEqual({ panelId: 'ed1', title: 'Early' });
  });
});

describe('nothing the service does changes the document (FR-041)', () => {
  it('attach, refresh, a settle, a title and destroy leave text, version and dirty exactly as they were', async () => {
    const a = await file('a.md', 'v0\n');
    await openEditor('ed1', a);
    editDocument(coord, meta('ed1', a), 'unsaved\n');
    const before = coord.getContent('ed1');

    await attach('v1', a);
    clock.advance(2000);
    await previews.refresh('v1');
    previews.publishEditorTitle('ed1', 'x');
    previews.destroyed('v1');

    expect(coord.getContent('ed1')).toEqual(before);
    expect(await readFile(a, 'utf8')).toBe('v0\n');
  });
});
