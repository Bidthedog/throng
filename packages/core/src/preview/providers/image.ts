/**
 * The Image provider's descriptor (074 FR-001, FR-020 – FR-028; #441) — a raster image previews as its picture.
 *
 * Binary: always standalone, following the disk, read through the preview protocol's source route only as the MIME
 * types below (FR-021, FR-094). `.svg` is the SVG provider's (FR-001, 044 FR-072). Ships Throng Preview; offers
 * Default OS Program (Q2). Pure data — the drawing is `ui/src/renderer/preview/providers/image/`.
 */
import type { PreviewProviderDescriptor } from '../provider.js';
import { maxFileBytesSetting, transparencyHatchSetting } from './media-settings.js';

export const imageProvider: PreviewProviderDescriptor = {
  id: 'image',
  displayName: 'Image',
  // `.jfif`, `.pjpeg`, `.pjp` are JPEG; `.dib` is a BMP; `.cur` is a cursor in the ICO container (2026-11-19).
  extensions: ['.png', '.apng', '.jpg', '.jpeg', '.jfif', '.pjpeg', '.pjp', '.gif', '.webp', '.avif', '.bmp', '.dib', '.ico', '.cur'],
  kind: 'binary',
  // 074 FR-103 — drawn as the preview icon with this type's mark.
  previewIcon: 'previewImage',
  // 075 FR-075a (the maintainer, 2026-11-20) — the picture, fitted to the page and never past its own size.
  print: 'document',
  sourceMimeTypes: ['image/png', 'image/apng', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon'],
  defaultOpenAction: 'preview',
  filesNoun: 'images',
  maxFileBytesSetting: 'maxFileBytes',
  settings: [
    maxFileBytesSetting('Images', 50 * 1024 * 1024),
    // No Default fit (2026-11-19, FR-020a supersedes FR-020's setting): every preview opens at 100%, or Fit when the
    // picture is larger than the panel.
    transparencyHatchSetting('images'),
  ],
};
