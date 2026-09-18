import { describe, expect, it, vi } from 'vitest';
import type { LinkResolutionRequest, ResolvedLink } from '@throng/core';
import { terminalContentMenu } from '../../src/renderer/terminal/terminal-content-menu.js';
import type { FileLinkMenuContext } from '../../src/renderer/links/link-menu-items.js';
import type { LinkActionDeps } from '../../src/renderer/links/link-actions.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { asKeyboardMenu } from '../../src/renderer/workspace/keyboard-menu.js';

/**
 * 045 US4 / SC-009 — the file-link run in the TERMINAL's content menu (T077).
 *
 * `contracts/menus-and-gestures.md` §1 is the whole subject: over a file link, with no text
 * selected, the menu LEADS with a `contextual` run — Open Link, then each offered or disabled target
 * in FR-030's order, then Copy Link Address — and it replaces the Open Link / Copy Link Address pair
 * 024 shipped for web links, rather than sitting beside it.
 *
 * ══ WHY THE FIVE SHAPES, AND NOT ONE ══
 *
 * SC-009 is a claim about the DIFFERENCES between link shapes, not about any one menu: the item set
 * is the only thing that tells a user an out-of-project file cannot open in a throng editor, or that
 * a preview exists for this file but its provider is switched off. A test over one shape would pass
 * with `linkTargetStates` stubbed to a constant.
 *
 * ══ AND WHY THE TERMINAL SHOWS NO CHORD ══
 *
 * FR-031 as amended on 2026-09-18: Open Link shows its chord *where one is bound*, and FR-046 binds
 * none in a terminal — `preview.followLink` is scoped to editors and previews, and Ctrl+Enter in a
 * terminal reaches the shell. Drawing the chord here would advertise a key that does something else.
 */

const noop = (): void => {};

function resolved(over: Partial<ResolvedLink> = {}): ResolvedLink {
  return {
    path: 'D:\\project\\src\\foo.ts',
    kind: 'file',
    inProject: true,
    executable: false,
    preview: 'none',
    ...over,
  };
}

const request: LinkResolutionRequest = {
  text: 'src/foo.ts',
  kind: 'detectedPath',
  panelId: 'panel-1',
  originProjectId: 'project-1',
};

function deps(): LinkActionDeps {
  return {
    openInEditor: vi.fn(),
    openInPreview: vi.fn(),
    revealInOsExplorer: vi.fn(async () => ({ ok: true }) as const),
    openInOsDefaultProgram: vi.fn(async () => ({ ok: true }) as const),
    reportFailure: vi.fn(),
  };
}

function fileLink(link: ResolvedLink, over: Partial<FileLinkMenuContext> = {}): FileLinkMenuContext {
  return { link, request, openLink: noop, deps: deps(), ...over };
}

/** The terminal menu, with whatever the pointer is over. */
function menu(args: {
  fileLink?: FileLinkMenuContext | null;
  link?: string | null;
  selection?: string;
}): MenuAction[] {
  return terminalContentMenu({
    link: args.link ?? null,
    fileLink: args.fileLink ?? null,
    selection: args.selection ?? '',
    redrawChord: 'Ctrl+Shift+R',
    startFailure: false,
    actions: {
      openLink: noop,
      copyLinkAddress: noop,
      copySelection: noop,
      paste: noop,
      redraw: noop,
      tryAgain: noop,
      copyDetails: noop,
      clearPanelType: noop,
    },
  });
}

const contextual = (items: MenuAction[]): MenuAction[] =>
  items.filter((item) => item.section === 'contextual');

const labels = (items: MenuAction[]): (string | undefined)[] => items.map((item) => item.label);

