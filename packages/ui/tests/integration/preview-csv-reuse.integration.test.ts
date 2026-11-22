import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_HISTORY, SHIPPED_PREVIEW_PROVIDERS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService, type PreviewHistoryHooks } from '../../src/main/preview-service.js';
import { CsvGridService, gridDocumentIdFor } from '../../src/main/csv-grid-service.js';
import { NavigationHistoryService } from '../../src/main/navigation-history-service.js';
import { lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';

/**
 * 073 T035 — the CSV provider's Last Preview Panel reuse (FR-060; 047 FR-010 – FR-016), reported in
 * manual testing (MT-06): with one CSV Preview Editor showing `a.csv`, opening `b.csv` moves it there, and
 * opening `a.csv` again must move it BACK, as a Markdown preview does — never place a second panel.
 *
 * Layer: integration — the decision is `PreviewService.open`'s, over the real editor coordinator whose
 * document registry the grid writes into (`CsvGridService`), wired as `main.ts` wires them.
 */

const fs = new NodeFileSystem(async () => {});
const REQUESTER = 3;

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let previews: PreviewService;
let grid: CsvGridService;

const history: PreviewHistoryHooks = {
  attach: () => EMPTY_HISTORY,
  get: () => undefined,
  rewriteCurrent: () => {},
  purge: () => {},
  recordOpen: () => {},
  moveTo: () => false,
  setCurrentViewState: () => {},
  recordJump: () => {},
};

async function file(name: string, text: string): Promise<string> {
  const path = join(root, name);
  await writeFile(path, text);
  return path;
}

const open = (absPath: string, reusePanelId: string | null, unsavedChoice?: 'save' | 'discard' | 'new') =>
  previews.open(REQUESTER, {
    absPath,
    projectId: 'P',
    hasParentLocally: false,
    target: { mode: 'lastActive', reusePanelId },
    ...(unsavedChoice !== undefined ? { unsavedChoice } : {}),
  });

async function attach(panelId: string, filePath: string): Promise<void> {
  const res = await previews.attach(REQUESTER, { panelId, projectId: 'P', filePath });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-csv-reuse-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-csv-reuse-rec-'));
  const settings = liveSettings();
  const relay = lateListener();
  const service = new EditorService(fs, settings.get);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
  });
  const gridRef: { current?: CsvGridService } = {};
  previews = new PreviewService({
    documents: coord,
    reader: service,
    fs,
    fileWatcher: manualWatcher(),
    settings: settings.get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'P' ? root : undefined),
    push: recordingPush(),
    windows: recordingWindows(1),
    history,
    runEnded: (panelId: string) => gridRef.current?.release(panelId),
    gridDocumentLeft: (panelId: string) => gridRef.current?.release(panelId),
    saveGridDocument: async (panelId: string) => (await gridRef.current?.save(panelId))?.ok === true,
  } as ConstructorParameters<typeof PreviewService>[0]);
  relay.bind(previews);
  grid = new CsvGridService(coord, previews);
  gridRef.current = grid;
});

