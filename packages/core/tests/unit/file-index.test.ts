import { describe, it, expect } from 'vitest';
import type { DirEntry, IFileSystem } from '../../src/abstractions/file-system.js';
import { walkFiles, diffPaths } from '../../src/explorer/file-index.js';

// 033 (contracts/file-index.md §1, W1–W8 and D1): the pure half of the project file index.
// `walkFiles` is the enumeration Quick Open is seeded from, and it knows nothing about an
// operating system — it asks the IFileSystem seam for a directory's children and nothing else
// (Principle II, W8). Everything below runs against a hand-written fake, so a failure here is a
// failure of the RULE, never of a real disk.

const file = (name: string, isSymlink = false): DirEntry => ({ name, kind: 'file', isSymlink });
const folder = (name: string, isSymlink = false): DirEntry => ({
  name,
  kind: 'folder',
  isSymlink,
});

/** An IFileSystem that answers `list` from a literal map and records what it was asked. */
function fakeFs(tree: Record<string, readonly DirEntry[]>): {
  fs: IFileSystem;
  listed: string[];
} {
  const listed: string[] = [];
  const unsupported = (name: string) => (): never => {
    throw new Error(`the walk must not call ${name}()`);
  };
  const fs = {
    async list(dir: string): Promise<DirEntry[]> {
      listed.push(dir);
      const entries = tree[dir];
      // A directory the parent listing named but that is no longer there (W6).
      if (entries === undefined) throw new Error(`ENOENT: no such file or directory, scandir '${dir}'`);
      return entries.map((entry) => ({ ...entry }));
    },
    mkdir: unsupported('mkdir'),
    stat: unsupported('stat'),
    realpath: unsupported('realpath'),
    rename: unsupported('rename'),
    move: unsupported('move'),
    copy: unsupported('copy'),
    delete: unsupported('delete'),
    trash: unsupported('trash'),
    restoreFromTrash: unsupported('restoreFromTrash'),
    exists: unsupported('exists'),
    readBytes: unsupported('readBytes'),
    writeBytes: unsupported('writeBytes'),
    size: unsupported('size'),
  } as unknown as IFileSystem;
  return { fs, listed };
}

const never = () => false;
const nothing = () => false;

describe('walkFiles — files only, root-relative, POSIX (W1, W2)', () => {
  const tree = {
    '/project': [folder('src'), file('README.md'), folder('docs')],
    '/project/src': [file('index.ts'), folder('deep')],
    '/project/src/deep': [file('nested.ts')],
    '/project/docs': [file('guide.md')],
  };

  it('lists every file beneath the root and no folder (W1)', async () => {
    const { fs } = fakeFs(tree);
    const paths = await walkFiles(fs, '/project', { cancelled: never, excluded: nothing });
    expect(paths).toEqual([
      'README.md',
      'docs/guide.md',
      'src/deep/nested.ts',
      'src/index.ts',
    ]);
    for (const folderName of ['src', 'docs', 'src/deep']) {
      expect(paths).not.toContain(folderName);
    }
  });

  it('produces root-relative POSIX paths, never an absolute one (W2)', async () => {
    const { fs } = fakeFs(tree);
    const paths = await walkFiles(fs, '/project', { cancelled: never, excluded: nothing });
    for (const path of paths) {
      expect(path.startsWith('/')).toBe(false);
      expect(path).not.toContain('\\');
      expect(path).not.toContain('/project');
    }
  });

  it('produces POSIX paths from a Windows-form root too (W2)', async () => {
    const { fs } = fakeFs({
      'C:\\project': [folder('src'), file('README.md')],
      'C:\\project\\src': [file('index.ts')],
    });
    const paths = await walkFiles(fs, 'C:\\project', { cancelled: never, excluded: nothing });
    expect(paths).toEqual(['README.md', 'src/index.ts']);
  });

  it('returns an empty array for an empty root', async () => {
    const { fs } = fakeFs({ '/project': [] });
    expect(await walkFiles(fs, '/project', { cancelled: never, excluded: nothing })).toEqual([]);
  });
});

