/**
 * 060 FR-008, FR-009, FR-010 — one match style on two surfaces, bold only where it belongs.
 *
 * jsdom applies no stylesheet, so these read the CSS text (the reading `find-bar-highlight-css.test.ts`
 * does for the editor). The find bar's rule is WIDENED to cover the results list rather than copied
 * into `find-in-files.css`, so the two surfaces cannot drift (research R8); the results sheet then
 * declares no background of its own for a match, and anything it left unused is deleted (FR-010).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(resolve(__dirname, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');

const findBar = read('../../src/renderer/search/find-bar.css');
const fif = read('../../src/renderer/find-in-files/find-in-files.css');

/** Every top-level rule as [selector list, declarations], at-rule bodies flattened. */
function rules(css: string): { selector: string; declarations: Map<string, string> }[] {
  const out: { selector: string; declarations: Map<string, string> }[] = [];
  for (const m of css.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const part of m[2].split(';')) {
      const colon = part.indexOf(':');
      if (colon > 0) declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
    }
    out.push({ selector: m[1].trim().replace(/\s+/g, ' '), declarations });
  }
  return out;
}

/** A selector list split on its top-level commas — not the one inside `:where(a, b)`. */
function selectorList(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of selector) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

/** Declarations of every rule whose selector LIST contains exactly `selector`. */
function declarationsFor(css: string, selector: string): Map<string, string>[] {
  return rules(css)
    .filter((r) => selectorList(r.selector).some((s) => s === selector))
    .map((r) => r.declarations);
}

describe('the match style is one definition shared by the editor and the results (FR-009)', () => {
  it('styles .throng-search-match under :where(.cm-editor, .fif-results)', () => {
    const [rule] = declarationsFor(findBar, ':where(.cm-editor, .fif-results) .throng-search-match');
    expect(rule, 'the find bar rule is not widened to the results list').toBeDefined();
    expect(rule.get('background')).toMatch(/^var\(--throng-colour-searchMatch,/);
    expect(rule.get('outline')).toMatch(/^1px solid var\(--throng-colour-searchMatchBorder\b/);
  });

  it('widens the current-match rule the same way', () => {
    const [rule] = declarationsFor(
      findBar,
      ':where(.cm-editor, .fif-results) .throng-search-match--current',
    );
    expect(rule, 'the current-match rule is not widened to the results list').toBeDefined();
    expect(rule.get('outline')).toMatch(/^2px solid var\(--throng-colour-searchMatchCurrentBorder\b/);
  });

  it('leaves no copy of the editor-scoped rule behind', () => {
    expect(declarationsFor(findBar, '.cm-editor .throng-search-match')).toEqual([]);
  });
});

describe('the results sheet declares no match background of its own (FR-009, FR-010)', () => {
  it('sets no background on .fif-match, under any state of the row', () => {
    const offenders = rules(fif).filter(
      (r) =>
        r.selector.split(',').some((s) => /\.fif-match(?![\w-])/.test(s)) &&
        (r.declarations.has('background') || r.declarations.has('background-color')),
    );
    expect(offenders.map((r) => r.selector)).toEqual([]);
  });
});

describe('only headings are bold (FR-008)', () => {
  it('gives a result row no bold weight', () => {
    for (const decl of declarationsFor(fif, '.fif-row')) {
      const weight = decl.get('font-weight');
      if (weight !== undefined) expect(weight).not.toMatch(/bold|[6-9]00|--throng-font-weight-bold/);
    }
  });

  it('weights .fif-group__key with the bold token — one rule, for folder and file headings alike', () => {
    const decls = declarationsFor(fif, '.fif-group__key');
    expect(decls.length).toBeGreaterThan(0);
    expect(decls.some((d) => d.get('font-weight') === 'var(--throng-font-weight-bold)')).toBe(true);
    // Not conditioned on the heading's kind: a folder heading is as bold as a file heading.
    expect(rules(fif).some((r) => /\.fif-group\[data-group-kind[^\]]*\]\s*\.fif-group__key/.test(r.selector))).toBe(false);
  });
});

describe('the muted folder beside a file name (FR-004)', () => {
  it('is textMuted at normal weight', () => {
    const decls = declarationsFor(fif, '.fif-group__dir');
    expect(decls.length, 'no .fif-group__dir rule').toBeGreaterThan(0);
    const merged = new Map(decls.flatMap((d) => [...d]));
    expect(merged.get('color')).toBe('var(--throng-colour-textMuted)');
    // Normal weight is the Pane Text role's own (a literal `normal` is a hardcoded weight, which
    // `find-in-files-typography.test.ts` forbids anywhere in the sheet), and never the bold token.
    expect(merged.get('font-weight')).toBe('var(--throng-font-paneText-weight)');
  });

  it('truncates before the name does — the directory shrinks first', () => {
    const merged = new Map(declarationsFor(fif, '.fif-group__dir').flatMap((d) => [...d]));
    expect(merged.get('overflow')).toBe('hidden');
    expect(merged.get('text-overflow')).toBe('ellipsis');
    // A larger flex-shrink than the name's, which is what makes it give way first.
    const nameShrink = Number(
      new Map(declarationsFor(fif, '.fif-group__key').flatMap((d) => [...d]))
        .get('flex-shrink') ?? 1,
    );
    expect(Number(merged.get('flex-shrink') ?? 1)).toBeGreaterThan(nameShrink);
  });
});