afterEach(async () => {
  previews.destroyed('v1');
  coord.destroy(gridDocumentIdFor('v1'));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('Last Preview Panel reuse for a CSV (073 T035, FR-060)', () => {
  it('moves the one panel from a.csv to b.csv and back again', async () => {
    const a = await file('a.csv', 'x,y\n1,2\n');
    const b = await file('b.csv', 'p,q\n3,4\n');
    await attach('v1', a);

    expect(await open(b, 'v1')).toEqual({ kind: 'navigated', panelId: 'v1' });
    expect(await open(a, 'v1')).toEqual({ kind: 'navigated', panelId: 'v1' });
    expect(previews.run('v1')?.filePath).toBe(a);
  });

  const setB2 = (value: string) => ({ kind: 'setCells', cells: [{ row: 1, col: 1, value }] });

  it('after an edit that was saved, moves to b.csv, releases a.csv’s grid document, and moves back', async () => {
    const a = await file('a.csv', 'x,y\n1,2\n');
    const b = await file('b.csv', 'p,q\n3,4\n');
    await attach('v1', a);
    expect(await grid.edit({ panelId: 'v1', filePath: a, operation: setB2('two') })).toEqual({ ok: true, dirty: true });
    expect((await grid.save('v1')).ok).toBe(true);

    expect(await open(b, 'v1')).toEqual({ kind: 'navigated', panelId: 'v1' });
    expect(coord.documentFor(a)).toBeNull();
    expect(await open(a, 'v1')).toEqual({ kind: 'navigated', panelId: 'v1' });
    expect(previews.run('v1')?.filePath).toBe(a);
  });

  describe('opening another CSV over unsaved grid edits asks first (FR-033b)', () => {
    const dirtyA = async () => {
      const a = await file('a.csv', 'x,y\n1,2\n');
      const b = await file('b.csv', 'p,q\n3,4\n');
      await attach('v1', a);
      expect(await grid.edit({ panelId: 'v1', filePath: a, operation: setB2('two') })).toEqual({ ok: true, dirty: true });
      return { a, b };
    };

    it('answers with the decision to take, and moves nothing and loses nothing until it is taken', async () => {
      const { a, b } = await dirtyA();
      expect(await open(b, 'v1')).toEqual({ kind: 'unsavedGrid', panelId: 'v1' });
      expect(previews.run('v1')?.filePath).toBe(a);
      expect(coord.getContent(gridDocumentIdFor('v1'))).toMatchObject({ text: 'x,y\n1,two\n', dirty: true });
      expect(await readFile(a, 'utf8')).toBe('x,y\n1,2\n');
    });

    it('Open in new preview: the edits stay in their panel and the open places a new one', async () => {
      const { a, b } = await dirtyA();
      expect(await open(b, 'v1', 'new')).toMatchObject({ kind: 'placeLocally', besidePanelId: null });
      expect(previews.run('v1')?.filePath).toBe(a);
      expect(coord.getContent(gridDocumentIdFor('v1'))).toMatchObject({ text: 'x,y\n1,two\n', dirty: true });
    });

    it('Save & open: saves the edits to a.csv, then moves the same panel to b.csv', async () => {
      const { a, b } = await dirtyA();
      expect(await open(b, 'v1', 'save')).toEqual({ kind: 'navigated', panelId: 'v1' });
      expect(await readFile(a, 'utf8')).toBe('x,y\n1,two\n');
      expect(previews.run('v1')?.filePath).toBe(b);
      expect(coord.documentFor(a)).toBeNull();
    });

    it('Discard & open: drops the edits, leaves a.csv as it was, and moves the same panel to b.csv', async () => {
      const { a, b } = await dirtyA();
      expect(await open(b, 'v1', 'discard')).toEqual({ kind: 'navigated', panelId: 'v1' });
      expect(await readFile(a, 'utf8')).toBe('x,y\n1,2\n');
      expect(previews.run('v1')?.filePath).toBe(b);
      expect(coord.documentFor(a)).toBeNull();
    });

    it('a clean panel is still reused without asking', async () => {
      const a = await file('a.csv', 'x,y\n1,2\n');
      const b = await file('b.csv', 'p,q\n3,4\n');
      await attach('v1', a);
      expect(await open(b, 'v1')).toEqual({ kind: 'navigated', panelId: 'v1' });
    });

  });

  it('a link or drop onto unsaved grid edits is handed back for an ordinary open (FR-033)', async () => {
    const a = await file('a.csv', 'x,y\n1,2\n');
    const b = await file('b.csv', 'p,q\n3,4\n');
    await attach('v1', a);
    await grid.edit({ panelId: 'v1', filePath: a, operation: setB2('two') });

    expect(await previews.navigate(REQUESTER, { panelId: 'v1', target: { absPath: b }, intent: { kind: 'drop' } })).toEqual({
      kind: 'reroute',
    });
    expect(previews.run('v1')?.filePath).toBe(a);
  });
});

/**
 * 073 T078 (MT-06) — open a.csv in the Last Preview Panel, open its editor from the status bar (Open in Editor),
 * go to another CSV, then back to a.csv: ONE CSV preview, never a second one beside the editor. Driven through
 * a REAL `NavigationHistoryService`, so the Back reading of "go back" is the same run's history step.
 */
describe('Last Preview Panel reuse once the CSV has an editor (073 T078, FR-060; 047 FR-016a)', () => {
  let hist: NavigationHistoryService;

  beforeEach(() => {
    hist = new NavigationHistoryService({ cap: () => 50, broadcastChanged: () => {} });
    const settings = liveSettings();
    const relay = lateListener();
    const service = new EditorService(fs, settings.get);
    coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
      recoveryDebounceMs: 10_000,
      relaySync: () => {},
      persistUndoHistory: () => false,
      documentLifecycle: relay,
      history: hist,
    });
    const gridRef: { current?: CsvGridService } = {};
    previews = new PreviewService({
      documents: coord,
      reader: service,
      fs,
      fileWatcher: manualWatcher(),
      settings: settings.get,
      registry: SHIPPED_PREVIEW_PROVIDERS,
      projectRoot: async (id) => (id === 'P' ? root : undefined),
      push: recordingPush(),
      windows: recordingWindows(1),
      history: hist,
      runEnded: (panelId: string) => gridRef.current?.release(panelId),
      gridDocumentLeft: (panelId: string) => gridRef.current?.release(panelId),
      saveGridDocument: async (panelId: string) => (await gridRef.current?.save(panelId))?.ok === true,
    } as ConstructorParameters<typeof PreviewService>[0]);
    relay.bind(previews);
    grid = new CsvGridService(coord, previews);
    gridRef.current = grid;
  });

  afterEach(() => coord.destroy('ed1'));

  const setB2 = (value: string) => ({ kind: 'setCells', cells: [{ row: 1, col: 1, value }] });

  /** a.csv in the Last Preview Panel v1, then Open in Editor from its status bar: ed1 holds a.csv's document. */
  async function previewThenEditor(): Promise<{ a: string; b: string }> {
    const a = await file('a.csv', 'x,y\n1,2\n');
    const b = await file('b.csv', 'p,q\n3,4\n');
    await attach('v1', a);
    const loaded = await coord.load({
      panelId: 'ed1',
      windowId: String(REQUESTER),
      ownerKind: 'project',
      ownerProjectId: 'P',
      ownerRoot: root,
      allProjectRoots: [root],
      tabId: 't1',
      absPath: a,
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'lf',
    });
    if (!loaded.ok) throw new Error(`editor load refused: ${loaded.reason}`);
    expect((await previews.refresh('v1')).update?.parent).toMatchObject({ panelId: 'ed1' });
    return { a, b };
  }

  // `hasParentLocally` is what the renderer sends: this window's layout holds ed1 for a.csv, none for b.csv.
  const openFrom = (absPath: string, hasParentLocally: boolean) =>
    previews.open(REQUESTER, { absPath, projectId: 'P', hasParentLocally, target: { mode: 'lastActive', reusePanelId: 'v1' } });

  it('reopening a.csv while the preview still shows it (the editor active) focuses that preview', async () => {
    const { a } = await previewThenEditor();
    expect(await openFrom(a, true)).toEqual({ kind: 'focused', panelId: 'v1' });
  });

  it('a.csv → b.csv → a.csv again from Files & Folders: the one preview moves back, re-paired with the editor', async () => {
    const { a, b } = await previewThenEditor();
    expect(await openFrom(b, false)).toEqual({ kind: 'navigated', panelId: 'v1' });

    expect(await openFrom(a, true)).toEqual({ kind: 'navigated', panelId: 'v1' });
    expect(previews.run('v1')?.filePath).toBe(a);
    expect((await previews.refresh('v1')).update?.parent).toMatchObject({ panelId: 'ed1' });
  });

  it('a.csv → b.csv, then Back: the one preview steps back to a.csv, re-paired with the editor', async () => {
    const { a, b } = await previewThenEditor();
    expect(await openFrom(b, false)).toEqual({ kind: 'navigated', panelId: 'v1' });

    const back = await previews.navigate(REQUESTER, { panelId: 'v1', target: { absPath: a }, intent: { kind: 'history', index: 0 } });
    expect(back).toMatchObject({ kind: 'shown' });
    expect(previews.run('v1')?.filePath).toBe(a);
    expect((await previews.refresh('v1')).update?.parent).toMatchObject({ panelId: 'ed1' });
    // …and opening a.csv again now only focuses it.
    expect(await openFrom(a, true)).toEqual({ kind: 'focused', panelId: 'v1' });
  });

  it('unsaved grid edits on b.csv are asked about first; Open in new preview keeps them and places a.csv beside its editor', async () => {
    const { a, b } = await previewThenEditor();
    expect(await openFrom(b, false)).toEqual({ kind: 'navigated', panelId: 'v1' });
    expect(await grid.edit({ panelId: 'v1', filePath: b, operation: setB2('four') })).toEqual({ ok: true, dirty: true });

    expect(await openFrom(a, true)).toEqual({ kind: 'unsavedGrid', panelId: 'v1' });
    const res = await previews.open(REQUESTER, {
      absPath: a,
      projectId: 'P',
      hasParentLocally: true,
      target: { mode: 'lastActive', reusePanelId: 'v1' },
      unsavedChoice: 'new',
    });
    expect(res).toMatchObject({ kind: 'placeLocally', besidePanelId: 'ed1' });
    expect(previews.run('v1')?.filePath).toBe(b);
    expect(coord.getContent(gridDocumentIdFor('v1'))).toMatchObject({ text: 'p,q\n3,four\n', dirty: true });
  });

  it('a New Preview Panel request still places a second preview beside the editor (047 FR-014)', async () => {
    const { a, b } = await previewThenEditor();
    expect(await openFrom(b, false)).toEqual({ kind: 'navigated', panelId: 'v1' });
    const res = await previews.open(REQUESTER, { absPath: a, projectId: 'P', hasParentLocally: true, target: { mode: 'new', reusePanelId: null } });
    expect(res).toMatchObject({ kind: 'placeLocally', besidePanelId: 'ed1' });
  });
});

