/**
 * The box every diagram is drawn in, with its own view controls (054 FR-046a – FR-046h, research R6).
 *
 * ══ THE TOOLBAR IS NOT IN THE TRANSFORMED LAYER ══
 *
 * The diagram sits in `__layer`, moved and scaled by one CSS `transform`; the toolbar is its sibling,
 * pinned to the frame's top-left. So no zoom or pan can move a control (FR-046b), by construction rather
 * than by recomputing a position.
 *
 * ══ VIEW STATE ══
 *
 * `{mode, scale, x, y}` lives here and nowhere else: never in the file, the layout or main (FR-046g). A
 * live re-render hands this frame a new SVG and keeps the state; a reopened preview mounts a new frame,
 * which starts from Fit.
 *
 * - **Fit** — the whole drawing inside the viewport, never enlarged: `min(width / naturalWidth, 1)` in
 *   place, where the box is as tall as that fitted drawing, and `min(width ratio, height ratio, 1)` where the
 *   height is given — maximised, filling a standalone `.mmd` preview's panel (`fillsPanel`), or set by the
 *   document (`height`, FR-046m). An in-place box keeps its height at every zoom (2026-10-13). No floor and
 *   no sideways scroll (MT-04 B1 superseded FR-046a's 0.5 floor). The panel zoom reset returns to Fit.
 * - **Zoom In / Out** — ×1.25 per step within [DIAGRAM_MIN_SCALE, DIAGRAM_MAX_SCALE] (FR-046c), about the
 *   centre of the visible box; Ctrl+wheel steps about the pointer instead (FR-046l, 2026-10-13).
 * - **Zoom 100%** — the actual size (scale 1), centred; sits between Zoom In and Zoom Out (MT-04 A2, which
 *   retired Full Size, "Fill the panel").
 * - **Maximise / Minimise** — hands the frame to the one maximise mechanism as a SECTION target (FR-046f,
 *   R7; named Full Pane before MT-04 A1). The state stays here, above the maximise layer's portal, so zoom
 *   and pan survive the move both ways.
 * - **Middle-button drag** pans in every view, and its press is prevented so Chromium never starts its
 *   autoscroll over a diagram (FR-046e).
 *
 * ══ CENTRED ══
 *
 * The diagram's centre sits at the centre of the VIEWPORT, on both axes, in every mode (MT-04 A3, A4): the
 * layer's `translate` is the centring offset (measured viewport minus scaled diagram, halved) plus the pan,
 * so the pan in the view state is a displacement from the centre and Fit / Zoom 100% reset it to zero. A
 * zoom step re-solves the pan so the point it zooms about stays put (`zoomAbout`). The
 * viewport is measured where it is — inline or in the maximise layer — so a maximised diagram is centred in
 * the maximised viewport, not in the place it left.
 *
 * ══ PANEL ZOOM ══
 *
 * With keyboard focus inside the frame, the panel's zoom chords and Ctrl+wheel zoom THIS diagram
 * (`diagram-zoom.ts`, MT-04 A5). The viewport is therefore focusable.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { firstBinding } from '@throng/core';
import { useKeybindings } from '../../config/config-store.js';
import { zoomTitles } from '../zoom-titles.js';
import { registerDiagramActions } from './diagram-actions.js';
import { rasteriseSvg, rasterSourceOf, registerRasterSource } from './rasterise.js';
import { createPortal } from 'react-dom';
import { IconButton } from '../../common/icon-button.js';
import { ZoomIndicator } from '../../workspace/zoom-indicator.js';
import {
  maximiseSection,
  maximisedPanelOf,
  restore as restoreMaximise,
  tabOfMaximisePanel,
  toggleMaximisePanel,
  useSectionMaximised,
} from '../../workspace/maximise-store.js';
import {
  DIAGRAM_FILLS_PANEL_ATTR,
  diagramZoomKey,
  registerDiagramZoom,
  type DiagramZoomAction,
  type DiagramZoomPoint,
} from './diagram-zoom.js';
import './diagram.css';
import { logCaught } from '@throng/core';
import { primaryModifierHeld } from '../../config/host-modifiers.js';

export const DIAGRAM_MIN_SCALE = 0.1;
/** B5 — how long a resize must pause before a diagram re-fits (the tables' `TABLE_RESIZE_DEBOUNCE_MS`). */
export const DIAGRAM_RESIZE_DEBOUNCE_MS = 150;
/** The viewport's `min-height` in diagram.css: room for the toolbar however small Fit makes the drawing. */
const VIEWPORT_MIN_HEIGHT = 36;
/** The viewport's class while a middle-button pan is in progress: it shows the move cursor (`diagram.css`). */
export const PANNING_CLASS = 'preview-diagram-frame__viewport--panning';
export const DIAGRAM_MAX_SCALE = 8;
export const ZOOM_STEP = 1.25;

