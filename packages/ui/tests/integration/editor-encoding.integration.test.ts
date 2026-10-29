/**
 * The editor reads and writes every supported format through the real service and coordinator
 * (059 US1–US4, FR-011–FR-039).
 *
 * Layer: integration — what is under test is the WIRING between a real file on disk, `EditorService`'s
 * read/write, the coordinator's per-document format state and the authority's line format. The codec
 * truth table is proven at unit level (`text-fidelity.test.ts`); each case here is one representative
 * of a behaviour that only this path can get wrong — a save that writes a view's ending, a reload that
 * forgets a chosen encoding, a refused save that writes something anyway.
 */
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import { DEFAULT_APP_SETTINGS, encode, type AppSettings, type CodePageId } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta, type EditorSyncMsg } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import {
  BOM_UTF16LE,
  CP1252_SAMPLE,
  TEXT_FIXTURES,
  UTF32LE,
  concat,
  utf16,
} from '../../../core/tests/fixtures/text-formats.js';

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let relayed: EditorSyncMsg[];
let settings: AppSettings;

const meta = (absPath: string | null, panelId = 'p1'): DocMeta => ({
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
});

async function open(name: string, bytes: Uint8Array, panelId = 'p1'): Promise<string> {
  const file = join(root, name);
  await writeFile(file, bytes);
  const res = await coord.load({ ...meta(file, panelId), absPath: file });
  expect(res.ok).toBe(true);
  return file;
}

/** Replace the text between two offsets, the way a view does. */
function edit(spec: { from: number; to?: number; insert?: string }, panelId = 'p1'): void {
  const current = coord.getContent(panelId)!;
  coord.dispatchChange(meta(current.absPath, panelId), {
    documentId: panelId,
    viewId: 'view-1',
    changes: ChangeSet.of(spec, current.text.length).toJSON(),
    baseVersion: current.version,
    selectionBefore: null,
    mergeClass: null,
  });
}

