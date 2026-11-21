/**
 * 074 US5 (FR-070 – FR-086; research R6) — an HTML Preview through the ordinary seam: the sandboxed frame, the
 * scripts notice, live updates drawn in place, a Ctrl+clicked link handed back by main, and Find shown disabled.
 *
 * Layer: component — the real panel with the SHIPPED `html` view; jsdom renders no page inside the frame, so the
 * frame is checked by its attributes and its `srcdoc`. The sanitiser's own rules are `html-sanitise.test.ts`'s.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLD, PROJECT, ROOT, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { classifyPreviewLink } from '@throng/core';
import { isPanelUnsearchable } from '../../src/renderer/preview/unsearchable-panels.js';
import { getFindSession, openFind, setTerm } from '../../src/renderer/search/search-store.js';
import { previewLinkHoverText } from '../../src/renderer/preview/link-dom.js';
import { primaryModifierLabel } from '../../src/renderer/config/host-modifiers.js';
import { refreshPreviewPanel } from '../../src/renderer/preview/refresh-preview.js';

const FILE = `${ROOT}/site/page.html`;
const SCRIPTED = '<html><body><h1>Hi</h1><script>alert(1)</script></body></html>';
const PLAIN = '<html><body><h1>Plain</h1></body></html>';

let pv: MountedPreviewWindow | undefined;

afterEach(() => {
  pv?.unmount();
  pv = undefined;
  document.body.replaceChildren();
});

async function mount(text: string): Promise<MountedPreviewWindow> {
  pv = await mountMarkdownPreview(text, FILE, { providerId: 'html' });
  return pv;
}

const frame = (): HTMLIFrameElement | null => screen.queryByTestId(`preview-html-frame-${pv!.id}`);

/** The frame's document, once the frame has loaded (jsdom loads `about:blank`; it does not parse `srcdoc`). */
const frameDoc = (): Document | null => {
  const f = frame();
  return f !== null && f.dataset.loaded === 'true' ? f.contentDocument : null;
};

/**
 * What the page on screen says: the frame document's body once an update has been drawn into it in place, else the
 * first page as `srcdoc` handed it (jsdom never parses `srcdoc`, so its loaded frame stays blank until an update).
 */
const pageText = (): string => {
  const body = frameDoc()?.body?.textContent ?? '';
  return body !== '' ? body : (frame()?.getAttribute('srcdoc') ?? '');
};

/** Give the frame document's scroller a size, so a scroll position can be held and clamped in jsdom. */
function scrollerOf(doc: Document, size: { height: number; width: number }): HTMLElement {
  const scroller = (doc.scrollingElement ?? doc.documentElement) as HTMLElement;
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => size.height });
  Object.defineProperty(scroller, 'scrollWidth', { configurable: true, get: () => size.width });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 100 });
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => 100 });
  return scroller;
}

const update = (m: MountedPreviewWindow, revision: number, text: string, over: Partial<Parameters<typeof previewUpdate>[0]> = {}): void =>
  m.push(previewUpdate({ panelId: m.id, filePath: FILE, providerId: 'html', revision, content: { kind: 'text', text }, ...over }));

