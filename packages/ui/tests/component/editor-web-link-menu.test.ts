import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest, ResolvedLink } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { asKeyboardMenu } from '../../src/renderer/workspace/keyboard-menu.js';

/**
 * 045 round four — the EDITOR's Link menu (FR-169 – FR-171, FR-170a – FR-170c, SC-025; T276 / T277).
 *
 * Over a link with no text selected, a right-click or `menu.open` (Shift+F10) opens the ONE Link menu
 * — `links/link-menu.ts` over core's `buildLinkMenu`, opened by `openLinkMenu` — **instead of** the
 * editor's content menu, exactly as a terminal does. With a selection, the content menu; away from a
 * link, the content menu unchanged. The rows are the terminal's rows (SC-025); the one permitted
 * difference is the Open Link chord, shown here because `preview.followLink` is bound in the editor
 * scope (FR-169's note, FR-046).
 *
 * A file link's menu opens AT ONCE with what the renderer knows (FR-170c) and is updated in place
 * when the ONE menu-open resolution answers (SC-021). Open In ▸ carries New Editor, Active Editor and
 * one row per open editor by name (FR-170 row 2) — the editor already showing the target excepted —
 * and each performs its own route.
 *
 * The menu is opened for real: a `contextmenu` event on the mounted view's content, through the
 * `domEventHandlers` `use-editor.ts` installs, into the window's `ContextMenuProvider`.
 */

const URL_TEXT = 'https://example.com/docs/guide';
const FILE_TEXT = './src/foo.ts';
const SELF_TEXT = './notes.txt';
const DOC = `read ${URL_TEXT} first\nsee ${FILE_TEXT} and ${SELF_TEXT}\nplain words here\n`;
const IN_URL = DOC.indexOf(URL_TEXT) + 6;
const IN_FILE = DOC.indexOf(FILE_TEXT) + 4;
const IN_SELF = DOC.indexOf(SELF_TEXT) + 4;
const IN_PLAIN = DOC.indexOf('plain words') + 2;

const SELF_PATH = 'C:/proj/notes.txt';
const FOO_PATH = 'C:/proj/src/foo.ts';

const resolved = (path: string): ResolvedLink => ({
  path,
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
});

let harness: EditorHarness | undefined;

afterEach(() => {
  harness?.unmount();
  harness = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

async function mount() {
  const openExternal = vi.fn();
  const notifyTyped = vi.fn();
  const clipboardWrites: { text: string; mode?: string }[] = [];
  /** Every menu-open resolution asked, held until the test answers it. */
  const asked: { request: LinkResolutionRequest; answer: (r: LinkResolution) => void }[] = [];
  const h = mountEditor({
    doc: { text: DOC, version: 1, absPath: SELF_PATH },
    projectRoot: 'C:/proj',
    registerProject: true,
    throng: {
      panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped },
      // 045 round four (T258 / T291): a link's URI leaves by `throng:linkUri:openExternal`.
      linkUri: { openExternal },
      clipboard: {
        write: async (entry: { text: string; mode?: string }) => void clipboardWrites.push(entry),
        paste: async () => ({ text: '', mode: 'verbatim' }),
      },
      links: {
        resolve: (request: LinkResolutionRequest): Promise<LinkResolution> =>
          new Promise((answer) => void asked.push({ request, answer })),
        reveal: async () => ({ ok: true as const }),
        open: async () => ({ ok: true as const }),
      },
    },
  });
  harness = h;
  h.serve({ absPath: FOO_PATH, text: 'export const foo = 1;\n', version: 2 });
  await waitFor(() => expect(h.view().state.doc.toString()).toBe(DOC));
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  const view = h.view() as unknown as { posAtCoords: (c: { x: number; y: number }) => number | null };
  let at = IN_URL;
  // Clamped: a test that opens a shorter file into this view must not leave the stub answering a
  // position past its end to the scroll relay, which measures on every frame.
  view.posAtCoords = () => Math.min(at, h.view().state.doc.length);
  const rightClick = (): void => {
    h.content().dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 10 }),
    );
  };
  return {
    h,
    openExternal,
    notifyTyped,
    clipboardWrites,
    asked,
    pointAt: (offset: number) => {
      at = offset;
    },
    rightClick,
  };
}

