import { describe, expect, it } from 'vitest';
import { resolveKnownExtensions } from '../../src/links/known-extensions.js';

/**
 * 045 T240 (FR-178, FR-178a) — the set FR-173e reads is the shipped list plus the user's additions,
 * less their removals. The setting stores the EDITS, not the resulting list, so an extension throng
 * ships later reaches every install that has not removed it.
 *
 * `resolveKnownExtensions(shipped, { added, removed })` is pure: each entry is trimmed, lower-cased and
 * stripped of one leading dot; an entry that is empty after that is dropped; `*` in `removed` removes
 * every SHIPPED entry (never an added one); the result is `(shipped ∪ added) − removed`, as a new set.
 */

const shipped: ReadonlySet<string> = new Set(['md', 'txt', 'log']);

const resolve = (added: readonly string[], removed: readonly string[]): string[] =>
  [...resolveKnownExtensions(shipped, { added, removed })].sort();

describe('resolveKnownExtensions — the shipped list, plus added, less removed (FR-178a)', () => {
  it('with no edits is the shipped list', () => {
    expect(resolve([], [])).toEqual(['log', 'md', 'txt']);
  });

  it('adds an entry', () => {
    expect(resolve(['foo'], [])).toEqual(['foo', 'log', 'md', 'txt']);
  });

  it('removes a shipped entry', () => {
    expect(resolve([], ['log'])).toEqual(['md', 'txt']);
  });

  it('removing an entry the list does not hold changes nothing', () => {
    expect(resolve([], ['xyz'])).toEqual(['log', 'md', 'txt']);
  });

  it('a removal wins over an addition of the same entry', () => {
    expect(resolve(['foo'], ['foo'])).toEqual(['log', 'md', 'txt']);
  });

  it('trims, lower-cases and strips one leading dot from every entry', () => {
    expect(resolve(['  .FOO ', 'Bar'], [' .LOG'])).toEqual(['bar', 'foo', 'md', 'txt']);
  });

  it('strips only ONE leading dot', () => {
    expect(resolve(['..x'], [])).toEqual(['.x', 'log', 'md', 'txt']);
  });

  it('drops entries that are empty after normalising', () => {
    expect(resolve(['', '   ', '.'], ['', ' . '])).toEqual(['log', 'md', 'txt']);
  });

  it('`*` in removed empties the shipped half (FR-178’s empty list)', () => {
    expect(resolve([], ['*'])).toEqual([]);
  });

  it('`*` is trimmed like any entry', () => {
    expect(resolve([], [' * '])).toEqual([]);
  });

  it('an addition survives `*`', () => {
    expect(resolve(['foo', 'MD'], ['*'])).toEqual(['foo', 'md']);
  });

  it('`*` in added is not a wildcard — it is an ordinary (useless) entry', () => {
    expect(resolve(['*'], [])).toEqual(['*', 'log', 'md', 'txt']);
  });

  it('returns a fresh set every time, and never mutates the shipped one', () => {
    const edits = { added: ['foo'], removed: ['md'] };
    const a = resolveKnownExtensions(shipped, edits);
    const b = resolveKnownExtensions(shipped, edits);
    expect(a).not.toBe(b);
    expect(a).not.toBe(shipped);
    expect(resolveKnownExtensions(shipped, { added: [], removed: [] })).not.toBe(shipped);
    expect([...shipped].sort()).toEqual(['log', 'md', 'txt']);
  });
});