describe('walkFiles — an excluded folder is not descended into (W3)', () => {
  const tree = {
    '/project': [folder('node_modules'), folder('src'), file('.DS_Store'), file('app.ts')],
    '/project/node_modules': [folder('pkg'), file('index.js')],
    '/project/node_modules/pkg': [file('deep.js')],
    '/project/src': [file('index.ts')],
  };

  it('omits the excluded folder and everything under it', async () => {
    const { fs } = fakeFs(tree);
    const paths = await walkFiles(fs, '/project', {
      cancelled: never,
      excluded: (rel) => rel === 'node_modules' || rel === '.DS_Store',
    });
    expect(paths).toEqual(['app.ts', 'src/index.ts']);
  });

  it('never even LISTS the excluded folder — the saving that makes node_modules free', async () => {
    const { fs, listed } = fakeFs(tree);
    await walkFiles(fs, '/project', {
      cancelled: never,
      excluded: (rel) => rel === 'node_modules',
    });
    expect(listed).toEqual(['/project', '/project/src']);
    expect(listed).not.toContain('/project/node_modules');
    expect(listed).not.toContain('/project/node_modules/pkg');
  });

  it('asks the predicate with the ROOT-RELATIVE path of each entry', async () => {
    const { fs } = fakeFs(tree);
    const asked: string[] = [];
    await walkFiles(fs, '/project', {
      cancelled: never,
      excluded: (rel) => {
        asked.push(rel);
        return rel === 'node_modules';
      },
    });
    expect(asked).toContain('node_modules');
    expect(asked).toContain('src');
    expect(asked).toContain('src/index.ts');
    expect(asked).toContain('app.ts');
    for (const rel of asked) expect(rel.startsWith('/')).toBe(false);
  });

  it('excludes a nested path by its full root-relative form', async () => {
    const { fs } = fakeFs(tree);
    const paths = await walkFiles(fs, '/project', {
      cancelled: never,
      excluded: (rel) => rel === 'src/index.ts' || rel === 'node_modules',
    });
    expect(paths).toEqual(['.DS_Store', 'app.ts']);
  });
});

describe('walkFiles — a symlinked directory is not followed (W4)', () => {
  const tree = {
    '/project': [folder('vendor', true), folder('src'), file('app.ts')],
    // The link's target — reachable only by following the link, which the walk must not do.
    '/project/vendor': [file('escaped.ts'), folder('deeper')],
    '/project/vendor/deeper': [file('further.ts')],
    '/project/src': [file('index.ts')],
  };

  it('produces nothing from beneath a symlinked directory', async () => {
    const { fs } = fakeFs(tree);
    const paths = await walkFiles(fs, '/project', { cancelled: never, excluded: nothing });
    expect(paths).toEqual(['app.ts', 'src/index.ts']);
    expect(paths).not.toContain('vendor/escaped.ts');
    expect(paths).not.toContain('vendor/deeper/further.ts');
  });

  it('does not list the symlinked directory at all', async () => {
    const { fs, listed } = fakeFs(tree);
    await walkFiles(fs, '/project', { cancelled: never, excluded: nothing });
    expect(listed).toEqual(['/project', '/project/src']);
  });

  it('still indexes a symlinked FILE — it is a file inside the root, and it opens', async () => {
    const { fs } = fakeFs({
      '/project': [file('shortcut.ts', true), file('real.ts')],
    });
    const paths = await walkFiles(fs, '/project', { cancelled: never, excluded: nothing });
    expect(paths).toEqual(['real.ts', 'shortcut.ts']);
  });
});

describe('walkFiles — cancellation is polled per directory (W5)', () => {
  const tree = {
    '/project': [folder('a'), folder('b'), file('root.ts')],
    '/project/a': [file('a1.ts'), folder('c')],
    '/project/a/c': [file('c1.ts')],
    '/project/b': [file('b1.ts')],
  };

  it('polls cancelled() at least once for every directory it reads', async () => {
    const { fs, listed } = fakeFs(tree);
    let polls = 0;
    await walkFiles(fs, '/project', {
      cancelled: () => {
        polls += 1;
        return false;
      },
      excluded: nothing,
    });
    expect(listed).toHaveLength(4);
    expect(polls).toBeGreaterThanOrEqual(listed.length);
  });

  it('produces nothing and reads nothing when it is cancelled before it starts', async () => {
    const { fs, listed } = fakeFs(tree);
    const paths = await walkFiles(fs, '/project', {
      cancelled: () => true,
      excluded: nothing,
    });
    expect(paths).toEqual([]);
    expect(listed).toEqual([]);
  });

  it('stops without completing when it is cancelled part-way, and produces nothing', async () => {
    const { fs, listed } = fakeFs(tree);
    let polls = 0;
    const paths = await walkFiles(fs, '/project', {
      cancelled: () => {
        polls += 1;
        return polls > 1;
      },
      excluded: nothing,
    });
    expect(paths).toEqual([]);
    expect(listed.length).toBeLessThan(4);
  });
});

