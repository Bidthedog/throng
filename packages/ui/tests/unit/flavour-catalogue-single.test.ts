import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ONE terminal-flavour catalogue, read by every surface that offers one (033 US3, FR-030).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/open-in-terminal.e2e.ts:138` (035 T055) — `test('AS-1 — Open
 * In holds a Terminal submenu whose flavours match the panel type-picker exactly')`.
 *
 * ══ THE E2E COMPARED TWO RENDERINGS; THIS ASSERTS THEY CANNOT DIFFER ══
 *
 * That test opened a real project, switched a panel to `terminal` to read the shipped Flavour
 * dropdown, then right-clicked a folder and a file in the tree and compared the submenu's labels
 * against it — element by element, in order.
 *
 * Two of its three claims are already proven at unit:
 *
 *   `unit/explorer-terminal-menu.test.ts:96`  the submenu's children are EXACTLY the supplied
 *                                             catalogue, in order — "no second copy of the list"
 *   `unit/explorer-terminal-menu.test.ts:124` every item declares section "navigate", so neither
 *                                             level draws a divider (the E2E's A6 half)
 *
 * The third is the one those cannot state, because it is about two DIFFERENT components agreeing:
 * that the list the submenu is supplied with and the list the picker renders are the same list.
 * Comparing two renderings can only ever say they matched on the machine that ran the test; asking
 * what they READ says they cannot diverge on any machine.
 *
 * ══ WHY AN ALLOW-LIST OF CONSUMERS ══
 *
 * FR-030 forbids a second copy of the catalogue, and a second copy arrives as a new caller — so the
 * guard names who may read it and fails on anyone else. A ban on specific wrong ways of building a
 * list would say nothing about the next one invented.
 *
 * `listDetectedFlavours` is deliberately NOT the same thing and is not covered here:
 * `settings-tab.tsx:177` documents why it uses that instead, and `terminal-panel.tsx:496` records
 * that `listFlavours` re-detects installed shells on every call — a filesystem probe per call, which
 * is exactly why the two exist.
 */

const SRC = fileURLToPath(new URL('../../src/renderer/', import.meta.url));

/** The hook that owns the catalogue, and the only module that may reach the bridge for it. */
const OWNER = 'panel-type/use-flavours.ts';

/** Every surface that may offer a flavour list, and nothing else may. */
const CONSUMERS = new Set([
  'panel-type/panel-type-form.tsx', // the panel type-picker
  'explorer/file-tree.tsx', // the Open In → Terminal submenu
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string): string => file.slice(SRC.length).replace(/\\/g, '/');

/**
 * Files whose CODE (not comments) CALLS the identifier.
 *
 * A call, deliberately, and not a mention. The first draft matched the bare word, and the mutation
 * that makes a consumer stop reading the catalogue passed clean — because the `import` line still
 * named it. An unused import is exactly the residue a surface that grew its own list would leave.
 */
function callers(files: readonly string[], identifier: string): string[] {
  const found: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
      // Comments name these identifiers on purpose, explaining the very rule under test.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // `\?\.` too: the bridge is reached as `listFlavours?.()`, and a pattern that only matched a
    // plain call reported the OWNER as a non-caller and turned the baseline red.
    if (new RegExp(`\\b${identifier}\\s*(\\?\\.)?\\s*\\(`).test(src)) found.push(rel(file));
  }
  return found;
}

describe('FR-030 — the flavour catalogue has exactly one source', () => {
  const files = walk(SRC).filter((f) => !f.endsWith('global.d.ts'));

  it('reads a source tree at all — the sweeps below are not vacuous', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => rel(f) === OWNER)).toBe(true);
  });

  it('lets ONLY the catalogue hook call the bridge for the list', () => {
    /*
     * A component that called `listFlavours` itself would get a list that is correct at that moment
     * and drifts from every other surface afterwards — and would pass the E2E, which compared the
     * two renderings on one machine at one instant.
     */
    expect(callers(files, 'listFlavours')).toEqual([OWNER]);
  });

  it('lets ONLY the named surfaces read the hook', () => {
    const readers = callers(files, 'useFlavours').filter((f) => f !== OWNER);

    expect(
      readers.filter((f) => !CONSUMERS.has(f)),
      'a new surface offering terminal flavours must be added to CONSUMERS, deliberately',
    ).toEqual([]);
  });

  it('has BOTH named surfaces reading it — so the allow-list is not describing an empty set', () => {
    // The failure that makes the test above pass trivially: a consumer stops reading the hook,
    // presumably because it grew its own list some other way.
    const readers = new Set(callers(files, 'useFlavours').filter((f) => f !== OWNER));

    for (const consumer of CONSUMERS) {
      expect(readers.has(consumer), `${consumer} no longer reads the catalogue`).toBe(true);
    }
  });
});
