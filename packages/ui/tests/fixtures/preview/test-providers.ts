/**
 * Two preview providers that exist only in tests (044 US5 — FR-070, FR-071, FR-073, SC-003).
 *
 * `preview-provider-seam.test.ts` registers these through `PreviewProviderRegistryContext` and an
 * injected registry, and asserts every surface offers them correctly. They live under `tests/` so
 * nothing in `src` can reach them and no build ships them — a surface that handles them does so because
 * it reads the registry, not because it was told about them.
 *
 * - **`testText`** (`.prvtxt`) — a text provider with one own toggle, `shout`: the shape of Markdown
 *   without being Markdown.
 * - **`testBinary`** (`.prvbin`) — a binary provider, the shape #388's PDF provider will take: no own
 *   settings, a source MIME allowlist, always standalone.
 *
 * Each view's body draws what it was handed and nothing else, so a test can read the content KIND a
 * provider received off the DOM (`data-content-kind`) — the claim S7 makes about a binary provider.
 */
import { createElement, useEffect, type ReactElement } from 'react';
import {
  createPreviewProviderRegistry,
  previewSettingsDefaults,
  type PreviewProviderDescriptor,
  type PreviewProviderRegistry,
  type ProviderSettings,
} from '@throng/core';
import type { PreviewBody, PreviewBodyProps, PreviewProviderView } from '../../../src/renderer/preview/provider-view.js';

export const TEST_TEXT: PreviewProviderDescriptor = {
  id: 'testText',
  displayName: 'Test text',
  extensions: ['.prvtxt'],
  kind: 'text',
  settings: [
    {
      leaf: 'shout',
      label: 'Shout',
      description: 'Draw every test text document in capitals.',
      control: 'toggle',
      default: false,
    },
  ],
};

export const TEST_BINARY: PreviewProviderDescriptor = {
  id: 'testBinary',
  displayName: 'Test binary',
  extensions: ['.prvbin'],
  kind: 'binary',
  sourceMimeTypes: ['application/x-prvbin'],
};

export const TEST_PREVIEW_REGISTRY: PreviewProviderRegistry = createPreviewProviderRegistry([TEST_TEXT, TEST_BINARY]);

/** A body that draws its content and reports every draw, as the view contract requires (data-model §13). */
function bodyFor(providerId: string): PreviewBody {
  return function TestPreviewBody({ panelId, content, filePath, onDrawn }: PreviewBodyProps): ReactElement {
    useEffect(() => {
      onDrawn(filePath);
    });
    return createElement(
      'div',
      { 'data-testid': `test-body-${providerId}-${panelId}`, 'data-content-kind': content.kind },
      content.kind === 'text' ? content.text : content.url,
    );
  };
}

export const TEST_PREVIEW_VIEWS: Readonly<Record<string, PreviewProviderView>> = {
  testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(bodyFor('testText')) },
  testBinary: { id: 'testBinary', textSelection: false, load: () => Promise.resolve(bodyFor('testBinary')) },
};

/** The context value a window holding only the two test providers would have. */
export const TEST_PREVIEW_PROVIDERS = { registry: TEST_PREVIEW_REGISTRY, views: TEST_PREVIEW_VIEWS };

/**
 * A `settings.json` document holding the test registry's generated `editor.previews`, with per-provider
 * overrides.
 *
 * Why the document names the providers at all: the window's settings are parsed by `app-settings.ts`
 * over the SHIPPED registry (contracts/preview-provider-seam.md §3, "Settings defaults and parsing"),
 * which carries an unknown provider's entry through as written and fills in nothing for it. In the app
 * the registry that parses and the registry the surfaces read are one and the same; here they are not,
 * so the document is written as the app would hold it for a build that registered these two.
 */
export function testPreviewSettings(
  over: { testText?: Partial<ProviderSettings>; testBinary?: Partial<ProviderSettings> } = {},
): Record<string, unknown> {
  const previews = previewSettingsDefaults(TEST_PREVIEW_REGISTRY);
  return {
    editor: {
      previews: {
        ...previews,
        providers: {
          testText: { ...previews.providers.testText, ...over.testText },
          testBinary: { ...previews.providers.testBinary, ...over.testBinary },
        },
      },
    },
  };
}
