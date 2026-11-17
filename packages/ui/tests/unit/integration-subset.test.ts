/**
 * 072 FR-008: pull-request CI runs a declared critical-path subset of the integration layer, bounded at 15 files, so
 * that layer answers in seconds without anyone deciding per PR what to run.
 *
 * Layer: unit. It reads the integration test files as text; the subset is declared by a describe-level
 * `{ tags: ['critical-path'] }`, which `ci.yml` selects with `--tags-filter=critical-path`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../../..');
const MAX = 15;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const integrationFiles = readdirSync(join(ROOT, 'packages'))
  .map((pkg) => join(ROOT, 'packages', pkg, 'tests', 'integration'))
  .filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  })
  .flatMap(walk)
  .filter((f) => f.endsWith('.test.ts'));

const CRITICAL = /tags:\s*\[[^\]]*['"]critical-path['"]/;
const tagged = integrationFiles
  .filter((f) => CRITICAL.test(readFileSync(f, 'utf8')))
  .map((f) => relative(ROOT, f).replaceAll('\\', '/'))
  .sort();

describe('the integration critical-path subset', () => {
  it('finds the integration layer', () => {
    expect(integrationFiles.length).toBeGreaterThan(MAX);
  });

  it(`declares between 1 and ${MAX} files`, () => {
    const listing = `\n  ${tagged.join('\n  ')}`;
    expect(tagged.length, `no integration file is tagged critical-path; PR CI would run none${listing}`).toBeGreaterThan(
      0,
    );
    expect(tagged.length, `${tagged.length} files are tagged critical-path, over the ${MAX} FR-008 allows${listing}`)
      .toBeLessThanOrEqual(MAX);
  });
});
