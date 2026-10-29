/**
 * The document's line format is AUTHORITY state (059 research R6 · FR-035–FR-038 · Principle XI).
 *
 * The buffer is always `\n`-normalised, so a line-ending conversion changes nothing the content can
 * show: before 059 the authority compared content only, and a converted document would have reported
 * itself clean. The line format therefore lives beside the content, is compared beside it for dirt,
 * and a conversion is an undo entry like any edit — one history, one owner.
 */
import { describe, expect, it } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import { DocumentAuthority } from '../../src/main/document-authority.js';

const MIXED = { lineEnding: 'crlf', mixedLineEndings: ['crlf', 'lf', 'crlf'] } as const;

function authority(text = 'a\nb\nc\n', format: ConstructorParameters<typeof DocumentAuthority>[3] = MIXED) {
  return new DocumentAuthority('doc', text, () => 0, format);
}

describe('line format is authority state (059 R6)', () => {
  it('starts with the format it was opened with, and clean', () => {
    const a = authority();
    expect(a.lineFormat).toEqual(MIXED);
    expect(a.dirty).toBe(false);
  });

  it('a conversion alone makes the document dirty (FR-035)', () => {
    const a = authority();
    const msg = a.convertLineEndings('lf', 'view-1');
    expect(msg).not.toBeNull();
    expect(a.text).toBe('a\nb\nc\n');
    expect(a.lineFormat).toEqual({ lineEnding: 'lf' });
    expect(a.dirty).toBe(true);
  });

  it('is ONE undo entry with empty change sets, which never merges', () => {
    const a = authority();
    const before = a.version;
    const msg = a.convertLineEndings('lf', 'view-1');
    expect(a.undoDepth).toBe(1);
    expect(a.version).toBe(before + 1);
    expect(msg).toMatchObject({
      kind: 'edit',
      version: before + 1,
      dirty: true,
      lineFormat: { lineEnding: 'lf', mixed: false },
    });
    expect(ChangeSet.fromJSON(msg?.changes).empty).toBe(true);

    // A typed character right after does NOT fold into the conversion.
    a.dispatch({
      documentId: 'doc',
      viewId: 'view-1',
      changes: ChangeSet.of({ from: 0, insert: 'x' }, a.doc.length).toJSON(),
      baseVersion: a.version,
      selectionBefore: null,
      mergeClass: 'type',
    });
    expect(a.undoDepth).toBe(2);
  });

  it('undo restores the mixed per-line record exactly, and clean (FR-036)', () => {
    const a = authority();
    a.convertLineEndings('lf', 'view-1');
    const undo = a.undo('view-2');
    expect(a.lineFormat).toEqual(MIXED);
    expect(a.dirty).toBe(false);
    expect(undo).toMatchObject({ kind: 'undo', lineFormat: { lineEnding: 'crlf', mixed: true } });
    expect(ChangeSet.fromJSON(undo?.changes).empty).toBe(true);
  });

  it('redo re-applies the conversion', () => {
    const a = authority();
    a.convertLineEndings('crlf', 'view-1');
    a.undo('view-1');
    const redo = a.redo('view-1');
    expect(a.lineFormat).toEqual({ lineEnding: 'crlf' });
    expect(redo).toMatchObject({ kind: 'redo', lineFormat: { lineEnding: 'crlf', mixed: false } });
  });

  it('converting a mixed document clears its per-line record (FR-037)', () => {
    const a = authority();
    a.convertLineEndings('crlf', 'view-1');
    expect(a.lineFormat).toEqual({ lineEnding: 'crlf' });
    expect(a.lineFormat.mixedLineEndings).toBeUndefined();
  });

  it('converting to the current uniform ending changes nothing and records nothing (FR-038)', () => {
    const a = authority('a\nb\n', { lineEnding: 'lf' });
    const v = a.version;
    expect(a.convertLineEndings('lf', 'view-1')).toBeNull();
    expect(a.version).toBe(v);
    expect(a.undoDepth).toBe(0);
    expect(a.dirty).toBe(false);
  });

  it('a save captures the format; undo after a save leaves the document dirty (edge case)', () => {
    const a = authority();
    a.convertLineEndings('lf', 'view-1');
    a.markSaved();
    expect(a.dirty).toBe(false);
    a.undo('view-1');
    expect(a.lineFormat).toEqual(MIXED);
    expect(a.dirty).toBe(true);
  });

  it('a reset adopts the format it is given, clean, with history cleared', () => {
    const a = authority();
    a.convertLineEndings('lf', 'view-1');
    a.reset('x\ny', true, { lineEnding: 'cr' });
    expect(a.lineFormat).toEqual({ lineEnding: 'cr' });
    expect(a.dirty).toBe(false);
    expect(a.undoDepth).toBe(0);
  });

  it('a reset that recovers unsaved content keeps the saved format to compare against', () => {
    const a = authority('a\nb\n', { lineEnding: 'lf' });
    a.reset('a\nb\n', false, { lineEnding: 'crlf' });
    expect(a.dirty).toBe(true);
  });
});