describe('the page is drawn in a same-origin frame that runs no script (FR-074, FR-074a – FR-077)', () => {
  // 074 FR-074a (2026-11-20) supersedes the opaque frame (`sandbox="allow-popups"` alone): the frame shares the
  // renderer's origin, and scripts are still refused by the sanitiser, the absent `allow-scripts` and the page's CSP.
  it('carries exactly sandbox="allow-same-origin allow-popups", its panel’s name, and the sanitised page as srcdoc', async () => {
    await mount(SCRIPTED);
    await waitFor(() => expect(frame()).toBeTruthy(), COLD);
    expect(frame()!.getAttribute('sandbox')).toBe('allow-same-origin allow-popups');
    expect(frame()!.getAttribute('name')).toBe(`throng-html-${pv!.id}`);
    expect(frame()!.hasAttribute('src')).toBe(false);
    const srcdoc = frame()!.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('<h1>Hi</h1>');
    expect(srcdoc).not.toContain('alert(1)');
    expect(srcdoc).toContain('http-equiv="Content-Security-Policy"');
    expect(srcdoc).not.toMatch(/script-src/);
  });

  // 074 FR-071b — an update replaces the page IN the frame that shows it: never a new frame, never a second `srcdoc`
  // (a navigation blanks the frame until the new document paints, and loses the reader's place).
  it('updates the page in place: the same frame, one srcdoc ever, the new page in its document', async () => {
    const writes = new Map<Element, number>();
    const original = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (this: Element, name: string, value: string): void {
      if (this instanceof HTMLIFrameElement && name.toLowerCase() === 'srcdoc') writes.set(this, (writes.get(this) ?? 0) + 1);
      original.call(this, name, value);
    };
    try {
      const m = await mount(PLAIN);
      await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
      const first = frame()!;
      update(m, 2, '<html><body class="two"><p>Second</p></body></html>');
      await waitFor(() => expect(frameDoc()!.body.textContent).toContain('Second'));
      update(m, 3, '<p>Third</p>');
      await waitFor(() => expect(frameDoc()!.body.textContent).toContain('Third'));
      expect(frame()).toBe(first);
      expect(frameDoc()!.body.textContent).not.toContain('Second');
      expect(frameDoc()!.body.classList.contains('two'), 'the body’s attributes are the new page’s').toBe(false);
      expect([...writes.entries()].map(([el, n]) => [el === first, n])).toEqual([[true, 1]]);
    } finally {
      Element.prototype.setAttribute = original;
    }
  });

  it('keeps the head nodes an update did not change, and replaces the ones it did', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    update(m, 2, '<html><head><style>p{color:red}</style><style>h1{color:blue}</style></head><body><p>A</p></body></html>');
    await waitFor(() => expect(frameDoc()!.body.textContent).toContain('A'));
    const [kept] = [...frameDoc()!.head.querySelectorAll('style')].filter((s) => s.textContent === 'p{color:red}');
    expect(kept).toBeTruthy();
    update(m, 3, '<html><head><style>p{color:red}</style><style>h1{color:green}</style></head><body><p>B</p></body></html>');
    await waitFor(() => expect(frameDoc()!.body.textContent).toContain('B'));
    const styles = [...frameDoc()!.head.querySelectorAll('style')];
    expect(styles.includes(kept!), 'the unchanged stylesheet is the same node').toBe(true);
    expect(styles.some((s) => s.textContent === 'h1{color:green}')).toBe(true);
    expect(styles.some((s) => s.textContent === 'h1{color:blue}')).toBe(false);
  });

  it('keeps the reader’s scroll on both axes through an update, clamped where the new page is shorter', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    const size = { height: 2000, width: 900 };
    const scroller = scrollerOf(frameDoc()!, size);
    scroller.scrollTop = 700;
    scroller.scrollLeft = 300;
    update(m, 2, '<p>Second</p>');
    await waitFor(() => expect(frameDoc()!.body.textContent).toContain('Second'));
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([300, 700]);
    size.height = 400; // max scrollTop 300
    size.width = 250; // max scrollLeft 150
    update(m, 3, '<p>Short</p>');
    await waitFor(() => expect(frameDoc()!.body.textContent).toContain('Short'));
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([150, 300]);
  });

  // FR-107 — now the frame's scroll is readable, a page has a place to leave and come back to.
  it('reports the frame’s scroll as the place it leaves when a link is followed', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    const scroller = scrollerOf(frameDoc()!, { height: 2000, width: 900 });
    scroller.scrollTop = 640;
    scroller.scrollLeft = 30;
    m.pushFrameLink({ panelId: m.id, href: 'other.html' });
    await waitFor(() => expect(m.preview.navigate).toHaveBeenCalled());
    expect(m.preview.navigate.mock.calls[0]![0]).toMatchObject({ leavingViewState: { scrollX: 30, scrollY: 640 } });
  });

  it('shows a page at the place an update hands down, and a followed link’s page from its top', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    const scroller = scrollerOf(frameDoc()!, { height: 2000, width: 900 });
    scroller.scrollTop = 900;
    update(m, 2, '<p>Back</p>', { navigationSeq: 1, viewState: { scrollX: 12, scrollY: 480 } });
    await waitFor(() => expect(frameDoc()!.body.textContent).toContain('Back'));
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([12, 480]);
    update(m, 3, '<p>Followed</p>', { navigationSeq: 2, filePath: `${ROOT}/site/other.html` });
    await waitFor(() => expect(frameDoc()!.body.textContent).toContain('Followed'));
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([0, 0]);
  });

  // R6b — a change of the safe sources changes the page's content policy, which a document cannot relax once
  // applied: the frame is reloaded with a new document.
  it('reloads the frame with a new srcdoc when the safe sources change', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    const first = frame()!;
    m.setSettings({ editor: { previews: { providers: { html: { safeSources: ['https://cdn.example.test'] } } } } });
    await waitFor(() => expect(frame()).not.toBe(first));
    expect(frame()!.getAttribute('srcdoc')).toContain('Plain');
  });
});

