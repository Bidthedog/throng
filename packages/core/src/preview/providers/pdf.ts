/**
 * The PDF provider's descriptor (074 US4, FR-001, FR-010, FR-011, FR-060 – FR-069).
 *
 * A BINARY provider: always standalone, following the disk (044 FR-023, FR-073), its bytes served only as
 * `application/pdf` (FR-094). It ships Open PDFs in: Throng Preview, and caps what it reads by its own Maximum
 * file size (FR-012), shipped at 100 MB. How a PDF is drawn — PDF.js, pages on demand, no script — is the
 * renderer's half, `ui/src/renderer/preview/providers/pdf/`.
 *
 * Pure data — no OS, no DOM.
 */
import type { PreviewProviderDescriptor } from '../provider.js';
import { maxFileBytesSetting } from './media-settings.js';

export const pdfProvider: PreviewProviderDescriptor = {
  id: 'pdf',
  displayName: 'PDF',
  extensions: ['.pdf'],
  kind: 'binary',
  // 074 FR-103 — drawn as the preview icon with this type's mark.
  previewIcon: 'previewPdf',
  sourceMimeTypes: ['application/pdf'],
  defaultOpenAction: 'preview',
  filesNoun: 'PDFs',
  maxFileBytesSetting: 'maxFileBytes',
  // FR-062b — Ctrl+G and the menus' Go to… go to a page.
  goTo: 'page',
  settings: [maxFileBytesSetting('PDFs', 100 * 1024 * 1024)],
};
