/**
 * 055 SC-002 (as amended for the window) — the monitor window is shown, loading state and all, within 1 s
 * of the click on a window not yet open. The click → IPC → `new BrowserWindow` part is a few milliseconds;
 * what fills the second is the renderer loading and running its scripts before it can paint. Measured on
 * Linux (2026-11-19): click → first-contentful-paint 223–244 ms, ~200 ms of it before the entry's own body
 * ran, loading the whole main-window app (~2.3 MB: xterm, the workspace, the panels) that the monitor
 * never draws — because `main.tsx` imported every window kind's app statically, and `monitor-app.tsx`
 * reached `composition-root.tsx` for one hook. A hosted macOS runner is about four times slower and
 * crossed the second by 0.7 ms. (The other large share, deriving the bundled themes at import, is pinned in
 * core's `default-themes-derived-on-read.test.ts`; the chunk graph, in `vite.config.ts`'s
 * `failOnHeavyMonitor`.)
 *
 * So this pins what reaches the monitor window before its first paint: the static-import closure of the
 * renderer entry plus the monitor's app must not include the main window's app or its heavy libraries.
 * A dynamic `import()` is a separate chunk loaded on demand, so it is not followed.
 *
 * Unit, because the question is the import graph, which the source answers without a build or a window;
 * the E2E (`resource-monitor.e2e.ts`) times the real interval.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RENDERER = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/renderer');

/** The module specifiers a file imports STATICALLY, type-only imports left out (they are erased). */
function staticImports(source: string): string[] {
  const out: string[] = [];
  const fromClause = /^[ \t]*(import|export)\s+(?!type\s)([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/gm;
  for (const m of source.matchAll(fromClause)) {
    const clause = m[2] ?? '';
    const braces = /^\{([\s\S]*)\}$/.exec(clause.trim());
    if (braces && braces[1]!.split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '))) continue;
    out.push(m[3]!);
  }
  for (const m of source.matchAll(/^[ \t]*import\s*['"]([^'"]+)['"]/gm)) out.push(m[1]!);
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every renderer file and bare package reached from `entries` through static imports alone. */
function staticClosure(entries: string[]): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of staticImports(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        if (spec.endsWith('.css')) continue;
        const next = resolveLocal(file, spec);
        if (next !== null) pending.push(next);
      } else {
        packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);
      }
    }
  }
  return { files, packages };
}

const rel = (f: string): string => relative(RENDERER, f).replace(/\\/g, '/');

/** The main window's own app and the libraries only it needs: none of it may load before the monitor paints. */
const MAIN_WINDOW_ONLY = /^(composition-root\.tsx|app\.tsx|subworkspace-app\.tsx|terminal\/|editor\/|preview\/|explorer\/|preferences\/)/;
const HEAVY_PACKAGES = /^(@xterm\/|@codemirror\/|@lezer\/|@dnd-kit\/|react-arborist$|markdown-it$|mermaid$)/;

describe('the monitor window loads only its own app before its first paint (055 SC-002, FR-081)', () => {
  const { files, packages } = staticClosure([join(RENDERER, 'main.tsx'), join(RENDERER, 'resources/monitor-app.tsx')]);

  it('reaches none of the main window’s app through static imports', () => {
    expect([...files].map(rel).filter((f) => MAIN_WINDOW_ONLY.test(f))).toEqual([]);
  });

  it('reaches none of the main window’s heavy libraries through static imports', () => {
    expect([...packages].filter((p) => HEAVY_PACKAGES.test(p))).toEqual([]);
  });

  it('the walk is not vacuous: it does reach the monitor’s shell and React', () => {
    expect([...files].map(rel)).toEqual(expect.arrayContaining(['main.tsx', 'resources/monitor-app.tsx', 'title-bar/title-bar.tsx']));
    expect(packages).toContain('react');
    // The same walk from the main window's app does reach what is forbidden above — so the patterns can match.
    const main = staticClosure([join(RENDERER, 'composition-root.tsx')]);
    expect([...main.files].map(rel).some((f) => MAIN_WINDOW_ONLY.test(f))).toBe(true);
    expect([...main.packages].some((p) => HEAVY_PACKAGES.test(p))).toBe(true);
  });
});