describe('scripts did not run — said once, inline and dismissible (FR-081)', () => {
  it('shows the notice for a page with script, and Dismiss removes it', async () => {
    await mount(SCRIPTED);
    const notice = await screen.findByTestId(`preview-html-scripts-${pv!.id}`, {}, COLD);
    expect(notice.textContent).toContain('Scripts in this page do not run in the preview.');
    fireEvent.click(screen.getByTestId(`preview-html-scripts-dismiss-${pv!.id}`));
    expect(screen.queryByTestId(`preview-html-scripts-${pv!.id}`)).toBeNull();
  });

  // 2026-11-19 — the notice belongs to the PAGE: it went on showing over a page with no script opened after one with
  // script, and once dismissed it never came back in that panel.
  it('goes with its page, and comes back for every page loaded with script, dismissed or not', async () => {
    const m = await mount(SCRIPTED);
    const notice = (): HTMLElement | null => screen.queryByTestId(`preview-html-scripts-${pv!.id}`);
    await waitFor(() => expect(notice()).not.toBeNull(), COLD);
    const OTHER = `${ROOT}/site/other.html`;
    m.push(previewUpdate({ panelId: m.id, filePath: OTHER, providerId: 'html', revision: 2, content: { kind: 'text', text: PLAIN } }));
    await waitFor(() => expect(pageText()).toContain('Plain'));
    expect(notice()).toBeNull();
    m.push(previewUpdate({ panelId: m.id, filePath: FILE, providerId: 'html', revision: 3, content: { kind: 'text', text: SCRIPTED } }));
    await waitFor(() => expect(notice()).not.toBeNull());
    fireEvent.click(screen.getByTestId(`preview-html-scripts-dismiss-${pv!.id}`));
    expect(notice()).toBeNull();
    m.push(previewUpdate({ panelId: m.id, filePath: OTHER, providerId: 'html', revision: 4, content: { kind: 'text', text: '<p>Third</p><script>y()</script>' } }));
    await waitFor(() => expect(pageText()).toContain('Third'));
    expect(notice()).not.toBeNull();
  });

  it('shows nothing for a page with no script', async () => {
    await mount(PLAIN);
    await waitFor(() => expect(frame()).toBeTruthy(), COLD);
    expect(screen.queryByTestId(`preview-html-scripts-${pv!.id}`)).toBeNull();
  });
});

