import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 046 iterate round 1 (FR-073, T135) — the File Explorer's and the Projects pane's active outline
 * must be exactly as wide as the panes' own default border, not the 2px the workspace panels' active
 * outline uses (`theme.css:581,2115`, untouched by this FR — it lives in a different file and this
 * test never reads it).
 *
 * WHAT IS RED, AND WHY: `panes.css`'s `.pane-explorer__body--active::after` /
 * `.projects-panel--active::after` rule still draws `border: 2px solid …` (`panes.css:52`). The
 * panes' own default border — `.pane--explorer`'s `border-left` — is 1px (`panes.css:19`), which is
 * the width FR-073 asks the active outline to match.
 *
 * Parsed as TEXT rather than through `getComputedStyle`: jsdom does not resolve a stylesheet's
 * cascade for an element nothing here renders, and a source-level check is exactly what proves the
 * DECLARED width without needing to mount anything (`preview-text-selection-css.test.ts` is the same
 * technique on a different file). CRLF-tolerant: nothing below anchors on a specific line ending —
 * the regexes work identically whether the file's line endings are LF (local) or CRLF (CI checkout).
 */
const PANES_CSS = readFileSync(
  fileURLToPath(new URL('../../src/renderer/panes/panes.css', import.meta.url)),
  'utf8',
);

interface Rule {
  selectors: string[];
  declarations: Map<string, string>;
}

/** Innermost rules, comments removed, each selector list split on commas. */
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

function borderWidthPx(declaration: string | undefined): number | null {
  const m = declaration?.match(/^(\d+)px\s+solid\b/);
  return m ? Number(m[1]) : null;
}

describe("the side-pane active outline is as thin as the panes' default border (FR-073)", () => {
  it('both .pane-explorer__body--active::after and .projects-panel--active::after draw a 1px border', () => {
    const parsed = rules(PANES_CSS);
    // Guard: the parse actually sees the shared rule, so the width check below is not vacuous.
    const rule = parsed.find(
      (r) =>
        r.selectors.includes('.pane-explorer__body--active::after') &&
        r.selectors.includes('.projects-panel--active::after'),
    );
    expect(rule, 'the shared active-outline rule for both side panes').toBeDefined();
    expect(borderWidthPx(rule!.declarations.get('border'))).toBe(1);
  });

  it("the panes' own default border (.pane--explorer's border-left) is itself 1px — the width the active outline must match, and the workspace panels' 2px outline this FR leaves untouched lives in theme.css, not here", () => {
    const parsed = rules(PANES_CSS);
    const defaultBorder = parsed.find((r) => r.selectors.includes('.pane--explorer'));
    expect(defaultBorder, 'the .pane--explorer default-border rule').toBeDefined();
    const width = defaultBorder!.declarations.get('border-left')?.match(/^(\d+)px/)?.[1];
    expect(Number(width)).toBe(1);
  });
});
