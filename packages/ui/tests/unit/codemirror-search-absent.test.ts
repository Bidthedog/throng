import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 033 G10 / FR-028 — CodeMirror's OWN search surfaces are not installed, anywhere.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/goto-line.e2e.ts:676` (035 T055) —
 * `test('CodeMirror's own go-to-line panel is not reachable — Ctrl+Alt+G opens nothing')`.
 *
 * ══ WHY A SOURCE GUARD IS STRONGER HERE, NOT WEAKER ══
 *
 * The E2E launched Electron, made a project, opened a file, pressed `Ctrl+Alt+G` and checked that
 * no `.cm-panels` container appeared. That is a true observation about ONE editor view, in one
 * window, in the one configuration that test built. `@codemirror/search`'s panel would arrive
 * through an `import`, and an import is a property of the SOURCE — so the question "is there a
 * second go-to-line surface in throng" is answered once, for every view that will ever be
 * constructed, by asking what the renderer imports.
 *
 * That is the same argument spec 035 made for `sidebar.e2e.ts:56`, and the same limit applies: this
 * proves the module is not pulled in, not that a hand-rolled `.cm-panels` could not be built by
 * other means. Nothing is doing that, and if something starts to, it will not be by importing this.
 *
 * ══ WHAT IS ALLOWED, AND WHY EXACTLY ONE THING IS ══
 *
 * `search-model.ts` imports `SearchQuery` — a plain matching object with a `getCursor`. It installs
 * no extension, binds no key and renders nothing. Everything else the package exports does:
 * `search()` mounts the panel extension, `searchKeymap` binds `Mod-Alt-g` to `gotoLine` and
 * `Mod-f` to `openSearchPanel`, and each of those is a second search surface whose controls cannot
 * be driven by throng's theme tokens (FR-014b).
 *
 * So the assertion is an ALLOW-LIST of imported bindings rather than a ban on named ones. A ban
 * lists what is known to be bad today and says nothing about `highlightSelectionMatches`, which
 * would be the next one added; an allow-list fails on anything new and makes whoever adds it say
 * why in the diff.
 */

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** The one binding that may be imported from `@codemirror/search`, and the file that may do it. */
const ALLOWED = new Map<string, readonly string[]>([['renderer/search/search-model.ts', ['SearchQuery']]]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `import … from '@codemirror/search'` in a file, as the set of bindings it brings in. */
function searchImports(src: string): string[] {
  const bindings: string[] = [];
  const re = /import\s+([\s\S]*?)\s+from\s+['"]@codemirror\/search['"]/g;
  for (const match of src.matchAll(re)) {
    const clause = match[1];
    const braced = /\{([\s\S]*?)\}/.exec(clause);
    if (braced) {
      for (const raw of braced[1].split(',')) {
        const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (name.length > 0) bindings.push(name);
      }
    }
    // A default or namespace import (`import * as search from …`) brings in EVERYTHING, so it is
    // recorded under a name no allow-list entry will match.
    const bare = clause.replace(/\{[\s\S]*?\}/, '').replace(/^,|,$/g, '').trim();
    if (bare.length > 0) bindings.push(`<namespace or default: ${bare}>`);
  }
  return bindings;
}

describe('FR-028 — no second go-to-line or find surface is installed', () => {
  const files = walk(SRC);

  it('reads a source tree at all — the sweep below is not vacuous', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('search-model.ts'))).toBe(true);
  });

  it('imports NOTHING from @codemirror/search but the matching type', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const bindings = searchImports(readFileSync(file, 'utf8'));
      if (bindings.length === 0) continue;
      const rel = file.slice(SRC.length).replace(/\\/g, '/');
      const allowed = ALLOWED.get(rel) ?? [];
      for (const binding of bindings) {
        if (!allowed.includes(binding)) offenders.push(`${rel} imports ${binding}`);
      }
    }

    expect(
      offenders,
      'search() mounts a panel, searchKeymap binds Mod-Alt-g to CodeMirror’s own go-to-line, ' +
        'and both are a SECOND surface with controls no theme token reaches (FR-028, FR-014b). ' +
        'If a new binding is genuinely inert, add it to ALLOWED with the reason.',
    ).toEqual([]);
  });

  it('finds the one import that IS there, so the allow-list is not describing an empty set', () => {
    // If `search-model.ts` ever stops importing SearchQuery, the test above passes trivially and
    // would keep passing after someone added `search()` somewhere and quietly widened ALLOWED.
    const src = readFileSync(join(SRC, 'renderer/search/search-model.ts'), 'utf8');
    expect(searchImports(src)).toEqual(['SearchQuery']);
  });
});
