/**
 * The Mermaid provider's renderer half (054 FR-042, FR-043, research R5).
 *
 * The whole file is one diagram, drawn by the SAME renderer and the same `DiagramBlock`/`DiagramFrame` an
 * embedded ```mermaid fence uses — this provider adds a body that hands the file to them, and nothing else.
 *
 * `load` is a dynamic import, like the Markdown view's (R21): the body, and behind it the diagram renderer,
 * arrive on the first Mermaid preview's mount. Copy follows the same rule as a diagram in a Markdown
 * preview (FR-049a): the copy path substitutes the diagram's source or its image, and the rich half goes
 * through the preview export profile, which is the Markdown provider's module, reached the same lazy way.
 *
 * The id is the core descriptor's (`packages/core/src/preview/providers/mermaid.ts`);
 * `provider-views.test.ts` fails if the two ever differ.
 */
import type { PreviewProviderView } from '../../provider-view.js';
import type { PreviewHtmlExporter } from '../markdown/sanitise.js';

let exporter: Promise<PreviewHtmlExporter> | null = null;

function htmlExporter(): Promise<PreviewHtmlExporter> {
  exporter ??= import('../markdown/sanitise.js')
    .then((m) => m.createHtmlExporter(window))
    .catch((error: unknown) => {
      exporter = null;
      throw error;
    });
  return exporter;
}

export const mermaidView: PreviewProviderView = {
  id: 'mermaid',
  textSelection: true,
  load: () => import('./mermaid-body.js').then((m) => m.MermaidBody),
  exportHtml: (selection) => htmlExporter().then((exportHtml) => exportHtml(selection)),
};