describe('the file-link run in a terminal (FR-031, SC-009)', () => {
  it('an in-project file with no preview provider offers editor, both OS targets and copy', () => {
    const items = contextual(menu({ fileLink: fileLink(resolved()) }));

    expect(labels(items)).toEqual([
      'Open Link',
      'Open in Editor',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link Address',
    ]);
    expect(items.every((item) => item.disabled !== true)).toBe(true);
  });

  it('an enabled preview provider adds Open in Preview, in FR-030’s order', () => {
    const items = contextual(menu({ fileLink: fileLink(resolved({ preview: 'enabled' })) }));

    expect(labels(items)).toEqual([
      'Open Link',
      'Open in Editor',
      'Open in Preview',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link Address',
    ]);
    expect(items.find((i) => i.label === 'Open in Preview')?.disabled).toBeFalsy();
  });

  it('a DISABLED preview provider draws the item greyed rather than removing it (044 FR-062)', () => {
    const items = contextual(menu({ fileLink: fileLink(resolved({ preview: 'disabled' })) }));

    expect(labels(items)).toContain('Open in Preview');
    expect(items.find((i) => i.label === 'Open in Preview')?.disabled).toBe(true);
    // Preview is the ONLY target that can be disabled — everything else is offered or absent.
    expect(items.filter((i) => i.disabled === true).map((i) => i.label)).toEqual(['Open in Preview']);
  });

  it('an out-of-project file offers neither of throng’s own destinations (FR-055)', () => {
    const items = contextual(
      menu({ fileLink: fileLink(resolved({ inProject: false, preview: 'enabled' })) }),
    );

    expect(labels(items)).toEqual([
      'Open Link',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link Address',
    ]);
  });

  it('a folder offers no editor, no preview and no default program', () => {
    const items = contextual(
      menu({ fileLink: fileLink(resolved({ kind: 'folder', path: 'D:\\project\\src' })) }),
    );

    expect(labels(items)).toEqual(['Open Link', 'Open in OS Explorer', 'Copy Link Address']);
  });

  it('every item of the run is contextual and leads the menu', () => {
    const items = menu({ fileLink: fileLink(resolved()) });
    const run = contextual(items);

    expect(items.slice(0, run.length)).toEqual(run);
    expect(items[run.length]?.section).not.toBe('contextual');
  });

  it('the terminal’s Open Link carries NO chord (FR-046)', () => {
    const items = contextual(menu({ fileLink: fileLink(resolved()) }));
    expect(items.find((i) => i.label === 'Open Link')?.shortcut).toBeUndefined();
  });

  it('a chord IS drawn where the surface binds one — the parameter, not the surface', () => {
    const items = contextual(
      menu({ fileLink: fileLink(resolved(), { chord: 'Ctrl+Enter' }) }),
    );
    expect(items.find((i) => i.label === 'Open Link')?.shortcut).toBe('Ctrl+Enter');
  });
});

describe('what the run does NOT change (FR-031)', () => {
  it('with text selected the ordinary menu appears (024 FR-019d)', () => {
    const items = menu({ fileLink: null, selection: 'some output' });

    expect(contextual(items)).toEqual([]);
    expect(labels(items)).toContain('Copy');
  });

  it('away from a link the menu is what it is today', () => {
    expect(labels(menu({}))).toEqual(['Copy', 'Paste', 'Refresh / redraw terminal']);
  });

  it('over a WEB link, 024’s two items are unchanged', () => {
    const items = contextual(menu({ link: 'https://example.com' }));
    expect(labels(items)).toEqual(['Open Link', 'Copy Link Address']);
    // Not the file run: no target items sneak in behind a web link.
    expect(labels(items)).not.toContain('Open in Editor');
  });

  it('a file link REPLACES the web pair rather than sitting beside it', () => {
    // `terminalLinkTarget` answers the `file:` text for a resolved hyperlink too, so both inputs
    // arrive together at the call site. Exactly one run must be drawn.
    const items = contextual(
      menu({ link: 'file:///D:/project/src/foo.ts', fileLink: fileLink(resolved()) }),
    );
    expect(labels(items).filter((l) => l === 'Open Link')).toHaveLength(1);
    expect(labels(items).filter((l) => l === 'Copy Link Address')).toHaveLength(1);
    expect(labels(items)).toContain('Open in Editor');
  });
});

describe('the keyboard-opened menu (§5, US4 scenario 8)', () => {
  it('offers the same items, composed from what the pointer rests on', () => {
    const pointer = contextual(menu({ fileLink: fileLink(resolved({ preview: 'enabled' })) }));

    let keyboard: MenuAction[] = [];
    asKeyboardMenu(() => {
      keyboard = contextual(menu({ fileLink: fileLink(resolved({ preview: 'enabled' })) }));
    });

    expect(labels(keyboard)).toEqual(labels(pointer));
  });
});
