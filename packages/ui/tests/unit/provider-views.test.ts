/**
 * 044 T068 (FR-070, contracts/preview-provider-seam.md §2) — every provider has both halves.
 *
 * A provider is a core DESCRIPTOR (`SHIPPED_PREVIEW_PROVIDERS`) and a renderer VIEW
 * (`PREVIEW_PROVIDER_VIEWS`), registered by one line each. Nothing else ties the two together, so a
 * descriptor registered without its view is a file type the menus offer to preview and the panel then
 * cannot draw — a silent degradation, and precisely the failure `language-loaders.test.ts` records for
 * the language registry's two halves. This is that test for this registry.
 */
import { describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS } from '@throng/core';
import { PREVIEW_PROVIDER_VIEWS } from '../../src/renderer/preview/providers/index.js';

describe('the renderer registers a view for exactly the providers core registers (FR-070)', () => {
  it('has the same key set as SHIPPED_PREVIEW_PROVIDERS’ ids', () => {
    const ids = SHIPPED_PREVIEW_PROVIDERS.list().map((p) => p.id).sort();
    // Anti-vacuity: two empty registries agree perfectly and prove nothing.
    expect(ids.length).toBeGreaterThan(0);
    expect(Object.keys(PREVIEW_PROVIDER_VIEWS).sort()).toEqual(ids);
  });

  it('files each view under its own id', () => {
    for (const [key, view] of Object.entries(PREVIEW_PROVIDER_VIEWS)) {
      expect(view.id, `the view registered as "${key}"`).toBe(key);
    }
  });

  it('loads each body lazily — registering a view imports no body', () => {
    // `load` is the R21 seam: the body (and markdown-it behind it) arrive on first use. A view whose
    // `load` is not a function would have to have imported its body eagerly to exist at all.
    for (const view of Object.values(PREVIEW_PROVIDER_VIEWS)) {
      expect(typeof view.load).toBe('function');
    }
  });
});
