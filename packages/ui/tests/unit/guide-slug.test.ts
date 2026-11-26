import { referenceSlug } from '@throng/core';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS build script.
import { slug } from '../../../../scripts/guide-build.mjs';

/**
 * 080 FR-026, FR-028 — the builder (plain .mjs, which cannot import TS source) and core's help URLs slug a
 * reference's `##` heading by one rule, GitHub's. If they drift, every (?) link lands on a page that does not exist.
 */
const HEADINGS = [
  'Focus & Zoom',
  'Main panel / workspace',
  'CSV grid',
  'File Explorer',
  'On a keyboard that isn\'t UK or US',
  'Typography: Editor',
  '  New Project  ',
  'The `editor.wordWrap` setting',
  'Ünïcode — héadings',
  'snake_case and kebab-case',
];

describe("the builder's slug agrees with core's referenceSlug", () => {
  it.each(HEADINGS)('%s', (heading) => {
    expect(slug(heading)).toBe(referenceSlug(heading));
  });

  it('matches the examples core documents', () => {
    expect(slug('Focus & Zoom')).toBe('focus--zoom');
    expect(slug('Main panel / workspace')).toBe('main-panel--workspace');
    expect(slug('CSV grid')).toBe('csv-grid');
  });
});
