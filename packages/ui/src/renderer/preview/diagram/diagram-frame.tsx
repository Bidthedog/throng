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
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { firstBinding } from '@throng/core';
import { useKeybindings } from '../../config/config-store.js';
import { registerDiagramActions } from './diagram-actions.js';
import { rasteriseSvg } from './rasterise.js';
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

export const DIAGRAM_MIN_SCALE = 0.1;
/** B5 — how long a resize must pause before a diagram re-fits (the tables' `TABLE_RESIZE_DEBOUNCE_MS`). */
export const DIAGRAM_RESIZE_DEBOUNCE_MS = 150;
/** The viewport's `min-height` in diagram.css: room for the toolbar however small Fit makes the drawing. */
const VIEWPORT_MIN_HEIGHT = 36;
/** The viewport's class while a middle-button pan is in progress: it shows the move cursor (`diagram.css`). */
export const PANNING_CLASS = 'preview-diagram-frame__viewport--panning';
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

export function DiagramFrame({
  svg,
  panelId,
  sectionId,
  dimmed = false,
  maximisable = true,
  fillsPanel = false,
  height = null,
}: DiagramFrameProps): ReactElement {
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
  const fitScale = Math.min(widthRatio, heightRatio, 1);
  const scale = view.mode === 'fit' ? fitScale : view.scale;
  // Centred on both axes; before the first measurement there is nothing to centre in.
  const centreXAt = (s: number): number => (size.width > 0 ? (size.width - natural.width * s) / 2 : 0);
  const centreYAt = (s: number): number => (boxHeight > 0 ? (boxHeight - natural.height * s) / 2 : 0);
  const centreX = centreXAt(scale);
  const centreY = centreYAt(scale);

  // #486 — every zoom action, Fit included, shows the scale it left in the box's top-right corner. A resize
  // that changes Fit's scale is not a zoom, and shows nothing.
  const [zoomCue, setZoomCue] = useState(0);
  const cueZoom = useCallback((): void => setZoomCue((c) => c + 1), []);
  const onFit = useCallback((): void => {
    setView(FIT);
    cueZoom();
  }, [cueZoom]);
  // Zoom 100%: the actual size, centred (the pan is cleared, as Fit clears it).
  const onZoomActual = useCallback((): void => {
    setView({ mode: 'zoom', scale: 1, x: 0, y: 0 });
    cueZoom();
  }, [cueZoom]);

  /*
   * FR-046l — a zoom step about a point of the viewport, which stays over the same point of the drawing: the
   * pointer for Ctrl+wheel, the centre of the visible box for the controls and the chords. The point's drawing
   * coordinate is read at the old scale and translate, and the pan is solved so that coordinate lands back on
   * the point at the new scale. The box does not change size with the zoom, so one height serves both.
   */
  const zoomAbout = useCallback(
    (factor: number, at?: { x: number; y: number }): void => {
      cueZoom();
      setView((v) => {
        const from = v.mode === 'fit' ? fitScale : v.scale;
        const next = clamp(from * factor, DIAGRAM_MIN_SCALE, DIAGRAM_MAX_SCALE);
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
    [cueZoom, fitScale, boxHeight, natural.width, natural.height, size.width],
  );
  const zoomBy = useCallback((factor: number): void => zoomAbout(factor), [zoomAbout]);

  // A5 — the panel's zoom chords and Ctrl+wheel zoom THIS diagram while focus is inside it; the wheel names
  // the pointer, which is used while it is over the viewport (FR-046l).
  const zoomKey = diagramZoomKey(panelId, sectionId);
  const viewportElRef = useRef<HTMLDivElement | null>(null);
  viewportElRef.current = viewportEl;
  useEffect(
    () =>
      registerDiagramZoom(zoomKey, (action: DiagramZoomAction, at?: DiagramZoomPoint): void => {
        // The reset is the diagram's default view, Fit; 1:1 is the toolbar's Zoom 100% (2026-10-13).
        if (action === 'reset') {
          onFit();
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
    [zoomKey, zoomAbout, onFit],
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
      // Ctrl+middle-click is the zoom-reset gesture, not a pan (2026-10-13). Preventing this press would make
      // Chromium drop the compatibility `mousedown` the gesture is bound to (`mouse-zoom.ts`), so it is left
      // alone; the press focuses the diagram, so the reset that follows lands on it (Zoom 100%).
      if (e.ctrlKey) {
        e.currentTarget.focus({ preventScroll: true });
        return;
      }
      e.preventDefault();
      drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, fromX: view.x, fromY: view.y };
      // The move cursor for as long as the pan lasts (manual test change request, 2026-10-12).
      e.currentTarget.classList.add(PANNING_CLASS);
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, DIAGRAM_RESIZE_DEBOUNCE_MS);
    });
    observer.observe(viewportEl);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [viewportEl, ownHeight]);

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

  /*
   * 054 (manual test change request, 2026-10-12) — the right-click menu's Copy Diagram as Image and Focus
   * Mode rows act through these. A standalone `.mmd` preview has no inline Focus Mode (FR-046f), so its
   * row maximises the panel instead.
   */
  const keybindings = useKeybindings();
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
            .catch(() => undefined);
        },
        toggleFocus: () => {
          if (maximisable) onFullPaneRef.current();
          else if (tabId !== null) toggleMaximisePanel(tabId, panelId);
        },
        inFocus: () => (maximisable ? fullPaneRef.current : tabId !== null && maximisedPanelOf(tabId) === panelId),
        ...(maximisable ? {} : { focusChord: firstBinding(keybindings, 'panel.toggleMaximise') }),
      }),
    [zoomKey, svg, maximisable, tabId, panelId, keybindings],
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
        {maximisable ? (
          <IconButton
            token={fullPane ? 'panelRestore' : 'diagramFullPane'}
            title={fullPane ? 'Minimise' : 'Maximise'}
            onClick={onFullPane}
            disabled={tabId === null}
          />
        ) : null}
      </div>
      <div
        ref={setViewportEl}
        className="preview-diagram-frame__viewport"
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
        <div
          ref={layerRef}
          className="preview-diagram-frame__layer"
          style={{
            width: `${natural.width}px`,
            transform: `translate(${centreX + view.x}px, ${centreY + view.y}px) scale(${scale})`,
          }}
        />
      </div>
      <ZoomIndicator percent={scale * 100} cue={zoomCue} testId={`diagram-zoom-indicator-${panelId}-${sectionId}`} />
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
