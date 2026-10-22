import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { transformMsiProject } from '@throng/core';

/**
 * 058 research D1 — `packaging/msi-project.cjs` is the `msiProjectCreated` hook electron-builder
 * `require()`s. It must export the function itself (electron-builder takes `module.exports` or its
 * `default`), and that function must rewrite the file at the path it is given with
 * `transformMsiProject`.
 *
 * Layer: unit — a temporary file stands in for electron-builder's project file. The hook imports the
 * BUILT `@throng/core`, as it does under electron-builder, so this needs core built first (the gate
 * builds before unit).
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const hook = createRequire(import.meta.url)(join(repoRoot, 'packaging', 'msi-project.cjs'));
const fixture = readFileSync(join(repoRoot, 'packages', 'core', 'tests', 'unit', 'fixtures', 'msi-template-output.wxs'), 'utf8');

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-msi-hook-'));
  scratch.push(dir);
  const path = join(dir, 'project.wxs');
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('packaging/msi-project.cjs (058 research D1)', () => {
  it('exports the hook function itself, which is what electron-builder resolves', () => {
    expect(typeof hook).toBe('function');
  });

  it('rewrites the project file in place with the core transform', async () => {
    const path = projectFile(fixture);
    await hook(path);
    expect(readFileSync(path, 'utf8')).toBe(transformMsiProject(fixture));
  });

  it('is safe to run twice over the same file', async () => {
    const path = projectFile(fixture);
    await hook(path);
    const once = readFileSync(path, 'utf8');
    await hook(path);
    expect(readFileSync(path, 'utf8')).toBe(once);
  });

  it('fails, and leaves the file as it found it, when the template is not the one the transforms know', async () => {
    const strange = '<Wix><Product Id="*"></Product></Wix>';
    const path = projectFile(strange);
    await expect(hook(path)).rejects.toThrow(/cannot find|template/i);
    expect(readFileSync(path, 'utf8')).toBe(strange);
  });
});
