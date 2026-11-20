/**
 * The PDF provider's body (074 US4, FR-060 – FR-068; research R5).
 *
 * Every page, one after another, in one keyboard-scrollable body. The document's bytes come from main through
 * `readSource` (the preview protocol's own handler: confined, MIME-checked, size-capped — FR-061); PDF.js sits
 * behind `pdf-renderer.ts` and is loaded on first use (FR-065).
 *
 * ══ ON DEMAND ══
 *
 * Each page is a placeholder of its size (page 1's size until its own is known) and is painted only when an
 * IntersectionObserver with a one-viewport margin sees it, so a 500-page PDF paints a handful of pages, not 500
 * (SC-004). A page is painted at the panel's zoom (`--throng-zoom-preview`, FR-034) times the device pixel ratio,
 * and painted AGAIN when the zoom changes, so it is sharp rather than a stretched bitmap (FR-062).
 *
 * ══ LINKS ══
 *
 * Drawn here, over the canvas, from what `pdf-renderer.ts` admits: a page inside the document, or an
 * `http:`/`https:`/`mailto:` URL. Both follow on the constitution's one gesture — Ctrl+click, or Ctrl+Enter on a
 * focused link (FR-079's rule, 044 FR-091) — and a plain click does nothing. An external link goes to the chrome
 * through `onFollow`; an internal one scrolls this body to its page.
 *
 * ══ VIEW CONTROLS (2026-11-19, FR-062a) ══
 *
 * A toolbar pinned top-left, outside the scrolling pages, carries the controls a picture preview has — Fit, Zoom In,
 * Zoom 100%, Zoom Out — with the fading zoom percentage. Fit fills the panel's width with the widest page. A PDF opens
 * at 100%, or at Fit where that page is wider than the panel (FR-020a). The panel's zoom chords and Ctrl+wheel act on this view, as they do on a
 * drawing that fills its panel (`diagram-zoom.ts`), and a step keeps the point at the centre (or under the pointer)
 * where it is. Any zoom the panel itself still carries multiplies in.
 *
 * ══ TEXT (2026-11-19, FR-068a) ══
 *
 * Each painted page carries PDF.js's text layer over its canvas — transparent spans the reader can select and copy
 * with the body menu's Copy, Select All or the Copy chord; links stay above it.
 *
 * ══ FIND (FR-086c) ══
 *
 * The panel's one find engine searches the text layers in this body. So that it finds the whole document, not the
 * pages painted so far, every page still without a text layer gets one — text only, no canvas — in idle batches
 * while this panel's find bar holds a query, and the find session is re-run as each batch lands. The match the
 * reader is on is a span in its page's layer, so stepping to it scrolls that page into view, which paints it.
 *
 * ══ PLACE ══
 *
 * The view state is `{ page, offset }` (offset: how far into that page, 0 – 1). A re-render after the file
 * changes on disk keeps the reader at the same page where it still exists, else the last page (FR-064).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { classifyPreviewLink, formatGrouped, logCaught } from '@throng/core';
import type { PageLayout, PreviewBodyProps } from '../../provider-view.js';
import { PAGE_LAYOUT_ROWS } from '../../content-menu.js';
import { IconButton } from '../../../common/icon-button.js';
import { Spinner } from '../../../common/loading.js';
import { useKeybindings } from '../../../config/config-store.js';
import { zoomPercent, zoomTitles } from '../../zoom-titles.js';
import { ZoomIndicator } from '../../../workspace/zoom-indicator.js';
import { DIAGRAM_MAX_SCALE, DIAGRAM_MIN_SCALE, ZOOM_STEP } from '../../diagram/diagram-frame.js';
import {
  DIAGRAM_FILLS_PANEL_ATTR,
  DIAGRAM_ZOOM_KEY_ATTR,
  diagramZoomKey,
  registerDiagramZoom,
  type DiagramZoomAction,
  type DiagramZoomPoint,
} from '../../diagram/diagram-zoom.js';
import { getPanelSearch } from '../../../search/search-controller.js';
import type { PreviewSearchController } from '../../preview-search.js';
import { updateCount, useVisibleFindSession } from '../../../search/search-store.js';
import { openPdf, type PdfDocument, type PdfLink, type PdfPage } from './pdf-renderer.js';
import { GoToDialog } from '../../../navigate/go-to-dialog.js';
import './pdf.css';

/** The space either side of a page and between two in a row (`pdf.css`): Fit leaves it clear. */
const PAGE_GAP_PX = 12;

