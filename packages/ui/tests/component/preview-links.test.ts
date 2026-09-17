/**
 * 044 T088 — links in a rendered preview: what they carry, how they are followed, and the keyboard
 * (FR-091, FR-094, FR-096; contracts/security-policy.md Layer 2 `a` hook).
 *
 * Most of this is the Markdown BODY on its own, with `onFollow` / `onLinkMenu` spies — that is where the
 * gestures live. The two cases that are the CHROME's — `preview.followLink` dispatched from the window's
 * key handler, and the link menu Shift+F10 opens — mount the whole panel (`mount-preview-panel.ts`).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, resolveAction, type PreviewLink } from '@throng/core';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { linkNoticeMessage } from '../../src/renderer/preview/preview-link-notice.js';
import { COLD, mountMarkdownPreview } from './helpers/mount-preview-panel.js';

const ROOT = 'D:/proj';
const DOC = `${ROOT}/README.md`;

const LINKS = [
  '# Links',
  '',
  '[Site](https://example.com/) then [Setup](docs/setup.md#install) then [Here](#links)',
  '',
  // Raw HTML, because markdown-it itself refuses to make a link of `[Bad](javascript:…)`.
  'and <a href="javascript:alert(1)">Bad</a> and [Mail](mailto:a@b.c) and [Out](../../elsewhere.md).',
].join('\n');

function mountBody(text = LINKS, over: Partial<PreviewBodyProps> = {}) {
  const onFollow = vi.fn<(link: PreviewLink) => void>();
  const onLinkMenu = vi.fn<(link: PreviewLink, point: { x: number; y: number }) => void>();
  const props: PreviewBodyProps = {
    panelId: 'p1',
    content: { kind: 'text', text },
    filePath: DOC,
    projectRoot: ROOT,
    providerSettings: { enabled: true, loadRemoteImages: true },
    initialViewState: undefined,
    onViewStateCapture: () => {},
    onFollow,
    onNotice: () => {},
    onDrawn: () => {},
    onBodyFailure: () => {},
    onLinkMenu,
    ...over,
  };
  render(createElement(MarkdownBody, props));
  return { onFollow, onLinkMenu, host: screen.getByTestId('preview-markdown-p1') };
}

const link = (name: string): HTMLElement => screen.getByText(name);

async function ready(host: HTMLElement): Promise<void> {
  await waitFor(() => expect(host.querySelector('h1')).not.toBeNull(), COLD);
}

/** Collapse any selection, or select the text of `el`. */
function select(el: HTMLElement | null): void {
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  if (el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.addRange(range);
  }
}