describe('a Ctrl+clicked link comes back from main and is followed (FR-079)', () => {
  it('opens an https link through the preview’s own external channel', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frame()).toBeTruthy(), COLD);
    m.pushFrameLink({ panelId: m.id, href: 'https://example.test/docs' });
    await waitFor(() => expect(m.openExternal).toHaveBeenCalledWith('https://example.test/docs'));
  });

  it('ignores a link addressed to another panel', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frame()).toBeTruthy(), COLD);
    m.pushFrameLink({ panelId: 'someone-else', href: 'https://example.test/docs' });
    expect(m.openExternal).not.toHaveBeenCalled();
  });
});

// 074 convergence T061 / T067 — FR-079 and Constitution 5.5.0: a link inside the page, a `#fragment` one included,
// follows on Ctrl+click and nothing else, and its hover names its target and the gesture as every preview does.
describe('a link in the page follows on the gesture only, a fragment link included (FR-079)', () => {
  const PAGE = '<p><a id="go" href="#part-two">to part two</a> <a id="web" href="https://example.test/x">web</a></p><h2 id="part-two">Part two</h2>';

  async function drawn(): Promise<{ doc: Document; W: Window & typeof globalThis }> {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    update(m, 2, PAGE);
    await waitFor(() => expect(frameDoc()!.querySelector('#part-two')).not.toBeNull());
    const doc = frameDoc()!;
    return { doc, W: doc.defaultView as Window & typeof globalThis };
  }

  /**
   * Watch `scrollIntoView` in both realms: an update draws nodes parsed in this window into the frame's document, and
   * an adopted node keeps the prototype it was made with. Restored after each test.
   */
  const restores: Array<() => void> = [];
  afterEach(() => {
    for (const restore of restores.splice(0)) restore();
  });
  function spyScroll(W: Window & typeof globalThis, scroll: () => void): void {
    for (const proto of new Set([W.Element.prototype, Element.prototype])) {
      const before = proto.scrollIntoView;
      proto.scrollIntoView = scroll;
      restores.push(() => {
        proto.scrollIntoView = before;
      });
    }
  }

  function click(doc: Document, W: Window & typeof globalThis, sel: string, ctrlKey: boolean): MouseEvent {
    const e = new W.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey });
    act(() => {
      doc.querySelector(sel)!.dispatchEvent(e);
    });
    return e;
  }

  it('a plain click on a fragment link moves nothing', async () => {
    const { doc, W } = await drawn();
    const scroll = vi.fn();
    spyScroll(W, scroll);
    const e = click(doc, W, '#go', false);
    expect(e.defaultPrevented, 'the frame’s own same-document jump is stopped').toBe(true);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('a Ctrl+click on a fragment link scrolls the page to its target', async () => {
    const { doc, W } = await drawn();
    const scroll = vi.fn();
    spyScroll(W, scroll);
    click(doc, W, '#go', true);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect((scroll.mock.contexts[0] as Element).id).toBe('part-two');
  });

  it('Ctrl+Enter on a focused fragment link scrolls the page to its target', async () => {
    const { doc, W } = await drawn();
    const scroll = vi.fn();
    spyScroll(W, scroll);
    act(() => {
      doc.querySelector('#go')!.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect((scroll.mock.contexts[0] as Element | undefined)?.id).toBe('part-two');
  });

  it('names each link’s target and the gesture on hover, in every preview’s words', async () => {
    const { doc } = await drawn();
    expect(doc.querySelector('#go')!.getAttribute('title')).toBe(
      previewLinkHoverText({ kind: 'heading', fragment: 'part-two' }, primaryModifierLabel()),
    );
    expect(doc.querySelector('#web')!.getAttribute('title')).toBe(
      previewLinkHoverText({ kind: 'external', url: 'https://example.test/x' }, primaryModifierLabel()),
    );
  });
});

// 074 convergence T077 — FR-063a: a plain middle-button drag scrolls the page, as it scrolls every other preview body.
describe('a middle-button drag scrolls the page (FR-063a)', () => {
  it('scrolls the page against the pointer’s movement', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    update(m, 2, '<p id="t">Long page</p>');
    await waitFor(() => expect(frameDoc()!.querySelector('#t')).not.toBeNull());
    const doc = frameDoc()!;
    const W = doc.defaultView as Window & typeof globalThis;
    const calls: Array<{ left?: number; top?: number }> = [];
    const restores: Array<() => void> = [];
    for (const proto of new Set([W.Element.prototype, Element.prototype])) {
      const before = proto.scrollBy;
      proto.scrollBy = function (this: Element, opts?: ScrollToOptions | number) {
        if (typeof opts === 'object') calls.push({ left: opts.left, top: opts.top });
      } as typeof proto.scrollBy;
      restores.push(() => {
        proto.scrollBy = before;
      });
    }
    try {
      const target = doc.querySelector('#t')!;
      const at = (type: string, x: number, y: number, buttons: number): void => {
        act(() => {
          target.dispatchEvent(new W.MouseEvent(type, { bubbles: true, cancelable: true, button: 1, buttons, clientX: x, clientY: y }));
        });
      };
      at('mousedown', 100, 100, 4);
      at('mousemove', 90, 60, 4);
      at('mouseup', 90, 60, 0);
      expect(calls).toContainEqual({ left: 10, top: 40 });
    } finally {
      for (const restore of restores) restore();
    }
  });
});

// 074 convergence T078 — FR-018a, FR-079 (045 FR-168): a file link's hover says what its Ctrl+click does to that file.
describe('a file link’s hover names where it opens (FR-018a, FR-079)', () => {
  it('words a link to a file no preview claims for the editor it opens in', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    update(m, 2, '<p><a href="notes.txt">Notes</a></p>');
    await waitFor(() => expect(frameDoc()!.querySelector('a')).not.toBeNull());
    const link = classifyPreviewLink('notes.txt', { docPath: FILE, projectRoot: ROOT });
    const asEditor = previewLinkHoverText(link, primaryModifierLabel(), { previewable: () => false, openTarget: 'lastActive' });
    expect(asEditor).not.toBe(previewLinkHoverText(link, primaryModifierLabel()));
    expect(frameDoc()!.querySelector('a')!.getAttribute('title')).toBe(asEditor);
  });
});

