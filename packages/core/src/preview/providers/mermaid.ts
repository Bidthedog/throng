/**
 * The Mermaid provider's descriptor (054 FR-005, FR-006, US5) — a standalone `.mmd` / `.mermaid` file
 * previews as its diagram, with the same rules, access points and settings as a Markdown preview.
 *
 * The core half only. How the diagram is drawn is the renderer's half,
 * `ui/src/renderer/preview/providers/mermaid/`, sharing the Markdown provider's embedded-diagram
 * renderer. It declares no settings of its own: enabled, default open action and Open previews in are
 * generated for every text provider.
 *
 * Pure data — no OS, no DOM.
 */
import type { PreviewProviderDescriptor } from '../provider.js';

export const mermaidProvider: PreviewProviderDescriptor = {
  id: 'mermaid',
  displayName: 'Mermaid',
  extensions: ['.mmd', '.mermaid'],
  kind: 'text',
};
