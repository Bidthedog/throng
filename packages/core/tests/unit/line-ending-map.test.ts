import { describe, expect, it } from 'vitest';
import { ChangeSet, Text } from '@codemirror/state';
import { mapLineEndings } from '../../src/editor/line-ending-map.js';
import type { LineFormat } from '../../src/editor/document-sync.js';

/**
 * 059 FR-061 — each line's ending follows it through every edit.
 *
 * The buffer is `\n`-normalised, so a mixed file's endings live only in the per-break record. Before
 * FR-061 an edit that added or removed a line made that record meaningless and the next save uniform;
 * now the record is mapped through each change, so it always has one entry per break.
 */

const doc = (s: string): Text => Text.of(s.split('\n'));
const change = (d: Text, spec: { from: number; to?: number; insert?: string } | { from: number; to?: number; insert?: string }[]) =>
  ChangeSet.of(spec, d.length);
const mixed = (lineEnding: LineFormat['lineEnding'], ...m: LineFormat['lineEnding'][]): LineFormat => ({
  lineEnding,
  mixedLineEndings: m,
});

describe('mapLineEndings (FR-061)', () => {
  it('keeps a uniform format untouched by an ordinary edit, without building a record', () => {
    const d = doc('a\nb\nc');
    const f: LineFormat = { lineEnding: 'crlf' };
    expect(mapLineEndings(f, d, change(d, { from: 1, insert: '\nx' }))).toBe(f);
  });

  it('keeps the record when an edit stays inside one line', () => {
    const d = doc('one\ntwo\nthree');
    const f = mixed('crlf', 'crlf', 'lf');
    expect(mapLineEndings(f, d, change(d, { from: 4, to: 7, insert: 'TWO' }))).toEqual(f);
  });

  it('drops the entry of a deleted line break', () => {
    const d = doc('a\nb\nc\nd'); // breaks: crlf, lf, cr
    const f = mixed('crlf', 'crlf', 'lf', 'cr');
    // Delete "b\n" — the second line and its LF break.
    expect(mapLineEndings(f, d, change(d, { from: 2, to: 4 }))).toEqual(mixed('crlf', 'crlf', 'cr'));
  });

  it('gives inserted breaks the inserting ending, at their position', () => {
    const d = doc('a\nb\nc');
    const f = mixed('crlf', 'crlf', 'lf');
    // Two new lines after "a", typed (the dominant ending).
    expect(mapLineEndings(f, d, change(d, { from: 1, insert: '\nx\ny' }))).toEqual(
      mixed('crlf', 'crlf', 'crlf', 'crlf', 'lf'),
    );
  });

  it('maps a multi-range change set, each range at its own place', () => {
    const d = doc('a\nb\nc\nd');
    const f = mixed('lf', 'lf', 'crlf', 'lf');
    const cs = change(d, [
      { from: 1, insert: '\nA' }, // new break after line 1
      { from: 5, to: 6 }, // delete the break after "c"
    ]);
    expect(mapLineEndings(f, d, cs)).toEqual(mixed('lf', 'lf', 'lf', 'crlf'));
  });

  it('makes a uniform document mixed when a break with another ending is inserted', () => {
    const d = doc('a\nb');
    expect(mapLineEndings({ lineEnding: 'lf' }, d, change(d, { from: 1, insert: '\n' }), 'crlf')).toEqual(
      mixed('lf', 'crlf', 'lf'),
    );
  });

  it('collapses a record whose breaks all share one ending', () => {
    const d = doc('a\nb\nc');
    // Delete the only CRLF break: what remains is LF throughout.
    expect(mapLineEndings(mixed('lf', 'crlf', 'lf'), d, change(d, { from: 1, to: 2 }))).toEqual({ lineEnding: 'lf' });
    // …or CR throughout, which then IS the document's ending.
    expect(mapLineEndings(mixed('lf', 'cr', 'lf'), d, change(d, { from: 3, to: 4 }))).toEqual({ lineEnding: 'cr' });
  });

  it('keeps the dominant ending of a document left with no breaks at all', () => {
    const d = doc('a\nb');
    expect(mapLineEndings(mixed('crlf', 'lf'), d, change(d, { from: 1, to: 2 }))).toEqual({ lineEnding: 'crlf' });
  });
});
