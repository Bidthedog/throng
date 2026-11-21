/**
 * 074 US4 (FR-060 – FR-068) — the PDF Preview's body, over a fake PDF.js seam (`pdf/pdf-renderer.ts`).
 *
 * Layer: component — the body's own decisions (which pages render, at what scale, what a link does, what the
 * notice says, what the readout says) are observable in jsdom once PDF.js is stood in for; jsdom has no canvas
 * and no IntersectionObserver, so the renderer is faked and the observer is a recorder the test fires.
 * The real engine (no script, no request from a hostile PDF) is FR-090's E2E, not this file's.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageLayoutControl, PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import type { PdfDocument, PdfLink, PdfOpenResult } from '../../src/renderer/preview/providers/pdf/pdf-renderer.js';

const openPdf = vi.hoisted(() => vi.fn<(bytes: Uint8Array) => Promise<PdfOpenResult>>());
vi.mock('../../src/renderer/preview/providers/pdf/pdf-renderer.js', () => ({ openPdf }));

import { PdfBody, PDF_PAGE_SPINNER_DELAY_MS, PDF_SCROLL_SETTLE_MS, PDF_ZOOM_SETTLE_MS } from '../../src/renderer/preview/providers/pdf/pdf-body.js';
import { createCssHighlightPainter, createPreviewSearchController } from '../../src/renderer/preview/preview-search.js';
import {
  __resetFindState,
  attachPanelSearch,
  findNext,
  findPrevious,
  getFindSession,
  openFind,
  setTerm,
} from '../../src/renderer/search/search-store.js';
import type { SearchCount } from '@throng/core';
import { pdfView } from '../../src/renderer/preview/providers/pdf/view.js';
import { PREVIEW_LOADING_CLASS } from '../../src/renderer/preview/loading-placeholder.js';
import { previewLinkHoverText } from '../../src/renderer/preview/link-dom.js';
import { primaryModifierLabel } from '../../src/renderer/config/host-modifiers.js';

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const renders: Array<{ page: number; scale: number }> = [];
/** Each render's abort signal, by page, in the order the renders began. */
const signals: Array<{ page: number; signal: AbortSignal | undefined }> = [];
/** A render that takes as long as the test says: it resolves when `release(page)` is called. */
let slowPages = new Set<number>();
const releases = new Map<number, () => void>();
const texts: Array<{ page: number; scale: number; container: HTMLElement }> = [];

function fakeDoc(pageCount: number, links: Record<number, PdfLink[]> = {}): PdfDocument {
  return {
    pageCount,
    page: (n) =>
      Promise.resolve({
        width: 600,
        height: 800,
        render: (_canvas: HTMLCanvasElement, scale: number, _ratio: number, signal?: AbortSignal) => {
          renders.push({ page: n, scale });
          signals.push({ page: n, signal });
          if (!slowPages.has(n)) return Promise.resolve();
          return new Promise<void>((resolve, reject) => {
            releases.set(n, resolve);
            signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
          });
        },
        renderText: (container: HTMLElement, scale: number) => {
          texts.push({ page: n, scale, container });
          const span = document.createElement('span');
          span.textContent = `Text of page ${n}`;
          container.replaceChildren(span);
          return Promise.resolve(() => undefined);
        },
        links: () => Promise.resolve(links[n] ?? []),
      }),
    destroy: vi.fn(),
  };
}

/** Every IntersectionObserver the body creates; `show` fires it for the elements given. */
const observers: Array<{ callback: IntersectionObserverCallback; targets: Element[] }> = [];
function show(...elements: Element[]): void {
  for (const o of observers) {
    const entries = elements
      .filter((el) => o.targets.includes(el))
      .map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry);
    if (entries.length > 0) o.callback(entries, {} as IntersectionObserver);
  }
}

