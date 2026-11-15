import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultPipeName, resolveIpcAddress } from '@throng/core';
import { skipOnWindows, withHostTraits } from '@throng/core/testing';
import { findCaseSensitiveRoots, macosIpcDirectory, macosTraitsForThisProcess } from '../../src/macos-host.js';

const byteLength = (s: string): number => Buffer.byteLength(s, 'utf8');
/** macOS's `sun_path` is 104 bytes (`<sys/un.h>`), NUL included. */
const SUN_PATH_MAX = 104;

describe('the IPC folder (070 FR-016, research R4)', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('is `$TMPDIR/throng`, the per-user temporary folder macOS gives each login', () => {
    expect(macosIpcDirectory({ TMPDIR: '/var/folders/ab/cdef/T/' }, 501)).toBe('/var/folders/ab/cdef/T/throng');
  });

  it('falls back to a per-user folder under /tmp when $TMPDIR is unset or not absolute, never a shared one', () => {
    expect(macosIpcDirectory({}, 501)).toBe('/tmp/throng-501');
    expect(macosIpcDirectory({ TMPDIR: 'relative' }, 501)).toBe('/tmp/throng-501');
  });

  it.skipIf(skipOnWindows('Windows has no POSIX owner-only mode for chmod to set'))('is created owner-only', () => {
    // Under /tmp, not tmpdir(): a test run's own TMPDIR can be deep enough that the folder moves to /tmp/throng-<uid>.
    const base = mkdtempSync('/tmp/throng-macos-host-');
    made.push(base);
    const traits = macosTraitsForThisProcess({ TMPDIR: base }, { pathconf: () => 0, volumes: () => [] });
    expect(traits.ipc).toEqual({ kind: 'socket', dir: join(base, 'throng') });
    expect(statSync(join(base, 'throng')).mode & 0o777).toBe(0o700);
  });

  it('uses the per-user /tmp folder when $TMPDIR is too deep for any socket name to fit (a test run folder)', () => {
    const deep = `/var/folders/5n/5t77mfb93jd7q8v9s6f0dn0m0000gn/T/throng_e2e_mwhsf0qq-3ff67051`;
    expect(macosIpcDirectory({ TMPDIR: deep }, 501)).toBe('/tmp/throng-501');
    withHostTraits({ os: 'macos', paths: { caseSensitive: false, backslashIsSeparator: false }, ipc: { kind: 'socket', dir: macosIpcDirectory({ TMPDIR: deep }, 501) } }, () => {
      expect(byteLength(resolveIpcAddress(defaultPipeName('dev')))).toBeLessThan(SUN_PATH_MAX);
    });
  });

  it('keeps every socket address inside sun_path for a 60-character $TMPDIR and a 200-character home', () => {
    const tmp = `/var/folders/${'x'.repeat(60 - '/var/folders/'.length - 3)}/T/`;
    expect(tmp.length).toBe(60);
    const home = `/Users/${'h'.repeat(200 - '/Users/'.length)}`;
    const dir = macosIpcDirectory({ TMPDIR: tmp, HOME: home }, 501);
    withHostTraits({ os: 'macos', paths: { caseSensitive: false, backslashIsSeparator: false }, ipc: { kind: 'socket', dir } }, () => {
      for (const name of [defaultPipeName('dev'), defaultPipeName(home), `\\\\.\\pipe\\${home}`, `throng.${'n'.repeat(120)}`]) {
        const address = resolveIpcAddress(name);
        expect(address.startsWith(`${dir}/`)).toBe(true);
        expect(byteLength(address)).toBeLessThan(SUN_PATH_MAX);
      }
    });
  });
});

describe('case-sensitive volume discovery (070 FR-020, research R4)', () => {
  it('lists / and each mounted volume that answers _PC_CASE_SENSITIVE = 1, and nothing else', () => {
    const answers: Record<string, number> = { '/': 0, '/Volumes/Work': 1, '/Volumes/Photos': 0, '/Volumes/Odd': -1 };
    const roots = findCaseSensitiveRoots({
      pathconf: (path) => answers[path] ?? 0,
      volumes: () => ['/Volumes/Work', '/Volumes/Photos', '/Volumes/Odd'],
    });
    expect(roots).toEqual(['/Volumes/Work']);
  });

  it('includes the boot volume when it is the case-sensitive one', () => {
    expect(findCaseSensitiveRoots({ pathconf: () => 1, volumes: () => [] })).toEqual(['/']);
  });

  it('treats a volume that cannot be asked as the default rule, so one bad mount does not stop startup', () => {
    expect(
      findCaseSensitiveRoots({
        pathconf: () => {
          throw new Error('ENOENT');
        },
        volumes: () => ['/Volumes/Gone'],
      }),
    ).toEqual([]);
  });

  it('puts the roots it found into the traits', () => {
    const base = mkdtempSync(join(tmpdir(), 'throng-macos-host-'));
    try {
      const traits = macosTraitsForThisProcess(
        { TMPDIR: base },
        { pathconf: (p) => (p === '/Volumes/Work' ? 1 : 0), volumes: () => ['/Volumes/Work'] },
      );
      expect(traits.os).toBe('macos');
      expect(traits.paths.caseSensitiveRoots).toEqual(['/Volumes/Work']);
      expect(traits.paths.unicodeForm).toBe('NFC');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
