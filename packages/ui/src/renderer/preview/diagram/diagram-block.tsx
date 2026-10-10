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

export interface DiagramBlockProps {
  panelId: string;
  /** Unique within the panel — `diagram-<ordinal>`. */
  sectionId: string;
  source: string;
  entry: BlockRendererEntry;
  theme: DiagramTheme;
}

export function DiagramBlock({ panelId, sectionId, source, entry, theme }: DiagramBlockProps): ReactElement {
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
          setError(reason instanceof Error && reason.message.length > 0 ? reason.message : 'The diagram could not be drawn.');
        },
      );
    // `theme` by its key: a re-render of the body hands a new object for the same theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, entry, theme.key]);

  return (
    <div className="preview-diagram" data-testid={`diagram-${panelId}-${sectionId}`}>
      {error !== null ? (
        <div className="preview-diagram__notice" role="status" data-testid={`diagram-notice-${panelId}-${sectionId}`}>
          <span>This diagram could not be drawn: </span>
          <span className="preview-diagram__notice-detail">{error}</span>
        </div>
      ) : null}
      {svg !== null ? <DiagramFrame svg={svg} panelId={panelId} sectionId={sectionId} dimmed={error !== null} /> : null}
    </div>
  );
}
