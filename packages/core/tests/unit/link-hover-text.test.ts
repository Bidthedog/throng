import { describe, expect, it } from 'vitest';
import { linkHoverText, type LinkHoverDestination } from '../../src/links/hover-text.js';

/**
 * 045 FR-168 — `contracts/menus-and-gestures.md` §9.4, §9.7. One function, shared by the terminal's
 * `hoveredLinkTipText`, the editor's link tooltip, the link hint and the Markdown preview's tooltip,
 * so no surface can word the same link differently (FR-104, FR-166).
 *
 * The destination is the CALLER's to derive (research R30: editors and terminals derive it by name;
 * the preview from 044's own follow, S6) — this file only turns a destination into words.
 *
 * Signature: `linkHoverText(destination, chord)`. `Cmd` replaces `Ctrl` on macOS — the caller passes
 * the chord, as it always did.
 */

describe('linkHoverText — FR-168’s table', () => {
  it('an editor destination names which editor, from the open-target preference', () => {
    const active: LinkHoverDestination = { kind: 'editor', openTarget: 'lastActive' };
    const fresh: LinkHoverDestination = { kind: 'editor', openTarget: 'new' };
    expect(linkHoverText(active, 'Ctrl')).toBe('Ctrl+Click to open in throng active editor');
    expect(linkHoverText(fresh, 'Ctrl')).toBe('Ctrl+Click to open in throng new editor');
  });

  it('a preview destination says so', () => {
    expect(linkHoverText({ kind: 'preview' }, 'Ctrl')).toBe('Ctrl+Click to open in throng preview');
  });

  it('everything revealed says OS Explorer, with no mention of throng', () => {
    const text = linkHoverText({ kind: 'osExplorer' }, 'Ctrl');
    expect(text).toBe('Ctrl+Click to show in OS Explorer');
    expect(text).not.toContain('throng');
  });

  it('web and loopback keep 024’s wording byte for byte', () => {
    expect(linkHoverText({ kind: 'systemBrowser' }, 'Ctrl')).toBe('Ctrl+Click to open in system browser');
  });

  it('a protocol link names its own scheme’s handler', () => {
    expect(linkHoverText({ kind: 'protocol', scheme: 'mailto' }, 'Ctrl')).toBe(
      'Ctrl+Click to open with the mailto handler',
    );
    expect(linkHoverText({ kind: 'protocol', scheme: 'slack' }, 'Ctrl')).toBe(
      'Ctrl+Click to open with the slack handler',
    );
  });

  it('the preview’s in-document heading link says it goes to the heading', () => {
    expect(linkHoverText({ kind: 'heading' }, 'Ctrl')).toBe('Ctrl+Click to go to the heading');
  });

  it('the preview’s FR-090e link, which stays on the current file, says it follows', () => {
    expect(linkHoverText({ kind: 'stays' }, 'Ctrl')).toBe('Ctrl+Click to follow');
  });

  it('never promises a browser for a file destination', () => {
    for (const destination of [
      { kind: 'editor', openTarget: 'lastActive' },
      { kind: 'editor', openTarget: 'new' },
      { kind: 'preview' },
      { kind: 'osExplorer' },
    ] as const) {
      expect(linkHoverText(destination, 'Ctrl'), destination.kind).not.toContain('browser');
    }
  });
});

describe('linkHoverText — the chord is the caller’s, so macOS says Cmd', () => {
  it('every wording names Cmd when given Cmd', () => {
    expect(linkHoverText({ kind: 'editor', openTarget: 'lastActive' }, 'Cmd')).toBe(
      'Cmd+Click to open in throng active editor',
    );
    expect(linkHoverText({ kind: 'preview' }, 'Cmd')).toBe('Cmd+Click to open in throng preview');
    expect(linkHoverText({ kind: 'osExplorer' }, 'Cmd')).toBe('Cmd+Click to show in OS Explorer');
    expect(linkHoverText({ kind: 'systemBrowser' }, 'Cmd')).toBe('Cmd+Click to open in system browser');
    expect(linkHoverText({ kind: 'protocol', scheme: 'mailto' }, 'Cmd')).toBe(
      'Cmd+Click to open with the mailto handler',
    );
    expect(linkHoverText({ kind: 'heading' }, 'Cmd')).toBe('Cmd+Click to go to the heading');
    expect(linkHoverText({ kind: 'stays' }, 'Cmd')).toBe('Cmd+Click to follow');
  });
});
