/**
 * The Image provider's renderer half (074 FR-020 – FR-028, research R2). The id is the core descriptor's
 * (`packages/core/src/preview/providers/image.ts`); `provider-views.test.ts` fails if the two ever differ.
 *
 * No text selection (FR-028): the body menu offers the picture's own Copy Image and Focus Mode rows, as a Mermaid
 * diagram's does, and no text Copy or Select All.
 */
import type { PreviewProviderView } from '../../provider-view.js';

export const imageView: PreviewProviderView = {
  id: 'image',
  textSelection: false,
  // FR-086a — a picture has no text: no Find.
  findable: false,
  load: () => import('./image-body.js').then((m) => m.ImageBody),
  // 075 FR-075a — the picture, fitted to the page and never past its own size.
  printable: (body, { title }) =>
    import('../../print/printable.js').then((m) => m.buildPrintable(body, { title, fit: 'page', noUpscale: true })),
};
