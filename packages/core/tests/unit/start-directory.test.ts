import { describe, it, expect } from 'vitest';
import { resolveStartDirectory } from '@throng/core';

const ROOT = 'C:/proj';
const exists = (set: string[]) => (p: string): boolean =>
  set.some((s) => s.toLowerCase() === p.toLowerCase());

describe('resolveStartDirectory (025 FR-028/FR-030/FR-031)', () => {
  it('uses the remembered directory when it still exists inside the project', () => {
    expect(resolveStartDirectory(ROOT, 'C:/proj/src', exists(['C:/proj/src']))).toBe('C:/proj/src');
  });

  it('falls back to the project root when there is no memory (today’s behaviour)', () => {
    expect(resolveStartDirectory(ROOT, undefined, exists([]))).toBe(ROOT);
    expect(resolveStartDirectory(ROOT, '', exists([]))).toBe(ROOT);
  });

  it('falls back to the root when the remembered directory no longer exists', () => {
    expect(resolveStartDirectory(ROOT, 'C:/proj/gone', exists([]))).toBe(ROOT);
  });

  it('falls back to the root when the remembered directory escaped the project (Principle I)', () => {
    // Even though it exists — a remembered path must never open a terminal in another project.
    expect(resolveStartDirectory(ROOT, 'C:/other/src', exists(['C:/other/src']))).toBe(ROOT);
  });

  it('accepts the root itself', () => {
    expect(resolveStartDirectory(ROOT, ROOT, exists([ROOT]))).toBe(ROOT);
  });

  it('is not fooled by a sibling directory sharing a prefix', () => {
    expect(resolveStartDirectory(ROOT, 'C:/project-other', exists(['C:/project-other']))).toBe(ROOT);
  });

  it('two panels resolve independently — neither collapses onto the other (FR-029)', () => {
    const e = exists(['C:/proj/a', 'C:/proj/b']);
    expect(resolveStartDirectory(ROOT, 'C:/proj/a', e)).toBe('C:/proj/a');
    expect(resolveStartDirectory(ROOT, 'C:/proj/b', e)).toBe('C:/proj/b');
  });
});