// 074 convergence T075 — Constitution VI ("one gesture follows a link"), FR-079, FR-085a: a panel's menu over a link
// offers Open Link and Copy Link to Clipboard, in an HTML page as in every other preview.
describe('the menu over a link in the page is the link menu (FR-079, FR-085a)', () => {
  it('offers Open Link and Copy Link to Clipboard on a right-click of a link', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    update(m, 2, '<p><a href="https://example.test/page">External</a></p>');
    await waitFor(() => expect(frameDoc()!.querySelector('a')).not.toBeNull());
    fireEvent.contextMenu(frameDoc()!.querySelector('a')!, { clientX: 4, clientY: 4 });
    await waitFor(() => {
      const rows = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim() ?? '');
      expect(rows.some((r) => r.startsWith('Open Link'))).toBe(true);
      expect(rows.some((r) => r.startsWith('Copy Link to Clipboard'))).toBe(true);
    });
  });
});

// 074 convergence T064 — FR-072: a change on disk to a stylesheet or font the page names is shown at the next update or
// Refresh. The frame fetches a resource again only when its URL changes, so each update names its assets afresh.
// 074 convergence T076 — FR-071b: a live edit updates the page in place, so it names the same asset URLs and nothing is
// fetched again; only Refresh names a new revision.
describe('Refresh, not every edit, fetches the page’s own resources again (FR-072, FR-071b)', () => {
  const PAGE = '<link rel="stylesheet" href="style.css"><p>styled</p>';
  const href = (): string => frameDoc()!.querySelector('link[rel="stylesheet"]')?.getAttribute('href') ?? '';

  it('keeps the stylesheet’s URL through live edits', async () => {
    const m = await mount(PAGE);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    update(m, 2, PAGE.replace('styled', 'styled again'));
    await waitFor(() => expect(href()).toContain('style.css'));
    const first = href();
    update(m, 3, PAGE.replace('styled', 'styled once more'));
    await waitFor(() => expect(frameDoc()!.body.textContent).toContain('once more'));
    expect(href()).toBe(first);
  });

  it('names the stylesheet by a new URL after a Refresh, though the page is unchanged', async () => {
    const m = await mount(PAGE);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    update(m, 2, PAGE.replace('styled', 'styled again'));
    await waitFor(() => expect(href()).toContain('style.css'));
    const first = href();
    const same = previewUpdate({ panelId: m.id, filePath: FILE, providerId: 'html', revision: 3, content: { kind: 'text', text: PAGE.replace('styled', 'styled again') } });
    vi.mocked(window.throng!.preview!.refresh).mockResolvedValueOnce({ update: same } as never);
    await act(async () => {
      await refreshPreviewPanel(m.id);
    });
    await waitFor(() => expect(href()).not.toBe(first));
    expect(href()).toContain('style.css');
  });
});

