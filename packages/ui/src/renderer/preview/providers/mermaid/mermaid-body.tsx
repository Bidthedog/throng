/**
 * The Mermaid provider's body (054 FR-042, FR-043, FR-044): the whole file as one diagram.
 *
 * It draws through exactly what an embedded fence draws through — the `mermaid` block renderer, the
 * `DiagramBlock` that keeps the last good render under a parse notice, and the `DiagramFrame` with its view
 * controls — inside the same host element, so find leaves the drawing out of its text (FR-032) and copy puts
 * the source or the image in its place (FR-049a).
 *
 * A body reports every draw (data-model §13). Here the draw is the host with its source: the diagram inside
 * it renders on its own, and a parse error is the diagram's inline notice, never a body failure. The place
 * is kept by the frame itself, which stays mounted across updates.
 */
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import type { PreviewBodyProps } from '../../provider-view.js';
import { useActiveTheme } from '../../../config/config-store.js';
import { blockRendererFor } from '../../blocks/block-renderers.js';
import { DiagramBlock } from '../../diagram/diagram-block.js';
import { diagramThemeFrom } from '../../diagram/diagram-theme.js';
import {
  DIAGRAM_HOST_CLASS,
  DIAGRAM_LANG_ATTRIBUTE,
  DIAGRAM_SOURCE_ATTRIBUTE,
} from '../../diagram/diagram-host.js';

const LANG = 'mermaid';

export function MermaidBody({ panelId, content, filePath, onDrawn, onBodyFailure, onViewStateCapture }: PreviewBodyProps): ReactElement {
  const text = content.kind === 'text' ? content.text : '';
  const theme = useActiveTheme();
  const diagramTheme = useMemo(() => diagramThemeFrom(theme), [theme]);
  const entry = blockRendererFor(LANG);
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  const onFailureRef = useRef(onBodyFailure);
  onFailureRef.current = onBodyFailure;

  // A diagram's view state is its frame's own (FR-046g): nothing for the chrome to keep across entries.
  useEffect(() => {
    onViewStateCapture(() => null);
  }, [onViewStateCapture]);

  useEffect(() => {
    if (entry === null) onFailureRef.current(new Error('No diagram renderer is registered for Mermaid.'));
    else onDrawnRef.current(filePath);
  }, [text, filePath, entry]);

  return (
    <div className="preview-mermaid" data-testid={`preview-mermaid-${panelId}`} tabIndex={-1}>
      <div
        className={DIAGRAM_HOST_CLASS}
        data-source-line="0"
        {...{ [DIAGRAM_LANG_ATTRIBUTE]: LANG, [DIAGRAM_SOURCE_ATTRIBUTE]: text }}
      >
        {entry !== null ? (
          <DiagramBlock panelId={panelId} sectionId="diagram-0" source={text} entry={entry} theme={diagramTheme} />
        ) : null}
      </div>
    </div>
  );
}
