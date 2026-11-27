/**
 * 073 T015 / T016 — `CsvGridService` against a real `EditorCoordinator` and a real disk (FR-030, FR-033,
 * FR-035, FR-045, FR-047; research R1, R2; contracts/preview-ipc-073.md).
 *
 * Layer: integration — "nothing is written until Save", "one undo step per grid action", the grid
 * document an editor later joins and inherits, and the bytes a save writes are properties of the real
 * authority, its one-buffer registry and its save path. The operation → text-change rules are unit-tested
 * in core (`csv-edit.test.ts`, `csv-grid-operation.test.ts`).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { CsvGridService, gridDocumentIdFor, type CsvGridRuns } from '../../src/main/csv-grid-service.js';

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let service: CsvGridService;
let file: string;
let flushed: string[];

const PREVIEW = 'pv1';
const GRID_DOC = gridDocumentIdFor(PREVIEW);

function editorMeta(panelId: string, absPath: string): DocMeta {
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

function runs(): CsvGridRuns {
  return {
    gridRun: (panelId) =>
      panelId === PREVIEW
        ? {
            projectId: 'A',
            projectRoot: root,
            filePath: file,
            editable: true,
            movedOut: false,
            windowId: 'w1',
            documentPanelId: coord.documentFor(file)?.panelId ?? null,
          }
        : undefined,
    flush: (panelId) => flushed.push(panelId),
  };
}

const setB2 = (value: string) => ({ kind: 'setCells', cells: [{ row: 1, col: 1, value }] });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-csv-grid-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-csv-grid-rec-'));
  coord = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: () => {},
    persistUndoHistory: () => true,
  });
  file = join(root, 'data.csv');
  flushed = [];
  service = new CsvGridService(coord, runs());
});

afterEach(async () => {
  coord.destroy(GRID_DOC);
  coord.destroy('ed1');
  for (const dir of [root, recoveryDir]) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('a grid edit with no editor open', () => {
  it('opens a grid document, leaves the file untouched and the document dirty, and is not an editor', async () => {
    await writeFile(file, 'a,"b"\r\n1,2\r\n');
    const res = await service.edit({ panelId: PREVIEW, filePath: file, operation: setB2('two') });
    expect(res).toEqual({ ok: true, dirty: true });
    expect(await readFile(file, 'utf8')).toBe('a,"b"\r\n1,2\r\n');
    expect(coord.documentFor(file)?.panelId).toBe(GRID_DOC);
    expect(coord.getContent(GRID_DOC)?.text).toBe('a,"b"\n1,two\n');
    // FR-025 still reads true for editors: the grid document is no editor panel.
    expect(coord.isOpen(file)).toBe(false);
    expect(await coord.openInto(file)).toEqual({ action: 'open' });
    expect(flushed).toEqual([PREVIEW]);
  });

  it('undoes one grid action in one step, back to clean', async () => {
    await writeFile(file, 'a,b\n1,2\n');
    await service.edit({ panelId: PREVIEW, filePath: file, operation: { kind: 'insertRows', at: 1, count: 1 } });
    await service.edit({ panelId: PREVIEW, filePath: file, operation: setB2('x') });
    expect(coord.getContent(GRID_DOC)?.text).toBe('a,b\n,x\n1,2\n');
    expect(service.undo(PREVIEW)).toEqual({ ok: true });
    expect(coord.getContent(GRID_DOC)?.text).toBe('a,b\n,\n1,2\n');
    service.undo(PREVIEW);
    expect(coord.getContent(GRID_DOC)).toMatchObject({ text: 'a,b\n1,2\n', dirty: false });
    service.redo(PREVIEW);
    expect(coord.getContent(GRID_DOC)?.text).toBe('a,b\n,\n1,2\n');
  });

  // SC-006 (convergence T094) — twenty grid edits, then twenty undos, give back the original text byte for byte, clean.
  it('twenty mixed grid edits and twenty undos return the document to its original text, clean (SC-006)', async () => {
    const original = 'name,"note, with comma",n\r\n"Ann ""A""",x,1\r\nBob,"two\nlines",2\r\n';
    await writeFile(file, original);
    const ops = [
      setB2('one'),
      { kind: 'insertRows', at: 1, count: 1 },
      { kind: 'setCells', cells: [{ row: 0, col: 0, value: 'he said "hi"' }] },
      { kind: 'insertColumn', at: 1 },
      { kind: 'setCells', cells: [{ row: 2, col: 1, value: 'a,b' }] },
      { kind: 'deleteRows', from: 1, count: 1 },
      { kind: 'setCells', cells: [{ row: 1, col: 2, value: 'line\nbreak' }] },
      { kind: 'insertRows', at: 3, count: 2, values: [['p', 'q'], ['r', 's']] },
      { kind: 'setCells', cells: [{ row: 3, col: 0, value: '' }, { row: 3, col: 1, value: 'z' }] },
      { kind: 'insertColumn', at: 0, count: 1, columns: [['c0', 'c1', 'c2', 'c3', 'c4', 'c5']] },
      setB2('two'),
      { kind: 'deleteRows', from: 4, count: 1 },
      { kind: 'setCells', cells: [{ row: 0, col: 3, value: 'semi;colon' }] },
      { kind: 'insertRows', at: 0, count: 1 },
      { kind: 'setCells', cells: [{ row: 0, col: 0, value: 'top' }] },
      { kind: 'insertColumn', at: 2 },
      setB2('three'),
      { kind: 'setCells', cells: [{ row: 2, col: 2, value: '"quoted"' }] },
      { kind: 'deleteRows', from: 0, count: 1 },
      setB2('four'),
    ];
    expect(ops).toHaveLength(20);
    for (const operation of ops) {
      expect(await service.edit({ panelId: PREVIEW, filePath: file, operation })).toMatchObject({ ok: true });
    }
    expect(coord.getContent(GRID_DOC)?.text).not.toBe(original.replace(/\r\n/g, '\n'));
    for (let i = 0; i < 20; i++) expect(service.undo(PREVIEW)).toEqual({ ok: true });
    const back = coord.getContent(GRID_DOC);
    // The document holds LF-normalised text; the file's CRLF endings are what a save writes back.
    expect(back?.text).toBe(original.replace(/\r\n/g, '\n'));
    expect(back?.dirty).toBe(false);
  });

  it('inserts copied rows, or copied columns, with their values in one undo step back to the original text (FR-038a)', async () => {
    await writeFile(file, 'a;b\n1;2\n');
    const rows = await service.edit({
      panelId: PREVIEW,
      filePath: file,
      operation: { kind: 'insertRows', at: 1, count: 2, values: [['x;y', 'z'], ['p', 'q']] },
    });
    expect(rows).toEqual({ ok: true, dirty: true });
    expect(coord.getContent(GRID_DOC)?.text).toBe('a;b\n"x;y";z\np;q\n1;2\n');
    expect(service.undo(PREVIEW)).toEqual({ ok: true });
    expect(coord.getContent(GRID_DOC)).toMatchObject({ text: 'a;b\n1;2\n', dirty: false });

    const columns = await service.edit({
      panelId: PREVIEW,
      filePath: file,
      operation: { kind: 'insertColumn', at: 1, count: 2, columns: [['m', 'n'], ['o', 'p']] },
    });
    expect(columns).toEqual({ ok: true, dirty: true });
    expect(coord.getContent(GRID_DOC)?.text).toBe('a;m;o;b\n1;n;p;2\n');
    expect(service.undo(PREVIEW)).toEqual({ ok: true });
    expect(coord.getContent(GRID_DOC)).toMatchObject({ text: 'a;b\n1;2\n', dirty: false });
  });

  it('saves only the edited field, keeping the file’s quoting and CRLF endings (FR-045, FR-047)', async () => {
    await writeFile(file, '"id","name"\r\n"1","Ann"\r\n"2","Bob"\r\n');
    await service.edit({ panelId: PREVIEW, filePath: file, operation: setB2('Ann, A') });
    const saved = await service.save(PREVIEW);
    expect(saved.ok).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('"id","name"\r\n"1","Ann, A"\r\n"2","Bob"\r\n');
    expect(coord.getContent(GRID_DOC)?.dirty).toBe(false);
  });

  it('deletes a column as one undo step, dirty, and saves only the removed fields (T4)', async () => {
    await writeFile(file, '"id","name",n\r\n"1","Ann",x\r\n');
    expect(await service.edit({ panelId: PREVIEW, filePath: file, operation: { kind: 'deleteColumns', from: 1, count: 1 } })).toEqual({ ok: true, dirty: true });
    expect(coord.getContent(GRID_DOC)?.text).toBe('"id",n\n"1",x\n');
    expect(service.undo(PREVIEW)).toEqual({ ok: true });
    expect(coord.getContent(GRID_DOC)).toMatchObject({ text: '"id","name",n\n"1","Ann",x\n', dirty: false });
    service.redo(PREVIEW);
    expect((await service.save(PREVIEW)).ok).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('"id",n\r\n"1",x\r\n');
  });

  it('inserts a row and a column into an empty file, dirty, and saves empty fields (T5)', async () => {
    await writeFile(file, '');
    expect(await service.edit({ panelId: PREVIEW, filePath: file, operation: { kind: 'insertRows', at: 0, count: 1 } })).toEqual({ ok: true, dirty: true });
    await service.edit({ panelId: PREVIEW, filePath: file, operation: { kind: 'insertColumn', at: 1 } });
    expect(coord.getContent(GRID_DOC)?.text).toBe(',\n');
    expect(service.undo(PREVIEW)).toEqual({ ok: true });
    expect(coord.getContent(GRID_DOC)?.text).toBe('\n');
    service.redo(PREVIEW);
    expect((await service.save(PREVIEW)).ok).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(',\n');
  });

  it('refuses every operation on a document with an unterminated quote, naming the line', async () => {
    await writeFile(file, 'a,b\n1,"open\n');
    expect(await service.edit({ panelId: PREVIEW, filePath: file, operation: setB2('x') })).toEqual({
      ok: false,
      reason: 'malformed',
      line: 2,
    });
  });

  it('makes no undo step and stays clean for an edit that changes nothing', async () => {
    await writeFile(file, 'a,b\n1,2\n');
    expect(await service.edit({ panelId: PREVIEW, filePath: file, operation: setB2('2') })).toEqual({ ok: true, dirty: false });
  });

  it('refuses a malformed operation and a stale file path', async () => {
    await writeFile(file, 'a\n');
    expect(await service.edit({ panelId: PREVIEW, filePath: file, operation: { kind: 'sort' } })).toEqual({ ok: false, reason: 'invalid' });
    expect(await service.edit({ panelId: PREVIEW, filePath: join(root, 'other.csv'), operation: setB2('x') })).toEqual({
      ok: false,
      reason: 'changed',
    });
  });
});

describe('the grid document and an editor (Principle XI)', () => {
  it('an editor opened later joins it as a link, and inherits it when the preview closes', async () => {
    await writeFile(file, 'a,b\n1,2\n');
    await service.edit({ panelId: PREVIEW, filePath: file, operation: setB2('x') });
    const loaded = await coord.load({ ...editorMeta('ed1', file) });
    expect(loaded).toMatchObject({ ok: true, linkedTo: GRID_DOC, text: 'a,b\n1,x\n' });
    expect(coord.isOpen(file)).toBe(true);
    expect(await coord.openInto(file)).toMatchObject({ action: 'focus', panelId: 'ed1' });

    service.release(PREVIEW);
    expect(coord.documentFor(file)?.panelId).toBe('ed1');
    expect(coord.getContent('ed1')).toMatchObject({ text: 'a,b\n1,x\n', dirty: true });
  });

  it('edits the editor’s own document when an editor already holds the file', async () => {
    await writeFile(file, 'a,b\n1,2\n');
    await coord.load({ ...editorMeta('ed1', file) });
    await service.edit({ panelId: PREVIEW, filePath: file, operation: setB2('y') });
    expect(coord.documentFor(file)?.panelId).toBe('ed1');
    expect(coord.getContent('ed1')).toMatchObject({ text: 'a,b\n1,y\n', dirty: true });
    // The preview never owned it, so closing the preview leaves the editor's document alone.
    service.release(PREVIEW);
    expect(coord.getContent('ed1')?.dirty).toBe(true);
  });

  // #703 — grid opened first, then its editor, then an edit in the grid: closing the editor lost the edit,
  // with no prompt, because the grid only FOLLOWED the editor's document and the document closed with it.
  it('closing the editor leaves its unsaved document with a grid that still shows the file (#703)', async () => {
    await writeFile(file, 'a,b\n1,2\n');
    coord = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
      recoveryDebounceMs: 10,
      relaySync: () => {},
      persistUndoHistory: () => true,
      documentLifecycle: {
        registered: () => {},
        unregistered: () => {},
        repointed: () => {},
        changed: () => {},
        dirtyChanged: () => {},
        // The preview service's answer: the CSV Preview Editor following this document takes it over.
        gridHeirFor: (documentPanelId: string) => (documentPanelId === 'ed1' ? GRID_DOC : undefined),
      },
    });
    service = new CsvGridService(coord, runs());
    await coord.load({ ...editorMeta('ed1', file) });
    await service.edit({ panelId: PREVIEW, filePath: file, operation: setB2('y') });
    expect(coord.getContent('ed1')).toMatchObject({ text: 'a,b\n1,y\n', dirty: true });

    coord.destroy('ed1');

    expect(coord.documentFor(file)?.panelId).toBe(GRID_DOC);
    expect(coord.getContent(GRID_DOC)).toMatchObject({ text: 'a,b\n1,y\n', dirty: true });
    // The same document, history and all: the grid's edit still undoes in it.
    expect(service.undo(PREVIEW)).toEqual({ ok: true });
    expect(coord.getContent(GRID_DOC)).toMatchObject({ text: 'a,b\n1,2\n', dirty: false });
  });

  it('closing the editor of a CLEAN document lets it close, and the grid goes back to the disk', async () => {
    await writeFile(file, 'a,b\n1,2\n');
    await coord.load({ ...editorMeta('ed1', file) });
    coord.destroy('ed1');
    expect(coord.documentFor(file)).toBeNull();
  });

  it('closing the preview with no editor drops the grid document', async () => {
    await writeFile(file, 'a\n');
    await service.edit({ panelId: PREVIEW, filePath: file, operation: setB2('x') });
    service.release(PREVIEW);
    expect(coord.documentFor(file)).toBeNull();
  });
});
