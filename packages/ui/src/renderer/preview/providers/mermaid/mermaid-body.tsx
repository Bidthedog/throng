/**
 * The Mermaid provider's body (054 FR-042, FR-043, FR-044): the whole file as one diagram.
 *
 * It draws through exactly what an embedded fence draws through — the `mermaid` block renderer, the
 * `DiagramBlock` that keeps the last good render under a parse notice, and the `DiagramFrame` with its view
 * controls — by way of the shared one-drawing body (`diagram/diagram-file-body.tsx`, 074), which the SVG and Image
 * previews use too.
 */
import type { ReactElement } from 'react';
import type { PreviewBodyProps } from '../../provider-view.js';
import { blockRendererFor } from '../../blocks/block-renderers.js';
import { DiagramFileBody } from '../../diagram/diagram-file-body.js';

export function MermaidBody(props: PreviewBodyProps): ReactElement {
  const text = props.content.kind === 'text' ? props.content.text : '';
  return <DiagramFileBody body={props} source={text} copySource={text} entry={blockRendererFor('mermaid')} name="preview-mermaid" />;
}
