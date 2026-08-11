import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #228 — a Panel's React identity must be its panel id, everywhere it is rendered.
 *
 * React reconciles by position and element type. A Panel rendered without a `key` therefore lets a
 * DIFFERENT panel inherit the component instance standing in the same slot — and a panel's instance
 * holds the state that decides what it IS: the editor's `configRef` (its file path), its CodeMirror
 * view and document replica, the terminal's attachment. Switching to a project whose layout has the
 * same shape mounted one project's panel id on top of another project's editor, which then loaded
 * the wrong project's file into it; with a dirty buffer it left unsaved content wearing a path from
 * a project it had never been in, one confinement check away from being written over the wrong file.
 *
 * This is a SOURCE guard rather than a rendered-output assertion because there is no jsdom layer in
 * this repo (the idiom `icon-call-sites.test.ts` established) — and here that is the stronger test.
 * The defect survived review as an ABSENT prop, which no test of the code that was changed could
 * catch. So the guard is shaped like the requirement: find every place a Panel is rendered, wherever
 * it is, and insist it carries a key.
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

/** Strip comments: the guard polices CODE, and this rule is explained in prose beside it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const sources = walk(RENDERER, /\.tsx$/);

describe('a Panel is keyed by its panel id wherever it is rendered (#228)', () => {
  it('every <PanelPlaceholder …> element carries a key', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const code = stripComments(readFileSync(file, 'utf8'));
      // Each opening tag, up to the end of its props. Self-closing or not; attributes may span
      // lines, which is why this matches to the first `>` that is not inside an expression.
      for (const match of code.matchAll(/<PanelPlaceholder\b([^>]*)>/g)) {
        if (!/\bkey=/.test(match[1])) offenders.push(`${file}: ${match[0].slice(0, 80)}`);
      }
    }
    expect(
      offenders,
      'an unkeyed Panel lets another panel reuse its component instance — its editor document, ' +
        'its terminal attachment — when a same-shaped layout takes its place (#228):\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('the split tree keys its Panel leaf by the node id, not by position', () => {
    const file = join(RENDERER, 'workspace', 'split-tree.tsx');
    const code = stripComments(readFileSync(file, 'utf8'));
    // Position — an index, or the path this recursion carries — is precisely what cannot identify a
    // panel: it is the same for the panel that was there before and the one that replaced it.
    expect(code).toMatch(/<PanelPlaceholder\b[^>]*\bkey=\{node\.id\}/);
    expect(code).not.toMatch(/<PanelPlaceholder\b[^>]*\bkey=\{(index|path)/);
  });
});
