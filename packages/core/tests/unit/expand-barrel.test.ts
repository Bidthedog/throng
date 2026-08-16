import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import * as explorerBarrel from '../../src/explorer/index.js';
import * as coreBarrel from '../../src/index.js';
import * as expand from '../../src/explorer/expand.js';

// 033 baseline finding F9 (task T163). `findNode` and `childFolders` were given `export` in
// `explorer/expand.ts` so that `explorer/subtree.ts` could build US4's Collapse/Expand All Children
// targets over the same `ExpandNode` view. They were DELIBERATELY kept off both barrels: they are a
// module-internal seam shared by two files in one folder, not part of @throng/core's published
// surface, and `explorer/index.ts` exports only `ExpandNode` and `nextExpandTargets` from that file.
//
// WHY A TEST AND NOT A NOTE. F9 was raised as a documentation finding — the plan's Source-code map
// said `expand.ts` was untouched — and the plan is now corrected. But a documentation finding whose
// rule nothing enforces becomes a documentation finding again in six months: `export` in TypeScript
// carries no distinction between "visible to my sibling" and "visible to every consumer of this
// package", so the ONLY thing keeping these two off the public API is that nobody has yet added the
// obvious-looking barrel line. This file is what turns that into a decision someone has to argue
// with rather than a line they can add by reflex.
//
// If you are here because this test went red: adding either symbol to a barrel is a widening of a
// published package surface. Do it deliberately, in a spec, or import from `./expand.js` directly
// the way `subtree.ts` does.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** Every `.ts` file under packages/core/src, as a repo-style POSIX-ish relative path. */
function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(relative(SRC, full).split(sep).join('/'));
    }
  }
  return out;
}

/**
 * The named bindings any `import`/`export … from '…expand.js'` in `text` pulls in.
 *
 * Matches both forms on purpose: an `import` is a consumer and an `export … from` is a
 * re-publication, and this file has something to say about each.
 */
function bindingsFromExpand(text: string): string[] {
  const names: string[] = [];
  const clause = /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]*expand\.js)['"]/gu;
  for (const match of text.matchAll(clause)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u)[0].trim();
      if (name.length > 0) names.push(name);
    }
  }
  return names;
}

const INTERNAL = ['findNode', 'childFolders'] as const;

describe('expand.ts internal exports stay off the package barrels (F9)', () => {
  const files = sourceFiles();

  it('scanned a non-trivial number of core source files', () => {
    // Guard the guard: a scan that silently found nothing would pass every assertion below.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('explorer/expand.ts');
    expect(files).toContain('explorer/subtree.ts');
  });

  it('exports both symbols from expand.ts — the omission below is deliberate, not deletion', () => {
    // If this fails, the two functions were removed or renamed and the rest of this file is
    // asserting the absence of something that no longer exists, which would pass for the wrong
    // reason.
    for (const name of INTERNAL) {
      expect(typeof (expand as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it.each(INTERNAL)('does not re-export %s from packages/core/src/explorer/index.ts', (name) => {
    expect(Object.keys(explorerBarrel)).not.toContain(name);
  });

  it.each(INTERNAL)('does not re-export %s from packages/core/src/index.ts', (name) => {
    expect(Object.keys(coreBarrel)).not.toContain(name);
  });

  it('has no `export … from` re-publication of either symbol anywhere in core', () => {
    // The runtime checks above catch a value re-export. This catches the source-level form too,
    // including a `export type { … }` that would vanish at runtime and still widen the API.
    const republished = files.filter((file) => {
      if (!/(?:^|\/)index\.ts$/u.test(file)) return false;
      const text = readFileSync(join(SRC, file), 'utf8');
      return bindingsFromExpand(text).some((name) =>
        (INTERNAL as readonly string[]).includes(name),
      );
    });
    expect(republished).toEqual([]);
  });

  it('has subtree.ts as their ONLY in-package consumer', () => {
    const consumers = files.filter((file) => {
      const text = readFileSync(join(SRC, file), 'utf8');
      return bindingsFromExpand(text).some((name) =>
        (INTERNAL as readonly string[]).includes(name),
      );
    });
    // expand.ts itself uses both internally and imports neither, so it is correctly absent here.
    expect(consumers).toEqual(['explorer/subtree.ts']);
  });
});