describe('a conversion survives the persisted history (059 T013)', () => {
  it('serialises its format, and restores it', () => {
    const a = authority();
    a.convertLineEndings('lf', 'view-1');
    const saved = a.serialiseHistory();
    expect(saved.undo[0]?.format).toEqual({ before: MIXED, after: { lineEnding: 'lf' } });

    const b = authority('a\nb\nc\n', { lineEnding: 'lf' });
    b.restoreHistory(saved);
    b.undo('view-1');
    expect(b.lineFormat).toEqual(MIXED);
  });

  it('an older history with no format field restores unchanged', () => {
    const a = authority('', { lineEnding: 'lf' });
    a.restoreHistory({
      undo: [
        {
          changes: ChangeSet.of({ from: 0, insert: 'x' }, 0).toJSON(),
          inverted: ChangeSet.of({ from: 0, to: 1 }, 1).toJSON(),
          selectionBefore: null,
          viewId: 'v',
          version: 1,
          mergeClass: null,
          at: 0,
        },
      ],
      redo: [],
    });
    expect(a.undoDepth).toBe(1);
    expect(a.lineFormat).toEqual({ lineEnding: 'lf' });
  });
});

describe('round 2: encoding, CR, and a record that follows edits (059 FR-055, FR-057, FR-061)', () => {
  const UTF8 = { encoding: 'utf8', hasBom: false } as const;
  const LE = { encoding: 'utf16le', hasBom: true } as const;

  function withEncoding(text = 'a\nb\n', format: ConstructorParameters<typeof DocumentAuthority>[3] = { lineEnding: 'lf' }) {
    return new DocumentAuthority('doc', text, () => 0, format, UTF8);
  }

  function type(a: DocumentAuthority, spec: { from: number; to?: number; insert?: string }, extra: object = {}) {
    return a.dispatch({
      documentId: 'doc',
      viewId: 'view-1',
      changes: ChangeSet.of(spec, a.doc.length).toJSON(),
      baseVersion: a.version,
      selectionBefore: null,
      mergeClass: null,
      ...extra,
    });
  }

  it('Change Encoding is one undo step that dirties the document and writes nothing (FR-055)', () => {
    const a = withEncoding();
    const msg = a.changeEncoding(LE, 'view-1');
    expect(a.encoding).toEqual(LE);
    expect(a.dirty).toBe(true);
    expect(a.undoDepth).toBe(1);
    expect(msg).toMatchObject({ kind: 'edit', dirty: true, encoding: LE });
    expect(ChangeSet.fromJSON(msg?.changes).empty).toBe(true);

    expect(a.undo('view-1')).toMatchObject({ kind: 'undo', encoding: UTF8 });
    expect(a.encoding).toEqual(UTF8);
    expect(a.dirty).toBe(false);
    expect(a.redo('view-1')).toMatchObject({ kind: 'redo', encoding: LE });
    expect(a.dirty).toBe(true);
  });

  it('choosing the current encoding changes nothing and records nothing (FR-055)', () => {
    const a = withEncoding();
    expect(a.changeEncoding(UTF8, 'view-1')).toBeNull();
    expect(a.undoDepth).toBe(0);
  });

  it('a save captures the encoding, and a reset adopts one clean', () => {
    const a = withEncoding();
    a.changeEncoding(LE, 'view-1');
    a.markSaved();
    expect(a.dirty).toBe(false);
    a.reset('x', true, { lineEnding: 'lf' }, UTF8);
    expect(a.encoding).toEqual(UTF8);
    expect(a.dirty).toBe(false);
  });

  it('the encoding change survives the persisted history', () => {
    const a = withEncoding();
    a.changeEncoding(LE, 'view-1');
    const saved = a.serialiseHistory();
    expect(saved.undo[0]?.encoding).toEqual({ before: UTF8, after: LE });
    const b = new DocumentAuthority('doc', 'a\nb\n', () => 0, { lineEnding: 'lf' }, LE);
    b.restoreHistory(saved);
    b.undo('view-1');
    expect(b.encoding).toEqual(UTF8);
  });

  it('CR is a conversion target (FR-057)', () => {
    const a = authority('a\nb\n', { lineEnding: 'crlf' });
    expect(a.convertLineEndings('cr', 'view-1')).toMatchObject({ lineFormat: { lineEnding: 'cr', mixed: false } });
    expect(a.lineFormat).toEqual({ lineEnding: 'cr' });
  });

  it('a typed line in a mixed document takes the dominant ending, at its place (FR-061)', () => {
    const a = authority(); // a\r\n b\n c\r\n
    const msg = type(a, { from: 0, insert: 'new\n' });
    expect(a.lineFormat).toEqual({ lineEnding: 'crlf', mixedLineEndings: ['crlf', 'crlf', 'lf', 'crlf'] });
    expect(msg?.lineFormat).toEqual({ lineEnding: 'crlf', mixed: true, lineEndings: ['crlf', 'crlf', 'lf', 'crlf'] });
  });

  it('undo restores the exact record an edit changed (FR-061)', () => {
    const a = authority();
    type(a, { from: 1, to: 2 }); // delete the CRLF break after "a"
    expect(a.lineFormat).toEqual({ lineEnding: 'crlf', mixedLineEndings: ['lf', 'crlf'] });
    a.undo('view-1');
    expect(a.lineFormat).toEqual(MIXED);
    expect(a.dirty).toBe(false);
  });

  it('Insert Line Break gives the inserted break its own ending (FR-061)', () => {
    const a = authority('a\nb', { lineEnding: 'lf' });
    const msg = type(a, { from: 1, insert: '\n' }, { insertedLineEnding: 'crlf' });
    expect(a.lineFormat).toEqual({ lineEnding: 'lf', mixedLineEndings: ['crlf', 'lf'] });
    expect(msg?.lineFormat).toEqual({ lineEnding: 'lf', mixed: true, lineEndings: ['crlf', 'lf'] });
    a.undo('view-1');
    expect(a.lineFormat).toEqual({ lineEnding: 'lf' });
  });

  it('a merged typing run undoes to the record from before the run began', () => {
    const a = new DocumentAuthority('doc', 'a\nb\nc\n', () => 0, MIXED);
    type(a, { from: 0, insert: 'x\n' }, { mergeClass: 'type' });
    type(a, { from: 2, insert: 'y\n' }, { mergeClass: 'type' });
    expect(a.undoDepth).toBe(1);
    expect(a.lineFormat.mixedLineEndings).toHaveLength(5);
    a.undo('view-1');
    expect(a.lineFormat).toEqual(MIXED);
  });

  it('an edit inside a line records no format', () => {
    const a = authority();
    const msg = type(a, { from: 0, to: 1, insert: 'A' });
    expect(msg?.lineFormat).toBeUndefined();
    expect(a.serialiseHistory().undo[0]?.format).toBeUndefined();
  });

  it('a save after adding lines keeps the record, not a uniform fallback (supersedes the markSaved fallback)', () => {
    const a = authority();
    type(a, { from: 0, insert: 'new\n' });
    a.markSaved();
    expect(a.lineFormat.mixedLineEndings).toEqual(['crlf', 'crlf', 'lf', 'crlf']);
  });
});