/** The observer reports these elements as having left the viewport and its margin. */
function hide(...elements: Element[]): void {
  for (const o of observers) {
    const entries = elements
      .filter((el) => o.targets.includes(el))
      .map((target) => ({ target, isIntersecting: false }) as unknown as IntersectionObserverEntry);
    if (entries.length > 0) o.callback(entries, {} as IntersectionObserver);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function props(overrides: Partial<PreviewBodyProps> = {}): PreviewBodyProps {
  return {
    panelId: 'p1',
    content: { kind: 'resource', url: 'throng-preview://source/p1?rev=1' },
    filePath: 'D:/proj/docs/datasheet.pdf',
    projectRoot: 'D:/proj',
    providerSettings: { enabled: true },
    initialViewState: undefined,
    onViewStateCapture: vi.fn(),
    onFollow: vi.fn(),
    onNotice: vi.fn(),
    onDrawn: vi.fn(),
    onBodyFailure: vi.fn(),
    onStatusReadout: vi.fn(),
    readSource: () => Promise.resolve({ ok: true as const, bytes: BYTES, mime: 'application/pdf' }),
    ...overrides,
  };
}

/** The panel root carries the zoom as `--throng-zoom-preview` (preview-panel.tsx, FR-034). */
function mount(p: PreviewBodyProps, zoom = '1'): { host: HTMLElement; rerender: (next: PreviewBodyProps) => void } {
  const host = document.createElement('div');
  host.style.setProperty('--throng-zoom-preview', zoom);
  // The panel's own host, as the workspace marks it: the panel zoom chords find the view to zoom through it.
  host.setAttribute('data-panel-host', 'p1');
  document.body.appendChild(host);
  const view = render(createElement(PdfBody, p), { container: host });
  return { host, rerender: (next) => view.rerender(createElement(PdfBody, next)) };
}

const pages = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-pdf-page]')];

beforeEach(() => {
  renders.length = 0;
  signals.length = 0;
  slowPages = new Set();
  releases.clear();
  texts.length = 0;
  observers.length = 0;
  openPdf.mockReset();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private readonly record: { callback: IntersectionObserverCallback; targets: Element[] };
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, targets: [] };
        observers.push(this.record);
      }
      observe(el: Element): void {
        this.record.targets.push(el);
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('selectable text (FR-068a, superseding FR-068)', () => {
  it('offers text selection, so the body menu has Copy and Select All', () => {
    expect(pdfView.id).toBe('pdf');
    expect(pdfView.textSelection).toBe(true);
  });

  it('lays a painted page’s text over its canvas, at the scale it was painted', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(2) });
    mount(props(), '1.5');
    await waitFor(() => expect(pages()).toHaveLength(2));
    act(() => show(pages()[1]!));
    await waitFor(() => expect(texts).toHaveLength(1));
    expect(texts[0]).toMatchObject({ page: 2, scale: 1.5 });
    expect(texts[0]!.container).toBe(screen.getByTestId('pdf-text-p1-2'));
    expect(screen.getByTestId('pdf-text-p1-2').textContent).toBe('Text of page 2');
  });
});

describe('while the document loads (075 FR-043a)', () => {
  it('shows the placeholder every preview shows while it loads, then the pages in its place', async () => {
    let open!: (result: PdfOpenResult) => void;
    openPdf.mockReturnValue(new Promise<PdfOpenResult>((resolve) => (open = resolve)));
    mount(props());
    const placeholder = await screen.findByTestId('pdf-loading-p1');
    expect(placeholder.classList.contains(PREVIEW_LOADING_CLASS)).toBe(true);
    expect(placeholder.classList.contains(`${PREVIEW_LOADING_CLASS}--block`)).toBe(true);
    expect(placeholder.textContent?.trim()).toBe('Loading PDF…');
    act(() => open({ ok: true, doc: fakeDoc(1) }));
    await waitFor(() => expect(pages()).toHaveLength(1));
    expect(screen.queryByTestId('pdf-loading-p1')).toBeNull();
  });
});

