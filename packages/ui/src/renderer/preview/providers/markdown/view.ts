/**
 * The Markdown provider's renderer half (044, FR-080, contracts/preview-provider-seam.md §1).
 *
 * `load` is a dynamic import on purpose (R21): the body, and behind it `markdown-it`, `dompurify` and
 * `yaml`, arrive on the first Markdown preview's mount rather than with the app. Registering this view
 * therefore costs the eager bundle one small object.
 *
 * `exportHtml` (FR-035a) is the export profile in `sanitise.ts`, reached by dynamic import for the same
 * reason — DOMPurify rides in the lazy chunk — and built once per window.
 *
 * The id is the core descriptor's (`packages/core/src/preview/providers/markdown.ts`);
 * `provider-views.test.ts` fails if the two ever differ.
 */
import type { PreviewProviderView } from '../../provider-view.js';
import type { PreviewHtmlExporter } from './sanitise.js';

let exporter: Promise<PreviewHtmlExporter> | null = null;

/** The window's one exporter, imported and built on first use; a failed import is tried again next time. */
function htmlExporter(): Promise<PreviewHtmlExporter> {
  exporter ??= import('./sanitise.js')
    .then((m) => m.createHtmlExporter(window))
    .catch((error: unknown) => {
      exporter = null;
      throw error;
    });
  return exporter;
}

export const markdownView: PreviewProviderView = {
  id: 'markdown',
  textSelection: true,
  load: () => import('./markdown-body.js').then((m) => m.MarkdownBody),
  exportHtml: (selection) => htmlExporter().then((exportHtml) => exportHtml(selection)),
};
