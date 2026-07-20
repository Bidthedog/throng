import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { THRONG_THEME } from '@throng/core';

/**
 * 021 / US8, FR-022 — the standing usage guard.
 *
 * A theme token is only real if something PAINTS with it and something TESTS it. This guard asserts,
 * for every current colour token, that it has (a) ≥1 live consumer — a `--throng-colour-<token>` read
 * in a renderer stylesheet, or one of the documented TypeScript consumers (`terminal-panel.tsx` reads
 * the `terminal*` colours from the theme object; `highlight-style.ts` composes the `syntax*` vars) —
 * and (b) ≥1 test assertion covering it (the `default-themes` completeness assertion, which iterates
 * every colour token and asserts each theme populates it, counts for the value tokens).
 *
 * The other half proves the 021 consolidation is COMPLETE: `menuSurface`, `dialogSurface` and the four
 * legacy `button*` tokens must have ZERO consumers — if the repoint had missed one, a stale
 * `var(--throng-colour-dialogSurface)` would light this up.
 */

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));
const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url)); // the monorepo `packages/` dir

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === '.claude') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, match));
    else if (match.test(entry)) out.push(path);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/** Tokens with a live consumer: CSS var reads + the documented renderer TS consumers. */
function consumers(): Set<string> {
  const found = new Set<string>();

  // 1. Every `var(--throng-colour-<token>)` read in a renderer stylesheet.
  for (const file of walk(RENDERER, /\.css$/)) {
    const css = stripComments(readFileSync(file, 'utf8'));
    for (const [, name] of css.matchAll(/var\(\s*--throng-colour-([a-zA-Z][a-zA-Z0-9]*)/g)) {
      if (name) found.add(name);
    }
  }

  // 2. Renderer TypeScript. Three shapes cover the documented consumers:
  //    - `var(--throng-colour-<token>)` written directly in a .tsx string;
  //    - `v('<token>')` — the highlight-style var composer (syntax*, editorFg);
  //    - `c.<token>` / `colours.<token>` — terminal-panel reads the terminal* colours off the object.
  for (const file of walk(RENDERER, /\.(ts|tsx)$/)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const [, name] of src.matchAll(/var\(\s*--throng-colour-([a-zA-Z][a-zA-Z0-9]*)/g)) {
      if (name) found.add(name);
    }
    for (const [, name] of src.matchAll(/\bv\(\s*['"]([a-zA-Z][a-zA-Z0-9]*)['"]\s*\)/g)) {
      if (name) found.add(name);
    }
    for (const [, name] of src.matchAll(/\b(?:c|colours)\.([a-zA-Z][a-zA-Z0-9]*)/g)) {
      if (name) found.add(name);
    }
  }
  return found;
}

/** Tokens named in a test-file assertion, plus the default-themes completeness credit. */
function assertionCoverage(): { covered: Set<string>; completeness: boolean } {
  const covered = new Set<string>();
  let completeness = false;
  for (const file of walk(PACKAGES, /\.test\.ts$/)) {
    const src = readFileSync(file, 'utf8');
    // The completeness assertion iterates every colour token and asserts each theme populates it.
    if (/Object\.keys\(\s*THRONG_THEME\.colours\s*\)/.test(src) && /theme\.colours\[\s*token\s*\]/.test(src)) {
      completeness = true;
    }
    for (const [, name] of src.matchAll(/['"]([a-zA-Z][a-zA-Z0-9]*Button(?:Bg|HoverBg|Border|HoverBorder|Text|HoverText))['"]/g)) {
      if (name) covered.add(name);
    }
    for (const [, name] of src.matchAll(/--throng-colour-([a-zA-Z][a-zA-Z0-9]*)/g)) {
      if (name) covered.add(name);
    }
  }
  return { covered, completeness };
}

const COLOUR_TOKENS = Object.keys(THRONG_THEME.colours);
const REMOVED = ['menuSurface', 'dialogSurface', 'buttonBg', 'buttonText', 'buttonHoverBg', 'buttonHoverText'];

describe('theme token usage guard (FR-022)', () => {
  const used = consumers();
  const { covered, completeness } = assertionCoverage();

  it('every current colour token has ≥1 live consumer', () => {
    const orphans = COLOUR_TOKENS.filter((t) => !used.has(t));
    expect(orphans, `colour tokens with no consumer:\n${orphans.join('\n')}`).toEqual([]);
  });

  it('every current colour token is covered by a test assertion', () => {
    // Value tokens are covered by the default-themes completeness assertion; that assertion MUST exist.
    expect(completeness, 'the default-themes completeness assertion is missing').toBe(true);
    const uncovered = COLOUR_TOKENS.filter((t) => !completeness && !covered.has(t));
    expect(uncovered, `colour tokens with no test assertion:\n${uncovered.join('\n')}`).toEqual([]);
  });

  it('the removed tokens (menuSurface/dialogSurface/legacy buttons) have ZERO consumers', () => {
    const stragglers = REMOVED.filter((t) => used.has(t));
    expect(stragglers, `removed tokens still consumed — repoint incomplete:\n${stragglers.join('\n')}`).toEqual([]);
  });
});