/**
 * `open` (074 FR-020a, 2026-11-19): the view a picture opens in — 100%, or Fit where the picture is larger than its
 * viewport — kept until the reader zooms or chooses Fit, so a resize before then still follows the same rule.
 */
export type DiagramViewMode = 'fit' | 'zoom' | 'open';

interface ViewState {
  mode: DiagramViewMode;
  /** The zoom in `zoom` mode; Fit computes its own. */
  scale: number;
  /** The pan, as a displacement from the centred position. */
  x: number;
  y: number;
}

export interface DiagramFrameProps {
  svg: SVGSVGElement;
  /** The preview panel the diagram is in — the maximise target's owner. */
  panelId: string;
  /** Unique within the panel: the diagram's ordinal (`diagram-0`) or the standalone diagram. */
  sectionId: string;
  /** FR-044 — the last good render, shown under a notice. */
  dimmed?: boolean;
  /**
   * FR-046f — whether the toolbar offers Maximise. A standalone `.mmd` preview IS its one diagram, so it
   * maximises from the panel header alone (manual test change request, 2026-10-11). Default `true`.
   */
  maximisable?: boolean;
  /**
   * FR-046a (manual test change request, 2026-10-13) — the diagram fills its panel: a standalone `.mmd`
   * preview. Its viewport takes the panel's height, so Fit uses both extents and centres the diagram, and
   * nothing around it can scroll. Default `false`: an inline diagram's height follows its drawing.
   */
  fillsPanel?: boolean;
  /**
   * FR-046m — the box height the document gives an inline diagram (```` ```mermaid height=300 ````,
   * `![[flow.mmd|300]]`), in CSS pixels; Fit then uses both extents inside it. `null`: the fitted drawing's.
   */
  height?: number | null;
  /**
   * 074 FR-020 — the view a newly mounted frame starts in: `fit` (absent), `actual` (the drawing at 100%, centred) or
   * `open` (FR-020a: 100%, or Fit where the drawing is larger than the viewport — every picture preview). A live
   * re-render keeps whatever view the reader has since chosen.
   */
  initialMode?: 'fit' | 'actual' | 'open';
  /**
   * 074 FR-031a (2026-11-19) — the viewport SCROLLS, on both axes, wherever the drawing at its scale outgrows it: an
   * Image or SVG preview. The drawing sits on a stage as large as the larger of the viewport and the scaled drawing,
   * centred while it is the smaller; the pan is the scroll position, so a middle-button drag and a zoom about a point
   * move the scrollbars rather than a transform. Default `false`: 054's pan-only view.
   */
  scrolls?: boolean;
  /**
   * 074 FR-027b — a picture's transparent areas are drawn over a hatch in the theme's `pictureHatch` (a backdrop the
   * size of the scaled picture, so the hatch keeps its screen spacing at every zoom). Default `true`. A drawing that
   * is not a picture (a Mermaid diagram) has no backdrop either way.
   */
  hatch?: boolean;
  /** 074 (2026-11-20) — the scale the drawing is shown at, on every change: for the status bar's zoom readout. */
  onScale?: (scale: number) => void;
}

/** Where a scrolling frame's next render puts its scroll position (FR-031a). */
type PendingScroll =
  | { kind: 'centre' }
  /** Keep drawing point (`drawnX`, `drawnY`) under viewport point (`px`, `py`) — a zoom about that point. */
  | { kind: 'point'; drawnX: number; drawnY: number; px: number; py: number };

