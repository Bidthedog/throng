/**
 * The production Markdown renderer: the pipeline bound to the real sanitiser (044, FR-081,
 * contracts/security-policy.md Layers 1 and 2).
 *
 * `createMarkdownPipeline` is generic over what its sanitiser returns, which is what lets a node test
 * inject a spy. That same freedom would let a caller wire a sanitiser returning a STRING — and a string
 * reaches the DOM only through `innerHTML`, the second parse Layer 2 exists to rule out. This factory is
 * the one the panel uses: its type admits nothing but a `DocumentFragment`.
 *
 * Reached only by dynamic import, like the two modules it binds (`vite.config.ts`, `preview` chunk).
 */
import type { WindowLike } from 'dompurify';
import { createMarkdownPipeline, type MarkdownPipeline } from './pipeline.js';
import { createSanitiser } from './sanitise.js';

export type MarkdownRenderer = MarkdownPipeline<DocumentFragment>;

export function createMarkdownRenderer(root?: WindowLike): MarkdownRenderer {
  return createMarkdownPipeline(createSanitiser(root));
}
