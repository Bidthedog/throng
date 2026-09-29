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
    // 047 FR-032b. Declared here for the same reason as `showFrontMatter` above: generated (FR-071),
    // drawn disabled while Markdown is off. The full dotted key is deliberately NOT written in this
    // comment — `settings-inertness-047.test.ts` matches a property read of the leaf, and a comment
    // spelling it out would count as a reader and pass that guard before anything consumes it.
    {
      leaf: 'gutter',
      label: 'Preview gutter',
      description:
        'Show a narrow gutter beside each heading in a Markdown preview, with a fold arrow. It is the only control that shows or hides the gutter; folding stays available from the menus and key bindings while it is off.',
      control: 'toggle',
      default: true,
    },
    // 047 FR-042d. A jump to a heading (Go to Heading, a link) scrolls over this many milliseconds;
    // 0 jumps instantly.
    {
      leaf: 'headingJumpMs',
      label: 'Heading jump scroll duration (ms)',
      description: 'How long a jump to a heading in a Markdown preview takes to scroll into view. 0 jumps instantly.',
      control: 'number',
      default: 200,
      min: 0,
      max: 2000,
      // A bounded number takes the slider (018 SC-007's converse guard), so it needs a step: at
      // least 1% of the range (`slider-descriptors.test.ts`), and the shipped 200 lands exactly on
      // one — 0 + 50×4.
      step: 50,
    },
  ],
  remoteImagesSetting: 'loadRemoteImages',
};
