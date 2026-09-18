import { describe, expect, it } from 'vitest';
import type { IPathForms } from '../../src/abstractions/path-forms.js';
import { resolveCandidate } from '../../src/links/resolve.js';
import type { LinkCandidate } from '../../src/links/types.js';

/**
 * 045 R1–R11 — `contracts/link-resolution.md` §2.
 *
 * `resolveCandidate` is pure: it returns the ORDERED list of absolute locations to try, and touches
 * no disk. "First that exists wins" is therefore a property of the ORDER, which is what these cases
 * assert; `existsFirst` below is the two-line walk main performs over the answer, written out here
 * so the ordering rules are stated as the outcomes they produce rather than as list indices.
 *
 * The fake `IPathForms` is Windows-shaped because that is the platform that ships, but nothing in
 * `resolve.ts` may know that — every drive letter and home folder below comes out of the fake.
 */

const HOME = 'C:\\Users\\dev';

const fakePathForms: IPathForms = {
  homeDirectory: () => HOME,
  fromDriveForm: (p) => {
    const m = /^\/(?:mnt\/)?([A-Za-z])(?:\/(.*))?$/.exec(p);
    return m ? `${m[1].toUpperCase()}:\\${(m[2] ?? '').replace(/\//g, '\\')}` : null;
  },
  fromFileUrl: (url) => {
    const m = /^file:\/\/([^/]*)\/(.*)$/i.exec(url);
    if (!m) return null;
    const rest = decodeURIComponent(m[2]).replace(/\//g, '\\');
    const host = m[1];
    if (host === '' || host.toLowerCase() === 'localhost') return rest;
    return `\\\\${host}\\${rest}`;
  },
  fromHomeForm: (p) => {
    if (p === '~') return HOME;
    const m = /^~[\\/](.*)$/.exec(p);
    return m ? `${HOME}\\${m[1].replace(/\//g, '\\')}` : null;
  },
};

const candidate = (text: string, extra: Partial<LinkCandidate> = {}): LinkCandidate => ({
  text,
  start: 0,
  end: text.length,
  ...extra,
});

const ctx = (over: { baseDirectory?: string; projectRoot?: string | null } = {}) => ({
  baseDirectory: over.baseDirectory,
  projectRoot: 'projectRoot' in over ? (over.projectRoot ?? null) : 'C:\\throng',
  pathForms: fakePathForms,
});

/** What main does with the answer: walk it, take the first that exists (R1). */
const existsFirst = (paths: readonly string[], exists: (p: string) => boolean): string | null =>
  paths.find((p) => exists(p)) ?? null;

describe('resolveCandidate — R2: drive and UNC forms map to themselves', () => {
  // "To themselves", and literally so: a form the platform already understands is passed through as
  // the user wrote it, in EITHER separator. Core may not name a separator (FR-026), and there is no
  // question to ask `IPathForms` here — the form needs no mapping. The spellings that DO need one,
  // `/d/x` and `file:`, come back from the port already in the platform's own separators, which is
  // where R2's "normalised by IPathForms" bites.
  it('a drive form, either separator', () => {
    expect(resolveCandidate(candidate('D:\\x\\foo.ts'), ctx())).toEqual(['D:\\x\\foo.ts']);
    expect(resolveCandidate(candidate('D:/x/foo.ts'), ctx())).toEqual(['D:/x/foo.ts']);
  });

  it('a UNC form, either separator', () => {
    expect(resolveCandidate(candidate('\\\\s\\h\\foo.ts'), ctx())).toEqual(['\\\\s\\h\\foo.ts']);
    expect(resolveCandidate(candidate('//s/h/foo.ts'), ctx())).toEqual(['//s/h/foo.ts']);
  });
});

describe('resolveCandidate — R3/R4: the drive forms and the home form go through IPathForms', () => {
  it('R3: /d/x and /mnt/d/x both name drive d', () => {
    const list = resolveCandidate(candidate('/d/git/x.ts'), ctx());
    expect(list).toContain('D:\\git\\x.ts');
    const wsl = resolveCandidate(candidate('/mnt/d/git/x.ts'), ctx());
    expect(wsl).toContain('D:\\git\\x.ts');
  });

  it('R4: ~/x maps through fromHomeForm', () => {
    expect(resolveCandidate(candidate('~/foo.ts'), ctx())).toEqual([`${HOME}\\foo.ts`]);
  });

  it('resolve.ts itself names no drive letter — the fake supplies every one', () => {
    const noMapping: IPathForms = { ...fakePathForms, fromDriveForm: () => null };
    const list = resolveCandidate(candidate('/d/git/x.ts'), {
      projectRoot: 'C:\\throng',
      pathForms: noMapping,
    });
    expect(list).not.toContain('D:\\git\\x.ts');
  });
});

describe('resolveCandidate — R5: a relative path tries the base directory FIRST', () => {
  it('US1 scenario 8 — a terminal in packages/core printing src/x.ts opens the one beside it', () => {
    const list = resolveCandidate(
      candidate('src/x.ts'),
      ctx({ baseDirectory: 'C:\\throng\\packages\\core' }),
    );
    expect(list).toEqual(['C:\\throng\\packages\\core\\src\\x.ts', 'C:\\throng\\src\\x.ts']);
    // Both exist: the base directory's copy is the one that wins.
    expect(existsFirst(list, () => true)).toBe('C:\\throng\\packages\\core\\src\\x.ts');
    // Only the project root's copy exists: the second attempt is what saves it.
    expect(existsFirst(list, (p) => p === 'C:\\throng\\src\\x.ts')).toBe('C:\\throng\\src\\x.ts');
  });

  it('./ and ../ forms resolve against the base directory too', () => {
    expect(
      resolveCandidate(candidate('./b.md'), ctx({ baseDirectory: 'C:\\throng\\docs' }))[0],
    ).toBe('C:\\throng\\docs\\b.md');
    expect(
      resolveCandidate(candidate('../docs/x.md'), ctx({ baseDirectory: 'C:\\throng\\src' }))[0],
    ).toBe('C:\\throng\\docs\\x.md');
  });

  it('R10: an untitled buffer supplies no base directory, so the project root is tried alone', () => {
    expect(resolveCandidate(candidate('test.txt'), ctx())).toEqual(['C:\\throng\\test.txt']);
  });
});

describe('resolveCandidate — R6: a leading / tries the PROJECT ROOT first', () => {
  it("#394's own example: /test.txt is the project's test.txt", () => {
    const list = resolveCandidate(candidate('/test.txt'), ctx());
    expect(list[0]).toBe('C:\\throng\\test.txt');
    expect(list).toHaveLength(2);
    expect(existsFirst(list, () => true)).toBe('C:\\throng\\test.txt');
  });

  it("the platform's own meaning of the path is tried second, not first", () => {
    const list = resolveCandidate(candidate('/test.txt'), ctx());
    expect(list[1]).not.toBe('C:\\throng\\test.txt');
    expect(existsFirst(list, (p) => p !== 'C:\\throng\\test.txt')).toBe(list[1]);
  });

  it('a drive form is NOT treated as a plain leading-slash path', () => {
    const list = resolveCandidate(candidate('/d/git/x.ts'), ctx());
    expect(list.indexOf('D:\\git\\x.ts')).toBeLessThan(list.length);
    expect(list[0]).toBe('C:\\throng\\d\\git\\x.ts');
  });
});

describe('resolveCandidate — R7: the positioned reading is tried before the reading without', () => {
  it('detection emits both and the ORDER of the two candidates is what decides', () => {
    // Detection's two readings of `C:\x\foo.ts:42:7`, in the order it emits them.
    const positioned = candidate('C:\\x\\foo.ts', {
      position: { line: 42, column: 7 },
      positionText: ':42:7',
    });
    const plain = candidate('C:\\x\\foo.ts:42:7');
    const attempts = [
      ...resolveCandidate(positioned, ctx()),
      ...resolveCandidate(plain, ctx()),
    ];
    expect(attempts).toEqual(['C:\\x\\foo.ts', 'C:\\x\\foo.ts:42:7']);
    expect(existsFirst(attempts, () => true)).toBe('C:\\x\\foo.ts');
    expect(existsFirst(attempts, (p) => p.endsWith(':42:7'))).toBe('C:\\x\\foo.ts:42:7');
  });
});

describe('resolveCandidate — R8: a file: URI is decoded through IPathForms', () => {
  it('no host, percent-decoded', () => {
    expect(resolveCandidate(candidate('file:///D:/a%20b/c.txt'), ctx())).toEqual(['D:\\a b\\c.txt']);
  });

  it('a host becomes the network location', () => {
    expect(resolveCandidate(candidate('file://server/share/x.txt'), ctx())).toEqual([
      '\\\\server\\share\\x.txt',
    ]);
  });

  it('localhost is the same as no host', () => {
    expect(resolveCandidate(candidate('file://localhost/D:/x'), ctx())).toEqual(
      resolveCandidate(candidate('file:///D:/x'), ctx()),
    );
  });

  it('a file: URI the port cannot convert yields nothing to try', () => {
    const blind: IPathForms = { ...fakePathForms, fromFileUrl: () => null };
    expect(resolveCandidate(candidate('file:///D:/x'), { projectRoot: null, pathForms: blind })).toEqual(
      [],
    );
  });
});

describe('resolveCandidate — R9/R11: what is deliberately NOT mapped', () => {
  it('R9: a POSIX path that is not a drive form gets no WSL mapping', () => {
    const list = resolveCandidate(candidate('/etc/hosts'), ctx());
    expect(list).toEqual(['C:\\throng\\etc\\hosts', '/etc/hosts']);
    expect(list.some((p) => /mnt/i.test(p))).toBe(false);
  });

  it('R11: projectRoot === null still resolves the absolute forms', () => {
    const rootless = ctx({ projectRoot: null });
    expect(resolveCandidate(candidate('D:\\x\\foo.ts'), rootless)).toEqual(['D:\\x\\foo.ts']);
    expect(resolveCandidate(candidate('~/foo.ts'), rootless)).toEqual([`${HOME}\\foo.ts`]);
  });

  it('R11: with no project root the project-root attempt is simply absent', () => {
    expect(resolveCandidate(candidate('/test.txt'), ctx({ projectRoot: null }))).toEqual(['/test.txt']);
    expect(resolveCandidate(candidate('test.txt'), ctx({ projectRoot: null }))).toEqual([]);
  });

  it('R1: a candidate with nothing to try is a non-link, not an error', () => {
    expect(resolveCandidate(candidate(''), ctx())).toEqual([]);
  });
});

describe('resolveCandidate — purity', () => {
  it('returns the same list for the same inputs and never mutates the candidate', () => {
    const c = candidate('src/foo.ts');
    const frozen = JSON.stringify(c);
    const a = resolveCandidate(c, ctx({ baseDirectory: 'C:\\throng\\packages' }));
    const b = resolveCandidate(c, ctx({ baseDirectory: 'C:\\throng\\packages' }));
    expect(a).toEqual(b);
    expect(JSON.stringify(c)).toBe(frozen);
  });

  it('never returns the same location twice', () => {
    const list = resolveCandidate(candidate('src/x.ts'), ctx({ baseDirectory: 'C:\\throng' }));
    expect(new Set(list).size).toBe(list.length);
  });
});
