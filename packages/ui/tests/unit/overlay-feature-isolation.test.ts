import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 033 FR-071a — no overlay may learn about another overlay to know whether to close.
 *
 * FR-071 could have been satisfied by teaching Quick Open about the tab picker: import
 * `tab-picker.js`, ask whether it is open, close it. That passes every behavioural test and is
 * precisely the design the requirement forbids, because the coupling is invisible in the behaviour
 * and the NEXT overlay added would have to repeat it against three features instead of one.
 *
 * So the requirement is structural, and it gets a structural test — the shape
 * `icon-call-sites.test.ts` and `floating-surfaces.test.ts` already established here. The
 * behavioural half lives in `tests/e2e/transient-overlays.e2e.ts`; this half is what stops the
 * mechanism rotting back into cross-feature imports while the E2E stays green.
 *
 * The permitted dependency is on `renderer/common/transient-overlay.ts`, which is shared
 * infrastructure and knows about no feature at all: an overlay tells it "I am open" and "here is how
 * to close me", and learns nothing in return.
 */
const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, match));
    else if (match.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Strip comments before matching.
 *
 * The guard polices IMPORTS, not prose. `navigation-chrome.tsx` explains at length why it must not
 * reach into `workspace/` — naming it, necessarily — and a guard that failed on the documentation of
 * its own rule would train the next author to delete the explanation rather than keep the rule.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every module specifier the file imports from, however the import is written. */
function importsOf(file: string): string[] {
  const src = code(file);
  const out: string[] = [];
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) out.push(m[1] as string);
  return out;
}

const navigateFiles = walk(join(RENDERER, 'navigate'), /\.tsx?$/);
const workspaceFiles = walk(join(RENDERER, 'workspace'), /\.tsx?$/);

describe('no overlay imports another overlay’s feature (FR-071a)', () => {
  it('scans a non-trivial number of files (the guard must not pass by finding nothing)', () => {
    // A guard that silently scanned zero files — a directory renamed, a glob that stopped matching —
    // would be green and worthless. Both halves of the rule need a corpus.
    expect(navigateFiles.length).toBeGreaterThan(3);
    expect(workspaceFiles.length).toBeGreaterThan(10);
  });

  it('nothing under renderer/navigate/ imports the tab picker or the tab group', () => {
    const offenders = navigateFiles.filter((file) =>
      importsOf(file).some((spec) => /(^|\/)workspace\/tab-(picker|group)(\.js)?$/.test(spec)),
    );
    expect(
      offenders.map((f) => f.replace(RENDERER, '')),
      'Quick Open and Go To Line must not know the tab picker exists. Dismissal goes through ' +
        'renderer/common/transient-overlay.ts, which knows about no feature at all (FR-071a).',
    ).toEqual([]);
  });

  it('nothing under renderer/workspace/ imports renderer/navigate/', () => {
    const offenders = workspaceFiles.filter((file) =>
      importsOf(file).some((spec) => /(^|\/)navigate\//.test(spec)),
    );
    expect(
      offenders.map((f) => f.replace(RENDERER, '')),
      'the tab picker must not know the navigation modals exist — the dependency is inverted ' +
        'through renderer/common/transient-overlay.ts (FR-071a).',
    ).toEqual([]);
  });

  it('the shared registry itself depends on no feature', () => {
    // The inversion is only real while the thing both sides depend on is neutral. A single import of
    // `../navigate/` or `../workspace/` here would re-create the coupling in one place instead of two.
    const specs = importsOf(join(RENDERER, 'common', 'transient-overlay.ts'));
    expect(specs.filter((s) => /(^|\/)(navigate|workspace|editor)\//.test(s))).toEqual([]);
  });
});
