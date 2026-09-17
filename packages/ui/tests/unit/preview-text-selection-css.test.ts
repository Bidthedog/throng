import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 044 T182 — a preview's body text can be selected with the mouse (FR-035, FR-094; iteration
 * 2026-09-15, Request 2).
 *
 * `theme.css` turns text selection off for the whole application on `body`, and re-enables it only
 * for the surfaces it names. A preview body inherited `none`, so Chromium would not start a mouse
 * selection in it — while every component test that selects with the Range API kept passing, because
 * jsdom applies no stylesheet and `addRange` ignores `user-select`.
 *
 * This pins the CAUSE, not the behaviour; `preview-scroll.e2e.ts` (T183) drags in a real Chromium for
 * the behaviour. Both files are read the way `preview-css-tokens.test.ts` reads them.
 */
const THEME_CSS = readFileSync(fileURLToPath(new URL('../../src/renderer/theme.css', import.meta.url)), 'utf8');
const MARKDOWN_CSS = readFileSync(
  fileURLToPath(new URL('../../src/renderer/preview/providers/markdown/markdown.css', import.meta.url)),
  'utf8',
);

interface Rule {
  selectors: string[];
  declarations: Map<string, string>;
}

/** Innermost rules, comments removed; each selector list split on commas. */
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out: Rule[] = [];
  for (const m of text.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    const declarations = new Map<string, string>();
    for (const part of m[2].split(';')) {
      const colon = part.indexOf(':');
      if (colon < 0) continue;
      const property = part.slice(0, colon).trim().toLowerCase();
      if (property) declarations.set(property, part.slice(colon + 1).trim());
    }
    out.push({ selectors, declarations });
  }
  return out;
}

describe('preview body text selection (FR-035, FR-094)', () => {
  it("theme.css's body rule turns selection off app-wide — which is why the preview must re-enable it", () => {
    const body = rules(THEME_CSS).filter((r) => r.selectors.includes('body') && r.declarations.has('user-select'));
    expect(body.length, 'a body rule declaring user-select').toBeGreaterThan(0);
    expect(body.some((r) => r.declarations.get('user-select') === 'none')).toBe(true);
  });

  it('markdown.css re-enables selection on .preview-markdown, standard and -webkit- forms', () => {
    const parsed = rules(MARKDOWN_CSS);
    // Guard: the parse sees the file's rules, so the check below is not vacuous.
    expect(parsed.some((r) => r.selectors.includes('.preview-markdown'))).toBe(true);
    const reenabling = parsed.filter(
      (r) =>
        r.selectors.includes('.preview-markdown') &&
        r.declarations.get('user-select') === 'text' &&
        r.declarations.get('-webkit-user-select') === 'text',
    );
    expect(reenabling.length, 'a .preview-markdown rule with user-select: text and -webkit-user-select: text').toBeGreaterThan(0);
  });
});