/** The SVG's drawing size, from its `viewBox` (mermaid always writes one), else its width/height. */
function naturalSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) return { width: box[2]!, height: box[3]! };
  const width = Number.parseFloat(svg.getAttribute('width') ?? '');
  const height = Number.parseFloat(svg.getAttribute('height') ?? '');
  return { width: width > 0 ? width : 300, height: height > 0 ? height : 150 };
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const FIT: ViewState = { mode: 'fit', scale: 1, x: 0, y: 0 };
/** 074 FR-020 — Zoom 100%'s view, as a starting point. */
const ACTUAL: ViewState = { mode: 'zoom', scale: 1, x: 0, y: 0 };
/** 074 FR-020a — the opening view: 100%, or Fit when the drawing is larger than its viewport. */
const OPEN: ViewState = { mode: 'open', scale: 1, x: 0, y: 0 };

export function DiagramFrame({
  svg,
  panelId,
  sectionId,
  dimmed = false,
  maximisable = true,
  fillsPanel = false,
  height = null,
  initialMode = 'fit',
  scrolls = false,
  hatch = true,
  onScale,
}: DiagramFrameProps): ReactElement {
  const [view, setView] = useState<ViewState>(initialMode === 'actual' ? ACTUAL : initialMode === 'open' ? OPEN : FIT);
  const viewRef = useRef(view);
  viewRef.current = view;
  // FR-031a — a scrolling frame opens centred: a picture larger than the panel shows its middle.
  const pendingScroll = useRef<PendingScroll | null>(scrolls ? { kind: 'centre' } : null);
  const isPicture = svg.hasAttribute('data-throng-picture');
  // A5 — the panel's zoom chords and Ctrl+wheel zoom THIS diagram while focus is inside it; the wheel names
  // the pointer, which is used while it is over the viewport (FR-046l).
  const zoomKey = diagramZoomKey(panelId, sectionId);
  const viewportElRef = useRef<HTMLDivElement | null>(null);
  // The viewport's size, measured where the viewport IS (inline, or in the maximise layer) — Fit and the
  // centring both read it.
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  viewportElRef.current = viewportEl;
  const tabId = tabOfMaximisePanel(panelId);
  const fullPane = useSectionMaximised(tabId ?? '', panelId, sectionId);
  const [paneHost, setPaneHost] = useState<HTMLDivElement | null>(null);
  const portalled = fullPane && paneHost !== null;
  const natural = naturalSize(svg);

  /*
   * The viewport's height. Its own, measured, when it has one: maximised, or filling its panel. In place it is
   * the box the document gives it (FR-046m), else the fitted drawing's — and it stays that at every zoom, so a
   * zoom never resizes the box in the document (manual test change request, 2026-10-13).
   */
  const ownHeight = portalled || fillsPanel;
  const widthRatio = size.width > 0 ? size.width / natural.width : 1;
  const inPlaceHeight = height ?? Math.max(natural.height * Math.min(widthRatio, 1), VIEWPORT_MIN_HEIGHT);
  const boxHeight = ownHeight ? size.height : inPlaceHeight;
  // B1 — Fit uses both extents wherever the height is not the drawing's own echo; the width alone otherwise.
  const heightRatio = (ownHeight || height !== null) && boxHeight > 0 ? boxHeight / natural.height : Number.POSITIVE_INFINITY;
  // 074 FR-031b (2026-11-19) — a picture's Fit FILLS the panel, enlarging a small one; a diagram's never enlarges.
  const fitScale = scrolls ? Math.min(widthRatio, heightRatio) : Math.min(widthRatio, heightRatio, 1);
  // A tiny picture fitted to a large panel may already be past the zoom ceiling: it can still zoom in from Fit.
  const maxScale = Math.max(DIAGRAM_MAX_SCALE, fitScale * 4);
  // FR-020a — opening, 100% unless that is larger than the viewport, which Fit then is.
  const scaleOf = (v: ViewState): number => (v.mode === 'fit' ? fitScale : v.mode === 'open' ? Math.min(1, fitScale) : v.scale);
  const scale = scaleOf(view);
  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;
  // Before the first measurement only a chosen zoom is worth reporting: Fit and the opening view read the viewport.
  const measuredScale = view.mode === 'zoom' || size.width > 0 ? scale : null;
  useEffect(() => {
    if (measuredScale !== null) onScaleRef.current?.(measuredScale);
  }, [measuredScale]);
  // Centred on both axes; before the first measurement there is nothing to centre in.
  const centreXAt = (s: number): number => (size.width > 0 ? (size.width - natural.width * s) / 2 : 0);
  const centreYAt = (s: number): number => (boxHeight > 0 ? (boxHeight - natural.height * s) / 2 : 0);
  // FR-031a — scrolling, the drawing is centred only while it is smaller than the viewport; larger, it starts at the
  // stage's edge and the scroll position does the rest.
  const offsetXAt = (s: number): number => Math.max(0, centreXAt(s));
  const offsetYAt = (s: number): number => Math.max(0, centreYAt(s));
  // 074 FR-031c (2026-11-19) — on an axis the picture does NOT overflow there is nothing to scroll, so a drag moves the
  // picture itself: the view's pan applies there, and only there.
  // A FITTED view (Fit, or the opening view) fits by definition: it never scrolls, and its viewport clips instead of
  // offering scrollbars (`--fitted`). Measured 2026-11-19: at app zoom 1.33 and 0.9 the fitted stage's rounding
  // overflowed by under a pixel, both scrollbars appeared, the narrower viewport fitted smaller, the scrollbars went,
  // and the picture refitted — every 150ms, for as long as the panel stayed open.
  const fitted = view.mode !== 'zoom';
  const overflowX = !fitted && size.width > 0 && natural.width * scale > size.width;
  const overflowY = !fitted && boxHeight > 0 && natural.height * scale > boxHeight;
  const overflowRef = useRef({ x: overflowX, y: overflowY });
  overflowRef.current = { x: overflowX, y: overflowY };
  const centreX = scrolls ? offsetXAt(scale) + (overflowX ? 0 : view.x) : centreXAt(scale) + view.x;
  const centreY = scrolls ? offsetYAt(scale) + (overflowY ? 0 : view.y) : centreYAt(scale) + view.y;
  const stageWidth = Math.max(size.width, natural.width * scale);
  const stageHeight = Math.max(boxHeight, natural.height * scale);

  // #486 — every zoom action, Fit included, shows the scale it left in the box's top-right corner. A resize
  // that changes Fit's scale is not a zoom, and shows nothing.
  const [zoomCue, setZoomCue] = useState(0);
  const cueZoom = useCallback((): void => setZoomCue((c) => c + 1), []);
  const onFit = useCallback((): void => {
    if (scrolls) pendingScroll.current = { kind: 'centre' };
    setView(FIT);
    cueZoom();
  }, [cueZoom, scrolls]);
  // The opening view again (FR-020a): what the zoom reset gives a picture.
  const onOpenView = useCallback((): void => {
    if (scrolls) pendingScroll.current = { kind: 'centre' };
    setView(OPEN);
    cueZoom();
  }, [cueZoom, scrolls]);
  // Zoom 100%: the actual size, centred (the pan is cleared, as Fit clears it).
  const onZoomActual = useCallback((): void => {
    if (scrolls) pendingScroll.current = { kind: 'centre' };
    setView({ mode: 'zoom', scale: 1, x: 0, y: 0 });
    cueZoom();
  }, [cueZoom, scrolls]);

  /*
   * FR-046l — a zoom step about a point of the viewport, which stays over the same point of the drawing: the
   * pointer for Ctrl+wheel, the centre of the visible box for the controls and the chords. The point's drawing
   * coordinate is read at the old scale and translate, and the pan is solved so that coordinate lands back on
   * the point at the new scale. The box does not change size with the zoom, so one height serves both.
   */
  const zoomAbout = useCallback(
    (factor: number, at?: { x: number; y: number }): void => {
      cueZoom();
      const viewport = viewportElRef.current;
      if (scrolls && viewport !== null) {
        // FR-031a — the same rule, solved for the scroll position: the drawing point under `point` is read through
        // the current scroll and offset, and the next render scrolls it back under `point` at the new scale.
        const v = viewRef.current;
        const from = scaleOf(v);
        const next = clamp(from * factor, DIAGRAM_MIN_SCALE, maxScale);
        const point = at ?? { x: size.width / 2, y: boxHeight / 2 };
        pendingScroll.current = {
          kind: 'point',
          drawnX: (viewport.scrollLeft + point.x - offsetXAt(from)) / from,
          drawnY: (viewport.scrollTop + point.y - offsetYAt(from)) / from,
          px: point.x,
          py: point.y,
        };
        setView({ mode: 'zoom', scale: next, x: 0, y: 0 });
        return;
      }
      setView((v) => {
        const from = scaleOf(v);
        const next = clamp(from * factor, DIAGRAM_MIN_SCALE, maxScale);
        const point = at ?? { x: size.width / 2, y: boxHeight / 2 };
        const drawnX = (point.x - (centreXAt(from) + v.x)) / from;
        const drawnY = (point.y - (centreYAt(from) + v.y)) / from;
        return {
          mode: 'zoom',
          scale: next,
          x: point.x - drawnX * next - centreXAt(next),
          y: point.y - drawnY * next - centreYAt(next),
        };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- centreXAt / centreYAt read only the values listed
    [cueZoom, fitScale, maxScale, boxHeight, natural.width, natural.height, size.width, scrolls],
  );
  const zoomBy = useCallback((factor: number): void => zoomAbout(factor), [zoomAbout]);

  // FR-031a — the scroll a zoom, Fit, Zoom 100% or the first draw asked for, applied once the stage has its new size.
  // A pending scroll waits for the first measurement: before it there is no viewport to centre in.
  useLayoutEffect(() => {
    const pending = pendingScroll.current;
    if (!scrolls || pending === null || viewportEl === null || size.width === 0) return;
    pendingScroll.current = null;
    if (pending.kind === 'centre') {
      viewportEl.scrollLeft = Math.max(0, (stageWidth - size.width) / 2);
      viewportEl.scrollTop = Math.max(0, (stageHeight - boxHeight) / 2);
    } else {
      viewportEl.scrollLeft = Math.max(0, pending.drawnX * scale + offsetXAt(scale) - pending.px);
      viewportEl.scrollTop = Math.max(0, pending.drawnY * scale + offsetYAt(scale) - pending.py);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- offsetXAt / offsetYAt read only the values listed
  }, [scrolls, viewportEl, scale, size.width, boxHeight, stageWidth, stageHeight]);
  useEffect(
    () =>
      registerDiagramZoom(zoomKey, (action: DiagramZoomAction, at?: DiagramZoomPoint): void => {
        // The reset is the view the frame opened in: a diagram's Fit (2026-10-13); a picture's opening view, 100%
        // unless that is larger than the panel (074 FR-020a, 2026-11-20).
        if (action === 'reset') {
          if (initialMode === 'open') onOpenView();
          else onFit();
          return;
        }
        // A pointer outside the viewport (focus in the diagram, pointer elsewhere) zooms about the centre.
        const rect = at === undefined ? undefined : viewportElRef.current?.getBoundingClientRect();
        const point =
          at !== undefined &&
          rect !== undefined &&
          at.clientX >= rect.left &&
          at.clientX <= rect.right &&
          at.clientY >= rect.top &&
          at.clientY <= rect.bottom
            ? { x: at.clientX - rect.left, y: at.clientY - rect.top }
            : undefined;
        zoomAbout(action === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP, point);
      }),
    [zoomKey, zoomAbout, onFit, onOpenView, initialMode],
  );
  /*
   * FR-046f — Maximise. The maximise layer draws what the section registers: here, an empty host element,
   * into which THIS component portals its own toolbar and viewport. So the state above stays where it is,
   * and zoom and pan are the same on the way out as on the way back. Esc and the Minimise control are the
   * maximise mechanism's own; the toolbar's Maximise control turns into Minimise while it holds.
   */
  const onFullPane = useCallback((): void => {
    if (tabId === null) return;
    if (fullPane) {
      restoreMaximise(tabId);
      return;
    }
    maximiseSection(tabId, panelId, sectionId, () => (
      <div className="preview-diagram-pane-host" data-testid={`diagram-pane-host-${panelId}-${sectionId}`} ref={setPaneHost} />
    ));
  }, [tabId, fullPane, panelId, sectionId]);

  // FR-046e — the middle button pans; a drag remembers where it started.
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    fromX: number;
    fromY: number;
    /** FR-031c — scrolling, where the scroll stood when the drag began (the pan is `fromX` / `fromY`). */
    fromLeft: number;
    fromTop: number;
  } | null>(null);
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (e.button !== 1) return;
      // Ctrl+middle-click (Cmd on macOS, 070 FR-030) is the zoom-reset gesture, not a pan (2026-10-13). Preventing this press would make
      // Chromium drop the compatibility `mousedown` the gesture is bound to (`mouse-zoom.ts`), so it is left
      // alone; the press focuses the diagram, so the reset that follows lands on it (Zoom 100%).
      if (primaryModifierHeld(e)) {
        e.currentTarget.focus({ preventScroll: true });
        return;
      }
      e.preventDefault();
      drag.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        fromX: view.x,
        fromY: view.y,
        fromLeft: e.currentTarget.scrollLeft,
        fromTop: e.currentTarget.scrollTop,
      };
      // The move cursor for as long as the pan lasts (manual test change request, 2026-10-12).
      e.currentTarget.classList.add(PANNING_CLASS);
      (e.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
    },
    [view.x, view.y],
  );
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      const d = drag.current;
      if (d === null || d.pointerId !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (scrolls) {
        // FR-031a / FR-031c — per axis: where the picture overflows, the scroll moves against the pointer; where it
        // fits, the picture itself follows the pointer.
        const overflow = overflowRef.current;
        if (overflow.x) e.currentTarget.scrollLeft = d.fromLeft - dx;
        if (overflow.y) e.currentTarget.scrollTop = d.fromTop - dy;
        if (!overflow.x || !overflow.y) {
          setView((v) => ({ ...v, x: overflow.x ? v.x : d.fromX + dx, y: overflow.y ? v.y : d.fromY + dy }));
        }
        return;
      }
      setView((v) => ({ ...v, x: d.fromX + dx, y: d.fromY + dy }));
    },
    [scrolls],
  );
  const onPointerEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.classList.remove(PANNING_CLASS);
  }, []);
  // The compatibility mousedown and the auxclick: neither may start autoscroll or follow anything.
  const swallowMiddle = useCallback((e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button === 1) e.preventDefault();
  }, []);

  // The viewport's size, for Fit and the centring — read when the viewport appears (it is a different
  // element in the maximise layer) and whenever it resizes. An unchanged size keeps the same state object,
  // so a notification that moved nothing renders nothing.
  // The height is followed only where it is the viewport's own (maximised, filling a panel): in place it is set
  // here, from the width or the document, and following it would cost every width change a second render when
  // the viewport's new height came back through the observer.
  useLayoutEffect(() => {
    if (viewportEl === null) return undefined;
    const measure = (): void =>
      setSize((prev) => {
        const width = viewportEl.clientWidth;
        const height = ownHeight ? viewportEl.clientHeight : prev.height;
        return prev.width === width && prev.height === height ? prev : { width, height };
      });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    // B5 — a panel drag notifies every frame, and each new width rewrites the layer's transform: a restyle and a
    // repaint of the whole SVG. Coalesced like the document's tables: the diagram re-fits once the drag pauses.
    // 074 (2026-11-19) — an Image or SVG preview is the panel's one picture, and follows the panel as it moves (as a PDF
    // or an HTML page does): measured once per frame, never more, rather than after the drag pauses.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raf: number | undefined;
    const observer = new ResizeObserver(() => {
      if (scrolls) {
        if (raf === undefined) {
          raf = requestAnimationFrame(() => {
            raf = undefined;
            measure();
          });
        }
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(measure, DIAGRAM_RESIZE_DEBOUNCE_MS);
    });
    observer.observe(viewportEl);
    return () => {
      clearTimeout(timer);
      if (raf !== undefined) cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [viewportEl, ownHeight, scrolls]);

  // The SVG itself: a clone, sized to its natural drawing size, so the layer's transform alone scales it.
  // A callback ref, so the layer is filled again when Full Pane moves it into the maximise layer and back.
  const layerRef = useCallback(
    (layer: HTMLDivElement | null): void => {
      if (layer === null) return;
      const drawn = svg.cloneNode(true) as SVGSVGElement;
      // 075 FR-066 (the maintainer, 2026-11-20: "SVG Print preview does not show anything") — the clone is what is
      // shown, so it is what Print… and Copy read: it carries the picture's own bytes, as the wrapper it copies does.
      const read = rasterSourceOf(svg);
      if (read !== undefined) registerRasterSource(drawn, read);
      drawn.setAttribute('width', String(natural.width));
      drawn.setAttribute('height', String(natural.height));
      drawn.style.removeProperty('max-width');
      layer.replaceChildren(drawn);
    },
    [svg, natural.width, natural.height],
  );

  // A frame that mounts while its section already fills the middle section (its tab was switched away from
  // and back, FR-073) hands the layer its own host: the registered render belongs to the frame that unmounted.
  // The target itself is released by whatever knows the diagram is gone (`diagram-sections.ts`), not here.
  useEffect(() => {
    if (!fullPane || paneHost !== null || tabId === null) return;
    maximiseSection(tabId, panelId, sectionId, () => (
      <div className="preview-diagram-pane-host" data-testid={`diagram-pane-host-${panelId}-${sectionId}`} ref={setPaneHost} />
    ));
  }, [fullPane, paneHost, tabId, panelId, sectionId]);

  /*
   * 054 (manual test change request, 2026-10-12) — the right-click menu's Copy Diagram as Image and Focus
   * Mode rows act through these. A standalone `.mmd` preview has no inline Focus Mode (FR-046f), so its
   * row maximises the panel instead.
   */
  const keybindings = useKeybindings();
  const titles = useMemo(() => zoomTitles(keybindings, 'Fit diagram', initialMode === 'open' ? 'actual' : 'fit'), [keybindings, initialMode]);
  const onFullPaneRef = useRef(onFullPane);
  onFullPaneRef.current = onFullPane;
  const fullPaneRef = useRef(fullPane);
  fullPaneRef.current = fullPane;
  useEffect(
    () =>
      registerDiagramActions(zoomKey, {
        copyImage: () => {
          void rasteriseSvg(svg)
            .then((dataUri) => window.throng?.clipboard?.writeImage?.({ dataUri }))
            .catch((error: unknown) => logCaught('diagram-frame: copy the diagram as an image', error));
        },
        toggleFocus: () => {
          if (maximisable) onFullPaneRef.current();
          else if (tabId !== null) toggleMaximisePanel(tabId, panelId);
        },
        inFocus: () => (maximisable ? fullPaneRef.current : tabId !== null && maximisedPanelOf(tabId) === panelId),
        ...(maximisable ? {} : { focusChord: firstBinding(keybindings, 'panel.toggleMaximise') }),
        // 074 FR-033 — an image or SVG is a picture, not a diagram: its menu row is Copy Image.
        picture: isPicture,
      }),
    [zoomKey, svg, maximisable, tabId, panelId, keybindings, isPicture],
  );

  // Entering Focus Mode puts focus in the diagram, so its zoom keys act on it at once. The viewport is a new
  // element in the layer, and its ref lands a render after `portalled` does: focus waits for it.
  const focusOnArrival = useRef(false);
  useEffect(() => {
    if (!portalled) {
      focusOnArrival.current = true;
      return;
    }
    if (focusOnArrival.current && viewportEl !== null && paneHost?.contains(viewportEl)) {
      viewportEl.focus({ preventScroll: true });
      focusOnArrival.current = false;
    }
  }, [portalled, viewportEl, paneHost]);

  // A right-click on the diagram gives it focus before the menu opens (the menu still opens: no preventDefault).
  const onViewportContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>): void => {
    e.currentTarget.focus({ preventScroll: true });
  }, []);

  const classes = [
    'preview-diagram-frame',
    fullPane ? 'preview-diagram-frame--full-pane' : '',
    fillsPanel ? 'preview-diagram-frame--fills' : '',
    scrolls ? 'preview-diagram-frame--scrolls' : '',
    dimmed ? 'preview-diagram-frame--dimmed' : '',
  ]
    .filter((c) => c.length > 0)
    .join(' ');

  const inside = (
    <>
      <div className="preview-diagram-frame__toolbar" role="toolbar" aria-label="Diagram view">
        <IconButton token="diagramFit" title={titles.fit} onClick={onFit} />
        <IconButton token="zoomIn" title={titles.zoomIn} onClick={() => zoomBy(ZOOM_STEP)} />
        <IconButton token="diagramZoomReset" title={titles.actual} onClick={onZoomActual} />
        <IconButton token="zoomOut" title={titles.zoomOut} onClick={() => zoomBy(1 / ZOOM_STEP)} />
        {maximisable ? (
          <IconButton
            token={fullPane ? 'panelRestore' : 'diagramFullPane'}
            // 069 FR-066 — Focus Mode, named as the panel header and the menu name it.
            title={fullPane ? 'Exit Focus Mode' : 'Enter Focus Mode'}
            onClick={onFullPane}
            disabled={tabId === null}
          />
        ) : null}
      </div>
      <div
        ref={setViewportEl}
        className={`preview-diagram-frame__viewport${scrolls && fitted ? ' preview-diagram-frame__viewport--fitted' : ''}`}
        // Focusable, so the panel's zoom chords and Ctrl+wheel can zoom just this diagram (A5).
        tabIndex={0}
        role="group"
        aria-label="Diagram"
        // In place, the document's height or the fitted drawing's, at every zoom (FR-046m); maximised or
        // filling its panel, it fills what holds it (B2).
        style={ownHeight ? undefined : { height: `${inPlaceHeight}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onMouseDown={swallowMiddle}
        onAuxClick={swallowMiddle}
        onContextMenu={onViewportContextMenu}
      >
        {/* FR-031a — scrolling, the stage gives the viewport the scaled drawing's extent: a transform alone has none. */}
        <div
          className="preview-diagram-frame__stage"
          // The picture's own extent, and never less than the viewport — a CSS minimum, so the browser alone decides
          // the scrollbars from the picture's size. A stage sized from the MEASURED viewport lagged a scrollbar by a
          // frame and overflowed the other way: zoomed out from 100%, the scrollbars came and went for good
          // (2026-11-20). The stage clips, so a centring offset that lags a resize never adds a scrollbar either.
          style={
            scrolls
              ? { width: `${natural.width * scale}px`, height: `${natural.height * scale}px`, minWidth: '100%', minHeight: '100%' }
              : undefined
          }
        >
          {/* FR-027b — the hatch behind a picture's transparent areas, at screen scale: it is not in the scaled layer. */}
          {isPicture && hatch ? (
            <div
              className="preview-diagram-frame__hatch"
              data-testid={`diagram-hatch-${panelId}-${sectionId}`}
              style={{
                width: `${natural.width * scale}px`,
                height: `${natural.height * scale}px`,
                // Whole pixels, so the tile lands on the device grid and every line draws crisp.
                transform: `translate(${Math.round(centreX)}px, ${Math.round(centreY)}px)`,
              }}
            />
          ) : null}
          <div
            ref={layerRef}
            className="preview-diagram-frame__layer"
            // 074 FR-034 — enlarged past 100%, a raster picture shows its pixels (diagram.css).
            {...(scale > 1 ? { 'data-magnified': '' } : {})}
            style={{
              width: `${natural.width}px`,
              transform: `translate(${centreX}px, ${centreY}px) scale(${scale})`,
            }}
          />
        </div>
      </div>
      <ZoomIndicator percent={scale * 100} cue={zoomCue} testId={`diagram-zoom-indicator-${panelId}-${sectionId}`} resting />
    </>
  );

  return (
    <div
      className={classes}
      data-testid={`diagram-frame-${panelId}-${sectionId}`}
      data-mode={view.mode}
      data-scale={String(scale)}
      data-diagram-zoom-key={zoomKey}
      // The panel's own zoom gestures zoom a diagram that fills it, focused or not (MT-04 retest, 2026-10-13).
      {...(fillsPanel ? { [DIAGRAM_FILLS_PANEL_ATTR]: '' } : {})}
      // While it fills the middle section, its place in the document keeps its height: nothing below jumps.
      style={portalled ? { minHeight: `${inPlaceHeight}px` } : undefined}
    >
      {portalled
        ? createPortal(
            <div className="preview-diagram-frame preview-diagram-frame--in-pane" data-diagram-zoom-key={zoomKey}>
              {inside}
            </div>,
            paneHost,
          )
        : inside}
    </div>
  );
}
