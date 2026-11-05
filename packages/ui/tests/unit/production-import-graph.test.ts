import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #542 — every process throng ships must load without its test tooling.
 *
 * The collector statically imported `@throng/core/testing`, whose barrel imports `vitest`. An installed app
 * has no `vitest`, and ESM resolves static imports before running anything, so the collector died on load in
 * every installed build while every test layer, running from the checkout, stayed green.
 *
 * Walks STATIC imports only, from each entry a packaged app runs. A dynamic `import()` is not an edge: it
 * loads only if that branch runs, which is how the collector's test-only fake stays out of production.
 */
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const ENTRIES = [
  'packages/ui/src/main/main.ts',
  'packages/ui/src/collector/resource-collector-entry.ts',
  'packages/daemon/src/main.ts',
  'packages/daemon/src/pty-agent-entry.ts',
];

/** `import x from 'y'`, `import 'y'`, `export … from 'y'`. `import type` and `export type` are erased. */
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

const packageName = (spec: string): string =>
  spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? spec);

const devOnly = (spec: string): boolean => {
  const name = packageName(spec);
  if (name === 'electron') return false; // the runtime itself provides it
  return manifest.devDependencies?.[name] !== undefined && manifest.dependencies?.[name] === undefined;
};

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith('.')
    ? resolve(dirname(from), spec)
    : spec.startsWith('@throng/')
      ? join(root, 'packages', spec.slice('@throng/'.length), 'src', 'index.ts')
      : null;
  if (base === null) return null;
  for (const candidate of [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')]) {
    if (candidate.endsWith('.js') === false && existsSync(candidate)) return candidate;
  }
  return null;
}

/** What each entry reaches that an installed app does not have, each with the chain that reached it. */
function forbiddenFrom(entry: string): string[] {
  const start = join(root, entry);
  const seen = new Map<string, string>([[start, entry]]);
  const queue = [start];
  const found: string[] = [];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const chain = seen.get(file) ?? file;
    for (const match of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const spec = match[1] ?? '';
      if (spec === '@throng/core/testing' || devOnly(spec)) {
        found.push(`${chain} -> ${spec}`);
        continue;
      }
      const next = resolveLocal(file, spec);
      if (next !== null && !seen.has(next)) {
        seen.set(next, `${chain} -> ${next.slice(root.length)}`);
        queue.push(next);
      }
    }
  }
  return found;
}

describe('what a packaged process loads (#542)', () => {
  it.each(ENTRIES)('%s reaches no test code and no devDependency', (entry) => {
    expect(forbiddenFrom(entry)).toEqual([]);
  });

  it('walks far enough to mean something', () => {
    // A walker that stopped at the entry would pass everything: the collector does reach the platform layer.
    const start = join(root, 'packages/ui/src/collector/resource-collector-entry.ts');
    expect(resolveLocal(start, '@throng/core')).toBe(join(root, 'packages/core/src/index.ts'));
    expect(resolveLocal(start, './composition-root.js')).toBe(join(root, 'packages/ui/src/collector/composition-root.ts'));
    expect('import { a } from "vitest";'.matchAll(STATIC_IMPORT).next().value?.[1]).toBe('vitest');
    expect('import type { a } from "vitest";'.matchAll(STATIC_IMPORT).next().done).toBe(true);
  });
});
