/**
 * 074 — the provider-neutral seam extensions the media providers need: a per-provider size cap (FR-011,
 * FR-012) and the request filter's sub-frame rule (FR-093).
 */
import { describe, expect, it } from 'vitest';
import { maxFileBytesFor, previewSettingsDefaults } from '../../src/config/preview-settings.js';
import { decideRendererRequest } from '../../src/preview/request-policy.js';
import type { PreviewProviderDescriptor, PreviewProviderRegistry } from '../../src/preview/provider.js';

const capped: PreviewProviderDescriptor = {
  id: 'pic',
  displayName: 'Pic',
  extensions: ['.pic'],
  kind: 'binary',
  sourceMimeTypes: ['image/png'],
  maxFileBytesSetting: 'maxFileBytes',
  settings: [
    { leaf: 'maxFileBytes', label: 'Maximum file size', description: 'd', control: 'number', default: 2048, min: 1024, max: 4096, step: 1024 },
  ],
};
const plain: PreviewProviderDescriptor = { id: 'txt', displayName: 'Txt', extensions: ['.txt'], kind: 'text' };
const registry: PreviewProviderRegistry = {
  list: () => [capped, plain],
  get: (id) => [capped, plain].find((p) => p.id === id),
  forPath: () => undefined,
};

describe('maxFileBytesFor (FR-012)', () => {
  it("reads the provider's declared size leaf", () => {
    const s = previewSettingsDefaults(registry);
    expect(maxFileBytesFor(registry, s, 'pic', 10_000_000)).toBe(2048);
    s.providers.pic = { ...s.providers.pic!, maxFileBytes: 3072 };
    expect(maxFileBytesFor(registry, s, 'pic', 10_000_000)).toBe(3072);
  });

  it('falls back to the editor limit for a provider without one, or an unknown id', () => {
    const s = previewSettingsDefaults(registry);
    expect(maxFileBytesFor(registry, s, 'txt', 10_000_000)).toBe(10_000_000);
    expect(maxFileBytesFor(registry, s, 'nope', 10_000_000)).toBe(10_000_000);
  });
});

describe('decideRendererRequest — a sub-frame never reaches the network (FR-093)', () => {
  const policy = { rendererDir: '/app/renderer', remoteImages: true };

  it('refuses an https image from a sub-frame even while remote images are allowed', () => {
    expect(decideRendererRequest({ url: 'https://x.test/a.png', resourceType: 'image', fromSubFrame: true }, policy)).toBe('cancel');
  });

  it('still lets a sub-frame load from the preview protocol', () => {
    expect(
      decideRendererRequest({ url: 'throng-preview://asset/p/a.png', resourceType: 'image', fromSubFrame: true }, policy),
    ).toBe('allow');
  });

  it('leaves the main frame as it was', () => {
    expect(decideRendererRequest({ url: 'https://x.test/a.png', resourceType: 'image' }, policy)).toBe('allow');
  });
});