// 074 convergence T063 — FR-068a / FR-085a: Ctrl+A in a page body (an HTML page, a PDF's text) selects the page's
// text and nothing outside it, as the menu's Select All does — never the whole window.
describe('Ctrl+A in the panel selects the page and nothing else (FR-085a, FR-068a)', () => {
  it('consumes Ctrl+A on the body and selects the page’s text', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    update(m, 2, '<p id="t">Page words</p>');
    await waitFor(() => expect(frameDoc()!.querySelector('#t')).not.toBeNull());
    const allowed = fireEvent.keyDown(screen.getByTestId(`preview-body-${m.id}`), { key: 'a', ctrlKey: true });
    expect(allowed, 'the window’s own select-all is prevented').toBe(false);
    expect(frameDoc()!.getSelection()!.toString()).toContain('Page words');
  });
});

// 074 FR-086b (2026-11-20) supersedes FR-086's disabled Find: the same-origin page is searched like any preview.
describe('Find searches the page (FR-086b)', () => {
  it('leaves the panel searchable, and counts the page’s own matches', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    expect(isPanelUnsearchable(m.id)).toBe(false);
    update(m, 2, '<p>alpha beta alpha</p>');
    await waitFor(() => expect(frameDoc()!.body.textContent).toContain('beta'));
    act(() => {
      openFind(m.id, 'preview');
      setTerm(m.id, 'alpha');
    });
    await waitFor(() => expect(getFindSession(m.id)?.count).toEqual({ current: 1, total: 2 }));
  });
});

/* ── FR-085a — the body menu over the page ────────────────────────────────────────────────────── */

const menuLabels = (): string[] =>
  [...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].map((el) => el.textContent?.trim() ?? '');

/** Draw `html` into the loaded frame, select the text of `selector` in it, and right-click there. */
async function rightClickSelected(m: MountedPreviewWindow, html: string, selector: string): Promise<void> {
  await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
  update(m, 2, html);
  await waitFor(() => expect(frameDoc()!.querySelector(selector)).not.toBeNull());
  const doc = frameDoc()!;
  const range = doc.createRange();
  range.selectNodeContents(doc.querySelector(selector)!);
  doc.getSelection()!.removeAllRanges();
  doc.getSelection()!.addRange(range);
  const W = doc.defaultView as Window & typeof globalThis;
  act(() => {
    doc.querySelector(selector)!.dispatchEvent(new W.MouseEvent('contextmenu', { clientX: 5, clientY: 5, button: 2, bubbles: true, cancelable: true }));
  });
}

