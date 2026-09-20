import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { linkHoverText, uriHoverDestination, type PreviewLink } from '@throng/core';
import { linkHitsBetween, type EditorLinkAt, type EditorLinkDeps } from '../../src/renderer/editor/link-decorations.js';
import { hoveredLinkTipText, type HoveredLink } from '../../src/renderer/terminal/hovered-link.js';
import { previewLinkHoverText } from '../../src/renderer/preview/link-dom.js';

/**
 * 045 FR-166, FR-168, SC-025 (review round four, editor M1) — the WORDING half of parity, which
 * `link-parity.test.ts` never reaches.
 *
 * That suite compares the terminal's and the editor's spans, kinds, targets and click outcomes. Both
 * folded `scanned.protocol` into a `kind: 'web'` hit and dropped the scheme, so both said "open in
 * system browser" for a `mailto:` link while the Markdown preview — which words its own destination —
 * said "open with the mailto handler". Two surfaces agreeing with each other and with neither the
 * spec nor the third surface is exactly what a terminal↔editor comparison cannot see.
 *
 * So this file asserts the three STRINGS are equal, and equal to what FR-168 / §9.4 require.
 *
 * ══ ROUND FIVE: THE EDITOR'S HALF MOVED OFF THE DECORATION'S `title` ══
 *
 * The maintainer asked for a link's hover to be its plain target, in full, in the native HTML title —
 * "any other popup / hover / title text should be removed". So `link-decorations.ts`'s `title`
 * attribute no longer carries this wording; it carries the target (`link-decorations.test.ts` covers
 * that). What still carries it is the plain-click hint (`showHintForPlainClick`, not exported), and
 * for the WEB/protocol hits this suite drives, that function's wording is exactly
 * `linkHoverText(uriHoverDestination(hit.uri), chord)` — the same two calls the terminal's
 * `hoveredLinkTipText` and the preview's `previewLinkHoverText` make for their own web/external kind.
 * `editorHintWordings` mirrors that one branch so the three-way comparison below still means something.
 */

const ALLOW: ReadonlySet<string> = new Set(['mailto', 'tel', 'slack']);

/** The wording the editor's plain-click hint would show for every WEB hit on `line` (see above). */
function editorHintWordings(line: string, chord = 'Ctrl'): string[] {
  const state = EditorState.create({ doc: line });
  const deps = {
    site: () => ({ panelId: 'p1', baseDirectory: 'D:\\p' }),
    scanOptions: () => ({ allowlist: ALLOW }),
    projectRoot: () => 'D:\\p',
    follow: () => {},
  } as unknown as EditorLinkDeps;
  const hits = linkHitsBetween(state, 0, line.length, deps) as (EditorLinkAt & { uri?: string })[];
  return hits.filter((h) => h.kind === 'web').map((h) => linkHoverText(uriHoverDestination(h.uri!), chord));
}

const terminalWeb = (uri: string): HoveredLink => ({ kind: 'web', uri });

describe('an allowlisted protocol link is worded by its own scheme on every surface (FR-168)', () => {
  it.each([
    ['mailto:someone@example.com', 'mailto'],
    ['tel:+442012345678', 'tel'],
    ['slack://open', 'slack'],
  ])('%s → "open with the %s handler"', (uri, scheme) => {
    const expected = `Ctrl+Click to open with the ${scheme} handler`;

    expect(hoveredLinkTipText(terminalWeb(uri), 'Ctrl'), 'terminal').toBe(expected);
    expect(editorHintWordings(`see ${uri} here`), 'editor hint').toContain(expected);
    const preview: PreviewLink = { kind: 'external', url: uri };
    expect(previewLinkHoverText(preview), 'preview').toBe(expected);
  });

  it('a web address still says "system browser" on every surface', () => {
    const expected = 'Ctrl+Click to open in system browser';
    expect(hoveredLinkTipText(terminalWeb('https://example.com/a'), 'Ctrl'), 'terminal').toBe(expected);
    expect(editorHintWordings('see https://example.com/a here'), 'editor hint').toContain(expected);
    expect(previewLinkHoverText({ kind: 'external', url: 'https://example.com/a' }), 'preview').toBe(expected);
  });

  it('a loopback address is still the browser’s, not a scheme handler', () => {
    const expected = 'Ctrl+Click to open in system browser';
    expect(hoveredLinkTipText(terminalWeb('http://localhost:8080/x'), 'Ctrl')).toBe(expected);
    expect(editorHintWordings('see http://localhost:8080/x here')).toContain(expected);
  });
});