afterEach(() => {
  select(null);
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('what a link carries (FR-091, FR-094, FR-096b)', () => {
  it('no href on any link; a followable link has data-throng-link, role=link, tabindex=0 and a title', async () => {
    const { host } = mountBody();
    await ready(host);
    expect(host.querySelectorAll('[href]')).toHaveLength(0);

    const site = link('Site');
    expect(site.getAttribute('role')).toBe('link');
    expect(site.getAttribute('tabindex')).toBe('0');
    expect(JSON.parse(site.getAttribute('data-throng-link')!)).toEqual({ kind: 'external', url: 'https://example.com/' });
    expect(site.getAttribute('title')).toBe('https://example.com/ — Ctrl+click to follow');

    expect(JSON.parse(link('Setup').getAttribute('data-throng-link')!)).toEqual({
      kind: 'file',
      absPath: 'D:/proj/docs/setup.md',
      fragment: 'install',
    });
    expect(link('Setup').getAttribute('title')).toBe('docs/setup.md#install — Ctrl+click to follow');
    expect(JSON.parse(link('Here').getAttribute('data-throng-link')!)).toEqual({ kind: 'heading', fragment: 'links' });
    expect(JSON.parse(link('Mail').getAttribute('data-throng-link')!)).toEqual({ kind: 'external', url: 'mailto:a@b.c' });
    expect(JSON.parse(link('Out').getAttribute('data-throng-link')!)).toMatchObject({ kind: 'outside' });
  });

  it('an inert link carries nothing to follow and is not focusable (FR-091)', async () => {
    const { host } = mountBody();
    await ready(host);
    const bad = link('Bad');
    expect(bad.hasAttribute('data-throng-link')).toBe(false);
    expect(bad.hasAttribute('tabindex')).toBe(false);
    expect(bad.hasAttribute('role')).toBe(false);
    expect(bad.hasAttribute('title')).toBe(false);
  });

  it('a link a document authored with its own title keeps no author text: the title names the target', async () => {
    const { host } = mountBody('# T\n\n[x](https://example.com/ "Totally safe")');
    await ready(host);
    expect(link('x').getAttribute('title')).toBe('https://example.com/ — Ctrl+click to follow');
  });
});

/*
 * Iteration 2026-09-15, FR-118 (T195) — the status bar readout reads a link's target from the element, in the
 * title's own display form without the gesture hint. Set by the sanitiser's hook after DOMPurify's checks, so
 * a document cannot write it.
 */
describe('data-throng-target — the target the status bar names (FR-118)', () => {
  const RLO = String.fromCharCode(0x202e);
  const HINT = ' — Ctrl+click to follow';

  it('a followable link carries its title without the hint', async () => {
    const { host } = mountBody();
    await ready(host);
    for (const name of ['Site', 'Setup', 'Here', 'Mail', 'Out']) {
      const el = link(name);
      const title = el.getAttribute('title') ?? '';
      expect(title.endsWith(HINT), name).toBe(true);
      expect(el.getAttribute('data-throng-target'), name).toBe(title.slice(0, -HINT.length));
    }
    expect(link('Setup').getAttribute('data-throng-target')).toBe('docs/setup.md#install');
  });

  it('strips bidi controls, as the title does', async () => {
    const { host } = mountBody(`# T\n\n<a href="https://example.com/&#x202E;gnp.exe">Bidi</a>`);
    await ready(host);
    const target = link('Bidi').getAttribute('data-throng-target') ?? '';
    expect(target).toBe('https://example.com/gnp.exe');
    expect(target.includes(RLO)).toBe(false);
  });

  it('an inert link carries none', async () => {
    const { host } = mountBody();
    await ready(host);
    expect(link('Bad').hasAttribute('data-throng-target')).toBe(false);
  });

  it('one a document wrote is gone, on a link and on any other element', async () => {
    const { host } = mountBody(
      '# T\n\n<a href="javascript:x" data-throng-target="forged">Inert</a> <span data-throng-target="forged">S</span> ' +
        '<a href="https://example.com/" data-throng-target="forged">Real</a>',
    );
    await ready(host);
    expect(host.querySelectorAll('[data-throng-target="forged"]')).toHaveLength(0);
    expect(link('Real').getAttribute('data-throng-target')).toBe('https://example.com/');
  });
});

describe('fix round 1 (item 7) — a link title cannot be reordered by bidi controls', () => {
  // Built from code points, so no invisible character sits in this source file.
  const BIDI = [0x061c, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f].map((c) =>
    String.fromCharCode(c),
  );
  const RLO = String.fromCharCode(0x202e);

  it.each([
    ['a Markdown link (percent-encoded by markdown-it, decoded for display)', `[Bidi](https://example.com/${RLO}gnp.exe)`],
    ['a raw HTML link carrying the control itself', `<a href="https://example.com/&#x202E;gnp.exe">Bidi</a>`],
    ['the Arabic letter mark U+061C (fix round 2)', `<a href="https://example.com/&#x61C;gnp.exe">Bidi</a>`],
    [
      'every control at once (fix round 2)',
      `<a href="https://example.com/${[0x061c, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f]
        .map((c) => `&#x${c.toString(16)};`)
        .join('')}x">Bidi</a>`,
    ],
  ])('%s', async (_name, markdown) => {
    const { host } = mountBody(`# T\n\n${markdown}`);
    await ready(host);
    const title = link('Bidi').getAttribute('title') ?? '';
    expect(title).toContain('example.com/');
    expect(title).toContain('Ctrl+click to follow');
    for (const ch of BIDI) expect(title.includes(ch), `U+${ch.charCodeAt(0).toString(16)}`).toBe(false);
  });

  it('a link notice names its target with no bidi control left in it (fix round 2)', () => {
    const target = `docs/${BIDI.join('')}gnp.exe.md`;
    for (const notice of [
      { kind: 'link-outside', target: `../${target}` },
      { kind: 'link-missing-file', target: `D:/proj/${target}` },
      { kind: 'link-missing-heading', target: `${BIDI.join('')}install` },
      { kind: 'history-refused', target: `D:/proj/${target}`, reason: 'x' },
    ] as const) {
      const message = linkNoticeMessage(notice, 'D:/proj');
      for (const ch of BIDI) expect(message.includes(ch), `${notice.kind} U+${ch.charCodeAt(0).toString(16)}`).toBe(false);
      expect(message).toMatch(/gnp\.exe\.md|install/);
    }
  });
});

describe('Ctrl+click follows, a plain click does not (FR-094)', () => {
  it('plain click → no onFollow', async () => {
    const { host, onFollow } = mountBody();
    await ready(host);
    fireEvent.click(link('Site'));
    expect(onFollow).not.toHaveBeenCalled();
  });

  it('Ctrl+click with a collapsed selection → exactly one onFollow with that link', async () => {
    const { host, onFollow } = mountBody();
    await ready(host);
    select(null);
    fireEvent.click(link('Setup'), { ctrlKey: true });
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(onFollow).toHaveBeenCalledWith({ kind: 'file', absPath: 'D:/proj/docs/setup.md', fragment: 'install' });
  });

  it('Ctrl+click on a child of the link follows the link', async () => {
    const { host, onFollow } = mountBody('# T\n\n[**bold** site](https://example.com/)');
    await ready(host);
    fireEvent.click(screen.getByText('bold'), { ctrlKey: true });
    expect(onFollow).toHaveBeenCalledWith({ kind: 'external', url: 'https://example.com/' });
  });

  it('a Ctrl+drag that leaves a selection follows nothing — it selected text', async () => {
    const { host, onFollow } = mountBody();
    await ready(host);
    select(link('Site'));
    fireEvent.click(link('Site'), { ctrlKey: true });
    expect(onFollow).not.toHaveBeenCalled();
  });

  /*
   * Iteration 2026-09-15, Request 2 (T183). Chromium starts no mouse selection from a press that lands on
   * a focusable element — measured in `preview-scroll.e2e.ts` against an anchor and a span, at tabindex 0
   * and -1 alike, and restored by removing the attribute alone. So a drag that STARTS on a link could
   * never select, and with nothing selected its closing Ctrl+click followed the link: FR-094 inverted.
   * jsdom does not model that engine rule, so this pins the mechanism the fix uses, not the selection.
   */
  it('a primary press on a link lifts its tabindex until the press ends, so a drag from it can select', async () => {
    const { host } = mountBody('# T\n\n[**bold** site](https://example.com/)');
    await ready(host);
    const site = link('site').closest<HTMLElement>('[data-throng-link]')!;
    expect(site.getAttribute('tabindex')).toBe('0');

    fireEvent.mouseDown(screen.getByText('bold'), { button: 0 });
    expect(site.hasAttribute('tabindex'), 'lifted for the press').toBe(false);
    fireEvent.mouseUp(window, { button: 0 });
    expect(site.getAttribute('tabindex'), 'back in the Tab order once the press ends (FR-096b)').toBe('0');

    fireEvent.mouseDown(site, { button: 2 });
    expect(site.getAttribute('tabindex'), 'a secondary press starts no selection and is left alone').toBe('0');
  });

  it('Ctrl+click on an inert link follows nothing', async () => {
    const { host, onFollow } = mountBody();
    await ready(host);
    fireEvent.click(link('Bad'), { ctrlKey: true });
    expect(onFollow).not.toHaveBeenCalled();
  });
});

describe('the keyboard (FR-096)', () => {
  it('the body is focusable, and arrow / Page / Home / End are left to scroll it (FR-096a)', async () => {
    const { host } = mountBody();
    await ready(host);
    expect(host.tabIndex).toBe(-1);
    for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']) {
      const notPrevented = fireEvent.keyDown(host, { key });
      expect(notPrevented, key).toBe(true);
    }
  });

  it('Tab order is document order, focused links get the focus class, and Tab on the last is not prevented (FR-096b)', async () => {
    const { host } = mountBody();
    await ready(host);
    const focusable = [...host.querySelectorAll<HTMLElement>('[tabindex="0"]')].map((el) => el.textContent);
    expect(focusable).toEqual(['Site', 'Setup', 'Here', 'Mail', 'Out']);

    const site = link('Site');
    act(() => site.focus());
    expect(site).toHaveClass('preview-markdown__link--focused');
    act(() => link('Setup').focus());
    expect(site).not.toHaveClass('preview-markdown__link--focused');
    expect(link('Setup')).toHaveClass('preview-markdown__link--focused');

    const last = link('Out');
    act(() => last.focus());
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(last, { key: 'Tab', shiftKey: true })).toBe(true);
  });

  it('plain Enter on a focused link follows nothing (FR-096c)', async () => {
    const { host, onFollow } = mountBody();
    await ready(host);
    const site = link('Site');
    act(() => site.focus());
    fireEvent.keyDown(site, { key: 'Enter' });
    fireEvent.keyUp(site, { key: 'Enter' });
    expect(onFollow).not.toHaveBeenCalled();
  });

  it.each([
    ['Shift+F10', { key: 'F10', shiftKey: true }],
    ['the menu key', { key: 'ContextMenu' }],
  ])('%s is NOT handled by the body — the bindable menu.open command owns it (FR-096d, Principle X)', async (_name, key) => {
    const { host, onLinkMenu } = mountBody();
    await ready(host);
    const setup = link('Setup');
    act(() => setup.focus());
    expect(fireEvent.keyDown(setup, key)).toBe(true);
    expect(onLinkMenu).not.toHaveBeenCalled();
  });

  it('the contextmenu menu.open re-dispatches at the focused link asks for the link menu for THAT link (FR-096d)', async () => {
    const { host, onLinkMenu } = mountBody();
    await ready(host);
    const setup = link('Setup');
    act(() => setup.focus());
    // What `app.tsx`'s `menu.open` does: a synthetic contextmenu at the focused element's corner.
    const notPrevented = setup.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 8 }),
    );
    expect(notPrevented).toBe(false);
    expect(onLinkMenu).toHaveBeenCalledTimes(1);
    expect(onLinkMenu.mock.calls[0]).toEqual([
      { kind: 'file', absPath: 'D:/proj/docs/setup.md', fragment: 'install' },
      { x: 12, y: 8 },
    ]);
  });

  it('Tab resolves to no editor command in the preview scope, so it cannot indent anything (FR-096, FR-021)', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Tab', ctrl: false, shift: false, alt: false }, 'editor')).toBe(
      'editor.indentLines',
    );
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Tab', ctrl: false, shift: false, alt: false }, 'preview')).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Enter', ctrl: true, shift: false, alt: false }, 'preview')).toBe(
      'preview.followLink',
    );
  });
});

