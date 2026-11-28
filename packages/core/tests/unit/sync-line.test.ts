/**
 * 081 FR-032 (#733) — the line a sync-scroll highlight names when the line under the centre of the scrolled view is
 * blank: the next non-blank line, or the previous one when nothing but blank lines follow, or none at all.
 */
import { describe, expect, it } from 'vitest';
import { nonBlankSyncLine, type SyncLineText } from '../../src/editor/sync-line.js';

const DOC = ['# Title', '', 'First paragraph.', '', '   ', 'Second paragraph.', '', ''];

describe('nonBlankSyncLine (081 FR-032)', () => {
  it('answers a non-blank line as it stands', () => {
    expect(nonBlankSyncLine(DOC, 0)).toBe(0);
    expect(nonBlankSyncLine(DOC, 2)).toBe(2);
  });

  it('moves a blank line to the next non-blank line, counting whitespace-only lines as blank', () => {
    expect(nonBlankSyncLine(DOC, 1)).toBe(2);
    expect(nonBlankSyncLine(DOC, 3)).toBe(5);
    expect(nonBlankSyncLine(DOC, 4)).toBe(5);
  });

  it('falls back to the previous non-blank line at the end of the document', () => {
    expect(nonBlankSyncLine(DOC, 6)).toBe(5);
    expect(nonBlankSyncLine(DOC, 7)).toBe(5);
  });

  it('clamps a line past either end of the document before looking', () => {
    expect(nonBlankSyncLine(DOC, 40)).toBe(5);
    expect(nonBlankSyncLine(DOC, -3)).toBe(0);
  });

  it('answers none for a document of blank lines, and for an empty one', () => {
    expect(nonBlankSyncLine(['', '  ', '\t'], 1)).toBeNull();
    expect(nonBlankSyncLine([], 0)).toBeNull();
  });

  it('reads a line source as it reads an array, asking only for the lines it walks', () => {
    const asked: number[] = [];
    const source: SyncLineText = {
      count: 1000,
      text: (line) => {
        asked.push(line);
        return line === 503 ? 'text' : '';
      },
    };
    expect(nonBlankSyncLine(source, 500)).toBe(503);
    expect(asked).toEqual([500, 501, 502, 503]);
  });
});
