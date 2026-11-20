/**
 * The SVG provider's body (074 FR-040 – FR-048): the file drawn as an isolated picture — the `svg` block renderer
 * (`blocks/picture.ts`, research R3) inside the shared one-drawing body, so it carries a Mermaid preview's controls
 * exactly (FR-030, FR-031). A parented preview hands it the editor's unsaved text; the drawing follows it, its last
 * good drawing dimmed under the notice while the text is malformed (FR-045).
 */
import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { zoomPercent } from '../../zoom-titles.js';
import type { PreviewBodyProps } from '../../provider-view.js';
import { blockRendererFor } from '../../blocks/block-renderers.js';
import { DiagramFileBody } from '../../diagram/diagram-file-body.js';

export function SvgBody(props: PreviewBodyProps): ReactElement {
  const text = props.content.kind === 'text' ? props.content.text : '';
  // 074 (2026-11-20) — the zoom the drawing is shown at, in the status bar's readout.
  const onReadoutRef = useRef(props.onStatusReadout);
  onReadoutRef.current = props.onStatusReadout;
  const onScale = useCallback((scale: number) => onReadoutRef.current?.(zoomPercent(scale)), []);
  useEffect(() => () => onReadoutRef.current?.(null), []);
  // FR-048 — a text copy of the drawing is the file's source.
  return (
    <DiagramFileBody
      body={props}
      source={text}
      copySource={text}
      entry={blockRendererFor('svg')}
      name="preview-svg"
      // FR-020a — 100%, or Fit when the drawing is larger than the panel.
      initialMode="open"
      scrolls
      hatch={props.providerSettings.transparencyHatch !== false}
      onScale={onScale}
    />
  );
}
