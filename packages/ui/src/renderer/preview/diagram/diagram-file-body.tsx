/**
 * A preview body that IS one drawing (054 FR-042 – FR-044; 074 FR-030, FR-031): a Mermaid file, an SVG file, an
 * image file. Shared so every such type draws through the same `DiagramBlock` → `DiagramFrame`, inside the same host
 * element — the same controls, the same Focus Mode route, find leaving the drawing out of its text (054 FR-032) and
 * copy putting the source or the image in its place (054 FR-049a) — and the three cannot drift apart.
 *
 * A body reports every draw (data-model §13). Here the draw is the host with its source: the drawing inside it
 * renders on its own, and a failure is the drawing's inline notice, never a body failure. The view is kept by the
 * frame itself, which stays mounted across updates.
 */
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import type { PreviewBodyProps } from '../provider-view.js';
import { useActiveTheme } from '../../config/config-store.js';
import type { BlockRendererEntry } from '../blocks/block-renderers.js';
import { DiagramBlock } from './diagram-block.js';
import { releaseDiagramSections } from './diagram-sections.js';
import { diagramThemeFrom } from './diagram-theme.js';
import { DIAGRAM_HOST_CLASS, DIAGRAM_LANG_ATTRIBUTE, DIAGRAM_SOURCE_ATTRIBUTE } from './diagram-host.js';

export interface DiagramFileBodyProps {
  body: PreviewBodyProps;
  /** What the renderer draws: the file's text, or a picture's URL. */
  source: string;
  /** The text a plain copy of the drawing puts on the clipboard (054 FR-049a); absent, nothing textual. */
  copySource?: string;
  /** The renderer, or `null` when none is registered (a body failure). */
  entry: BlockRendererEntry | null;
  /** The body's class and test-id stem: `preview-mermaid`, `preview-svg`, `preview-image`. */
  name: string;
  initialMode?: 'fit' | 'actual' | 'open';
  /**
   * 074 FR-031a — a picture (Image, SVG): the viewport scrolls on both axes when the drawing outgrows it, instead of
   * panning only. A Mermaid file keeps 054's pan-only view.
   */
  scrolls?: boolean;
  /** 074 FR-027b — hatch a picture's transparent areas (the provider's Hatch transparent areas setting). */
  hatch?: boolean;
  /** 074 (2026-11-20) — the scale the drawing is shown at, on every change: for the status bar's zoom readout. */
  onScale?: (scale: number) => void;
}

export function DiagramFileBody({
  body,
  source,
  copySource,
  entry,
  name,
  initialMode = 'fit',
  scrolls = false,
  hatch = true,
  onScale,
}: DiagramFileBodyProps): ReactElement {
  const { panelId, filePath, onDrawn, onBodyFailure, onViewStateCapture } = body;
  const theme = useActiveTheme();
  const diagramTheme = useMemo(() => diagramThemeFrom(theme), [theme]);
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  const onFailureRef = useRef(onBodyFailure);
  onFailureRef.current = onBodyFailure;

  // A drawing's view state is its frame's own (054 FR-046g): nothing for the chrome to keep across entries.
  useEffect(() => {
    onViewStateCapture(() => null);
  }, [onViewStateCapture]);

  // 054 FR-073 — the Full Pane target outlives this body (a tab switch unmounts it); it goes when the FILE does.
  const drawnFile = useRef(filePath);
  useEffect(() => {
    if (drawnFile.current !== filePath) releaseDiagramSections(panelId, 0);
    drawnFile.current = filePath;
  }, [panelId, filePath]);

  useEffect(() => {
    if (entry === null) onFailureRef.current(new Error(`No renderer is registered for ${name}.`));
    else onDrawnRef.current(filePath);
  }, [source, filePath, entry, name]);

  const lang = entry?.lang ?? '';
  return (
    // `preview-drawing-file`: every one-drawing body fills its panel the same way (diagram.css), whatever its name.
    <div className={`preview-drawing-file ${name}`} data-testid={`${name}-${panelId}`} tabIndex={-1}>
      <div
        className={DIAGRAM_HOST_CLASS}
        data-source-line="0"
        {...{ [DIAGRAM_LANG_ATTRIBUTE]: lang }}
        {...(copySource !== undefined ? { [DIAGRAM_SOURCE_ATTRIBUTE]: copySource } : {})}
      >
        {entry !== null ? (
          // Keyed by file: a drawing's last good render and view belong to the file it was drawn from.
          // No inline Maximise: the file is its one drawing, so the panel header maximises it.
          <DiagramBlock
            key={filePath}
            panelId={panelId}
            sectionId="diagram-0"
            source={source}
            entry={entry}
            theme={diagramTheme}
            maximisable={false}
            fillsPanel
            initialMode={initialMode}
            scrolls={scrolls}
            hatch={hatch}
            onScale={onScale}
          />
        ) : null}
      </div>
    </div>
  );
}
