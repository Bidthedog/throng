/**
 * The SVG provider's renderer half (074 FR-040 – FR-048, research R2/R3). The id is the core descriptor's
 * (`packages/core/src/preview/providers/svg.ts`); `provider-views.test.ts` fails if the two ever differ.
 *
 * `textSelection` as Mermaid's: the copy path substitutes the drawing's source (054 FR-049a), so Copy works and the
 * rich half goes through the Markdown provider's export profile, reached lazily.
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

export const svgView: PreviewProviderView = {
  id: 'svg',
  textSelection: true,
  // FR-086a — the drawing is a picture: nothing in it for the find bar to search, so no Find.
  findable: false,
  load: () => import('./svg-body.js').then((m) => m.SvgBody),
  exportHtml: (selection) => htmlExporter().then((exportHtml) => exportHtml(selection)),
};