/** FR-062a / FR-062c — the view: Fit (the widest page, or two side by side, across the panel), or a zoom. */
type PdfView = { mode: 'fit' } | { mode: 'zoom'; scale: number } | { mode: 'open' };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** FR-086c — pages whose text is laid out for Find in one idle moment. */
const TEXT_BATCH_PAGES = 4;

type IdleHandle = { idle: number } | { timer: ReturnType<typeof setTimeout> };

/** Run `cb` when the renderer is idle; a runtime without `requestIdleCallback` (jsdom) runs it on the next task. */
function whenIdle(cb: () => void): IdleHandle {
  return typeof requestIdleCallback === 'function' ? { idle: requestIdleCallback(cb, { timeout: 500 }) } : { timer: setTimeout(cb, 0) };
}

function cancelIdle(handle: IdleHandle): void {
  if ('idle' in handle) cancelIdleCallback(handle.idle);
  else clearTimeout(handle.timer);
}

/** This panel's preview find engine (`preview-search.ts`), or `null` while the panel has none. */
function previewEngine(panelId: string): PreviewSearchController | null {
  const controller = getPanelSearch(panelId);
  return controller?.panelKind === 'preview' && 'refresh' in controller ? (controller as PreviewSearchController) : null;
}

/** What a reader's place in a PDF is (FR-064). */
export interface PdfViewState {
  page: number;
  offset: number;
}

const ZOOM_VAR = '--throng-zoom-preview';

function isViewState(v: unknown): v is PdfViewState {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as PdfViewState).page === 'number' &&
    typeof (v as PdfViewState).offset === 'number'
  );
}

/** The nearest ancestor that carries the panel's zoom in its own style, and that zoom. */
function zoomHost(el: Element | null): HTMLElement | null {
  for (let at = el?.parentElement ?? null; at !== null; at = at.parentElement) {
    if (at.style.getPropertyValue(ZOOM_VAR) !== '') return at;
  }
  return null;
}

function zoomOf(host: HTMLElement | null): number {
  const value = Number.parseFloat(host?.style.getPropertyValue(ZOOM_VAR) ?? '');
  return Number.isFinite(value) && value > 0 ? value : 1;
}

type Loaded =
  | { kind: 'loading' }
  | { kind: 'failed'; reason: string }
  | { kind: 'ready'; doc: PdfDocument; size: { width: number; height: number } };

