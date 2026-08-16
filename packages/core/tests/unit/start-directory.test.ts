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

/**
 * 033 FR-032 — a START DIRECTORY is contained by the same rule, and that is the whole claim.
 *
 * The contract (§B.6) says containment is "inherited" by handing a `startDirectory` to this very
 * resolver instead of writing a second one. Inheritance is only worth claiming if it is measured,
 * so these are the containment cases stated in the terms 033 uses — a folder the user right-clicked
 * in the tree, not a directory a shell was left in.
 *
 * ══ WHY THIS IS THE FIRST UNTRUSTED INPUT ON THIS PATH ══
 *
 * `rememberedCwd` is the daemon's read of a live OS process's working directory: it is absolute, it
 * is already resolved, and it cannot contain a `..`. `startDirectory` is persisted on the workspace
 * layout JSON, which a user can edit — so 033 is the release in which a path arrives here that
 * nothing in the app produced. The last case is the one that was passing for the wrong reason.
 */
describe('resolveStartDirectory with a START DIRECTORY (033 FR-032)', () => {
  it('honours a start directory inside the project', () => {
    expect(resolveStartDirectory(ROOT, 'C:/proj/src/deep', exists(['C:/proj/src/deep']))).toBe(
      'C:/proj/src/deep',
    );
  });

  it('refuses a start directory OUTSIDE the root and substitutes the root', () => {
    // Exists on disk and is a perfectly good directory — containment is why it is refused, which is
    // the one guarantee §B.6 claims to inherit rather than re-implement.
    expect(resolveStartDirectory(ROOT, 'D:/somewhere/else', exists(['D:/somewhere/else']))).toBe(ROOT);
  });

  it('refuses a sibling whose name merely BEGINS with the root', () => {
    expect(resolveStartDirectory(ROOT, 'C:/proj-other/src', exists(['C:/proj-other/src']))).toBe(ROOT);
  });

  it('refuses a start directory that walks OUT of the root with `..`', () => {
    // The containment check compares strings; `statSync` and the shell resolve them. A prefix-only
    // rule answers "contained" here and the shell then starts in C:/Windows/System32.
    const escape = 'C:/proj/../Windows/System32';
    expect(resolveStartDirectory(ROOT, escape, exists([escape]))).toBe(ROOT);
    expect(resolveStartDirectory(ROOT, 'C:/proj/src/../../elsewhere', exists([]))).toBe(ROOT);
  });

  it('still accepts a folder whose NAME contains dots', () => {
    // The refusal above is about `..` as a path SEGMENT. A folder called `..config` is a folder.
    expect(resolveStartDirectory(ROOT, 'C:/proj/..config', exists(['C:/proj/..config']))).toBe(
      'C:/proj/..config',
    );
  });
});
