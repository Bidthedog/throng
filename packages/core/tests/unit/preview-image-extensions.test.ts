/**
 * 074 FR-001, FR-094 — every extension the Image provider claims is served through the source route as one of the
 * MIME types it declares: a claimed extension the protocol cannot name would open an Image Preview that refuses its
 * own file (415).
 */
import { describe, expect, it } from 'vitest';
import { imageProvider } from '../../src/preview/providers/image.js';
import { resolvePreviewAsset } from '../../src/preview/request-policy.js';

const root = '/project';

describe('Image provider extensions (074 FR-094)', () => {
  it.each(imageProvider.extensions)('serves %s through the source route', (ext) => {
    const result = resolvePreviewAsset(
      { kind: 'source' },
      { projectRoot: root, docPath: `${root}/pics/sample${ext.toUpperCase()}`, mimeAllowlist: imageProvider.sourceMimeTypes ?? [] },
    );
    expect(result.ok).toBe(true);
  });

  it('claims the JPEG, bitmap and cursor aliases', () => {
    expect(imageProvider.extensions).toEqual(expect.arrayContaining(['.jfif', '.pjpeg', '.pjp', '.dib', '.cur']));
  });

  it.each([
    ['.jfif', 'image/jpeg'],
    ['.pjpeg', 'image/jpeg'],
    ['.pjp', 'image/jpeg'],
    ['.dib', 'image/bmp'],
    ['.cur', 'image/x-icon'],
  ])('serves %s as %s', (ext, mime) => {
    const result = resolvePreviewAsset(
      { kind: 'source' },
      { projectRoot: root, docPath: `${root}/a${ext}`, mimeAllowlist: imageProvider.sourceMimeTypes ?? [] },
    );
    expect(result).toMatchObject({ ok: true, mime });
  });
});
