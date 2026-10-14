/**
 * THE renderer registration of preview providers (044, FR-070, contracts/preview-provider-seam.md §2).
 *
 * One view per descriptor in core's `preview/providers/index.ts`, keyed by the descriptor's id. Adding a
 * provider is writing its folder beside `markdown/` and adding one entry here; no surface imports a
 * provider module (`preview-surfaces-name-no-provider.test.ts`), and `provider-views.test.ts` fails when
 * this key set and core's differ.
 *
 * Each view's body loads on first use, so importing this index pulls in no provider's libraries.
 */
import type { PreviewProviderView } from '../provider-view.js';
import { markdownView } from './markdown/view.js';
import { mermaidView } from './mermaid/view.js';

export const PREVIEW_PROVIDER_VIEWS: Readonly<Record<string, PreviewProviderView>> = {
  [markdownView.id]: markdownView,
  // 054 FR-042 — `.mmd` / `.mermaid`, drawn through the same diagram renderer as an embedded fence.
  [mermaidView.id]: mermaidView,
};