describe('the view controls (FR-062a)', () => {
  /** jsdom has no layout: the body's width, which Fit reads, is stubbed. */
  function stubWidth(width: number): () => void {
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('preview-pdf') ? width : 0;
      },
    });
    // jsdom defines `clientWidth` on `Element.prototype`: with no own property to put back, the stub is removed.
    return () => {
      if (own) Object.defineProperty(HTMLElement.prototype, 'clientWidth', own);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    };
  }

  it('carries Fit, the zooms and the three page layouts, each a titled icon button, outside the scrolling pages', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(1) });
    mount(props());
    await waitFor(() => expect(pages()).toHaveLength(1));
    const toolbar = screen.getByRole('toolbar', { name: 'PDF view' });
    expect([...toolbar.querySelectorAll('button')].map((b) => b.title)).toEqual([
      'Fit page width',
      'Zoom in (Ctrl+Alt++)',
      'Zoom 100% (Ctrl+Alt+Numpad0)',
      'Zoom out (Ctrl+Alt+-)',
      'Single Page',
      'Two Pages',
      'Pages Side by Side',
    ]);
    expect(screen.getByTestId('preview-pdf-p1').contains(toolbar)).toBe(false);
  });

  it('opens at Fit when the widest page is wider than the panel (FR-020a)', async () => {
    const restore = stubWidth(324);
    try {
      openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(1) });
      mount(props());
      await waitFor(() => expect(pages()).toHaveLength(1));
      // (324 − 24 gutter) / 600 → 0.5.
      await waitFor(() => expect(pages()[0]!.style.width).toBe('300px'));
    } finally {
      restore();
    }
  });

  it('fits a panel narrower than the smallest zoom step, and zooming out from there goes no wider (FR-062a, FR-062d)', async () => {
    // macOS CI, 2026-11-20: five panels in a 1024px window left a PDF 58px wide, and Fit stopped at the zoom steps'
    // 10% floor — a page of 61px plus its gutter, scrolling sideways in a panel it was meant to fit.
    const restore = stubWidth(58);
    try {
      openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(1) });
      mount(props());
      await waitFor(() => expect(pages()).toHaveLength(1));
      fireEvent.click(screen.getByTestId('pdf-fit-p1'));
      // (58 − 24 gutter) / 600 → 0.0567: a 34px page.
      await waitFor(() => expect(pages()[0]!.style.width).toBe('34px'));
      fireEvent.click(screen.getByTestId('pdf-zoom-out-p1'));
      await waitFor(() => expect(Number.parseFloat(pages()[0]!.style.width)).toBeLessThanOrEqual(34));
    } finally {
      restore();
    }
  });

  it('opens at 100% when the page fits, and Fit then FILLS the panel (FR-020a, FR-062a)', async () => {
    const wide = stubWidth(1224);
    try {
      openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(1) });
      mount(props());
      await waitFor(() => expect(pages()).toHaveLength(1));
      await waitFor(() => expect(pages()[0]!.style.width).toBe('600px'));
      fireEvent.click(screen.getByTestId('pdf-fit-p1'));
      // (1224 − 24) / 600 → 2: the page is enlarged to fill the width.
      await waitFor(() => expect(pages()[0]!.style.width).toBe('1200px'));
    } finally {
      wide();
    }
  });

  describe('page layouts (FR-062c)', () => {
    it('opens as Single Page; each layout button lays the pages out its way and says it is pressed', async () => {
      openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(3) });
      mount(props());
      await waitFor(() => expect(pages()).toHaveLength(3));
      const grid = screen.getByTestId('pdf-pages-p1');
      expect(grid).toHaveClass('preview-pdf__pages--single');
      expect(screen.getByTestId('pdf-layout-single-p1').getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(screen.getByTestId('pdf-layout-wrap-p1'));
      expect(grid).toHaveClass('preview-pdf__pages--wrap');
      expect(screen.getByTestId('pdf-layout-wrap-p1').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('pdf-layout-single-p1').getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(screen.getByTestId('pdf-layout-two-p1'));
      expect(grid).toHaveClass('preview-pdf__pages--two');
    });

    it('Fit in Two Pages fills the width with two pages side by side', async () => {
      const restore = stubWidth(1236);
      try {
        openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(2) });
        mount(props());
        await waitFor(() => expect(pages()).toHaveLength(2));
        fireEvent.click(screen.getByTestId('pdf-layout-two-p1'));
        // (1236 − 3 × 12) / (2 × 600) → 1.
        await waitFor(() => expect(pages()[0]!.style.width).toBe('600px'));
      } finally {
        restore();
      }
    });

    it('hands the panel its layout to read and set, and takes it back on unmount', async () => {
      const registered: Array<PageLayoutControl | null> = [];
      openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(2) });
      mount(props({ registerPageLayout: (c) => registered.push(c) }));
      await waitFor(() => expect(pages()).toHaveLength(2));
      const control = registered.at(-1)!;
      expect(control.get()).toBe('single');
      act(() => control.set('wrap'));
      expect(screen.getByTestId('pdf-pages-p1')).toHaveClass('preview-pdf__pages--wrap');
      expect(control.get()).toBe('wrap');
      document.body.replaceChildren();
    });
  });

  it('zooms by ×1.25 a step, to 100%, and back to Fit, repainting sharp each time', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(1) });
    mount(props());
    await waitFor(() => expect(pages()).toHaveLength(1));
    act(() => show(pages()[0]!));
    await waitFor(() => expect(renders).toEqual([{ page: 1, scale: 1 }]));
    fireEvent.click(screen.getByTestId('pdf-zoom-in-p1'));
    await waitFor(() => expect(renders).toContainEqual({ page: 1, scale: 1.25 }));
    expect(pages()[0]!.style.width).toBe('750px');
    fireEvent.click(screen.getByTestId('pdf-zoom-out-p1'));
    fireEvent.click(screen.getByTestId('pdf-zoom-out-p1'));
    await waitFor(() => expect(pages()[0]!.style.width).toBe('480px'));
    fireEvent.click(screen.getByTestId('pdf-zoom-actual-p1'));
    await waitFor(() => expect(pages()[0]!.style.width).toBe('600px'));
  });

  it('takes the panel’s zoom chords and Ctrl+wheel, as a drawing that fills its panel does', async () => {
    const { zoomPanelDiagram } = await import('../../src/renderer/preview/diagram/diagram-zoom.js');
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(1) });
    const p = props();
    mount(p);
    await waitFor(() => expect(pages()).toHaveLength(1));
    let handled = false;
    act(() => {
      handled = zoomPanelDiagram('p1', 'in');
    });
    expect(handled).toBe(true);
    await waitFor(() => expect(pages()[0]!.style.width).toBe('750px'));
    // 2026-11-20 — the status bar names the zoom beside the page.
    expect(p.onStatusReadout).toHaveBeenLastCalledWith('Page 1 of 1 · 125%');
    act(() => {
      zoomPanelDiagram('p1', 'reset');
    });
    await waitFor(() => expect(pages()[0]!.style.width).toBe('600px'));
  });
});