describe('walkFiles — the tree changes while it is being read (W6)', () => {
  it('skips a directory that has disappeared rather than throwing', async () => {
    const { fs } = fakeFs({
      '/project': [folder('gone'), folder('src'), file('app.ts')],
      // '/project/gone' is deliberately absent — its parent named it, and then it was deleted.
      '/project/src': [file('index.ts')],
    });
    const paths = await walkFiles(fs, '/project', { cancelled: never, excluded: nothing });
    expect(paths).toEqual(['app.ts', 'src/index.ts']);
  });

  it('returns an empty array when the ROOT itself has gone', async () => {
    const { fs } = fakeFs({});
    await expect(
      walkFiles(fs, '/project', { cancelled: never, excluded: nothing }),
    ).resolves.toEqual([]);
  });

  it('keeps the files it had already found when a later directory disappears', async () => {
    const { fs } = fakeFs({
      '/project': [folder('a'), folder('b')],
      '/project/a': [file('kept.ts')],
      // '/project/b' vanished.
    });
    expect(await walkFiles(fs, '/project', { cancelled: never, excluded: nothing })).toEqual([
      'a/kept.ts',
    ]);
  });
});

describe('walkFiles — the output is sorted (W7)', () => {
  it('sorts regardless of the order the filesystem reported entries in', async () => {
    const { fs } = fakeFs({
      '/project': [folder('zeta'), file('m.ts'), folder('alpha'), file('a.ts')],
      '/project/zeta': [file('z2.ts'), file('z1.ts')],
      '/project/alpha': [file('a2.ts'), file('a1.ts')],
    });
    const paths = await walkFiles(fs, '/project', { cancelled: never, excluded: nothing });
    expect(paths).toEqual([...paths].sort());
    expect(paths).toEqual([
      'a.ts',
      'alpha/a1.ts',
      'alpha/a2.ts',
      'm.ts',
      'zeta/z1.ts',
      'zeta/z2.ts',
    ]);
  });
});

describe('diffPaths — exactly the symmetric difference (D1)', () => {
  it('reports two empty arrays for equal inputs', () => {
    const paths = ['a.ts', 'b.ts', 'c/d.ts'];
    expect(diffPaths(paths, [...paths])).toEqual({ added: [], removed: [] });
  });

  it('reports two empty arrays for two empty inputs', () => {
    expect(diffPaths([], [])).toEqual({ added: [], removed: [] });
  });

  it('reports what appeared', () => {
    expect(diffPaths(['a.ts', 'c.ts'], ['a.ts', 'b.ts', 'c.ts'])).toEqual({
      added: ['b.ts'],
      removed: [],
    });
  });

  it('reports what vanished', () => {
    expect(diffPaths(['a.ts', 'b.ts', 'c.ts'], ['a.ts', 'c.ts'])).toEqual({
      added: [],
      removed: ['b.ts'],
    });
  });

  it('reports both halves of a rename', () => {
    expect(diffPaths(['src/old.ts', 'x.ts'], ['src/new.ts', 'x.ts'])).toEqual({
      added: ['src/new.ts'],
      removed: ['src/old.ts'],
    });
  });

  it('handles an empty previous and an empty next', () => {
    expect(diffPaths([], ['a.ts', 'b.ts'])).toEqual({ added: ['a.ts', 'b.ts'], removed: [] });
    expect(diffPaths(['a.ts', 'b.ts'], [])).toEqual({ added: [], removed: ['a.ts', 'b.ts'] });
  });

  it('is order-stable — added and removed come out sorted, as their inputs were', () => {
    const previous = ['a.ts', 'b.ts', 'd.ts', 'f.ts'];
    const next = ['a.ts', 'c.ts', 'd.ts', 'e.ts'];
    expect(diffPaths(previous, next)).toEqual({
      added: ['c.ts', 'e.ts'],
      removed: ['b.ts', 'f.ts'],
    });
  });

  it('mutates neither input', () => {
    const previous = ['a.ts', 'b.ts'];
    const next = ['b.ts', 'c.ts'];
    diffPaths(previous, next);
    expect(previous).toEqual(['a.ts', 'b.ts']);
    expect(next).toEqual(['b.ts', 'c.ts']);
  });

  it('round-trips: previous minus removed plus added is next', () => {
    const previous = ['a.ts', 'b.ts', 'd.ts'];
    const next = ['a.ts', 'c.ts', 'd.ts', 'e.ts'];
    const { added, removed } = diffPaths(previous, next);
    const applied = [...previous.filter((p) => !removed.includes(p)), ...added].sort();
    expect(applied).toEqual(next);
  });
});
