import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 080 FR-009 — a help URL is built from one base URL, defined once (`packages/core/src/help/help-urls.ts`).
 * A guide URL written out anywhere else in the app's source is a second home that will not move when
 * the guide does.
 */

const ROOT = process.cwd();
const HOME = join('packages', 'core', 'src', 'help', 'help-urls.ts');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') sources(path, out);
    } else if (/\.(m?[jt]sx?|cts)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('help URLs have one home', () => {
  it('writes no throng-ide.com/guide URL outside help-urls.ts', () => {
    const packages = join(ROOT, 'packages');
    const offenders = readdirSync(packages)
      .map((p) => join(packages, p, 'src'))
      .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true)
      .flatMap((dir) => sources(dir))
      .map((file) => relative(ROOT, file))
      .filter((file) => file !== HOME)
      .filter((file) => readFileSync(join(ROOT, file), 'utf8').includes('throng-ide.com/guide'));
    expect(offenders).toEqual([]);
  });
});
