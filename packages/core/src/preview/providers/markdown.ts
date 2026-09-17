/**
 * The Markdown provider's descriptor (044, FR-065, FR-080, FR-092, data-model §2).
 *
 * The core half only: what it accepts and what it lets a user configure. How Markdown is rendered is
 * the renderer's half, `ui/src/renderer/preview/providers/markdown/`.
 *
 * Pure data — no OS, no DOM.
 */
import type { PreviewProviderDescriptor } from '../provider.js';

export const markdownProvider: PreviewProviderDescriptor = {
  id: 'markdown',
  displayName: 'Markdown',
  extensions: ['.md', '.markdown'],
  kind: 'text',
  settings: [
    {
      leaf: 'loadRemoteImages',
      label: 'Load remote images',
      description:
        'Show images a Markdown document links from the web over a secure connection, such as build badges. When off, each shows its alternative text instead and nothing is requested.',
      control: 'toggle',
      default: true,
    },
    // FR-117 (refines FR-085). Declared here, so its key, descriptor, default and parse are generated
    // (FR-071), drawn disabled while Markdown is off. The full dotted key is deliberately NOT written in
    // this comment: `settings-inertness-044.test.ts` matches a property read of the leaf, and a comment
    // spelling it out would count as a reader and pass that guard before anything consumes the setting.
    {
      leaf: 'showFrontMatter',
      label: 'Show front matter',
      description:
        'Show the block of metadata at the top of a Markdown document, such as its title and tags, as a table. When off, the block is not shown at all and the document begins after it.',
      control: 'toggle',
      default: true,
    },
  ],
  remoteImagesSetting: 'loadRemoteImages',
};