describe('a CSV preview is linked to its text editor (073 FR-033c, 044 FR-013)', () => {
  it('opened from a CSV editor it is placed beside it and attaches as its child, so the two can scroll in step', async () => {
    const a = await file('a.csv', 'x,y\n1,2\n');
    await coord.load({
      panelId: 'ed1',
      windowId: String(REQUESTER),
      ownerKind: 'project',
      ownerProjectId: 'P',
      ownerRoot: root,
      allProjectRoots: [root],
      tabId: 't1',
      absPath: a,
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'lf',
    });
    const res = await previews.open(REQUESTER, { absPath: a, projectId: 'P', hasParentLocally: true });
    expect(res).toMatchObject({ kind: 'placeLocally', besidePanelId: 'ed1' });
    const attached = await previews.attach(REQUESTER, {
      panelId: 'v1',
      projectId: 'P',
      filePath: a,
      ...(res.kind === 'placeLocally' ? { reservation: res.reservation } : {}),
    });
    expect(attached).toMatchObject({ ok: true, update: { parent: { panelId: 'ed1' } } });
    coord.destroy('ed1');
  });
});

describe('Save As from the CSV Preview Editor (073 FR-035a)', () => {
  const setB2 = (value: string) => ({ kind: 'setCells', cells: [{ row: 1, col: 1, value }] });

  it('writes the edited document to the new path, leaves the old file, and the preview follows', async () => {
    const a = await file('a.csv', 'x,y\n1,2\n');
    const target = join(root, 'copy.csv');
    await attach('v1', a);
    expect(await grid.edit({ panelId: 'v1', filePath: a, operation: setB2('two') })).toEqual({ ok: true, dirty: true });

    expect(await grid.save('v1', target)).toMatchObject({ ok: true });

    expect(await readFile(target, 'utf8')).toBe('x,y\n1,two\n');
    expect(await readFile(a, 'utf8')).toBe('x,y\n1,2\n');
    expect(previews.run('v1')?.filePath).toBe(target);
    expect(coord.getContent(gridDocumentIdFor('v1'))).toMatchObject({ text: 'x,y\n1,two\n', dirty: false });
  });

  it('with nothing edited yet, opens the document and writes the file as it is to the new path', async () => {
    const a = await file('a.csv', 'x,y\n1,2\n');
    const target = join(root, 'plain-copy.csv');
    await attach('v1', a);
    expect(coord.documentFor(a)).toBeNull();

    expect(await grid.save('v1', target)).toMatchObject({ ok: true });

    expect(await readFile(target, 'utf8')).toBe('x,y\n1,2\n');
    expect(previews.run('v1')?.filePath).toBe(target);
    expect(coord.getContent(gridDocumentIdFor('v1'))).toMatchObject({ dirty: false });
  });

  it('a Save As onto a path outside the project is refused and changes nothing', async () => {
    const a = await file('a.csv', 'x,y\n1,2\n');
    await attach('v1', a);
    await grid.edit({ panelId: 'v1', filePath: a, operation: setB2('two') });
    const outside = join(recoveryDir, 'elsewhere.csv');

    expect(await grid.save('v1', outside)).toMatchObject({ ok: false });
    expect(previews.run('v1')?.filePath).toBe(a);
    expect(coord.getContent(gridDocumentIdFor('v1'))).toMatchObject({ dirty: true });
  });
});

