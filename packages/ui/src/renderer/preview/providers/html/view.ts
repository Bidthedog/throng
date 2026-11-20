/**
 * The HTML provider's renderer half (074 FR-070 – FR-093a; research R6, R6a – R6e).
 *
 * The page is drawn in a same-origin frame that runs no script (FR-074a), so the panel reads into it: its text is
 * selectable for the panel's Copy, Copy as Rich Text, Copy as Plain Text and Select All (`textSelection`, FR-085a),
 * and Find searches the page (FR-086b, FR-086d). The body hands the panel the frame document's body as the place its
 * selection lives. The body, with its sanitiser, arrives on the first HTML preview's mount (`load` is a dynamic
 * import, R21).
 *
 * The id is the core descriptor's (`packages/core/src/preview/providers/html.ts`); `provider-views.test.ts` fails if
 * the two ever differ.
 */
import type { PreviewProviderView } from '../../provider-view.js';

export const htmlView: PreviewProviderView = {
  id: 'html',
  textSelection: true,
  load: () => import('./html-body.js').then((m) => m.HtmlBody),
  // FR-085a — a rich copy of the page: the selection's markup with the preview's own addresses and attributes removed.
  exportHtml: (selection) => import('./html-export.js').then((m) => m.exportHtmlSelection(selection)),
};