describe('pages, laid out and drawn on demand (FR-060, FR-065)', () => {
  it('reads the source bytes, lays out one placeholder per page and reports the draw', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(3) });
    const p = props();
    mount(p);
    await waitFor(() => expect(pages()).toHaveLength(3));
    expect(openPdf).toHaveBeenCalledWith(BYTES);
    expect(p.onDrawn).toHaveBeenCalledWith('D:/proj/docs/datasheet.pdf');
    expect(p.onStatusReadout).toHaveBeenLastCalledWith('Page 1 of 3');
    // Nothing is painted until a page comes near the viewport.
    expect(renders).toEqual([]);
  });

  it('paints a page when it is observed, at the panel zoom', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(3) });
    mount(props(), '1.5');
    await waitFor(() => expect(pages()).toHaveLength(3));
    act(() => show(pages()[1]!));
    await waitFor(() => expect(renders).toEqual([{ page: 2, scale: 1.5 }]));
  });

  it('re-paints the pages in view, sharp, when the panel zoom changes (FR-062)', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(2) });
    const { host } = mount(props(), '1');
    await waitFor(() => expect(pages()).toHaveLength(2));
    act(() => show(pages()[0]!));
    await waitFor(() => expect(renders).toEqual([{ page: 1, scale: 1 }]));
    host.style.setProperty('--throng-zoom-preview', '2');
    await waitFor(() => expect(renders).toContainEqual({ page: 1, scale: 2 }));
    expect(pages()[0]!.style.width).toBe('1200px');
  });

  it('is a keyboard-scrollable body (FR-063)', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(1) });
    mount(props());
    await waitFor(() => expect(pages()).toHaveLength(1));
    expect(screen.getByTestId('preview-pdf-p1').tabIndex).toBe(0);
  });
});

