import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { asKeyboardMenu } from '../../src/renderer/workspace/keyboard-menu.js';
import { __resetLinkCacheForTests } from '../../src/renderer/links/link-cache.js';

/**
 * 045 T167 — the editor's content menu over a WEB link (FR-103, S4; contracts/menus-and-gestures.md
 * §7.2).
 *
 * Over a web link with no text selected, the menu LEADS with a `contextual` section:
 *
 *   1. **Open Link** — opens the address in the system browser; shows `Ctrl+Enter`, because the
 *      chord is live in the editor scope (§4).
 *   2. **Copy Link Address** — copies the address exactly as written.
 *
 * With a selection the ordinary menu wins, as it does in a terminal (024 FR-019d). A keyboard-opened
 * menu (Shift+F10) composes from the CARET, because its synthetic event carries the focused
 * element's corner (§5).
 *
 * What the user sees today: right-click a URL in an editor and the menu is the ordinary
 * Cut/Copy/Paste one — no Open Link, no Copy Link Address — where the same URL in a terminal offers
 * both (S4 supersedes 024 US7's "terminal-only" edge case).
 *
 * The menu is opened for real: a `contextmenu` event on the mounted view's content, through the
 * `domEventHandlers` `use-editor.ts` installs, into the window's `ContextMenuProvider`.
 */

const URL_TEXT = 'https://example.com/docs/guide';
const DOC = `read ${URL_TEXT} first\nsecond line\n`;
const IN_URL = DOC.indexOf(URL_TEXT) + 6;

let harness: EditorHarness | undefined;

afterEach(() => {
  harness?.unmount();
  harness = undefined;
  __resetLinkCacheForTests();
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

async function mount() {
  const openExternal = vi.fn();
  const clipboardWrites: { text: string; mode?: string }[] = [];
  const h = mountEditor({
    doc: { text: DOC, version: 1, absPath: 'C:/proj/notes.txt' },
    projectRoot: 'C:/proj',
    registerProject: true,
    throng: {
      openExternal,
      clipboard: {
        write: async (entry: { text: string; mode?: string }) => void clipboardWrites.push(entry),
        paste: async () => ({ text: '', mode: 'verbatim' }),
      },
      links: {
        resolve: async (_request: LinkResolutionRequest): Promise<LinkResolution> => ({ ok: false }),
        reveal: async () => ({ ok: true as const }),
        open: async () => ({ ok: true as const }),
      },
    },
  });
  harness = h;
  await waitFor(() => expect(h.view().state.doc.toString()).toBe(DOC));
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  const view = h.view() as unknown as { posAtCoords: (c: { x: number; y: number }) => number | null };
  let at = IN_URL;
  view.posAtCoords = () => at;
  const rightClick = (): void => {
    h.content().dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 10 }),
    );
  };
  return {
    h,
    openExternal,
    clipboardWrites,
    pointAt: (offset: number) => {
      at = offset;
    },
    rightClick,
  };
}

/** The drawn menu's labels, in order. */
function menuLabels(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid^="menu-item-"]')].map(
    (el) => el.getAttribute('data-testid')!.replace(/^menu-item-/, ''),
  );
}

function menuItem(label: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="menu-item-${label}"]`);
  if (!el) throw new Error(`no "${label}" row on the menu; it drew: ${menuLabels().join(', ')}`);
  return el;
}

describe('§7.2 — over a web link, nothing selected, the menu LEADS with Open Link and Copy Link Address', () => {
  it('in that order, ahead of Cut / Copy / Paste', async () => {
    const m = await mount();
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));

    expect(menuLabels().slice(0, 3)).toEqual(['Open Link', 'Copy Link Address', 'Cut']);
  });

  it('Open Link shows the Ctrl+Enter chord', async () => {
    const m = await mount();
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));

    const shortcut = document.querySelector('[data-testid="menu-shortcut-Open Link"]');
    // The menu draws every shortcut in brackets (`context-menu.tsx`), as `(Ctrl+X)` is for Cut.
    expect(shortcut?.textContent).toBe('(Ctrl+Enter)');
  });

  it('Open Link opens the address once through the open-external seam', async () => {
    const m = await mount();
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));
    menuItem('Open Link').click();

    await waitFor(() => expect(m.openExternal).toHaveBeenCalledTimes(1));
    expect(m.openExternal).toHaveBeenCalledWith(URL_TEXT);
  });

  it('Copy Link Address copies the address EXACTLY as written', async () => {
    const m = await mount();
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));
    menuItem('Copy Link Address').click();

    await waitFor(() => expect(m.clipboardWrites.map((w) => w.text)).toEqual([URL_TEXT]));
  });
});

describe('§7.2 — with text selected, the ordinary menu appears (024 FR-019d)', () => {
  it('no Open Link and no Copy Link Address', async () => {
    const m = await mount();
    // The selection covers the link, and the right-click lands inside it, so it is preserved (FR-012a).
    m.h.view().dispatch({ selection: { anchor: IN_URL - 3, head: IN_URL + 5 } });
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));

    expect(menuLabels()).not.toContain('Open Link');
    expect(menuLabels()).not.toContain('Copy Link Address');
  });
});

describe('§5 — a keyboard-opened menu composes the web-link run from the CARET', () => {
  it('caret inside the link, pointer coordinates elsewhere: the run is offered', async () => {
    const m = await mount();
    m.h.view().dispatch({ selection: { anchor: IN_URL } });
    // A keyboard menu's coordinates are the element's corner: here they resolve to the second line.
    m.pointAt(DOC.indexOf('second line') + 2);
    asKeyboardMenu(() => m.rightClick());
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));

    expect(menuLabels().slice(0, 2)).toEqual(['Open Link', 'Copy Link Address']);
  });
});
