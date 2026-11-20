/**
 * The PDF provider's renderer half (074 US4, FR-060 – FR-068; research R5).
 *
 * `load` is a dynamic import (054 FR-047's rule), so the body — and PDF.js behind it — arrive on the first PDF
 * preview's mount. Text selection (FR-068a, superseding FR-068): each page's text layer is selectable, so the body
 * menu offers Copy and Select All; with no export profile, a rich copy is the plain text.
 *
 * The id is the core descriptor's (`packages/core/src/preview/providers/pdf.ts`); `provider-views.test.ts`
 * fails if the two ever differ.
 */
import type { PreviewProviderView } from '../../provider-view.js';

export const pdfView: PreviewProviderView = {
  id: 'pdf',
  textSelection: true,
  load: () => import('./pdf-body.js').then((m) => m.PdfBody),
  // 075 FR-075c — the PDF's own pages, one per sheet, fitted whole.
  printable: (_body, { title, readSource }) => import('../../print/pdf-printable.js').then((m) => m.buildPdfPrintable(readSource, title)),
};
