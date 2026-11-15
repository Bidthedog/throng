import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOT_A_PLATFORM_SKIP, groupSkips, guardsIn, skipReasonFor } from '../support/skip-reasons.js';

/**
 * 070 FR-038, SC-002, SC-009: a broken macOS class must fail the macOS jobs, which it can only do if its contract and
 * integration files run there and nowhere else, and every test a Mac skips must say why.
 */
const PACKAGES = resolve(import.meta.dirname, '../../..');

function testFiles(dir: string): string[] {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : testFiles(path);
    return /\.test\.ts$/.test(e.name) ? [path] : [];
  });
}

const layerFiles = (pkg: string): string[] =>
  ['contract', 'integration'].flatMap((layer) => testFiles(join(PACKAGES, pkg, 'tests', layer)));
const read = (file: string): string => readFileSync(file, 'utf8');
const name = (file: string): string => relative(PACKAGES, file);

describe('macOS test guards', () => {
  it('every macOS contract and integration file carries skipUnlessMacos with a reason', () => {
    const files = layerFiles('platform-macos');
    expect(files.length).toBeGreaterThan(10);
    const unguarded = files.filter((file) => !guardsIn(read(file)).some((g) => g.platform === 'Macos' && g.reason.length > 0));
    expect(unguarded.map(name)).toEqual([]);
  });

  it('a contract or integration file outside the platform packages that uses a Windows or Linux class says which platform it needs, or picks macOS’s on darwin', () => {
    const others = readdirSync(PACKAGES).filter((pkg) => !pkg.startsWith('platform-'));
    const offending = others.flatMap(layerFiles).filter((file) => {
      const source = read(file);
      if (!/@throng\/platform-(windows|linux)|platform-(windows|linux)\/src/.test(source)) return false;
      return guardsIn(source).length === 0 && !source.includes("'darwin'");
    });
    expect(offending.map(name)).toEqual([]);
  });

  it('no contract or integration file skips on process.platform directly, where its reason would go unsaid', () => {
    const all = readdirSync(PACKAGES).flatMap(layerFiles);
    const bare = all.filter((file) => /\.skipIf\(\s*process\.platform/.test(read(file)));
    expect(bare.map(name)).toEqual([]);
  });
});

describe('the skip-reasons reporter’s reading of a file', () => {
  const source = [
    "describe.skipIf(skipUnlessLinux('reads /proc'))('a', () => {", // line 1
    "  it('x', () => {});",
    '});',
    "describe.skipIf(skipUnlessMacos(\"libproc is macOS's\"))('b', () => {", // line 4
    "  it('y', () => {});",
    '});',
  ].join('\n');

  it('finds each guard with its platform, reason and line', () => {
    expect(guardsIn(source)).toEqual([
      { platform: 'Linux', reason: 'reads /proc', line: 1 },
      { platform: 'Macos', reason: "libproc is macOS's", line: 4 },
    ]);
  });

  it('gives a skipped test the guard nearest above it', () => {
    expect(skipReasonFor(source, 2)).toBe('Linux: reads /proc');
    expect(skipReasonFor(source, 5)).toBe("Macos: libproc is macOS's");
  });

  it('groups skips by reason, and a file with no guard under none', () => {
    const groups = groupSkips(
      [
        { file: 'a', name: 'x', line: 2 },
        { file: 'a', name: 'y', line: 5 },
        { file: 'b', name: 'z', line: 1 },
      ],
      (file) => (file === 'a' ? source : "it.skipIf(process.platform === 'win32')('z', () => {});"),
    );
    expect(groups.get('Linux: reads /proc')?.map((t) => t.name)).toEqual(['x']);
    expect(groups.get(null)?.map((t) => t.name)).toEqual(['z']);
  });

  it('owes no platform reason for a skip in a file that never decides by platform (a tags filter, a fixture switch)', () => {
    const groups = groupSkips([{ file: 'c', name: 'perf', line: 1 }], () => "describe('perf', { tags: ['regression'] }, () => {});");
    expect(groups.get(null)).toBeUndefined();
    expect(groups.get(NOT_A_PLATFORM_SKIP)?.map((t) => t.name)).toEqual(['perf']);
  });

  it('reads skipOnMacos as a stated reason too', () => {
    expect(skipReasonFor("it.skipIf(skipOnMacos('a Mac has codesign'))('x', () => {});", 1)).toBe('Macos: a Mac has codesign');
  });
});