describe('a PDF that cannot be displayed (FR-067)', () => {
  it('shows one inline notice saying why, and still reports the draw', async () => {
    openPdf.mockResolvedValue({ ok: false, reason: 'it is protected by a password' });
    const p = props();
    mount(p);
    const notice = await screen.findByTestId('preview-pdf-notice-p1');
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toBe('This PDF cannot be displayed: it is protected by a password.');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    await waitFor(() => expect(p.onDrawn).toHaveBeenCalled());
    expect(p.onBodyFailure).not.toHaveBeenCalled();
  });

  it('shows the same notice when main refuses the source', async () => {
    mount(props({ readSource: () => Promise.resolve({ ok: false as const, status: 413 }) }));
    expect((await screen.findByTestId('preview-pdf-notice-p1')).textContent).toMatch(/^This PDF cannot be displayed: /);
    expect(openPdf).not.toHaveBeenCalled();
  });
});

describe('links (FR-066)', () => {
  const links: Record<number, PdfLink[]> = {
    1: [
      { rect: [10, 10, 100, 20], target: { kind: 'url', url: 'https://example.test/spec' } },
      { rect: [10, 40, 100, 20], target: { kind: 'page', page: 3 } },
    ],
  };

  async function drawnWithLinks(p: PreviewBodyProps): Promise<HTMLAnchorElement[]> {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(3, links) });
    mount(p);
    await waitFor(() => expect(pages()).toHaveLength(3));
    act(() => show(pages()[0]!));
    await waitFor(() => expect(pages()[0]!.querySelectorAll('a')).toHaveLength(2));
    return [...pages()[0]!.querySelectorAll('a')];
  }

  it('follows an external link only on Ctrl+click', async () => {
    const p = props();
    const [web] = await drawnWithLinks(p);
    fireEvent.click(web!);
    expect(p.onFollow).not.toHaveBeenCalled();
    fireEvent.click(web!, { ctrlKey: true });
    expect(p.onFollow).toHaveBeenCalledWith({ kind: 'external', url: 'https://example.test/spec' });
  });

  it('follows it on Ctrl+Enter too', async () => {
    const p = props();
    const [web] = await drawnWithLinks(p);
    fireEvent.keyDown(web!, { key: 'Enter', ctrlKey: true });
    expect(p.onFollow).toHaveBeenCalledTimes(1);
  });

  // 074 convergence T060 — Constitution 5.5.0: a panel's menu over a link offers Open Link / Copy Link to Clipboard.
  it('reports a right-click on an external link to the panel, so its link menu opens over it', async () => {
    const onLinkMenu = vi.fn();
    const p = props({ onLinkMenu });
    const [web] = await drawnWithLinks(p);
    fireEvent.contextMenu(web!, { clientX: 30, clientY: 40 });
    expect(onLinkMenu).toHaveBeenCalledWith({ kind: 'external', url: 'https://example.test/spec' }, { x: 30, y: 40 });
  });

  // 074 convergence T067 — FR-066 / 044 FR-094: the hover names the target and what following it does, in the words
  // every preview uses, with the platform's own modifier.
  it('names an external link’s target and gesture on hover as every preview does', async () => {
    const [web] = await drawnWithLinks(props());
    expect(web!.title).toBe(
      previewLinkHoverText({ kind: 'external', url: 'https://example.test/spec' }, primaryModifierLabel()),
    );
  });

  // 074 convergence T083 — Constitution VI, FR-066: a link to another page of the PDF opens the link menu too, and its
  // Open Link (the panel's heading follow, through the reveal the body registers) goes to that page.
  it('reports a right-click on a page link to the panel, and Open Link goes to that page', async () => {
    const onLinkMenu = vi.fn();
    let reveal: ((fragment: string) => boolean) | null = null;
    const p = props({ onLinkMenu, registerFragmentReveal: (r: ((fragment: string) => boolean) | null) => (reveal = r) });
    const [, internal] = await drawnWithLinks(p);
    fireEvent.contextMenu(internal!, { clientX: 30, clientY: 40 });
    expect(onLinkMenu).toHaveBeenCalledWith({ kind: 'heading', fragment: 'page=3' }, { x: 30, y: 40 });
    expect(reveal, 'the body registered no fragment reveal').not.toBeNull();
    let answered = false;
    act(() => {
      answered = reveal!('page=3');
    });
    expect(answered).toBe(true);
    const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1) as HTMLElement;
    expect(scrolled.getAttribute('data-pdf-page')).toBe('3');
  });

  it('scrolls an internal link to its page, and asks the chrome nothing', async () => {
    const p = props();
    const [, internal] = await drawnWithLinks(p);
    fireEvent.click(internal!, { ctrlKey: true });
    const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1) as HTMLElement;
    expect(scrolled.getAttribute('data-pdf-page')).toBe('3');
    expect(p.onFollow).not.toHaveBeenCalled();
  });
});

