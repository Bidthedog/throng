import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 067 FR-013: no OS clipboard or drag format name appears outside the platform layer. */
const FORMAT_NAMES = ['text/uri-list', 'gnome-copied-files', 'x-kde-cutselection', 'Preferred DropEffect'];
const SCANNED = ['packages/core/src', 'packages/daemon/src', 'packages/ipc-contract/src', 'packages/persistence/src', 'packages/ui/src'];

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx|cts|mts)$/.test(name) ? [path] : [];
  });
}

describe('OS clipboard format names (067 FR-013)', () => {
  it('stay in the platform packages', () => {
    const offenders = SCANNED.flatMap(sourcesUnder).flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      return FORMAT_NAMES.filter((name) => text.includes(name)).map((name) => `${relative(process.cwd(), path)}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });
});
