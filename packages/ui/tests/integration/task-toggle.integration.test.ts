/**
 * 054 T018 / T020 — `TaskToggleService` against a real `EditorCoordinator` and a real disk (FR-024 –
 * FR-029, contracts/preview-ipc-054.md).
 *
 * Layer: integration — the save-iff-clean rule, the undo entry and the byte-exact rewrite are properties
 * of the real authority and real files; `locateTaskToggle`'s list-shape matrix is unit-tested in core.
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, type TaskToggleRequest } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { TaskToggleService } from '../../src/main/task-toggle-service.js';
import { editDocument } from './helpers/edit-document.js';

const fs = new NodeFileSystem(async () => {});

let root: string;
let outside: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let runs: Map<string, { projectRoot: string; filePath: string }>;
let service: TaskToggleService;

function meta(panelId: string, absPath: string): DocMeta {
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

function request(filePath: string, line: number, expectChecked: boolean, itemText: string): TaskToggleRequest {
  runs.set('pv', { projectRoot: root, filePath });
  return { panelId: 'pv', filePath, line, expectChecked, itemText };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-task-toggle-'));
  outside = await mkdtemp(join(tmpdir(), 'throng-task-toggle-out-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-task-toggle-rec-'));
  coord = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: () => {},
    persistUndoHistory: () => true,
  });
  runs = new Map();
  service = new TaskToggleService(fs, coord, (id) => runs.get(id));
});

afterEach(async () => {
  // Dispose the document's recovery timer before its directory disappears (editor-move's precedent).
  coord.destroy('p1');
  for (const dir of [root, outside, recoveryDir]) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('an open, clean document (FR-024, FR-025)', () => {
  it('edits the document, saves it, and one undo removes the toggle and leaves it unsaved', async () => {
    const path = join(root, 'a.md');
    await writeFile(path, '# T\n- [ ] one\n');
    await coord.load({ ...meta('p1', path), absPath: path });

    expect(await service.toggle(request(path, 1, false, 'one'))).toEqual({ ok: true, savedToDisk: true });
    expect(await readFile(path, 'utf8')).toBe('# T\n- [x] one\n');
    expect(coord.getContent('p1')).toMatchObject({ text: '# T\n- [x] one\n', dirty: false });

    coord.undo('p1', 'view-1');
    expect(coord.getContent('p1')).toMatchObject({ text: '# T\n- [ ] one\n', dirty: true });
  });
});

describe('an open document with unsaved edits (FR-025)', () => {
  it('applies the toggle beside them, saves nothing, and undo removes only the toggle', async () => {
    const path = join(root, 'a.md');
    await writeFile(path, '- [ ] one\n');
    await coord.load({ ...meta('p1', path), absPath: path });
    editDocument(coord, meta('p1', path), '- [ ] one\nmine\n');

    expect(await service.toggle(request(path, 0, false, 'one'))).toEqual({ ok: true, savedToDisk: false });
    expect(await readFile(path, 'utf8')).toBe('- [ ] one\n');
    expect(coord.getContent('p1')).toMatchObject({ text: '- [x] one\nmine\n', dirty: true });

    coord.undo('p1', 'view-1');
    expect(coord.getContent('p1')?.text).toBe('- [ ] one\nmine\n');
  });
});

describe('a file with no open document (FR-029)', () => {
  it('rewrites one marker and keeps the BOM and CRLF endings', async () => {
    const path = join(root, 'b.md');
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    await writeFile(path, Buffer.concat([bom, Buffer.from('x\r\n- [X] done\r\n- [ ] next\r\n')]));

    expect(await service.toggle(request(path, 1, true, 'done'))).toEqual({ ok: true, savedToDisk: true });
    expect(await readFile(path)).toEqual(Buffer.concat([bom, Buffer.from('x\r\n- [ ] done\r\n- [ ] next\r\n')]));
  });

  it('refuses a source that moved ambiguously, leaving the file untouched (FR-027)', async () => {
    const path = join(root, 'c.md');
    await writeFile(path, 'new\n- [ ] dup\n- [ ] dup\n');
    expect(await service.toggle(request(path, 0, false, 'dup'))).toEqual({ ok: false, reason: 'ambiguous' });
    expect(await readFile(path, 'utf8')).toBe('new\n- [ ] dup\n- [ ] dup\n');
  });

  it('refuses a file that is not valid UTF-8 rather than transcoding it', async () => {
    const path = join(root, 'd.md');
    await writeFile(path, Buffer.from([0x2d, 0x20, 0x5b, 0x20, 0x5d, 0x20, 0xe9, 0x0a]));
    expect(await service.toggle(request(path, 0, false, 'é'))).toEqual({ ok: false, reason: 'encoding' });
  });
});

describe('refusals (FR-028)', () => {
  it('a read-only file → readOnly, unchanged', async () => {
    const path = join(root, 'ro.md');
    await writeFile(path, '- [ ] t\n');
    await chmod(path, 0o444);
    try {
      expect(await service.toggle(request(path, 0, false, 't'))).toEqual({ ok: false, reason: 'readOnly' });
      expect(await readFile(path, 'utf8')).toBe('- [ ] t\n');
    } finally {
      await chmod(path, 0o666);
    }
  });

  it('an OPEN, clean document whose save fails → refused, and the toggle is taken back out of the buffer', async () => {
    const path = join(root, 'ro-open.md');
    await writeFile(path, '- [ ] t\n');
    await coord.load({ ...meta('p1', path), absPath: path });
    await chmod(path, 0o444);
    try {
      expect(await service.toggle(request(path, 0, false, 't'))).toEqual({ ok: false, reason: 'readOnly' });
      expect(coord.getContent('p1')).toMatchObject({ text: '- [ ] t\n', dirty: false });
      expect(await readFile(path, 'utf8')).toBe('- [ ] t\n');
    } finally {
      await chmod(path, 0o666);
    }
  });

  it('a file outside the preview’s project → outOfTree', async () => {
    const path = join(outside, 'x.md');
    await writeFile(path, '- [ ] t\n');
    expect(await service.toggle(request(path, 0, false, 't'))).toEqual({ ok: false, reason: 'outOfTree' });
    expect(await readFile(path, 'utf8')).toBe('- [ ] t\n');
  });

  it('a request naming a file the run no longer shows → changed', async () => {
    const path = join(root, 'e.md');
    await writeFile(path, '- [ ] t\n');
    runs.set('pv', { projectRoot: root, filePath: join(root, 'other.md') });
    expect(await service.toggle({ panelId: 'pv', filePath: path, line: 0, expectChecked: false, itemText: 't' })).toEqual({
      ok: false,
      reason: 'changed',
    });
  });
});