// 074 convergence T063 — FR-068a: the PDF's text is the page's to select, so the body names its pages as the panel's
// selection host — the menu then offers Select All and Ctrl+A selects the PDF's text and nothing outside it.
describe('the PDF’s text is selectable as a page (FR-068a)', () => {
  it('registers its pages as the panel’s selection host', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(2) });
    const registerSelectionHost = vi.fn();
    mount(props({ registerSelectionHost }));
    await waitFor(() => expect(pages()).toHaveLength(2));
    const host = registerSelectionHost.mock.calls.map(([h]) => h).filter(Boolean).at(-1) as (() => HTMLElement | null) | undefined;
    expect(host, 'a selection host was registered').toBeDefined();
    const el = host!();
    expect(el).not.toBeNull();
    for (const page of pages()) expect(el!.contains(page)).toBe(true);
  });
});

describe('view state (FR-064)', () => {
  it('captures the page and the place in it', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(3) });
    const p = props();
    mount(p);
    await waitFor(() => expect(pages()).toHaveLength(3));
    const capture = vi.mocked(p.onViewStateCapture).mock.calls.at(-1)![0];
    expect(capture()).toEqual({ page: 1, offset: 0 });
  });

  it('keeps the reader at their page when the file is re-rendered, else the last page', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(3) });
    const p = props({ initialViewState: { page: 3, offset: 0 } });
    const { rerender } = mount(p);
    await waitFor(() => expect(pages()).toHaveLength(3));
    await waitFor(() => expect(p.onStatusReadout).toHaveBeenLastCalledWith('Page 3 of 3'));
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(2) });
    rerender({ ...p, content: { kind: 'resource', url: 'throng-preview://source/p1?rev=2' } });
    await waitFor(() => expect(pages()).toHaveLength(2));
    await waitFor(() => expect(p.onStatusReadout).toHaveBeenLastCalledWith('Page 2 of 2'));
  });
});

// 074 convergence T071 — FR-064, US4/AC3: a reload keeps the reader's place within the page, not only the page.
describe('a reload keeps the place within the page (FR-064)', () => {
  it('returns to the same point of the page it captured', async () => {
    const page = 1000;
    const proto = HTMLElement.prototype;
    const before = {
      top: Object.getOwnPropertyDescriptor(proto, 'offsetTop'),
      height: Object.getOwnPropertyDescriptor(proto, 'offsetHeight'),
    };
    const nOf = (el: HTMLElement): number => Number(el.getAttribute('data-pdf-page') ?? 0);
    Object.defineProperty(proto, 'offsetTop', { configurable: true, get(this: HTMLElement) { return Math.max(0, nOf(this) - 1) * page; } });
    Object.defineProperty(proto, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return nOf(this) > 0 ? page : 0; } });
    try {
      openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(3) });
      mount(props({ initialViewState: { page: 2, offset: 0.5 } }));
      await waitFor(() => expect(pages()).toHaveLength(3));
      await waitFor(() => expect(screen.getByTestId('preview-pdf-p1').scrollTop).toBe(page + 0.5 * page));
    } finally {
      for (const [name, d] of [['offsetTop', before.top], ['offsetHeight', before.height]] as const) {
        if (d) Object.defineProperty(proto, name, d);
        else delete (proto as unknown as Record<string, unknown>)[name];
      }
    }
  });
});