const bytesOf = async (file: string): Promise<number[]> => [...(await readFile(file))];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-encoding-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-encoding-rec-'));
  relayed = [];
  settings = DEFAULT_APP_SETTINGS;
  coord = new EditorCoordinator(
    new EditorService(fs, () => settings),
    new EditorRecovery(recoveryDir),
    {
      recoveryDebounceMs: 10,
      relaySync: (_exclude, msg) => {
        relayed.push(msg);
      },
      persistUndoHistory: () => true,
    },
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('the save writes the AUTHORITY’s line format (059 R6, FR-011)', () => {
  it('a mixed file edited on one line keeps every other line’s ending (016 FR-023b)', async () => {
    const file = await open('mixed.txt', concat('one\r\ntwo\nthree\r\n'));
    edit({ from: 4, to: 7, insert: 'TWO' });
    expect(await coord.save({ panelId: 'p1' })).toMatchObject({ ok: true });
    expect(await readFile(file, 'utf8')).toBe('one\r\nTWO\nthree\r\n');
  });

  it('a save payload can no longer name the line ending', async () => {
    const file = await open('crlf.txt', concat('a\r\nb\r\n'));
    edit({ from: 0, to: 1, insert: 'A' });
    // A renderer-held `lineEnding` used to win here. It is not part of the payload any more; a caller
    // that still sends one is ignored rather than obeyed.
    await coord.save({ panelId: 'p1', lineEnding: 'lf' } as Parameters<EditorCoordinator['save']>[0]);
    expect(await readFile(file, 'utf8')).toBe('A\r\nb\r\n');
  });
});

describe('Windows-1252 (059 US1)', () => {
  it('opens with its characters, and an edit changes only the edited bytes (FR-012)', async () => {
    const file = await open('legacy.txt', CP1252_SAMPLE);
    expect(coord.getContent('p1')).toMatchObject({ text: 'café £5 €\n', encoding: 'windows1252' });
    edit({ from: 0, to: 1, insert: 'C' });
    await coord.save({ panelId: 'p1' });
    expect(await bytesOf(file)).toEqual([0x43, ...CP1252_SAMPLE.subarray(1)]);
  });

  it('a character the encoding cannot hold writes NOTHING and says which (FR-021, FR-022)', async () => {
    const file = await open('legacy.txt', CP1252_SAMPLE);
    edit({ from: 10, insert: 'smile 😀' });
    const res = await coord.save({ panelId: 'p1' });
    expect(res).toMatchObject({
      ok: false,
      reason: 'unrepresentable',
      unrepresentable: { encoding: 'windows1252', char: '😀', line: 2, column: 7 },
    });
    expect(await bytesOf(file)).toEqual([...CP1252_SAMPLE]);
    expect(coord.getContent('p1')?.dirty).toBe(true);
    expect(relayed.filter((m) => m.saveRefused)).toHaveLength(1);
    // A repeat refusal re-sends — the views' cue to flash the one notice they show.
    await coord.save({ panelId: 'p1' });
    expect(relayed.filter((m) => m.saveRefused)).toHaveLength(2);
  });

  it('the refusal clears when an edit removes the character', async () => {
    await open('legacy.txt', CP1252_SAMPLE);
    edit({ from: 10, insert: '😀' });
    await coord.save({ panelId: 'p1' });
    edit({ from: 10, to: 12 });
    // The re-check runs on the recovery debounce (10 ms here), not per keystroke.
    await new Promise((r) => setTimeout(r, 50));
    expect(relayed.some((m) => m.saveRefused === null)).toBe(true);
    expect(coord.getContent('p1')?.saveRefused).toBeNull();
  });

  it('Save All saves the others and leaves the refused one dirty (FR-023)', async () => {
    const good = await open('good.txt', concat('fine\n'), 'p2');
    await open('legacy.txt', CP1252_SAMPLE, 'p1');
    edit({ from: 0, insert: '😀' }, 'p1');
    edit({ from: 0, insert: 'still ' }, 'p2');
    await coord.saveAll('all', { activeTabId: null, activeProjectId: 'A' } as never);
    expect(await readFile(good, 'utf8')).toBe('still fine\n');
    expect(coord.getContent('p1')?.dirty).toBe(true);
  });

  it('a brand-new document still saves as UTF-8, no BOM, in the default ending (FR-016)', async () => {
    coord.register({ ...meta(null), lineEnding: 'lf' }, 'new ✓\n');
    const target = join(root, 'new.txt');
    await coord.save({ panelId: 'p1', absPath: target });
    expect(await readFile(target, 'utf8')).toBe('new ✓\n');
  });
});

describe('UTF-16 (059 US2)', () => {
  for (const name of ['utf16leBom', 'utf16beBom', 'utf16leNoBom', 'utf16beNoBom'] as const) {
    it(`${name}: edit, save, same encoding and BOM state`, async () => {
      const f = TEXT_FIXTURES[name];
      const file = await open(`${name}.txt`, f.bytes);
      expect(coord.getContent('p1')).toMatchObject({ encoding: f.encoding, hasBom: f.hasBom });
      edit({ from: 0, to: 1, insert: 'H' });
      await coord.save({ panelId: 'p1' });
      const order = f.encoding === 'utf16le' ? 'le' : 'be';
      const bom = f.hasBom ? (order === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
      expect(await bytesOf(file)).toEqual([...concat(bom, utf16('Héllo wörld\r\nσ line two\r\n', order))]);
    });
  }

  it('UTF-32 is refused by name (FR-006), and a PNG is still not text (FR-007)', async () => {
    const u32 = join(root, 'wide.txt');
    await writeFile(u32, UTF32LE);
    expect(await coord.load({ ...meta(u32), absPath: u32 })).toMatchObject({
      ok: false,
      reason: 'utf32',
      error: 'This file is UTF-32, which throng does not open.',
    });
    const png = join(root, 'pic.png');
    await writeFile(png, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
    expect(await coord.load({ ...meta(png), absPath: png })).toMatchObject({ ok: false, reason: 'binary' });
  });
});

describe('choosing an encoding (059 US3)', () => {
  it('Reopen with Encoding re-reads, clears undo, writes nothing, and is remembered (FR-024)', async () => {
    const file = await open('looks-utf8.txt', concat('cafÃ©\n'));
    edit({ from: 0, insert: 'x' });
    edit({ from: 0, to: 1 });
    const res = await coord.reopenWithEncoding('p1', 'windows1252');
    expect(res).toEqual({ ok: true });
    expect(coord.getContent('p1')).toMatchObject({
      text: 'cafÃƒÂ©\n',
      encoding: 'windows1252',
      encodingChosen: true,
      dirty: false,
    });
    expect(await readFile(file, 'utf8')).toBe('cafÃ©\n');
    expect(relayed.some((m) => m.encoding === 'windows1252' && m.encodingChosen === true)).toBe(true);
  });

  it('a reopen the bytes do not allow changes nothing (FR-014)', async () => {
    await open('legacy.txt', CP1252_SAMPLE);
    expect(await coord.reopenWithEncoding('p1', 'utf8')).toMatchObject({
      ok: false,
      reason: 'not-decodable',
      encoding: 'utf8',
    });
    expect(coord.getContent('p1')).toMatchObject({ encoding: 'windows1252', text: 'café £5 €\n' });
  });

  it('a document with no file cannot be reopened (FR-026)', async () => {
    coord.register(meta(null), 'draft');
    expect(await coord.reopenWithEncoding('p1', 'utf8')).toMatchObject({ ok: false, reason: 'no-file' });
  });

  it('Change Encoding then save writes the chosen format and keeps it (FR-055, superseding FR-027)', async () => {
    const file = await open('ps.txt', TEXT_FIXTURES.powershell.bytes);
    coord.changeEncoding('p1', 'utf8', false);
    expect(await coord.save({ panelId: 'p1' })).toMatchObject({ ok: true });
    expect(await bytesOf(file)).toEqual([...concat('héllo\r\n')]);
    expect(coord.getContent('p1')).toMatchObject({ encoding: 'utf8', hasBom: false, encodingChosen: true });
  });

  it('a chosen encoding survives an external-change reload (FR-028)', async () => {
    const file = await open('looks-utf8.txt', concat('cafÃ©\n'));
    await coord.reopenWithEncoding('p1', 'windows1252');
    await writeFile(file, concat('naÃ¯ve\n'));
    await coord.reload('p1');
    expect(coord.getContent('p1')).toMatchObject({ encoding: 'windows1252', encodingChosen: true });
  });

  it('…but gives way to detection once the file cannot be read in it (edge case)', async () => {
    const file = await open('was-utf16.txt', TEXT_FIXTURES.utf16leBom.bytes);
    await coord.reopenWithEncoding('p1', 'utf16le');
    // 11 bytes: an odd count, which UTF-16 genuinely cannot read.
    await writeFile(file, concat('plain now!\n'));
    await coord.reload('p1');
    expect(coord.getContent('p1')).toMatchObject({ encoding: 'utf8', encodingChosen: false, text: 'plain now!\n' });
  });

  it('a recovered buffer comes back in its format, and saves in it (FR-015)', async () => {
    const file = await open('legacy.txt', CP1252_SAMPLE);
    coord.restoreRecovered('p1', 'recovered é\n', undefined, {
      encoding: 'windows1252',
      hasBom: false,
      encodingChosen: false,
      lineFormat: { lineEnding: 'crlf' },
    });
    await coord.save({ panelId: 'p1' });
    expect(await bytesOf(file)).toEqual([...concat('recovered '), 0xe9, 0x0d, 0x0a]);
  });

  it('a fresh open after close detects again (clarification 3)', async () => {
    const file = await open('looks-utf8.txt', concat('cafÃ©\n'));
    await coord.reopenWithEncoding('p1', 'windows1252');
    coord.destroy('p1');
    await coord.load({ ...meta(file), absPath: file });
    expect(coord.getContent('p1')).toMatchObject({ encoding: 'utf8', encodingChosen: false });
  });
});

describe('code-review findings (059 step 8)', () => {
  it('Discard after a conversion restores the file’s line format, clean, and tells the views', async () => {
    const file = await open('lf.txt', concat('a\nb\n'));
    coord.convertLineEndings('p1', 'crlf');
    relayed.length = 0;
    expect(coord.revert('p1')).toBe(true);
    expect(coord.getContent('p1')).toMatchObject({ dirty: false, lineEnding: 'lf', mixed: false });
    expect(relayed.some((m) => m.lineFormat?.lineEnding === 'lf')).toBe(true);
    edit({ from: 0, to: 1, insert: 'A' });
    await coord.save({ panelId: 'p1' });
    expect(await readFile(file, 'utf8')).toBe('A\nb\n');
  });

  it('Discard after Change Encoding restores the file’s encoding, clean, and saves in it (FR-055)', async () => {
    const file = await open('plain.txt', concat('a\n'));
    coord.changeEncoding('p1', 'utf16le', true);
    expect(coord.revert('p1')).toBe(true);
    expect(coord.getContent('p1')).toMatchObject({ dirty: false, encoding: 'utf8', hasBom: false });
    edit({ from: 0, insert: 'X' });
    await coord.save({ panelId: 'p1' });
    expect(await readFile(file, 'utf8')).toBe('Xa\n');
  });

  it('the load answer of a mixed file says it is mixed', async () => {
    const file = join(root, 'mixed.txt');
    await writeFile(file, concat('a\r\nb\nc\r\n'));
    expect(await coord.load({ ...meta(file), absPath: file })).toMatchObject({ ok: true, lineEnding: 'crlf', mixed: true, lineEndings: ['crlf', 'lf', 'crlf'] });
  });

  it('a save that changed the line count keeps every line’s own ending (FR-061, superseding the uniform fallback)', async () => {
    const file = await open('mixed.txt', concat('a\r\nb\nc\r\n'));
    edit({ from: 0, insert: 'new\n' });
    await coord.save({ panelId: 'p1' });
    expect(await readFile(file, 'utf8')).toBe('new\r\na\r\nb\nc\r\n');
    expect(coord.getContent('p1')).toMatchObject({ lineEnding: 'crlf', mixed: true });
    edit({ from: 0, to: 4 });
    await coord.save({ panelId: 'p1' });
    expect(await readFile(file, 'utf8')).toBe('a\r\nb\nc\r\n');
  });

  it('a refused save in a changed encoding keeps its notice while the character is still there', async () => {
    await open('plain.txt', concat('smile 😀\n'));
    coord.changeEncoding('p1', 'windows1252', false);
    expect(await coord.save({ panelId: 'p1' })).toMatchObject({ ok: false, reason: 'unrepresentable' });
    edit({ from: 0, insert: 'x' });
    await new Promise((r) => setTimeout(r, 50));
    expect(coord.getContent('p1')?.saveRefused).toMatchObject({ encoding: 'windows1252', char: '😀' });
  });
});

describe('an external change to the format alone (059 step 8)', () => {
  it('a clean document adopts a re-encoding whose text is unchanged', async () => {
    const watched = new EditorCoordinator(
      new EditorService(fs, () => DEFAULT_APP_SETTINGS),
      new EditorRecovery(recoveryDir),
      {
        recoveryDebounceMs: 10,
        relaySync: (_e, msg) => relayed.push(msg),
        persistUndoHistory: () => false,
        fileWatcher: new NodeFileWatcher(20),
      },
    );
    const file = join(root, 'ps.txt');
    await writeFile(file, TEXT_FIXTURES.powershell.bytes);
    await watched.load({ ...meta(file, 'w1'), absPath: file });
    try {
      await writeFile(file, concat('héllo\n'));
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline && watched.getContent('w1')?.encoding !== 'utf8') {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(watched.getContent('w1')).toMatchObject({ encoding: 'utf8', hasBom: false, lineEnding: 'lf', dirty: false });
    } finally {
      watched.destroy('w1');
    }
  });
});

describe('converting line endings (059 US4)', () => {
  it('converts every view’s document, dirties it, and saves the target ending (FR-035)', async () => {
    const file = await open('crlf.txt', concat('a\r\nb\r\nc\r\n'));
    expect(coord.convertLineEndings('p1', 'lf')).toEqual({ ok: true, changed: true });
    expect(coord.getContent('p1')?.dirty).toBe(true);
    expect(relayed.some((m) => m.change?.lineFormat?.lineEnding === 'lf')).toBe(true);
    await coord.save({ panelId: 'p1' });
    expect(await readFile(file, 'utf8')).toBe('a\nb\nc\n');
  });

  it('undo restores a mixed file exactly, and clean (FR-036)', async () => {
    const file = await open('mixed.txt', concat('a\r\nb\nc\r\n'));
    coord.convertLineEndings('p1', 'crlf');
    coord.undo('p1', 'view-1');
    expect(coord.getContent('p1')).toMatchObject({ dirty: false, lineEnding: 'crlf', mixed: true });
    coord.redo('p1', 'view-1');
    await coord.save({ panelId: 'p1' });
    expect(await readFile(file, 'utf8')).toBe('a\r\nb\r\nc\r\n');
  });

  it('converting to the current ending is a no-op (FR-038)', async () => {
    await open('lf.txt', concat('a\nb\n'));
    expect(coord.convertLineEndings('p1', 'lf')).toEqual({ ok: true, changed: false });
    expect(coord.getContent('p1')?.dirty).toBe(false);
  });

  it('a UTF-16 file converts and stays UTF-16', async () => {
    const file = await open('u16.txt', concat(BOM_UTF16LE, utf16('a\r\nb\r\n', 'le')));
    coord.convertLineEndings('p1', 'lf');
    await coord.save({ panelId: 'p1' });
    expect(await bytesOf(file)).toEqual([...concat(BOM_UTF16LE, utf16('a\nb\n', 'le'))]);
  });
});

describe('round 2: change encoding, CR, insert a line break (059 FR-055, FR-057, FR-061)', () => {
  it('Change Encoding dirties, writes nothing, and the save writes the new encoding (FR-055)', async () => {
    const file = await open('plain.txt', concat('a\nb\n'));
    expect(coord.changeEncoding('p1', 'utf16le', true)).toEqual({ ok: true, changed: true });
    expect(coord.getContent('p1')).toMatchObject({ encoding: 'utf16le', hasBom: true, dirty: true, encodingChosen: true });
    expect(await readFile(file, 'utf8')).toBe('a\nb\n');
    expect(relayed.some((m) => m.encoding === 'utf16le')).toBe(true);
    await coord.save({ panelId: 'p1' });
    expect(await bytesOf(file)).toEqual([...concat(BOM_UTF16LE, utf16('a\nb\n', 'le'))]);
    expect(coord.getContent('p1')).toMatchObject({ dirty: false });
  });

  it('undo puts the encoding back, clean, and tells the views (FR-055)', async () => {
    await open('plain.txt', concat('a\n'));
    coord.changeEncoding('p1', 'windows1252', true);
    relayed.length = 0;
    coord.undo('p1', 'view-1');
    expect(coord.getContent('p1')).toMatchObject({ encoding: 'utf8', hasBom: false, dirty: false });
    expect(relayed.some((m) => m.encoding === 'utf8')).toBe(true);
  });

  it('choosing the current encoding changes nothing (FR-055)', async () => {
    await open('plain.txt', concat('a\n'));
    expect(coord.changeEncoding('p1', 'utf8', false)).toEqual({ ok: true, changed: false });
    expect(coord.getContent('p1')).toMatchObject({ dirty: false });
  });

  it('a change to an encoding that cannot hold the text is refused at the save, not at the change (FR-021)', async () => {
    const file = await open('emoji.txt', concat('smile 😀\n'));
    coord.changeEncoding('p1', 'windows1252', false);
    expect(await coord.save({ panelId: 'p1' })).toMatchObject({ ok: false, reason: 'unrepresentable' });
    expect(await readFile(file, 'utf8')).toBe('smile 😀\n');
  });

  it('a Change Encoding survives a crash: restored dirty, in the chosen encoding, and saved in it (FR-055)', async () => {
    const file = await open('plain.txt', concat('a\n'));
    coord.changeEncoding('p1', 'utf16le', true);
    const recovery = new EditorRecovery(recoveryDir);
    await expect.poll(async () => (await recovery.read('p1'))?.format?.encoding, { timeout: 2000 }).toBe('utf16le');
    const snapshot = (await recovery.read('p1'))!;

    // The next launch: a fresh coordinator reads the file, then adopts what was recovered.
    const next = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
      recoveryDebounceMs: 10,
      relaySync: () => {},
      persistUndoHistory: () => true,
    });
    await next.load({ ...meta(file), absPath: file });
    next.restoreRecovered('p1', snapshot.text, snapshot.history, snapshot.format);
    expect(next.getContent('p1')).toMatchObject({ encoding: 'utf16le', hasBom: true, dirty: true });
    await next.save({ panelId: 'p1' });
    expect(await bytesOf(file)).toEqual([...concat(BOM_UTF16LE, utf16('a\n', 'le'))]);
  });

  it('converts to CR and saves CR (FR-057)', async () => {
    const file = await open('crlf.txt', concat('a\r\nb\r\n'));
    expect(coord.convertLineEndings('p1', 'cr')).toEqual({ ok: true, changed: true });
    await coord.save({ panelId: 'p1' });
    expect(await readFile(file, 'utf8')).toBe('a\rb\r');
  });

  it('an inserted CRLF in an LF file keeps its ending through edits elsewhere and the save (FR-061)', async () => {
    const file = await open('lf.txt', concat('one\ntwo\nthree\n'));
    const current = coord.getContent('p1')!;
    coord.dispatchChange(meta(file), {
      documentId: 'p1',
      viewId: 'view-1',
      changes: ChangeSet.of({ from: 3, insert: '\n' }, current.text.length).toJSON(),
      baseVersion: current.version,
      selectionBefore: null,
      mergeClass: null,
      insertedLineEnding: 'crlf',
    });
    expect(coord.getContent('p1')).toMatchObject({ lineEnding: 'lf', mixed: true });
    // Elsewhere: add a line at the end, delete "two\n".
    edit({ from: coord.getContent('p1')!.text.length, insert: 'four\n' });
    edit({ from: 5, to: 9 });
    await coord.save({ panelId: 'p1' });
    expect(await readFile(file, 'utf8')).toBe('one\r\n\nthree\nfour\n');
  });
});

describe('how the document was read (059 FR-068)', () => {
  /** Windows-1252 `CAFÉ™` and `HÔTEL`: every high byte pairs into valid UTF-8, so it opens as UTF-8. */
  const MISREAD = concat('CAF', [0xc9, 0x99], ' brand\nH', [0xd4, 0x95], 'TEL\n');
  const notices = (): unknown[] => relayed.filter((m) => m.readNotice !== undefined).map((m) => m.readNotice);

  it('a UTF-8 open that looks like misread Windows-1252 carries a suspect notice, relayed and published', async () => {
    await open('misread.txt', MISREAD);
    expect(coord.getContent('p1')).toMatchObject({ encoding: 'utf8', readNotice: { kind: 'suspect', readAs: 'utf8' } });
    expect(notices()).toContainEqual({ kind: 'suspect', readAs: 'utf8', likely: 'windows1252' });
  });

  it('an ordinary UTF-8 or Windows-1252 open carries none', async () => {
    await open('plain.txt', concat('naïve café\n'));
    expect(coord.getContent('p1')?.readNotice).toBeNull();
    await open('legacy.txt', CP1252_SAMPLE, 'p2');
    expect(coord.getContent('p2')?.readNotice).toBeNull();
  });

  it('a reopen replaces it with one naming the encoding read as', async () => {
    await open('misread.txt', MISREAD);
    await coord.reopenWithEncoding('p1', 'windows1252');
    expect(coord.getContent('p1')).toMatchObject({
      text: 'CAFÉ™ brand\nHÔ•TEL\n',
      readNotice: { kind: 'reopened', readAs: 'windows1252' },
    });
    expect(notices().at(-1)).toEqual({ kind: 'reopened', readAs: 'windows1252' });
  });

  it('it survives an edit and a Change Encoding, and goes when saved in another encoding', async () => {
    const file = await open('misread.txt', MISREAD);
    await coord.reopenWithEncoding('p1', 'windows1252');
    edit({ from: 0, insert: 'x' });
    coord.changeEncoding('p1', 'utf8', false);
    expect(coord.getContent('p1')?.readNotice).toMatchObject({ kind: 'reopened' });
    expect(await coord.save({ panelId: 'p1' })).toMatchObject({ ok: true });
    expect(coord.getContent('p1')?.readNotice).toBeNull();
    expect(notices().at(-1)).toBeNull();
    expect(await readFile(file, 'utf8')).toContain('CAFÉ™');
  });

  it('it stays when saved in the encoding it was read as: the file still opens wrongly', async () => {
    await open('misread.txt', MISREAD);
    await coord.reopenWithEncoding('p1', 'windows1252');
    edit({ from: 0, insert: 'x' });
    expect(await coord.save({ panelId: 'p1' })).toMatchObject({ ok: true });
    expect(coord.getContent('p1')?.readNotice).toMatchObject({ kind: 'reopened', readAs: 'windows1252' });
  });

  it('dismissing clears it for every view, and a fresh open decides again', async () => {
    const file = await open('misread.txt', MISREAD);
    coord.dismissReadNotice('p1');
    expect(coord.getContent('p1')?.readNotice).toBeNull();
    expect(notices().at(-1)).toBeNull();
    await coord.load({ ...meta(file, 'p1'), absPath: file });
    expect(coord.getContent('p1')?.readNotice).toMatchObject({ kind: 'suspect' });
  });
});

describe('the Windows code pages, the fallback encoding and the misread warning (059 FR-069)', () => {
  const GREEK = encode('Καλημέρα σας. Αυτό είναι ένα δοκιμαστικό αρχείο.\nΗ γρήγορη καφέ αλεπού πηδάει πάνω από τον σκύλο.\n', {
    encoding: 'windows1253',
    hasBom: false,
    lineEnding: 'lf',
  });
  const RUSSIAN = encode('Привет, это тестовый файл.\nСъешь же ещё этих мягких французских булок, да выпей чаю.\n', {
    encoding: 'windows1251',
    hasBom: false,
    lineEnding: 'lf',
  });
  const withFallback = (fallbackEncoding: CodePageId): void => {
    settings = { ...DEFAULT_APP_SETTINGS, editor: { ...DEFAULT_APP_SETTINGS.editor, fallbackEncoding } };
  };

  it('a Greek file read as Western carries a notice naming Windows-1253, and reopening reads it', async () => {
    const file = await open('greek.txt', GREEK);
    expect(coord.getContent('p1')).toMatchObject({
      encoding: 'windows1252',
      readNotice: { kind: 'suspect', readAs: 'windows1252', likely: 'windows1253' },
    });
    await coord.reopenWithEncoding('p1', 'windows1253');
    expect(coord.getContent('p1')).toMatchObject({
      encoding: 'windows1253',
      // FR-071: not valid UTF-8, so making 1253 the fallback would read it as Greek — the notice offers that.
      readNotice: { kind: 'reopened', readAs: 'windows1253', fallbackHelps: true },
    });
    expect(coord.getContent('p1')?.text).toContain('Καλημέρα');
    // An edit saved in that code page changes only the edited bytes.
    edit({ from: 0, insert: 'Α' });
    expect(await coord.save({ panelId: 'p1' })).toMatchObject({ ok: true });
    expect(await bytesOf(file)).toEqual([0xc1, ...GREEK]);
  });

  it('with the fallback set to Windows-1251, a Cyrillic file reads correctly and raises nothing', async () => {
    withFallback('windows1251');
    await open('russian.txt', RUSSIAN);
    expect(coord.getContent('p1')).toMatchObject({ encoding: 'windows1251', readNotice: null });
    expect(coord.getContent('p1')?.text).toContain('Привет');
  });

  it('a byte the fallback leaves undefined is kept: the file reads in the fallback (FR-072)', async () => {
    withFallback('windows1253');
    await open('hole.txt', concat('A', [0xaa], 'B\n'));
    expect(coord.getContent('p1')).toMatchObject({ encoding: 'windows1253', text: 'A\u{f7aa}B\n' });
  });

  it('a Greek file with an undefined byte is suggested as Greek, reopens as Greek and saves every byte back (FR-072)', async () => {
    const bytes = Uint8Array.from([...GREEK.subarray(0, 10), 0xaa, ...GREEK.subarray(10)]);
    const file = await open('greek-hole.txt', bytes);
    expect(coord.getContent('p1')?.readNotice).toEqual({ kind: 'suspect', readAs: 'windows1252', likely: 'windows1253' });
    await coord.reopenWithEncoding('p1', 'windows1253');
    expect(coord.getContent('p1')?.text).toContain('\u{f7aa}');
    edit({ from: coord.getContent('p1')!.text.length, insert: 'Α' });
    expect(await coord.save({ panelId: 'p1' })).toMatchObject({ ok: true });
    expect(await bytesOf(file)).toEqual([...bytes, 0xc1]);
  });

  it('a reopen of a file that is valid UTF-8 does not offer the fallback: it would still open as UTF-8 (FR-071)', async () => {
    await open('misread.txt', concat('CAF', [0xc9, 0x99], ' brand\n'));
    await coord.reopenWithEncoding('p1', 'windows1252');
    expect(coord.getContent('p1')?.readNotice).toEqual({ kind: 'reopened', readAs: 'windows1252' });
  });

  it('a UTF-8 suspect names the fallback encoding, not Windows-1252', async () => {
    withFallback('windows1250');
    await open('misread.txt', concat('CAF', [0xc9, 0x99], ' brand\nH', [0xd4, 0x95], 'TEL\n'));
    expect(coord.getContent('p1')?.readNotice).toEqual({ kind: 'suspect', readAs: 'utf8', likely: 'windows1250' });
  });

  it('a Western file raises nothing, and a Greek file read in its own code page raises nothing', async () => {
    await open('legacy.txt', CP1252_SAMPLE);
    expect(coord.getContent('p1')?.readNotice).toBeNull();
    withFallback('windows1253');
    await open('greek.txt', GREEK, 'p2');
    expect(coord.getContent('p2')).toMatchObject({ encoding: 'windows1253', readNotice: null });
  });
});
