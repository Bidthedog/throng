import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
