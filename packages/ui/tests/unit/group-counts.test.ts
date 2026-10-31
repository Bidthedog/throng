/**
 * Row counts per foldable heading (056 FR-006, data-model "HeadingCount").
 *
 * Layer: unit — pure functions over descriptors.
 *
 * A heading's count includes every row beneath it, descendants too, and is keyed by the heading's
 * FoldKey — built from the descriptor's own strings, never from a test id (research R4).
 */
import { describe, expect, it } from 'vitest';
import { SETTINGS_METADATA, type FieldDescriptor } from '@throng/core';
import { foldKey, groupCounts, groupDescriptors } from '../../src/renderer/preferences/group-descriptors.js';

const d = (key: string, group: string, subgroup?: string, subsection?: string): FieldDescriptor =>
  ({
    key,
    label: key,
    description: key,
    group,
    control: 'boolean',
    ...(subgroup ? { subgroup } : {}),
    ...(subsection ? { subsection } : {}),
  }) as FieldDescriptor;

describe('foldKey', () => {
  it('is a JSON array of the names, one to three deep', () => {
    expect(foldKey('Editor')).toBe('["Editor"]');
    expect(foldKey('Editor', 'Previews')).toBe('["Editor","Previews"]');
    expect(foldKey('Editor', 'Previews', 'Markdown')).toBe('["Editor","Previews","Markdown"]');
  });

  it('cannot be ambiguous for names holding separators', () => {
    expect(foldKey('A · B', 'C')).not.toBe(foldKey('A', 'B · C'));
  });
});

describe('groupCounts', () => {
  const groups = groupDescriptors([
    d('a', 'Editor'),
    d('b', 'Editor', 'Previews'),
    d('c', 'Editor', 'Previews', 'Markdown'),
    d('e', 'Editor', 'Previews', 'Markdown'),
    d('f', 'Editor', 'Previews', 'Mermaid'),
    d('g', 'Terminal'),
  ]);
  const counts = groupCounts(groups);

  it('counts a section over every descendant row', () => {
    expect(counts.get(foldKey('Editor'))).toBe(5);
    expect(counts.get(foldKey('Terminal'))).toBe(1);
  });

  it('counts a subgroup over its own rows and its subsections', () => {
    expect(counts.get(foldKey('Editor', 'Previews'))).toBe(4);
  });

  it('counts a subsection over its own rows', () => {
    expect(counts.get(foldKey('Editor', 'Previews', 'Markdown'))).toBe(2);
    expect(counts.get(foldKey('Editor', 'Previews', 'Mermaid'))).toBe(1);
  });

  it('returns an empty map for no groups', () => {
    expect(groupCounts([]).size).toBe(0);
  });

  it('counts every row of the shipped registry under its section (moved down from the Settings tab)', () => {
    // The rendered count is `formatGrouped(count)` — digit grouping is asserted in
    // preferences-fold-heading.test.ts; what is left is that the number fed to it is right.
    const real = groupCounts(groupDescriptors(SETTINGS_METADATA));
    const sections = [...new Set(SETTINGS_METADATA.map((x) => x.group))];
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      expect(real.get(foldKey(section)), section).toBe(
        SETTINGS_METADATA.filter((x) => x.group === section).length,
      );
    }
  });
});
