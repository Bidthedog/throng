/**
 * THE core registration of preview providers (044, FR-070, contracts/preview-provider-seam.md §2).
 *
 * Adding a provider is writing its descriptor beside `markdown.ts` and adding it to the array below —
 * plus the matching line in the renderer's `preview/providers/index.ts`. Nothing else in core names a
 * provider, and `preview-surfaces-name-no-provider.test.ts` holds every surface to that.
 *
 * Built at module load, so an extension claimed twice throws on the first import in every process
 * (FR-072).
 *
 * ══ THE ONE OTHER THING THIS FILE FORWARDS ══
 *
 * `markdownHeadingLine` (fix round 1, item 3) lives with the Markdown provider
 * (`./markdown/heading-line.js`), not in shared `preview/links.ts` — but the core barrel
 * (`core/src/index.ts`) still needs to re-export it for the editor's FR-090d heading reveal
 * (`reveal-range.ts`), and this registration index is the only file outside a provider's own folder
 * allowed to import one. So the barrel imports it from HERE, not from the provider folder directly.
 */
import type { PreviewProviderDescriptor, PreviewProviderRegistry } from '../provider.js';
import { createPreviewProviderRegistry } from '../registry.js';
import { markdownProvider } from './markdown.js';

export { markdownHeadingLine } from './markdown/heading-line.js';

export const SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS: readonly PreviewProviderDescriptor[] = [markdownProvider];

export const SHIPPED_PREVIEW_PROVIDERS: PreviewProviderRegistry = createPreviewProviderRegistry(
  SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS,
);
