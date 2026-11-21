/**
 * 062 FR-051 — what the project watch behind the tree and Find in Files may leave out: only a folder both ignore.
 *
 * Layer: unit — a pure predicate over four lists.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXCLUDE_GLOBS, DEFAULT_SEARCH_EXCLUDE_GLOBS } from '@throng/core';
import { projectWatchLeavesOut } from '../../src/main/project-watch-exclusion.js';

const defaults = {
  treeGlobs: DEFAULT_EXCLUDE_GLOBS,
  hiddenPaths: [] as string[],
  searchGlobs: DEFAULT_SEARCH_EXCLUDE_GLOBS,
  projectSearchGlobs: [] as string[],
};

describe('projectWatchLeavesOut (062 FR-051)', () => {
  it('leaves out what the shipped defaults of both ignore, at any depth', () => {
    const leavesOut = projectWatchLeavesOut(defaults);
    expect(leavesOut('node_modules')).toBe(true);
    expect(leavesOut('packages/ui/node_modules')).toBe(true);
    expect(leavesOut('.git')).toBe(true);
    expect(leavesOut('src')).toBe(false);
  });

  it('keeps a folder only search ignores, because the tree still draws it', () => {
    expect(projectWatchLeavesOut(defaults)('dist')).toBe(false);
  });

  it('keeps a folder only the tree ignores, because search still scans it', () => {
    const leavesOut = projectWatchLeavesOut({ ...defaults, hiddenPaths: ['docs'] });
    expect(leavesOut('docs')).toBe(false);
    const both = projectWatchLeavesOut({ ...defaults, hiddenPaths: ['docs'], projectSearchGlobs: ['docs'] });
    expect(both('docs')).toBe(true);
  });

  it('follows a user who unignores a folder in either list', () => {
    const treeShows = projectWatchLeavesOut({ ...defaults, treeGlobs: DEFAULT_EXCLUDE_GLOBS.filter((g) => g !== '**/node_modules') });
    expect(treeShows('node_modules')).toBe(false);
    const searchScans = projectWatchLeavesOut({ ...defaults, searchGlobs: DEFAULT_SEARCH_EXCLUDE_GLOBS.filter((g) => g !== '**/node_modules') });
    expect(searchScans('node_modules')).toBe(false);
  });
});
