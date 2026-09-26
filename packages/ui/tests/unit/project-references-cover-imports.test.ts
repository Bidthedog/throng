import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every workspace package a `tsc -b` project imports MUST be one of its project references.
 *
 * The bug: `packages/ui` imported `@throng/platform-windows` from `src/main` without referencing
 * it. Under TypeScript 6 `tsc -b` built the projects one at a time in the root's listed order, so
 * platform-windows happened to be emitted before ui was checked and the gap was invisible.
 * TypeScript 7 builds independent projects IN PARALLEL: ui started as soon as core and
 * ipc-contract were done, read `platform-windows/dist` while platform-windows was still being
 * built, and — because the build shares its parsed files between projects — handed that torn
 * view on to `daemon`, which DOES reference platform-windows. The result was a from-clean
 * `npm run typecheck` failing 8 times in 10 locally (`probeChildPids` missing from
 * `NodePtyHost`) and on the remote gate (TS2307 "Cannot find module '@throng/platform-windows'"),
 * blaming whichever file lost the race rather than the tsconfig that caused it.
 *
 * This guard DISCOVERS rather than lists: it reads every package's tsconfig, walks the sources
 * that tsconfig includes, and fails for any `@throng/<pkg>` import whose package is not a
 * reference. The renderer is out of scope — Vite bundles it and `tsconfig.renderer.json` is a
 * separate `tsc -p` no-emit check outside the references graph.
 */

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url));

interface TsConfig {
  include?: string[];
  references?: { path: string }[];
}

/** tsconfig allows `//` line comments; JSON.parse does not. */
function readTsConfig(file: string): TsConfig {
  const text = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  return JSON.parse(text) as TsConfig;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** `src/main/**\/*` → `src/main`: every include in this repo is a directory glob. */
function includedRoots(pkgDir: string, config: TsConfig): string[] {
  return (config.include ?? []).map((pattern) => join(pkgDir, pattern.replace(/\/\*\*.*$/, '')));
}

const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"]@throng\/([a-z0-9-]+)['"]/g;

const projects = readdirSync(PACKAGES)
  .map((name) => ({ name, dir: join(PACKAGES, name) }))
  .filter(({ dir }) => {
    try {
      return statSync(join(dir, 'tsconfig.json')).isFile();
    } catch {
      return false;
    }
  });

describe('tsc -b project references cover every workspace import', () => {
  it('finds the projects it is meant to police', () => {
    expect(projects.map((p) => p.name)).toEqual(
      expect.arrayContaining(['core', 'daemon', 'platform-windows', 'ui']),
    );
  });

  it.each(projects.map((p) => [p.name, p.dir] as const))(
    '%s references every @throng package its compiled sources import',
    (name, dir) => {
      const config = readTsConfig(join(dir, 'tsconfig.json'));
      const referenced = new Set(
        (config.references ?? []).map((r) => r.path.replace(/^\.\.\//, '').replace(/\/$/, '')),
      );
      const missing = new Map<string, string>();
      for (const root of includedRoots(dir, config)) {
        for (const file of walk(root)) {
          for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
            const target = match[1]!;
            if (target !== name && !referenced.has(target) && !missing.has(target)) {
              missing.set(target, file.slice(PACKAGES.length).replaceAll('\\', '/'));
            }
          }
        }
      }
      expect(
        [...missing].map(([target, file]) => `@throng/${target} (first imported by ${file})`),
        `packages/${name}/tsconfig.json must reference these — tsc -b builds unreferenced ` +
          'projects in parallel and the importer then races their emit',
      ).toEqual([]);
    },
  );
});
