/**
 * The preview providers a surface may draw from, BY INJECTION (044, FR-070,
 * contracts/preview-provider-seam.md §3).
 *
 * Every renderer surface that needs a provider — the panel's body host today, the menus, status bars
 * and restore filter as they land — reads this context rather than importing a provider or the shipped
 * registry. Its default IS the shipped pair, so the app needs no provider mounted; a test substitutes a
 * registry of its own (SC-003's `testText` / `testBinary`) by wrapping the tree, and every surface
 * underneath follows without an edit.
 *
 * It carries both halves of a provider: core's descriptor registry (what a file type IS) and the
 * renderer's views (how its content is drawn), which meet by id.
 */
import { createContext, useContext } from 'react';
import { SHIPPED_PREVIEW_PROVIDERS, type PreviewProviderRegistry } from '@throng/core';
import type { PreviewProviderView } from './provider-view.js';
import { PREVIEW_PROVIDER_VIEWS } from './providers/index.js';

export interface PreviewProviders {
  registry: PreviewProviderRegistry;
  views: Readonly<Record<string, PreviewProviderView>>;
}

export const PreviewProviderRegistryContext = createContext<PreviewProviders>({
  registry: SHIPPED_PREVIEW_PROVIDERS,
  views: PREVIEW_PROVIDER_VIEWS,
});

export function usePreviewProviders(): PreviewProviders {
  return useContext(PreviewProviderRegistryContext);
}
