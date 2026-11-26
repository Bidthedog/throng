/**
 * The Mermaid provider's descriptor (054 FR-005, FR-006, US5) — a standalone `.mmd` / `.mermaid` file
 * previews as its diagram, with the same rules, access points and settings as a Markdown preview.
 *
 * The core half only. How the diagram is drawn is the renderer's half,
 * `ui/src/renderer/preview/providers/mermaid/`, sharing the Markdown provider's embedded-diagram
 * renderer. It declares no settings of its own: enabled, default open action and Open previews in are
 * generated for every text provider.
 *
 * Two departures from the generated rows, both from 054's MT-04 review:
 * - It ships Preview as its default open action (superseding 044 FR-050's Editor for Mermaid only): a
 *   diagram file is opened to be looked at.
 * - Its enabled toggle is worded for what it governs — standalone `.mmd` / `.mermaid` files only. A
 *   diagram inside a Markdown preview answers to Markdown's Render Mermaid diagrams (FR-041, FR-049).
 *
 * Pure data — no OS, no DOM.
 */
import type { PreviewProviderDescriptor } from '../provider.js';

export const mermaidProvider: PreviewProviderDescriptor = {
  id: 'mermaid',
  displayName: 'Mermaid',
  extensions: ['.mmd', '.mermaid'],
  kind: 'text',
  // 074 FR-103 — drawn as the preview icon with this type's mark.
  previewIcon: 'previewMermaid',
  defaultOpenAction: 'preview',
  // One diagram, not a document: no Select All, Go to Heading or Synchronise Scrolling.
  flowingDocument: false,
  // 075 FR-060, FR-075 — one diagram, printed fitted to the page.
  print: 'document',
  enabledLabel: 'Preview .mmd files',
  enabledDescription:
    'Offer previews of .mmd and .mermaid files. Markdown\'s Render Mermaid diagrams covers the rest.',
};
