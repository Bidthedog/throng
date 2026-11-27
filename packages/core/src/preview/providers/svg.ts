/**
 * The SVG provider's descriptor (074 FR-001, FR-040 – FR-048; Q1, Q3, Q5) — a `.svg` file previews as its picture,
 * drawn in the browser's image mode, beside the editor it is being written in.
 *
 * Its own type rather than a format of Image Preview (Q1): an SVG is text, edited live, so it is parented and follows
 * the unsaved buffer as Markdown does. One picture, not a document (`flowingDocument: false`): no Select All, Go to
 * Heading or Synchronise Scrolling (FR-046). Ships Throng Preview (Q5).
 *
 * The core half only; the drawing is the renderer's `ui/src/renderer/preview/providers/svg/`. Pure data.
 */
import type { PreviewProviderDescriptor } from '../provider.js';
import { maxFileBytesSetting, transparencyHatchSetting } from './media-settings.js';

export const svgProvider: PreviewProviderDescriptor = {
  id: 'svg',
  displayName: 'SVG',
  extensions: ['.svg'],
  kind: 'text',
  // 075 FR-075a (the maintainer, 2026-11-20) — the drawing, fitted to the page and never past its own size.
  print: 'document',
  // 074 FR-103 — drawn as the preview icon with this type's mark.
  previewIcon: 'previewSvg',
  defaultOpenAction: 'preview',
  filesNoun: 'SVG files',
  flowingDocument: false,
  maxFileBytesSetting: 'maxFileBytes',
  settings: [maxFileBytesSetting('SVG files', 10 * 1024 * 1024), transparencyHatchSetting('SVGs')],
};