describe('in a mounted panel (the chrome’s half)', () => {
  it('Ctrl+Enter (preview.followLink) follows the focused link exactly as Ctrl+click does (FR-096c)', async () => {
    const m = await mountMarkdownPreview(LINKS);
    try {
      const site = await screen.findByText('Site', {}, COLD);
      act(() => site.focus());
      fireEvent.keyDown(site, { key: 'Enter', ctrlKey: true });
      expect(m.openExternal).toHaveBeenCalledTimes(1);
      expect(m.openExternal).toHaveBeenCalledWith('https://example.com/');
    } finally {
      m.unmount();
    }
  });

  it('Ctrl+Enter with no link focused follows nothing', async () => {
    const m = await mountMarkdownPreview(LINKS);
    try {
      await screen.findByText('Site', {}, COLD);
      act(() => screen.getByTestId(`preview-body-${m.id}`).focus());
      fireEvent.keyDown(screen.getByTestId(`preview-body-${m.id}`), { key: 'Enter', ctrlKey: true });
      expect(m.openExternal).not.toHaveBeenCalled();
      expect(m.preview.navigate).not.toHaveBeenCalled();
    } finally {
      m.unmount();
    }
  });

  it('menu.open’s contextmenu at a focused link opens the link menu for it, and Open Link follows THAT link (FR-096d)', async () => {
    const m = await mountMarkdownPreview(LINKS);
    try {
      const site = await screen.findByText('Site', {}, COLD);
      act(() => site.focus());
      act(() => {
        site.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
      });
      expect(screen.getByTestId('menu-item-Copy Link Address')).toBeInTheDocument();
      fireEvent.click(await screen.findByTestId('menu-item-Open Link'));
      expect(m.openExternal).toHaveBeenCalledWith('https://example.com/');
    } finally {
      m.unmount();
    }
  });

  it('fix round 1 (item 9) — a body re-renders when Load remote images changes', async () => {
    const onFollow = vi.fn();
    const base: PreviewBodyProps = {
      panelId: 'p1',
      content: { kind: 'text', text: '# T\n\n![badge](https://img.example/b.svg)' },
      filePath: DOC,
      projectRoot: ROOT,
      providerSettings: { enabled: true, loadRemoteImages: true },
      initialViewState: undefined,
      onViewStateCapture: () => {},
      onFollow,
      onNotice: () => {},
      onDrawn: () => {},
      onBodyFailure: () => {},
    };
    const view = render(createElement(MarkdownBody, base));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('https://img.example/b.svg'), COLD);

    view.rerender(createElement(MarkdownBody, { ...base, providerSettings: { enabled: true, loadRemoteImages: false } }));
    await waitFor(() => expect(host.querySelector('img')).toBeNull());
    expect(host.textContent).toContain('badge');

    view.rerender(createElement(MarkdownBody, base));
    await waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('https://img.example/b.svg'));
  });
});