/*
 * #696 — a preview whose file is gone unloads, but the CSV Preview Editor IS the editor of its file: it keeps its
 * buffer when the file goes, as an editor does (073, *A file deleted under an open panel*), so an unsaved grid
 * edit is never taken off screen. Saving it re-creates the file.
 */
describe('a CSV Preview Editor whose file is deleted keeps its grid (#696, 073)', () => {
  it('the unsaved edit stays on screen with no deleted notice, and a save re-creates the file', async () => {
    const a = await file('a.csv', 'x,y\n1,2\n');
    await attach('v1', a);
    expect(await grid.edit({ panelId: 'v1', filePath: a, operation: { kind: 'setCells', cells: [{ row: 1, col: 1, value: 'mine' }] } }))
      .toEqual({ ok: true, dirty: true });

    await unlink(a);
    coord.markDeleted([a]);

    const { update } = await previews.refresh('v1');
    expect(update).toMatchObject({ notice: null, dirty: true, content: { kind: 'text', text: 'x,y\n1,mine\n' } });
    expect((await grid.save('v1')).ok).toBe(true);
    expect(await readFile(a, 'utf8')).toBe('x,y\n1,mine\n');
  });
});

// Maintainer report 2026-11-22 — grid first, then its editor, then a grid edit: closing the editor put the grid back
// on the disk, clean, and the edit was gone with no prompt. The grid must keep the unsaved document (Principle XI).
describe('closing the editor of a document the grid follows', () => {
  const setB2 = (value: string) => ({ kind: 'setCells', cells: [{ row: 1, col: 1, value }] });
  const editorAt = (absPath: string) => ({
    panelId: 'ed1',
    windowId: 'w1',
    ownerKind: 'project' as const,
    ownerProjectId: 'P',
    ownerRoot: root,
    allProjectRoots: [root],
    tabId: 't1',
    absPath,
    encoding: 'utf8' as const,
    hasBom: false,
    lineEnding: 'lf' as const,
  });

  it('a grid opened before its editor keeps an unsaved grid edit when the editor closes, and now owns it', async () => {
    const a = await file('a.csv', 'x,y\n1,2\n');
    await attach('v1', a);
    await coord.load(editorAt(a));
    expect(await grid.edit({ panelId: 'v1', filePath: a, operation: setB2('two') })).toEqual({ ok: true, dirty: true });

    coord.destroy('ed1');

    // What the panel is told: still the edited text, still unsaved, and now its own document (the close prompt's).
    const { update } = await previews.refresh('v1');
    expect(update).toMatchObject({ dirty: true, ownsDocument: true, content: { kind: 'text', text: 'x,y\n1,two\n' } });
    expect(coord.documentFor(a)?.panelId).toBe(gridDocumentIdFor('v1'));
    expect(await readFile(a, 'utf8')).toBe('x,y\n1,2\n');
  });

  it('a clean document closes with its editor, and the grid goes back to the file', async () => {
    const a = await file('a.csv', 'x,y\n1,2\n');
    await attach('v1', a);
    await coord.load(editorAt(a));
    coord.destroy('ed1');
    expect(coord.documentFor(a)).toBeNull();
    const { update } = await previews.refresh('v1');
    expect(update).toMatchObject({ dirty: false, content: { kind: 'text', text: 'x,y\n1,2\n' } });
    expect(update?.ownsDocument).not.toBe(true);
  });
});