describe('Go to Page (FR-062b)', () => {
  /** Mount a laid-out PDF and open Go to Page the way the panel does (Ctrl+G, the menus): through what it registered. */
  async function openGoTo(pageCount: number): Promise<HTMLInputElement> {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(pageCount) });
    let open: (() => void) | null = null;
    mount(props({ registerGoTo: (o) => (open = o) }));
    await waitFor(() => expect(open).not.toBeNull());
    act(() => open!());
    return screen.getByTestId('pdf-goto-p1-input') as HTMLInputElement;
  }

  it('registers its opener only once there are pages, and names the current page and the count', async () => {
    const input = await openGoTo(120);
    expect(screen.getByRole('dialog', { name: 'Go to Page' })).toBeInTheDocument();
    expect(screen.getByTestId('pdf-goto-p1-status').textContent).toBe('Page 1 of 120');
    expect(input).toHaveFocus();
  });

  it('takes only a page that exists: anything else is refused as it is typed', async () => {
    const input = await openGoTo(15);
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '12' } });
    expect(input.value).toBe('12');
    fireEvent.change(input, { target: { value: '120' } }); // past the last page
    expect(input.value).toBe('12');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.change(input, { target: { value: 'x' } });
    expect(input.value).toBe('12');
  });

  it('Enter goes to the page, names it the current page, closes and hands focus back to the pages', async () => {
    const input = await openGoTo(5);
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1) as HTMLElement;
    expect(scrolled.getAttribute('data-pdf-page')).toBe('4');
    expect(screen.queryByTestId('pdf-goto-p1')).toBeNull();
    expect(screen.getByTestId('preview-pdf-p1')).toHaveFocus();
  });

  it('Enter with nothing typed goes nowhere and keeps the modal open', async () => {
    const input = await openGoTo(5);
    const calls = vi.mocked(Element.prototype.scrollIntoView).mock.calls.length;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('pdf-goto-p1')).toBeInTheDocument();
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls.length).toBe(calls);
  });

  it('Escape closes without going anywhere', async () => {
    const input = await openGoTo(5);
    const calls = vi.mocked(Element.prototype.scrollIntoView).mock.calls.length;
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('pdf-goto-p1')).toBeNull();
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls.length).toBe(calls);
  });
});

describe('Find across the whole document, pages not yet drawn included (FR-086c)', () => {
  /** The panel's find engine over the mounted body, as `preview-panel.tsx` builds it, and the find bar opened on it. */
  async function findIn(pageCount: number): Promise<void> {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(pageCount) });
    const { host } = mount(props());
    await waitFor(() => expect(pages()).toHaveLength(pageCount));
    attachPanelSearch('p1', createPreviewSearchController({ host: () => host, painter: createCssHighlightPainter('p1') }));
    openFind('p1', 'preview');
  }
  const count = (): SearchCount | undefined => getFindSession('p1')?.count;

  afterEach(() => __resetFindState());

  it('counts a match on a page never scrolled near, and scrolls that page’s match into view', async () => {
    await findIn(5);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    act(() => setTerm('p1', 'page 4'));
    await waitFor(() => expect(count()).toEqual({ current: 1, total: 1 }));
    const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.contexts as Element[];
    expect(scrolled.some((el) => pages()[3]!.contains(el))).toBe(true);
    // Text only: no page was painted to find it.
    expect(renders).toEqual([]);
  });

  it('steps Next / Previous through every page’s matches', async () => {
    await findIn(4);
    act(() => setTerm('p1', 'Text of page'));
    await waitFor(() => expect(count()).toEqual({ current: 1, total: 4 }));
    act(() => findPrevious('p1'));
    expect(count()).toEqual({ current: 4, total: 4 });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    act(() => findNext('p1'));
    expect(count()).toEqual({ current: 1, total: 4 });
    const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.contexts as Element[];
    expect(scrolled.some((el) => pages()[0]!.contains(el))).toBe(true);
  });

  it('builds no text layer while there is nothing to find', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(5) });
    mount(props());
    await waitFor(() => expect(pages()).toHaveLength(5));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(texts).toEqual([]);
  });
});

