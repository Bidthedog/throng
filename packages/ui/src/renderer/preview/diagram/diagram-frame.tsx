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
 * - **Fit** — `scale = clamp(width / naturalWidth, MIN_READABLE_SCALE, 1)`: shrink to the box, never
 *   enlarge, and below the floor keep the floor and scroll sideways (FR-046a).
 * - **Zoom In / Out** — ×1.25 per step within [DIAGRAM_MIN_SCALE, DIAGRAM_MAX_SCALE] (FR-046c).
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
 * so the pan in the view state is a displacement from the centre and Fit / Zoom 100% reset it to zero. The
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
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../../common/icon-button.js';
import {
  maximiseSection,
  restore as restoreMaximise,
  tabOfMaximisePanel,
  useSectionMaximised,
} from '../../workspace/maximise-store.js';
import { diagramZoomKey, registerDiagramZoom, type DiagramZoomAction } from './diagram-zoom.js';
import './diagram.css';

export const MIN_READABLE_SCALE = 0.5;
export const DIAGRAM_MIN_SCALE = 0.1;
export const DIAGRAM_MAX_SCALE = 8;
export const ZOOM_STEP = 1.25;

export type DiagramViewMode = 'fit' | 'zoom';

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
}

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

export function DiagramFrame({ svg, panelId, sectionId, dimmed = false }: DiagramFrameProps): ReactElement {
  const [view, setView] = useState<ViewState>(FIT);
  // The viewport's size, measured where the viewport IS (inline, or in the maximise layer) — Fit and the
  // centring both read it.
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const tabId = tabOfMaximisePanel(panelId);
  const fullPane = useSectionMaximised(tabId ?? '', panelId, sectionId);
  const [paneHost, setPaneHost] = useState<HTMLDivElement | null>(null);
  const portalled = fullPane && paneHost !== null;
  const natural = naturalSize(svg);

  const fitScale = size.width > 0 ? clamp(size.width / natural.width, MIN_READABLE_SCALE, 1) : 1;
  const scale = view.mode === 'fit' ? fitScale : view.scale;
  // Centred on both axes; before the first measurement there is nothing to centre in.
  const centreX = size.width > 0 ? (size.width - natural.width * scale) / 2 : 0;
  // In place and fitted, the viewport is exactly as tall as the diagram (its height is set from the scale), so
  // there is nothing to centre vertically — and its height is a CONSEQUENCE of the width, not an input.
  const heightFollowsScale = view.mode === 'fit' && !portalled;
  const centreY = size.height > 0 && !heightFollowsScale ? (size.height - natural.height * scale) / 2 : 0;

  const onFit = useCallback((): void => setView(FIT), []);
  // Zoom 100%: the actual size, centred (the pan is cleared, as Fit clears it).
  const onZoomActual = useCallback((): void => setView({ mode: 'zoom', scale: 1, x: 0, y: 0 }), []);
  const zoomBy = useCallback(
    (factor: number): void =>
      setView((v) => {
        const from = v.mode === 'fit' ? fitScale : v.scale;
        const next = clamp(from * factor, DIAGRAM_MIN_SCALE, DIAGRAM_MAX_SCALE);
        return { ...v, mode: 'zoom', scale: next };
      }),
    [fitScale],
  );

  // A5 — the panel's zoom chords and Ctrl+wheel zoom THIS diagram while focus is inside it.
  const zoomKey = diagramZoomKey(panelId, sectionId);
  useEffect(
    () =>
      registerDiagramZoom(zoomKey, (action: DiagramZoomAction): void => {
        if (action === 'reset') onZoomActual();
        else zoomBy(action === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP);
      }),
    [zoomKey, zoomBy, onZoomActual],
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
  const drag = useRef<{ pointerId: number; x: number; y: number; fromX: number; fromY: number } | null>(null);
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (e.button !== 1) return;
      e.preventDefault();
      drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, fromX: view.x, fromY: view.y };
      (e.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
    },
    [view.x, view.y],
  );
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    const x = d.fromX + (e.clientX - d.x);
    const y = d.fromY + (e.clientY - d.y);
    setView((v) => ({ ...v, x, y }));
  }, []);
  const onPointerEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  }, []);
  // The compatibility mousedown and the auxclick: neither may start autoscroll or follow anything.
  const swallowMiddle = useCallback((e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button === 1) e.preventDefault();
  }, []);

  // The viewport's size, for Fit and the centring — read when the viewport appears (it is a different
  // element in the maximise layer) and whenever it resizes. An unchanged size keeps the same state object,
  // so a notification that moved nothing renders nothing.
  // The height is followed only while it is an input: in place and fitted it is the scale's echo, and following
  // it would cost every width change a second render when the viewport's new height came back through the
  // observer. Leaving that state measures afresh, so the first zoomed render is centred on a current height.
  useLayoutEffect(() => {
    if (viewportEl === null) return undefined;
    const measure = (): void =>
      setSize((prev) => {
        const width = viewportEl.clientWidth;
        const height = heightFollowsScale ? prev.height : viewportEl.clientHeight;
        return prev.width === width && prev.height === height ? prev : { width, height };
      });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(viewportEl);
    return () => observer.disconnect();
  }, [viewportEl, heightFollowsScale]);

  // The SVG itself: a clone, sized to its natural drawing size, so the layer's transform alone scales it.
  // A callback ref, so the layer is filled again when Full Pane moves it into the maximise layer and back.
  const layerRef = useCallback(
    (layer: HTMLDivElement | null): void => {
      if (layer === null) return;
      const drawn = svg.cloneNode(true) as SVGSVGElement;
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

  const scrolls = view.mode === 'fit' && size.width > 0 && natural.width * MIN_READABLE_SCALE > size.width;
  const classes = [
    'preview-diagram-frame',
    fullPane ? 'preview-diagram-frame--full-pane' : '',
    scrolls ? 'preview-diagram-frame--scrolls' : '',
    dimmed ? 'preview-diagram-frame--dimmed' : '',
  ]
    .filter((c) => c.length > 0)
    .join(' ');

  const inside = (
    <>
      <div className="preview-diagram-frame__toolbar" role="toolbar" aria-label="Diagram view">
        <IconButton token="diagramFit" title="Fit diagram" onClick={onFit} />
        <IconButton token="zoomIn" title="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} />
        <IconButton token="diagramZoomReset" title="Zoom 100%" onClick={onZoomActual} />
        <IconButton token="zoomOut" title="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)} />
        <IconButton
          token={fullPane ? 'panelRestore' : 'diagramFullPane'}
          title={fullPane ? 'Minimise' : 'Maximise'}
          onClick={onFullPane}
          disabled={tabId === null}
        />
      </div>
      <div
        ref={setViewportEl}
        className="preview-diagram-frame__viewport"
        // Focusable, so the panel's zoom chords and Ctrl+wheel can zoom just this diagram (A5).
        tabIndex={0}
        role="group"
        aria-label="Diagram"
        style={view.mode === 'fit' ? { height: `${natural.height * scale}px` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onMouseDown={swallowMiddle}
        onAuxClick={swallowMiddle}
      >
        <div
          ref={layerRef}
          className="preview-diagram-frame__layer"
          style={{
            width: `${natural.width}px`,
            transform: `translate(${centreX + view.x}px, ${centreY + view.y}px) scale(${scale})`,
          }}
        />
      </div>
    </>
  );

  return (
    <div
      className={classes}
      data-testid={`diagram-frame-${panelId}-${sectionId}`}
      data-mode={view.mode}
      data-scale={String(scale)}
      data-diagram-zoom-key={zoomKey}
      // While it fills the middle section, its place in the document keeps its height: nothing below jumps.
      style={portalled ? { minHeight: `${natural.height * fitScale}px` } : undefined}
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
