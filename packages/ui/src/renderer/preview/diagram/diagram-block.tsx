/**
 * One diagram in a preview: its renderer's latest answer, and what to show for it (054 FR-044, FR-048,
 * research R5). Embedded fences and the standalone Mermaid preview both draw through this (FR-043).
 *
 * ══ THE LAST GOOD RENDER STAYS ══
 *
 * A live update never blanks a diagram. A source that does not parse — or a render that runs out of time,
 * which the renderer reports the same way (FR-048) — shows one inline notice naming the problem, above the
 * last good render, dimmed; a diagram that has never rendered shows the notice alone. The next good render
 * clears both. A render overtaken by a newer source is dropped, so the shown state only ever moves forward,
 * at the pace of the preview's own live-update debounce.
 *
 * ══ STATE BY ORDINAL ══
 *
 * The Markdown body keeps this component mounted per diagram ORDINAL across re-renders, so an edit
 * elsewhere in the document changes nothing here: the source is the same, so nothing renders again, and
 * the frame keeps its zoom and pan (FR-046g).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { BlockRendererEntry } from '../blocks/block-renderers.js';
import type { DiagramTheme } from './diagram-theme.js';
import { DiagramFrame } from './diagram-frame.js';
import { Spinner } from '../../common/loading.js';

export interface DiagramBlockProps {
  panelId: string;
  /** Unique within the panel — `diagram-<ordinal>`. */
  sectionId: string;
  source: string;
  entry: BlockRendererEntry;
  theme: DiagramTheme;
  /** Passed to `DiagramFrame` — `false` for a standalone `.mmd` preview. */
  maximisable?: boolean;
  /** Passed to `DiagramFrame` — `true` for a standalone `.mmd` preview, whose diagram fills the panel. */
  fillsPanel?: boolean;
  /** Passed to `DiagramFrame` — the box height the document gives the diagram (FR-046m), if any. */
  height?: number | null;
  /** Passed to `DiagramFrame` — 074 FR-020's starting view. */
  initialMode?: 'fit' | 'actual' | 'open';
  /** Passed to `DiagramFrame` — 074 FR-031a: the viewport scrolls instead of panning (an Image or SVG preview). */
  scrolls?: boolean;
  /** Passed to `DiagramFrame` — 074 FR-027b: hatch a picture's transparent areas. */
  hatch?: boolean;
  /** 074 (2026-11-20) — the scale the drawing is shown at, on every change: for the status bar's zoom readout. */
  onScale?: (scale: number) => void;
}

export function DiagramBlock({
  panelId,
  sectionId,
  source,
  entry,
  theme,
  maximisable = true,
  fillsPanel = false,
  height = null,
  initialMode = 'fit',
  scrolls = false,
  hatch = true,
  onScale,
}: DiagramBlockProps): ReactElement {
  // 074 — a picture is not a diagram: the entry names what it draws, for the notices.
  const noun = entry.noun ?? 'diagram';
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    latest.current += 1;
    const ticket = latest.current;
    entry
      .load()
      .then((renderer) => renderer.render(source, { theme }))
      .then(
        (drawn) => {
          if (ticket !== latest.current) return;
          setSvg(drawn);
          setError(null);
        },
        (reason: unknown) => {
          if (ticket !== latest.current) return;
          setError(reason instanceof Error && reason.message.length > 0 ? reason.message : `The ${noun} could not be drawn.`);
        },
      );
    // `theme` by its key: a re-render of the body hands a new object for the same theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, entry, theme.key]);

  return (
    <div className="preview-diagram" data-testid={`diagram-${panelId}-${sectionId}`}>
      {error !== null ? (
        <div className="preview-diagram__notice" role="status" data-testid={`diagram-notice-${panelId}-${sectionId}`}>
          <span>{`This ${noun} could not be drawn: `}</span>
          <span className="preview-diagram__notice-detail">{error}</span>
        </div>
      ) : null}
      {/* The first draw of a diagram can take a moment: say so rather than show nothing. */}
      {svg === null && error === null ? (
        <div className="preview-diagram__loading" data-testid={`diagram-loading-${panelId}-${sectionId}`}>
          <Spinner label={`Drawing ${noun}`} />
          <span>{`Drawing ${noun}…`}</span>
        </div>
      ) : null}
      {svg !== null ? (
        <DiagramFrame
          svg={svg}
          panelId={panelId}
          sectionId={sectionId}
          dimmed={error !== null}
          maximisable={maximisable}
          fillsPanel={fillsPanel}
          height={height}
          initialMode={initialMode}
          scrolls={scrolls}
          hatch={hatch}
          onScale={onScale}
        />
      ) : null}
    </div>
  );
}