describe('smooth scrolling and resizing (FR-065a – FR-065c)', () => {
  it('keeps every page at its placeholder size as pages paint: nothing below moves', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(4) });
    mount(props());
    await waitFor(() => expect(pages()).toHaveLength(4));
    const before = pages().map((p) => `${p.style.width}x${p.style.height}`);
    expect(before).toEqual(['600pxx800px', '600pxx800px', '600pxx800px', '600pxx800px']);
    act(() => show(pages()[1]!, pages()[2]!));
    await waitFor(() => expect(renders).toHaveLength(2));
    expect(pages().map((p) => `${p.style.width}x${p.style.height}`)).toEqual(before);
  });

  it('paints a page the scroll brought near only once scrolling has been still (FR-065a)', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(3) });
    mount(props());
    await waitFor(() => expect(pages()).toHaveLength(3));
    fireEvent.scroll(screen.getByTestId('preview-pdf-p1'));
    act(() => show(pages()[2]!));
    await sleep(PDF_SCROLL_SETTLE_MS / 2);
    // Still scrolling, as far as the body knows: nothing is drawn on the scroll path.
    fireEvent.scroll(screen.getByTestId('preview-pdf-p1'));
    await sleep(PDF_SCROLL_SETTLE_MS / 2);
    expect(renders).toEqual([]);
    await waitFor(() => expect(renders).toEqual([{ page: 3, scale: 1 }]));
  });

  it('cancels a page’s paint when it leaves the view before it is drawn, and paints it again on its return (FR-065a)', async () => {
    slowPages = new Set([2]);
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(3) });
    mount(props());
    await waitFor(() => expect(pages()).toHaveLength(3));
    act(() => show(pages()[1]!));
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]!.signal?.aborted).toBe(false);
    act(() => hide(pages()[1]!));
    expect(signals[0]!.signal?.aborted).toBe(true);
    slowPages = new Set();
    act(() => show(pages()[1]!));
    await waitFor(() => expect(renders).toHaveLength(2));
  });

  it('draws a resize’s run of zooms once, sharp at the last, when the zoom has been still (FR-065b)', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(1) });
    const { host } = mount(props(), '1');
    await waitFor(() => expect(pages()).toHaveLength(1));
    act(() => show(pages()[0]!));
    await waitFor(() => expect(renders).toEqual([{ page: 1, scale: 1 }]));
    for (const zoom of ['1.1', '1.2', '1.3', '1.4']) {
      host.style.setProperty('--throng-zoom-preview', zoom);
      await sleep(PDF_ZOOM_SETTLE_MS / 4);
    }
    // The page box follows every step at once — the drawn bitmap stretches to it until the zoom is still.
    await waitFor(() => expect(pages()[0]!.style.width).toBe('840px'));
    expect(renders).toEqual([{ page: 1, scale: 1 }]);
    await waitFor(() => expect(renders).toEqual([{ page: 1, scale: 1 }, { page: 1, scale: 1.4 }]));
    await sleep(PDF_ZOOM_SETTLE_MS * 2);
    expect(renders).toHaveLength(2);
  });

  it('shows a spinner in a page still drawing once the delay has passed, and takes it away when drawn (FR-065c)', async () => {
    slowPages = new Set([1]);
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(2) });
    mount(props());
    await waitFor(() => expect(pages()).toHaveLength(2));
    act(() => show(pages()[0]!));
    await waitFor(() => expect(releases.has(1)).toBe(true));
    await sleep(PDF_PAGE_SPINNER_DELAY_MS / 2);
    expect(screen.queryByTestId('pdf-page-loading-p1-1')).toBeNull();
    const spinner = await screen.findByTestId('pdf-page-loading-p1-1');
    expect(pages()[0]!.contains(spinner)).toBe(true);
    expect(spinner.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Loading page 1');
    act(() => releases.get(1)!());
    await waitFor(() => expect(screen.queryByTestId('pdf-page-loading-p1-1')).toBeNull());
  });

  it('shows no spinner for a page drawn within the delay (FR-065c)', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(2) });
    mount(props());
    await waitFor(() => expect(pages()).toHaveLength(2));
    act(() => show(pages()[0]!));
    await waitFor(() => expect(renders).toHaveLength(1));
    await sleep(PDF_PAGE_SPINNER_DELAY_MS * 2);
    expect(screen.queryByTestId('pdf-page-loading-p1-1')).toBeNull();
  });

  it('shows no spinner over a page already drawn while it redraws at a new zoom (FR-065c)', async () => {
    openPdf.mockResolvedValue({ ok: true, doc: fakeDoc(1) });
    const { host } = mount(props(), '1');
    await waitFor(() => expect(pages()).toHaveLength(1));
    act(() => show(pages()[0]!));
    await waitFor(() => expect(renders).toHaveLength(1));
    slowPages = new Set([1]);
    host.style.setProperty('--throng-zoom-preview', '2');
    await waitFor(() => expect(renders).toHaveLength(2));
    await sleep(PDF_PAGE_SPINNER_DELAY_MS * 2);
    expect(screen.queryByTestId('pdf-page-loading-p1-1')).toBeNull();
  });
});