/** The drawn menu's top-level labels, in order. */
function menuLabels(): string[] {
  const root = document.querySelector<HTMLElement>('[data-testid="context-menu"]');
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(':scope > li[data-testid^="menu-item-"]')].map(
    (el) => el.getAttribute('data-testid')!.replace(/^menu-item-/, ''),
  );
}

function menuItem(label: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="menu-item-${label}"]`);
  if (!el) throw new Error(`no "${label}" row on the menu; it drew: ${menuLabels().join(', ')}`);
  return el;
}

/** Open the Open In ▸ flyout and answer its rows' labels. */
async function openInRows(): Promise<string[]> {
  menuItem('Open In').click();
  const flyout = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="submenu-Open In"]');
    if (!el) throw new Error('the Open In flyout did not open');
    return el;
  });
  return [...flyout.querySelectorAll<HTMLElement>(':scope > li[data-testid^="menu-item-"]')].map(
    (el) => el.getAttribute('data-testid')!.replace(/^menu-item-/, ''),
  );
}

describe('FR-171 — over a WEB link, nothing selected, the Link menu opens INSTEAD of the content menu', () => {
  it('Open Link then Copy Link to Clipboard, and nothing else (SC-025)', async () => {
    const m = await mount();
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));

    expect(menuLabels()).toEqual(['Open Link', 'Copy Link to Clipboard']);
  });

  it('Open Link shows the Ctrl+Enter chord — bound in the editor scope (FR-169 note)', async () => {
    const m = await mount();
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));

    const shortcut = document.querySelector('[data-testid="menu-shortcut-Open Link"]');
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

  it('Copy Link to Clipboard copies the address EXACTLY as written', async () => {
    const m = await mount();
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));
    menuItem('Copy Link to Clipboard').click();

    await waitFor(() => expect(m.clipboardWrites.map((w) => w.text)).toEqual([URL_TEXT]));
  });

  it('asks main nothing for a web link', async () => {
    const m = await mount();
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));
    expect(m.asked).toHaveLength(0);
  });
});

describe('FR-171 — with text selected, or away from a link, the content menu (024 FR-019d)', () => {
  it('a selection over the link: the content menu, no link row', async () => {
    const m = await mount();
    // The selection covers the link, and the right-click lands inside it, so it is preserved (FR-012a).
    m.h.view().dispatch({ selection: { anchor: IN_URL - 3, head: IN_URL + 5 } });
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));

    expect(menuLabels()[0]).toBe('Cut');
    expect(menuLabels()).not.toContain('Open Link');
    expect(menuLabels()).not.toContain('Copy Link to Clipboard');
  });

  it('away from any link: the content menu, unchanged', async () => {
    const m = await mount();
    m.pointAt(IN_PLAIN);
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));

    expect(menuLabels().slice(0, 3)).toEqual(['Cut', 'Copy', 'Paste']);
    expect(menuLabels()).not.toContain('Open Link');
  });
});

describe('§5 — a keyboard-opened menu (menu.open) hit-tests the CARET', () => {
  it('caret inside the link, pointer coordinates elsewhere: the Link menu opens', async () => {
    const m = await mount();
    m.h.view().dispatch({ selection: { anchor: IN_URL } });
    // A keyboard menu's coordinates are the element's corner: here they resolve to plain text.
    m.pointAt(IN_PLAIN);
    asKeyboardMenu(() => m.rightClick());
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));

    expect(menuLabels()).toEqual(['Open Link', 'Copy Link to Clipboard']);
  });
});

describe('FR-170b / FR-170c — over a FILE link the Link menu opens at once, then updates', () => {
  it('opens BEFORE main answers, with only the renderer-known rows', async () => {
    const m = await mount();
    m.pointAt(IN_FILE);
    m.rightClick();
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));

    // Rows 5 / 6 wait for main's answer; Open In ▸ is drawn, disabled, because the link is in the
    // project by name (FR-170c). An in-project `.ts` has no preview provider, so no Open Preview.
    expect(menuLabels()).toEqual(['Open Link', 'Open In', 'Open in OS Explorer', 'Copy Link to Clipboard']);
    expect(menuItem('Open In').getAttribute('aria-disabled')).toBe('true');
    // SC-021 — ONE resolution per opening, and it has not been answered yet.
    expect(m.asked).toHaveLength(1);
    expect(m.asked[0]!.request.text).toBe(FILE_TEXT);
  });

  it('when main answers, the SAME menu gains its rows and Open In ▸ enables', async () => {
    const m = await mount();
    m.pointAt(IN_FILE);
    m.rightClick();
    await waitFor(() => expect(m.asked).toHaveLength(1));
    m.asked[0]!.answer({ ok: true, link: resolved(FOO_PATH) });

    await waitFor(() =>
      expect(menuLabels()).toEqual([
        'Open Link',
        'Open In',
        'Open in OS Explorer',
        'Open in OS Default Program',
        'Copy Link to Clipboard',
      ]),
    );
    expect(menuItem('Open In').getAttribute('aria-disabled')).toBe('false');
    expect(m.asked).toHaveLength(1);
  });
});

describe('FR-170 row 2 — Open In ▸ New Editor, Active Editor, and one row per open editor', () => {
  async function answered(offset: number, path: string) {
    const m = await mount();
    m.pointAt(offset);
    m.rightClick();
    await waitFor(() => expect(m.asked).toHaveLength(1));
    m.asked[0]!.answer({ ok: true, link: resolved(path) });
    await waitFor(() => expect(menuItem('Open In').getAttribute('aria-disabled')).toBe('false'));
    return m;
  }

  it('names this editor, which shows a different file', async () => {
    await answered(IN_FILE, FOO_PATH);
    expect(await openInRows()).toEqual(['New Editor', 'Active Editor', 'Panel 1']);
  });

  it('leaves out the editor already showing the target', async () => {
    await answered(IN_SELF, SELF_PATH);
    expect(await openInRows()).toEqual(['New Editor', 'Active Editor']);
  });

  it('the named row opens the file INTO that editor', async () => {
    const m = await answered(IN_FILE, FOO_PATH);
    await openInRows();
    menuItem('Panel 1').click();

    await waitFor(() => expect(m.h.calls.load).toHaveBeenCalledWith(expect.objectContaining({ absPath: FOO_PATH })));
    await waitFor(() => expect(m.h.view().state.doc.toString()).toBe('export const foo = 1;\n'));
    expect(m.notifyTyped).not.toHaveBeenCalled();
  });

  it('Active Editor reuses the active editor — no new panel', async () => {
    const m = await answered(IN_FILE, FOO_PATH);
    await openInRows();
    menuItem('Active Editor').click();

    await waitFor(() => expect(m.h.calls.load).toHaveBeenCalledWith(expect.objectContaining({ absPath: FOO_PATH })));
    expect(m.notifyTyped).not.toHaveBeenCalled();
  });

  it('New Editor opens a NEW editor panel on the file, leaving this one alone', async () => {
    const m = await answered(IN_FILE, FOO_PATH);
    await openInRows();
    menuItem('New Editor').click();

    await waitFor(() => expect(m.notifyTyped).toHaveBeenCalledWith(expect.any(String), 'editor', { filePath: FOO_PATH }));
    expect(m.notifyTyped.mock.calls[0]![0]).not.toBe('p-ed');
    expect(m.h.calls.load).not.toHaveBeenCalled();
  });
});
