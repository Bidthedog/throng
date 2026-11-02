/**
 * Section derivation for Markdown folding (047 T041, US3, FR-030 – FR-041d, research R3): the pure
 * functions `markdownSections`, `sectionAtLine` and `foldRangeFor`.
 *
 * Moved down from `component/editor-markdown-fold.test.ts`: they take plain records (and, for
 * `foldRangeFor`, a CodeMirror `Text`) and return plain values, so they need no DOM. The gutter, the
 * click, `syncFoldRanges` and the seeding stay at the component layer, where they run against an
 * `EditorView`.
 */
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { headingSlug, type HeadingRecord } from '@throng/core';
import {
  foldRangeFor,
  markdownSections,
  sectionAtLine,
  type EditorFoldSection,
} from '../../src/renderer/editor/markdown-fold.js';

function heading(level: HeadingRecord['level'], text: string, line: number, taken: Set<string>): HeadingRecord {
  return { level, text, slug: headingSlug(text, taken), line };
}

describe('markdownSections — a section runs to just before the next heading at its level or higher', () => {
  it('a flat run of H2s each end just before the next', () => {
    const taken = new Set<string>();
    const headings = [heading(2, 'A', 0, taken), heading(2, 'B', 3, taken), heading(2, 'C', 6, taken)];
    const sections = markdownSections(headings, 8);
    expect(sections).toEqual([
      { slug: 'a', level: 2, startLine: 0, endLine: 2 },
      { slug: 'b', level: 2, startLine: 3, endLine: 5 },
      { slug: 'c', level: 2, startLine: 6, endLine: 8 },
    ]);
  });

  it('an H1 followed by H2 children runs through them to the next H1 or the document end', () => {
    const taken = new Set<string>();
    const headings = [heading(1, 'Intro', 0, taken), heading(2, 'A', 2, taken), heading(2, 'B', 5, taken)];
    const sections = markdownSections(headings, 9);
    expect(sections.find((s) => s.slug === 'intro')).toEqual({ slug: 'intro', level: 1, startLine: 0, endLine: 9 });
    expect(sections.find((s) => s.slug === 'b')).toEqual({ slug: 'b', level: 2, startLine: 5, endLine: 9 });
  });

  it('a heading with nothing after it before the next has no content lines', () => {
    const taken = new Set<string>();
    const headings = [heading(2, 'A', 0, taken), heading(2, 'B', 1, taken)];
    expect(markdownSections(headings, 2)[0]).toEqual({ slug: 'a', level: 2, startLine: 0, endLine: 0 });
  });

  it('no headings gives no sections', () => {
    expect(markdownSections([], 5)).toEqual([]);
  });
});

describe('sectionAtLine — the innermost section containing a line, any level', () => {
  const sections: EditorFoldSection[] = [
    { slug: 'intro', level: 1, startLine: 0, endLine: 9 },
    { slug: 'a', level: 2, startLine: 2, endLine: 4 },
    { slug: 'b', level: 2, startLine: 5, endLine: 9 },
  ];

  it('a line inside a nested H2 resolves to the H2, not the enclosing H1', () => {
    expect(sectionAtLine(sections, 3)?.slug).toBe('a');
  });

  it('a line between the H1 heading and its first child resolves to the H1', () => {
    expect(sectionAtLine(sections, 1)?.slug).toBe('intro');
  });

  it('a line before the first heading resolves to nothing', () => {
    expect(sectionAtLine(sections, 0 - 1)).toBeNull();
    expect(sectionAtLine([{ slug: 'a', level: 1, startLine: 3, endLine: 5 }], 0)).toBeNull();
  });
});

describe('foldRangeFor — the CodeMirror range a section\'s content occupies', () => {
  const doc = EditorState.create({ doc: 'H1\nline1\nline2\nH2\nline3' }).doc;

  it('starts just after the heading line and ends at the section\'s last content line', () => {
    const range = foldRangeFor({ slug: 'a', level: 1, startLine: 0, endLine: 2 }, doc);
    expect(range).toEqual({ from: doc.line(1).to, to: doc.line(3).to });
  });

  it('is null when the section has no content', () => {
    const range = foldRangeFor({ slug: 'a', level: 1, startLine: 3, endLine: 3 }, doc);
    expect(range).toBeNull();
  });
});