describe('a right-click in the page opens the panel’s body menu (FR-085a)', () => {
  it('offers Find…, Copy, Copy as Rich Text, Copy as Plain Text, Select All and Split, enabled over a selection', async () => {
    const m = await mount(PLAIN);
    await rightClickSelected(m, '<p id="t">Some <b>bold</b> words</p>', '#t');
    await waitFor(() => expect(menuLabels().length).toBeGreaterThan(0));
    const labels = menuLabels();
    for (const row of ['Find…', 'Copy', 'Copy as Rich Text', 'Copy as Plain Text', 'Select All', 'Split']) {
      expect(labels.some((l) => l.startsWith(row)), `${row} in ${labels.join(' | ')}`).toBe(true);
    }
    expect(labels.some((l) => l.startsWith('Go to Heading'))).toBe(false);
  });

  it('Copy as Rich Text puts the selection on the clipboard as HTML with its plain text', async () => {
    const m = await mount(PLAIN);
    await rightClickSelected(m, '<p id="t">Some <b>bold</b> <a href="https://example.test/x">link</a><img src="x.png" alt="pic"></p>', '#t');
    await waitFor(() => expect(screen.getByText('Copy as Rich Text')).toBeTruthy());
    fireEvent.click(screen.getByText('Copy as Rich Text'));
    await waitFor(() => expect(m.writeRich).toHaveBeenCalled());
    const [{ text, html }] = m.writeRich.mock.calls[0]! as [{ text: string; html: string }];
    expect(text).toContain('Some bold link');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('href="https://example.test/x"');
    expect(html).not.toContain('<img');
    expect(html).toContain('pic');
  });

  it('Copy as Plain Text puts the text alone; Select All selects the page and nothing outside it', async () => {
    const m = await mount(PLAIN);
    await rightClickSelected(m, '<p id="t">Plain words</p><p id="u">More</p>', '#t');
    await waitFor(() => expect(screen.getByText('Copy as Plain Text')).toBeTruthy());
    fireEvent.click(screen.getByText('Copy as Plain Text'));
    await waitFor(() => expect(m.clipboardWrite).toHaveBeenCalledWith(expect.objectContaining({ text: 'Plain words' })));
    const doc = frameDoc()!;
    const W = doc.defaultView as Window & typeof globalThis;
    act(() => {
      doc.querySelector('#u')!.dispatchEvent(new W.MouseEvent('contextmenu', { clientX: 5, clientY: 5, button: 2, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(screen.getAllByText('Select All').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Select All').at(-1)!);
    expect(doc.getSelection()!.toString()).toContain('Plain words');
    expect(doc.getSelection()!.toString()).toContain('More');
  });
});

/* ── FR-093a — what the page could not load: one notice, grouped by source ───────────────────────── */

const REMOTE = [
  '<html><head>',
  '<link rel="stylesheet" href="https://cdn.example.test/site.css">',
  '<link rel="stylesheet" href="http://plain.example.test/old.css">',
  '<script src="https://cdn.example.test/app.js"></script>',
  '</head><body>',
  '<img src="https://cdn.example.test/logo.png" alt="Logo">',
  '<img src="https://img.example.test/a.png" alt="A">',
  '</body></html>',
].join('');

const blockedNotice = (): HTMLElement | null => screen.queryByTestId(`preview-html-blocked-${pv!.id}`);
const sourceRows = (): HTMLElement[] => screen.queryAllByTestId(`preview-html-blocked-source-${pv!.id}`);
const rowOf = (source: string): HTMLElement => sourceRows().find((r) => r.dataset.source === source)!;
const throngGlobal = (): Record<string, unknown> & { preview: Record<string, unknown> } =>
  Reflect.get(window, 'throng') as Record<string, unknown> & { preview: Record<string, unknown> };

describe('remote resources left out are listed in one notice (FR-093a)', () => {
  it('lists each one, grouped by its source, Allow this source only where allowing would load it', async () => {
    await mount(REMOTE);
    await waitFor(() => expect(blockedNotice()).not.toBeNull(), COLD);
    expect(screen.queryAllByTestId(`preview-html-blocked-${pv!.id}`)).toHaveLength(1);
    expect(sourceRows().map((r) => r.dataset.source)).toEqual([
      'https://cdn.example.test',
      'http://plain.example.test',
      'https://img.example.test',
    ]);
    const cdn = rowOf('https://cdn.example.test');
    expect(cdn.textContent).toContain('https://cdn.example.test/site.css');
    expect(cdn.textContent).toContain('https://cdn.example.test/app.js');
    expect(cdn.textContent).toContain('https://cdn.example.test/logo.png');
    expect(within(cdn).queryByTitle('Allow this source')).not.toBeNull();
    const plain = rowOf('http://plain.example.test');
    expect(within(plain).queryByTitle('Allow this source')).toBeNull();
    expect(plain.textContent).toContain('not a secure (https) source');
    expect(blockedNotice()!.textContent).toContain('HTML: Safe preview sources');
  });

  it('lists a source whose only resources are scripts without the action', async () => {
    await mount('<html><head><script src="https://js.example.test/x.js"></script></head><body><p>x</p></body></html>');
    await waitFor(() => expect(blockedNotice()).not.toBeNull(), COLD);
    const row = rowOf('https://js.example.test');
    expect(within(row).queryByTitle('Allow this source')).toBeNull();
    expect(row.textContent).toContain('scripts never run in a preview');
  });

  it('Allow this source adds the source to the project’s own list', async () => {
    const allow = vi.spyOn(ProjectsClient.prototype, 'setHtmlSafeSources').mockResolvedValue({} as never);
    try {
      await mount(REMOTE);
      await waitFor(() => expect(blockedNotice()).not.toBeNull(), COLD);
      // The project list arrives asynchronously; the action appears once the panel knows its project.
      await waitFor(() => expect(within(rowOf('https://img.example.test')).queryByTitle('Allow this source')).not.toBeNull());
      fireEvent.click(within(rowOf('https://img.example.test')).getByTitle('Allow this source'));
      expect(allow).toHaveBeenCalledWith(PROJECT, ['https://img.example.test']);
    } finally {
      allow.mockRestore();
    }
  });

  it('opens Preferences at HTML: Safe preview sources', async () => {
    await mount(REMOTE);
    await waitFor(() => expect(blockedNotice()).not.toBeNull(), COLD);
    const openPreferences = vi.fn();
    throngGlobal().openPreferences = openPreferences;
    fireEvent.click(screen.getByTestId(`preview-html-blocked-preferences-${pv!.id}`));
    expect(openPreferences).toHaveBeenCalledWith('settings', 'editor.previews.providers.html.safeSources');
  });

  it('shows nothing for a page that names nothing remote', async () => {
    await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    expect(blockedNotice()).toBeNull();
  });

  it('adds a request the page’s content policy refused while it loaded', async () => {
    await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    const doc = frameDoc()!;
    const W = doc.defaultView as Window & typeof globalThis;
    const violation = new W.Event('securitypolicyviolation') as Event & Record<string, string>;
    Object.assign(violation, { blockedURI: 'https://fonts.example.test/f.woff2', effectiveDirective: 'font-src' });
    act(() => {
      doc.dispatchEvent(violation);
    });
    await waitFor(() => expect(blockedNotice()).not.toBeNull());
    const row = rowOf('https://fonts.example.test');
    expect(row.textContent).toContain('font: https://fonts.example.test/f.woff2');
    expect(within(row).queryByTitle('Allow this source')).not.toBeNull();
  });

  it('tells main which sources the frame may load, again when they change, and none once it goes', async () => {
    const m = await mount(PLAIN);
    await waitFor(() => expect(frameDoc()).not.toBeNull(), COLD);
    const setFrameSources = vi.fn();
    throngGlobal().preview.setFrameSources = setFrameSources;
    m.setSettings({ editor: { previews: { providers: { html: { safeSources: ['https://cdn.example.test'] } } } } });
    await waitFor(() => expect(setFrameSources).toHaveBeenCalledWith(m.id, ['https://cdn.example.test']));
    m.unmount();
    pv = undefined;
    expect(setFrameSources).toHaveBeenLastCalledWith(m.id, []);
  });
});
