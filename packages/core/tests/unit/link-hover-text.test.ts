import { describe, expect, it } from 'vitest';
import { linkHoverText } from '../../src/links/hover-text.js';

/**
 * 045 FR-105 — `contracts/menus-and-gestures.md` §7.4. One function, shared by the terminal's
 * `hoveredLinkTipText` and the editor's link tooltip, so the two panel types cannot word the same
 * link differently.
 *
 * The tooltip names the gesture AND where it goes. With the default link action retired (FR-112),
 * the click rule (FR-110) makes the destination knowable, so the file wording no longer has to stop
 * at "to open":
 *
 *   web                                  `Ctrl+Click to open in system browser` (024, unchanged)
 *   file whose click is editor / preview `Ctrl+Click to open`
 *   file or folder whose click is OS     `Ctrl+Click to show in OS Explorer`
 *
 * `Cmd` replaces `Ctrl` on macOS — the caller passes the chord, as it does today.
 *
 * Signature, as the contract names it: `linkHoverText(kind, clickResult, chord)`. A web link has no
 * click result (it never passes through the click rule — `data-model.md` §13.1), so it takes `null`.
 */

describe('linkHoverText — FR-105’s three wordings', () => {
  it('a web link keeps 024’s wording byte for byte', () => {
    expect(linkHoverText('web', null, 'Ctrl')).toBe('Ctrl+Click to open in system browser');
  });

  it('a file whose click opens it in throng says it opens — editor and preview alike', () => {
    expect(linkHoverText('file', 'editor', 'Ctrl')).toBe('Ctrl+Click to open');
    expect(linkHoverText('file', 'preview', 'Ctrl')).toBe('Ctrl+Click to open');
  });

  it('a link whose click shows it in OS Explorer says so', () => {
    expect(linkHoverText('file', 'osExplorer', 'Ctrl')).toBe('Ctrl+Click to show in OS Explorer');
  });

  it('never promises a browser for a file link', () => {
    for (const click of ['editor', 'preview', 'osExplorer'] as const) {
      expect(linkHoverText('file', click, 'Ctrl'), click).not.toContain('browser');
    }
  });
});

describe('linkHoverText — the chord is the caller’s, so macOS says Cmd', () => {
  it('every wording names Cmd when given Cmd', () => {
    expect(linkHoverText('web', null, 'Cmd')).toBe('Cmd+Click to open in system browser');
    expect(linkHoverText('file', 'editor', 'Cmd')).toBe('Cmd+Click to open');
    expect(linkHoverText('file', 'osExplorer', 'Cmd')).toBe('Cmd+Click to show in OS Explorer');
  });
});
