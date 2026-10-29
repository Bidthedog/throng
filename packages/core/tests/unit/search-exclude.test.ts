import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXCLUDE_GLOBS,
  DEFAULT_SEARCH_EXCLUDE_GLOBS,
  compileExcluder,
  parseExcludeBox,
  pathToSearchGlob,
  searchExcludeGlobs,
} from '@throng/core';

/**
 * 060 #532 (FR-025–FR-030, research R19) — what a Find in Files scan skips, composed in one place.
 */

const ADDITIONS = [
  '**/dist',
  '**/build',
  '**/out',
  '**/coverage',
  '**/.claude',
  '**/.vscode',
  '**/.idea',
  '**/log',
  '**/logs',
  '**/*.log',
  '**/.remember',
  '**/.cache',
  '**/.turbo',
  '**/.next',
  '**/.nuxt',
  '**/target',
  '**/bin',
  '**/obj',
  '**/.venv',
  '**/__pycache__',
  '**/*.min.js',
  '**/*.map',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
];

describe('DEFAULT_SEARCH_EXCLUDE_GLOBS (FR-026)', () => {
  it('is the explorer’s shipped list as it stood on 2026-10-29, then the additions, in that order', () => {
    // A literal, not `DEFAULT_EXCLUDE_GLOBS`: a later addition to the explorer's list must not join
    // search silently (FR-025). Today the two prefixes agree.
    const EXPLORER_AT_532 = ['**/.git', '**/.svn', '**/.hg', '**/CVS', '**/.DS_Store', '**/Thumbs.db', '**/node_modules'];
    expect(DEFAULT_SEARCH_EXCLUDE_GLOBS).toEqual([...EXPLORER_AT_532, ...ADDITIONS]);
    expect(EXPLORER_AT_532).toEqual([...DEFAULT_EXCLUDE_GLOBS]);
  });

  it('is a copy, not the explorer’s list: the two are not linked (FR-025)', () => {
    expect(DEFAULT_SEARCH_EXCLUDE_GLOBS).not.toBe(DEFAULT_EXCLUDE_GLOBS);
    expect(Object.isFrozen(DEFAULT_SEARCH_EXCLUDE_GLOBS)).toBe(true);
  });
});

describe('parseExcludeBox (FR-029)', () => {
  it('splits on semicolons, trims, and drops empty entries', () => {
    expect(parseExcludeBox(' **/fixtures ; *.snap;;  ')).toEqual({ globs: ['**/fixtures', '*.snap'], invalid: [] });
  });

  it('is empty for an empty box', () => {
    expect(parseExcludeBox('')).toEqual({ globs: [], invalid: [] });
  });

  it('reports an entry that is not a glob, and keeps the rest', () => {
    expect(parseExcludeBox('**/a;[;**/b')).toEqual({ globs: ['**/a', '**/b'], invalid: ['['] });
  });
});

describe('searchExcludeGlobs — the one list a scan compiles (FR-027, FR-029, FR-030)', () => {
  const lists = { global: ['**/dist'], project: ['**/generated'], extra: ['**/fixtures'] };
  const excluded = (useGlobal: boolean, path: string): boolean =>
    compileExcluder(searchExcludeGlobs({ ...lists, useGlobal }))(path);

  it('applies the global list only while the toggle is on', () => {
    expect(excluded(true, 'dist/b.js')).toBe(true);
    expect(excluded(false, 'dist/b.js')).toBe(false);
  });

  it('applies the project list and the panel’s box whatever the toggle says', () => {
    for (const useGlobal of [true, false]) {
      expect(excluded(useGlobal, 'generated/g.ts')).toBe(true);
      expect(excluded(useGlobal, 'fixtures/d.txt')).toBe(true);
    }
  });

  it('excludes everything beneath a matched folder, not only the folder', () => {
    expect(excluded(true, 'pkg/dist/deep/b.js')).toBe(true);
    expect(excluded(false, 'generated/sub/g.ts')).toBe(true);
  });

  it('leaves everything else searchable', () => {
    expect(excluded(true, 'src/a.ts')).toBe(false);
  });
});

describe('pathToSearchGlob — a path chosen from a menu (FR-033, FR-034)', () => {
  it('matches that path and what is beneath it, and nothing else', () => {
    const excluded = compileExcluder(searchExcludeGlobs({ global: [], useGlobal: true, project: [pathToSearchGlob('src/[gen]')], extra: [] }));
    expect(excluded('src/[gen]')).toBe(true);
    expect(excluded('src/[gen]/x.ts')).toBe(true);
    expect(excluded('src/g')).toBe(false);
  });

  it('normalises backslashes and a leading slash', () => {
    expect(pathToSearchGlob('\\src\\gen\\')).toBe('src/gen');
  });
});
