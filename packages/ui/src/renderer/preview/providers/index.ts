/**
 * THE renderer registration of preview providers (044, FR-070, contracts/preview-provider-seam.md §2).
 *
 * One view per descriptor in core's `preview/providers/index.ts`, keyed by the descriptor's id. Adding a
 * provider is writing its folder beside `markdown/` and adding one entry here; no surface imports a
 * provider module (`preview-surfaces-name-no-provider.test.ts`), and `provider-views.test.ts` fails when
 * this key set and core's differ.
 *
 * Each view's body loads on first use, so importing this index pulls in no provider's libraries.
 */
import type { PreviewProviderView } from '../provider-view.js';
import { markdownView } from './markdown/view.js';
import { mermaidView } from './mermaid/view.js';
import { csvView } from './csv/view.js';
import { spreadsheetView } from './spreadsheet/view.js';
import { pdfView } from './pdf/view.js';
import { imageView } from './image/view.js';
import { svgView } from './svg/view.js';
import { htmlView } from './html/view.js';

export const PREVIEW_PROVIDER_VIEWS: Readonly<Record<string, PreviewProviderView>> = {
  [markdownView.id]: markdownView,
  // 054 FR-042 — `.mmd` / `.mermaid`, drawn through the same diagram renderer as an embedded fence.
  [mermaidView.id]: mermaidView,
  // 073 — the CSV Preview Editor and the read-only workbook preview, both on the shared grid.
  [csvView.id]: csvView,
  [spreadsheetView.id]: spreadsheetView,
  // 074 — an image and an SVG, each drawn as one picture in the diagram frame.
  [imageView.id]: imageView,
  [svgView.id]: svgView,
  // 074 US4 — `.pdf`, drawn by PDF.js behind the view's dynamic import.
  [pdfView.id]: pdfView,
  // 074 US5 — `.html` / `.htm`, static markup in a sandboxed frame.
  [htmlView.id]: htmlView,
};