export function PdfBody({
  panelId,
  content,
  filePath,
  projectRoot,
  initialViewState,
  onViewStateCapture,
  onFollow,
  onDrawn,
  onBodyFailure,
  onStatusReadout,
  readSource,
  registerGoTo,
  registerPageLayout,
}: PreviewBodyProps): ReactElement {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  /** FR-062c — one page under another, two to a row, or as many as fit the panel's width. */
  const [layout, setLayout] = useState<PageLayout>('single');
  /** Whatever zoom the panel itself carries (044 FR-034); the view's own scale multiplies it. */
  const [panelZoom, setPanelZoom] = useState(1);
  /** FR-020a — a PDF opens at 100%, or Fit where its widest page is wider than the panel, until the reader zooms. */
  const [view, setView] = useState<PdfView>({ mode: 'open' });
  const [width, setWidth] = useState(0);
  const [zoomCue, setZoomCue] = useState(0);
  const [current, setCurrent] = useState(1);
  /** Each page's own size once known, and its links once painted. */
  const [sizes, setSizes] = useState<Record<number, { width: number; height: number }>>({});
  const [links, setLinks] = useState<Record<number, readonly PdfLink[]>>({});

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const visible = useRef(new Set<number>());
  const painted = useRef(new Map<number, number>());
  /** Each page's text layer in progress, cancelled when the page is painted again. */
  const textLayers = useRef(new Map<number, () => void>());
  /** FR-086c — the pages whose text layer has been laid out, painted or not. */
  const textBuilt = useRef(new Set<number>());

  /*
   * FR-062a (amended 2026-11-19) — Fit FILLS the panel's width with the widest known page, enlarging a page narrower
   * than the panel; in Two Pages (FR-062c) it fills it with two of them side by side. Side by Side fits one page across,
   * as Single Page does, and wraps however many fit at any other zoom.
   */
  const widest = Math.max(
    loaded.kind === 'ready' ? loaded.size.width : 0,
    ...Object.values(sizes).map((s) => s.width),
  );
  const columns = layout === 'two' ? 2 : 1;
  const fitScale =
    width > 0 && widest > 0
      ? clamp((width - PAGE_GAP_PX * (columns + 1)) / (widest * columns), DIAGRAM_MIN_SCALE, DIAGRAM_MAX_SCALE)
      : 1;
  const viewScale = view.mode === 'fit' ? fitScale : view.mode === 'open' ? Math.min(1, fitScale) : view.scale;
  const zoom = viewScale * panelZoom;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const viewScaleRef = useRef(viewScale);
  viewScaleRef.current = viewScale;
  /** Where a zoom step leaves the scroll: the content point under (`px`, `py`) stays there. */
  const pendingScroll = useRef<{ ratio: number; px: number; py: number } | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  /** Where to put the reader once the next document is laid out. */
  const restoreTo = useRef<PdfViewState | null>(isViewState(initialViewState) ? initialViewState : null);

  const latest = useRef({ onDrawn, onBodyFailure, onStatusReadout, readSource, onFollow });
  latest.current = { onDrawn, onBodyFailure, onStatusReadout, readSource, onFollow };

  // FR-064 — the reader's place, as the chrome reads it when it leaves this entry.
  const capture = useCallback((): PdfViewState => {
    const page = currentRef.current;
    const scroller = scrollerRef.current;
    const el = pageEls.current.get(page);
    let offset = 0;
    if (scroller !== null && el !== undefined && el.offsetHeight > 0) {
      offset = Math.min(1, Math.max(0, (scroller.scrollTop - el.offsetTop) / el.offsetHeight));
    }
    return { page, offset };
  }, []);
  useEffect(() => {
    onViewStateCapture(capture);
  }, [onViewStateCapture, capture]);

  // The panel's zoom: read from the panel root's own style, and followed as it changes.
  useEffect(() => {
    const host = zoomHost(scrollerRef.current);
    setPanelZoom(zoomOf(host));
    if (host === null) return undefined;
    const observer = new MutationObserver(() => setPanelZoom(zoomOf(host)));
    observer.observe(host, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);

  // FR-062a — the body's width, for Fit.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return undefined;
    // The scroller keeps a stable scrollbar gutter (`pdf.css`), so a vertical scrollbar coming and going never
    // changes this width — measured, it did, and Fit flipped between two scales every frame (2026-11-19).
    const measure = (): void => setWidth(scroller.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // FR-062a — the controls, the chords and Ctrl+wheel. A step keeps the content under `at` (the pointer, or the
  // centre of the view) where it is.
  const cue = useCallback((): void => setZoomCue((c) => c + 1), []);
  const onFit = useCallback((): void => {
    setView({ mode: 'fit' });
    cue();
  }, [cue]);
  const onZoomActual = useCallback((): void => {
    setView({ mode: 'zoom', scale: 1 });
    cue();
  }, [cue]);
  const zoomAbout = useCallback(
    (factor: number, at?: { x: number; y: number }): void => {
      const scroller = scrollerRef.current;
      const from = viewScaleRef.current;
      const next = clamp(from * factor, DIAGRAM_MIN_SCALE, DIAGRAM_MAX_SCALE);
      if (scroller !== null) {
        pendingScroll.current = {
          ratio: next / from,
          px: at?.x ?? scroller.clientWidth / 2,
          py: at?.y ?? scroller.clientHeight / 2,
        };
      }
      setView({ mode: 'zoom', scale: next });
      cue();
    },
    [cue],
  );
  useLayoutEffect(() => {
    const pending = pendingScroll.current;
    const scroller = scrollerRef.current;
    if (pending === null || scroller === null) return;
    pendingScroll.current = null;
    scroller.scrollLeft = Math.max(0, (scroller.scrollLeft + pending.px) * pending.ratio - pending.px);
    scroller.scrollTop = Math.max(0, (scroller.scrollTop + pending.py) * pending.ratio - pending.py);
  }, [zoom]);

  // The panel's zoom chords and Ctrl+wheel zoom this view, as they zoom a drawing that fills its panel.
  const keybindings = useKeybindings();
  const titles = useMemo(() => zoomTitles(keybindings, 'Fit page width', 'actual'), [keybindings]);
  const zoomKey = diagramZoomKey(panelId, 'pdf');
  useEffect(
    () =>
      registerDiagramZoom(zoomKey, (action: DiagramZoomAction, at?: DiagramZoomPoint): void => {
        // The reset is the view the document opened in (FR-020a, 2026-11-20): 100% unless the pages are wider.
        if (action === 'reset') {
          setView({ mode: 'open' });
          cue();
          return;
        }
        const rect = at === undefined ? undefined : scrollerRef.current?.getBoundingClientRect();
        const point =
          at !== undefined && rect !== undefined && at.clientX >= rect.left && at.clientX <= rect.right && at.clientY >= rect.top && at.clientY <= rect.bottom
            ? { x: at.clientX - rect.left, y: at.clientY - rect.top }
            : undefined;
        zoomAbout(action === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP, point);
      }),
    [zoomKey, zoomAbout, cue],
  );

  // Load the document: on mount, and whenever main hands a new revision of the source.
  const url = content.kind === 'resource' ? content.url : '';
  useEffect(() => {
    let cancelled = false;
    let opened: PdfDocument | null = null;
    // A reload (the file changed on disk) keeps the reader where they are (FR-064).
    if (loaded.kind === 'ready') restoreTo.current = capture();
    void (async () => {
      const read = (await latest.current.readSource?.()) ?? { ok: false as const, status: 404 };
      if (cancelled) return;
      if (!read.ok) {
        setLoaded({ kind: 'failed', reason: read.status === 413 ? 'it is larger than its preview limit' : 'it could not be read' });
        return;
      }
      const result = await openPdf(read.bytes);
      if (cancelled) {
        if (result.ok) result.doc.destroy();
        return;
      }
      if (!result.ok) {
        setLoaded({ kind: 'failed', reason: result.reason });
        return;
      }
      opened = result.doc;
      const first = result.doc.pageCount > 0 ? await result.doc.page(1) : null;
      if (cancelled) return;
      painted.current.clear();
      visible.current.clear();
      textBuilt.current.clear();
      setSizes(first === null ? {} : { 1: { width: first.width, height: first.height } });
      setLinks({});
      setLoaded({ kind: 'ready', doc: result.doc, size: first === null ? { width: 612, height: 792 } : first });
    })().catch((error: unknown) => {
      // The chrome shows the shared failure banner for it (data-model §13); logged here, where it was caught.
      logCaught('pdf-body: open the document', error);
      if (!cancelled) latest.current.onBodyFailure(error);
    });
    return () => {
      cancelled = true;
      opened?.destroy();
    };
    // `loaded` and `capture` are read for the reload's place only; the source revision is what reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Report every draw (provider-view.ts): the laid-out document, or the one notice.
  useEffect(() => {
    if (loaded.kind === 'loading') return;
    if (loaded.kind === 'ready') {
      const target = restoreTo.current;
      restoreTo.current = null;
      const page = target === null ? 1 : Math.min(Math.max(1, Math.round(target.page)), loaded.doc.pageCount);
      setCurrent(page);
      if (target !== null) pageEls.current.get(page)?.scrollIntoView({ block: 'start' });
    }
    latest.current.onDrawn(filePath);
  }, [loaded, filePath]);

  // FR-062 — "Page n of m", digit-grouped, and the zoom the pages are shown at (2026-11-20), as the indicator shows it.
  useEffect(() => {
    if (loaded.kind !== 'ready') {
      latest.current.onStatusReadout?.(null);
      return;
    }
    const page = `Page ${formatGrouped(current)} of ${formatGrouped(loaded.doc.pageCount)}`;
    // Before the panel is measured only a chosen zoom is known: Fit and the opening view read its width.
    latest.current.onStatusReadout?.(view.mode === 'zoom' || width > 0 ? `${page} · ${zoomPercent(zoom)}` : page);
  }, [loaded, current, zoom, width, view.mode]);
  useEffect(() => () => latest.current.onStatusReadout?.(null), []);

  /*
   * FR-086c — this panel's find session, while its bar is up. A text layer laid out under it replaces the spans its
   * matches were found in, so the session is re-run (once per task, however many layers landed) to find them again
   * and paint them over the new spans. A session that had no current match and now has one scrolls to it.
   */
  const findSession = useVisibleFindSession(panelId);
  const hasQuery = (findSession?.term.length ?? 0) > 0;
  const hasQueryRef = useRef(hasQuery);
  hasQueryRef.current = hasQuery;
  const findRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleFindRefresh = useCallback((): void => {
    if (!hasQueryRef.current || findRefreshTimer.current !== null) return;
    findRefreshTimer.current = setTimeout(() => {
      findRefreshTimer.current = null;
      const engine = previewEngine(panelId);
      if (engine === null || !hasQueryRef.current) return;
      const before = engine.currentFrom();
      updateCount(panelId, engine.refresh());
      if (before === null && engine.currentFrom() !== null) engine.scrollToCurrent();
    }, 0);
  }, [panelId]);
  useEffect(
    () => () => {
      if (findRefreshTimer.current !== null) clearTimeout(findRefreshTimer.current);
    },
    [],
  );

  /** Paint page `n` at the current zoom, unless it already is. */
  const paint = useCallback(
    (n: number): void => {
      if (loaded.kind !== 'ready') return;
      const scale = zoomRef.current;
      if (painted.current.get(n) === scale) return;
      painted.current.set(n, scale);
      const doc = loaded.doc;
      void doc
        .page(n)
        .then(async (page: PdfPage) => {
          setSizes((s) => (s[n]?.width === page.width && s[n]?.height === page.height ? s : { ...s, [n]: { width: page.width, height: page.height } }));
          const pageEl = pageEls.current.get(n);
          const canvas = pageEl?.querySelector('canvas');
          if (canvas) await page.render(canvas, scale, window.devicePixelRatio || 1);
          // FR-068a — the selectable text, at the scale just painted; a layer still building for an older one stops.
          const text = pageEl?.querySelector<HTMLElement>('.preview-pdf__text');
          if (text && painted.current.get(n) === scale) {
            textLayers.current.get(n)?.();
            textLayers.current.set(n, await page.renderText(text, scale));
            textBuilt.current.add(n);
            scheduleFindRefresh();
          }
          const found = await page.links();
          setLinks((l) => (l[n] === undefined && found.length === 0 ? l : { ...l, [n]: found }));
        })
        .catch((error: unknown) => {
          painted.current.delete(n);
          logCaught('pdf-body: paint a page', error);
        });
    },
    [loaded, scheduleFindRefresh],
  );

  // FR-086c — while there is a query, every page still without text gets its text layer (no canvas), a few pages per
  // idle moment so typing and scrolling stay responsive; the find session re-runs as each batch lands.
  useEffect(() => {
    if (loaded.kind !== 'ready' || !hasQuery) return undefined;
    const doc = loaded.doc;
    const pending = Array.from({ length: doc.pageCount }, (_, i) => i + 1).filter((n) => !textBuilt.current.has(n));
    if (pending.length === 0) return undefined;
    let cancelled = false;
    let handle: IdleHandle | null = null;
    const buildText = async (n: number): Promise<void> => {
      if (textBuilt.current.has(n) || painted.current.has(n)) return;
      const page = await doc.page(n);
      const text = pageEls.current.get(n)?.querySelector<HTMLElement>('.preview-pdf__text');
      // A page painted meanwhile lays its own text out, at the scale it was painted.
      if (cancelled || text == null || textBuilt.current.has(n) || painted.current.has(n)) return;
      const cancel = await page.renderText(text, zoomRef.current);
      if (!textLayers.current.has(n)) textLayers.current.set(n, cancel);
      textBuilt.current.add(n);
    };
    const step = (): void => {
      handle = null;
      const batch = pending.splice(0, TEXT_BATCH_PAGES);
      void Promise.all(batch.map((n) => buildText(n)))
        .catch((error: unknown) => logCaught('pdf-body: lay out a page’s text for Find', error))
        .then(() => {
          if (cancelled) return;
          scheduleFindRefresh();
          if (pending.length > 0) handle = whenIdle(step);
        });
    };
    handle = whenIdle(step);
    return () => {
      cancelled = true;
      if (handle !== null) cancelIdle(handle);
    };
  }, [loaded, hasQuery, scheduleFindRefresh]);

  // FR-065 — pages near the viewport are painted; the rest stay placeholders.
  useEffect(() => {
    if (loaded.kind !== 'ready') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset.pdfPage);
          if (entry.isIntersecting) {
            visible.current.add(n);
            paint(n);
          } else visible.current.delete(n);
        }
      },
      { root: scrollerRef.current, rootMargin: '100% 0px' },
    );
    for (const el of pageEls.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [loaded, paint]);

  // A text layer still building when the body goes stops there.
  useEffect(
    () => () => {
      for (const cancel of textLayers.current.values()) cancel();
      textLayers.current.clear();
    },
    [],
  );

  // FR-062 — a zoom change repaints the pages in view at the new scale.
  useEffect(() => {
    for (const n of visible.current) paint(n);
  }, [zoom, paint]);

  // The page whose row starts last above the middle of the view is the current page — the first of that row, where a
  // row holds several (FR-062c).
  const onScroll = useCallback((): void => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const middle = scroller.scrollTop + scroller.clientHeight / 2;
    let page = 1;
    let top = Number.NEGATIVE_INFINITY;
    for (const [n, el] of pageEls.current) {
      if (el.offsetTop > middle) continue;
      if (el.offsetTop > top || (el.offsetTop === top && n < page)) {
        top = el.offsetTop;
        page = n;
      }
    }
    if (page !== currentRef.current) setCurrent(page);
  }, []);

  // FR-062c — the layout, for the body menu's rows; a change keeps the current page in view.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const keepPage = useRef<number | null>(null);
  const changeLayout = useCallback((next: PageLayout): void => {
    if (next === layoutRef.current) return;
    keepPage.current = currentRef.current;
    setLayout(next);
  }, []);
  useLayoutEffect(() => {
    const page = keepPage.current;
    keepPage.current = null;
    if (page !== null) pageEls.current.get(page)?.scrollIntoView({ block: 'start' });
  }, [layout, zoom]);
  useEffect(() => {
    registerPageLayout?.({ get: () => layoutRef.current, set: changeLayout });
    return () => registerPageLayout?.(null);
  }, [registerPageLayout, changeLayout]);

  const goToPage = useCallback((page: number): void => {
    pageEls.current.get(page)?.scrollIntoView({ block: 'start' });
    setCurrent(page);
  }, []);

  // FR-062b — Go to Page: the panel opens it (Ctrl+G, the menus) once there are pages to go to.
  const [goToOpen, setGoToOpen] = useState(false);
  const ready = loaded.kind === 'ready';
  useEffect(() => {
    if (!ready) return undefined;
    registerGoTo?.(() => setGoToOpen(true));
    return () => registerGoTo?.(null);
  }, [ready, registerGoTo]);
  const onGoToDismiss = useCallback((): void => setGoToOpen(false), []);
  const onGoToClosed = useCallback((): void => scrollerRef.current?.focus({ preventScroll: true }), []);

  const follow = (link: PdfLink): void => {
    if (link.target.kind === 'page') {
      goToPage(link.target.page);
      return;
    }
    latest.current.onFollow(classifyPreviewLink(link.target.url, { docPath: filePath, projectRoot }));
  };
  const onLinkClick = (link: PdfLink) => (e: MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) follow(link);
  };
  const onLinkKey = (link: PdfLink) => (e: KeyboardEvent<HTMLAnchorElement>): void => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) follow(link);
  };

  const pageCount = loaded.kind === 'ready' ? loaded.doc.pageCount : 0;
  const fallback = loaded.kind === 'ready' ? loaded.size : { width: 612, height: 792 };

  return (
    <div
      className="preview-pdf-view"
      // The panel's zoom gestures zoom this view, focused or not, as they zoom a drawing that fills its panel.
      {...{ [DIAGRAM_ZOOM_KEY_ATTR]: zoomKey, [DIAGRAM_FILLS_PANEL_ATTR]: '' }}
      data-scale={String(viewScale)}
    >
      {loaded.kind === 'ready' ? (
        <div className="preview-pdf__toolbar" role="toolbar" aria-label="PDF view">
          <IconButton token="diagramFit" title={titles.fit} onClick={onFit} testId={`pdf-fit-${panelId}`} />
          <IconButton token="zoomIn" title={titles.zoomIn} onClick={() => zoomAbout(ZOOM_STEP)} testId={`pdf-zoom-in-${panelId}`} />
          <IconButton token="diagramZoomReset" title={titles.actual} onClick={onZoomActual} testId={`pdf-zoom-actual-${panelId}`} />
          <IconButton token="zoomOut" title={titles.zoomOut} onClick={() => zoomAbout(1 / ZOOM_STEP)} testId={`pdf-zoom-out-${panelId}`} />
          <span className="preview-pdf__toolbar-gap" aria-hidden="true" />
          {PAGE_LAYOUT_ROWS.map((row) => (
            <IconButton
              key={row.layout}
              token={row.icon}
              title={row.label}
              ariaPressed={layout === row.layout}
              onClick={() => changeLayout(row.layout)}
              testId={`pdf-layout-${row.layout}-${panelId}`}
            />
          ))}
        </div>
      ) : null}
    <div
      ref={scrollerRef}
      className="preview-pdf"
      data-testid={`preview-pdf-${panelId}`}
      tabIndex={0}
      onScroll={onScroll}
    >
      {loaded.kind === 'loading' ? (
        // 075 FR-043a — the placeholder everything in a preview shows while it loads (`loading-placeholder.css`).
        <div className="preview-loading preview-loading--block" data-testid={`pdf-loading-${panelId}`}>
          <Spinner label="Loading PDF" />
          <span>Loading PDF…</span>
        </div>
      ) : null}
      {loaded.kind === 'failed' ? (
        <div className="preview-pdf__notice" role="status" data-testid={`preview-pdf-notice-${panelId}`}>
          {`This PDF cannot be displayed: ${loaded.reason}.`}
        </div>
      ) : null}
      <div className={`preview-pdf__pages preview-pdf__pages--${layout}`} data-testid={`pdf-pages-${panelId}`}>
      {Array.from({ length: pageCount }, (_, i) => {
        const n = i + 1;
        const size = sizes[n] ?? fallback;
        return (
          <div
            key={n}
            ref={(el) => {
              if (el === null) pageEls.current.delete(n);
              else pageEls.current.set(n, el);
            }}
            className="preview-pdf__page"
            data-pdf-page={String(n)}
            style={
              {
                width: `${size.width * zoom}px`,
                height: `${size.height * zoom}px`,
                // FR-062d — the text layer's scale is the view's, not the paint's: PDF.js sizes the layer and its spans
                // from this variable, so a page not repainted since a zoom still matches its box (a stale, wider
                // layer scrolled the panel sideways, 2026-11-19).
                '--total-scale-factor': String(zoom),
              } as CSSProperties
            }
          >
            <canvas className="preview-pdf__canvas" aria-label={`Page ${formatGrouped(n)}`} />
            {/* FR-068a — PDF.js's text layer: selectable, transparent text over the canvas. */}
            <div className="preview-pdf__text" data-testid={`pdf-text-${panelId}-${n}`} />

            {(links[n] ?? []).map((link, k) => {
              const [left, top, width, height] = link.rect;
              const target = link.target.kind === 'page' ? `Page ${formatGrouped(link.target.page)}` : link.target.url;
              return (
                <a
                  key={k}
                  className="preview-pdf__link"
                  href={link.target.kind === 'url' ? link.target.url : `#page-${link.target.page}`}
                  title={`${target} — Ctrl+click to follow`}
                  style={{ left: `${left * zoom}px`, top: `${top * zoom}px`, width: `${width * zoom}px`, height: `${height * zoom}px` }}
                  onClick={onLinkClick(link)}
                  onKeyDown={onLinkKey(link)}
                />
              );
            })}
          </div>
        );
      })}
      </div>
    </div>
      <ZoomIndicator percent={zoom * 100} cue={zoomCue} testId={`pdf-zoom-indicator-${panelId}`} resting />
      {goToOpen && loaded.kind === 'ready' ? (
        // 074 FR-062b — the shared Go to dialog (073 FR-043b) counting pages: "Page 3 of 120", a field that takes only a page
        // that exists. Enter goes, Escape or the scrim dismisses; focus returns to the pages either way.
        <GoToDialog
          unit="Page"
          current={current}
          count={loaded.doc.pageCount}
          onGo={goToPage}
          onDismiss={onGoToDismiss}
          returnFocus={onGoToClosed}
          testIdPrefix={`pdf-goto-${panelId}`}
        />
      ) : null}
    </div>
  );
}
