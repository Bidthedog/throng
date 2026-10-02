import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 049 T046 (US5, FR-021, FR-025) — an editor that does not have focus keeps showing its selection, in the
 * Inactive Selection colour rather than the focused one. jsdom applies no stylesheet, so this reads
 * `editor.css` as `find-bar-highlight-css.test.ts` reads its own file. The focused rule must stay exactly as it
 * was, and the inactive one must out-rank the base rule that paints every `.cm-selectionBackground`.
 */
const EDITOR_CSS = readFileSync(
  fileURLToPath(new URL('../../src/renderer/editor/editor.css', import.meta.url)),
  'utf8',
);

/** The declarations of the rule whose selector list is exactly `selector`, comments removed. */
function declarationsOf(css: string, selector: string): Map<string, string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const m of text.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    if (m[1].trim().replace(/\s+/g, ' ') !== selector) continue;
    const declarations = new Map<string, string>();
    for (const part of m[2].split(';')) {
      const colon = part.indexOf(':');
      if (colon < 0) continue;
      declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
    }
    return declarations;
  }
  throw new Error(`no rule for ${selector}`);
}

describe('an unfocused editor’s selection (049 FR-021)', () => {
  it('paints in editorSelectionInactive', () => {
    const rule = declarationsOf(EDITOR_CSS, '.editor-panel .cm-editor:not(.cm-focused) .cm-selectionBackground');
    expect(rule.get('background')).toMatch(/^var\(--throng-colour-editorSelectionInactive\b.*!important$/);
  });

  it('is declared after the base selection rule, which it must out-rank', () => {
    expect(EDITOR_CSS.indexOf('.editor-panel .cm-editor:not(.cm-focused) .cm-selectionBackground {')).toBeGreaterThan(
      EDITOR_CSS.indexOf('.editor-panel .cm-selectionBackground,'),
    );
  });

  it('leaves the focused selection rule unchanged', () => {
    const rule = declarationsOf(EDITOR_CSS, '.editor-panel .cm-focused .cm-selectionBackground');
    expect(rule.get('background')).toMatch(/^var\(--throng-colour-editorSelection,.*!important$/);
  });
});
