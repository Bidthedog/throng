/**
 * A script that a test imports runs its body only when executed (`scripts/is-main.mjs`). Through a symlinked checkout
 * `process.argv[1]` is the link while `import.meta.url` is the target, so comparing them as given made
 * `npm run test:e2e` exit 0 having run nothing (072 code review).
 *
 * Layer: unit, on real files in a temp folder.
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { isMain } from '../../../../scripts/is-main.mjs';

const dir = mkdtempSync(join(tmpdir(), 'is-main-'));
const real = join(dir, 'script.mjs');
writeFileSync(real, '');
const link = join(dir, 'link.mjs');
let linked = true;
try {
  symlinkSync(real, link);
} catch {
  linked = false; // Windows without the symlink privilege
}
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('isMain', () => {
  const url = pathToFileURL(real).href;

  it('is true when the script itself is executed', () => {
    expect(isMain(url, real)).toBe(true);
  });

  it.skipIf(!linked)('is true when it is executed through a symlink', () => {
    expect(isMain(url, link)).toBe(true);
  });

  // macOS's temp folder is a symlink (/var → /private/var): Node gives import.meta.url resolved, argv[1] as typed.
  it.skipIf(!linked)('is true when the module and its entry reach one file by different routes', () => {
    expect(isMain(pathToFileURL(link).href, real)).toBe(true);
  });

  it('is false on import, from another entry point, or with no entry point', () => {
    expect(isMain(url, join(dir, 'other.mjs'))).toBe(false);
    expect(isMain(url, undefined)).toBe(false);
  });
});
