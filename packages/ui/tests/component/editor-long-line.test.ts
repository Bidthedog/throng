import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LONG_LINE_THRESHOLD } from '../../src/renderer/editor/highlight-style.js';
import { mountEditor } from './helpers/mount-editor.js';

/**
 * A very long line is not HIGHLIGHTED, and is still a document (016 FR-008a).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-highlighting.e2e.ts:201` (035 T055) —
 * `test('a >10,000-character line renders unhighlighted but editable, while the rest of the file
 * highlights (FR-008a)')`.
 *
 * ══ WHAT THE E2E ASSERTED, AND WHERE IT LIVES ══
 *
 * Two things, neither of them a colour. It read `.cm-line` CLASS LISTS — is `cm-throng-plain-line`
 * on the long line and absent from the short one — and then typed into the document to show the
 * line was still editable. A class marker and a document edit; the migrated test never sampled a
 * pixel, which is what its census verdict noticed.
 *
 * The COLOUR half of that rule is the theme rather than the plugin: `.cm-throng-plain-line span`
 * paints `--throng-colour-editorFg`, a real cascade, and `editor-highlighting.e2e.ts` keeps its
 * theme-repaint test under `@reserve:layout` for exactly that reason.
 *
 * ══ THE VIEWPORT IS THE PART THAT COULD HAVE MADE THIS UNTESTABLE ══
 *
 * `longLinePlugin` builds its decorations from `view.visibleRanges`, and jsdom reports every rect as
 * 0×0. It works here because CodeMirror falls back to rendering the whole document when it can
 * measure nothing — but that is a fact about this environment, not a guarantee, so the tests below
 * assert the marker's PRESENCE and its ABSENCE against the same render. If the viewport ever
 * stopped covering the document, the presence assertion would fail rather than the absence one
 * passing vacuously.
 */

/**
 * Just over `LONG_LINE_THRESHOLD`, and syntactically real JavaScript. No longer than it has to be: jsdom's cost for a
 * line this size climbs with its length, measured at 2.3 s for 12,000 characters and 1.4 s for 10,100, and a slow runner
 * multiplies that (5.5 s on a green CI run, past this project's 15 s timeout on a red one).
 */
const LONG = `const bundle = ${JSON.stringify('x'.repeat(LONG_LINE_THRESHOLD))};`;
const SHORT = 'const readable = 1;';
const DOC = [SHORT, LONG, 'export default readable;', ''].join('\n');

const lines = (): { long: boolean; plain: boolean }[] =>
  [...document.querySelectorAll('.cm-line')].map((l) => ({
    long: (l.textContent ?? '').length > LONG_LINE_THRESHOLD,
    plain: l.classList.contains('cm-throng-plain-line'),
  }));

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('a >10,000-character line (FR-008a, migrated from editor-highlighting.e2e.ts:201)', () => {
  it('carries the plain-line marker (an ordinary line does not) and is still a document — it takes an edit', async () => {
    const h = mountEditor({ doc: { text: DOC, version: 1, absPath: 'C:/proj/bundle.min.js' } });
    await waitFor(() => expect(h.text()).toContain('const readable'));

    await waitFor(() => {
      const seen = lines();
      expect(seen.some((l) => l.long && l.plain), 'the long line is not exempted').toBe(true);
      expect(seen.some((l) => !l.long && !l.plain), 'a normal line was wrongly exempted').toBe(true);
    });

    /*
     * The other half, and the one that makes the exemption acceptable at all: the line is still
     * parsed and still editable; only the PAINTING is skipped. A guard that achieved its speed by
     * making the line read-only would satisfy the marker assertion above perfectly.
     */
    const view = h.view();
    const end = view.state.doc.length;

    view.dispatch({ changes: { from: end, insert: '// still editable' } });

    expect(view.state.doc.toString()).toContain('// still editable');
  });

  // DELETED: "marks the long line even when it is the ONLY line" — the first test already asserts
  // presence (`long && plain`) AND absence (`!long && !plain`) against one render, so a plugin that
  // marked every line fails there; a 12k-char mount cost ~3.7 s for the same presence claim.

  it('marks NOTHING in an ordinary file', async () => {
    // …and the mirror. Without this, a plugin that marked every line would pass the case above.
    const h = mountEditor({
      doc: { text: 'const a = 1;\nconst b = 2;\n', version: 1, absPath: 'C:/proj/small.ts' },
    });
    await waitFor(() => expect(h.text()).toContain('const a'));

    expect(lines().some((l) => l.plain)).toBe(false);
  });
});
