/**
 * The block-renderer seam (054 FR-043, research R5): a fenced block whose language has a renderer here is
 * drawn by that renderer instead of being highlighted as code.
 *
 * Nothing in this module names a diagram language but the one registration at the bottom: a later
 * diagram language is one more `registerBlockRenderer` call and one more renderer module, with no change
 * to the Markdown body, the pipeline or the sanitisers.
 *
 * ══ WHAT A RENDERER IS HANDED ══
 *
 * The SANITISED document's `<pre><code data-lang>` — the pipeline's one code-block shape — never markdown-it's
 * HTML. The block's source is the code element's text, which the document sanitiser has already passed;
 * the renderer's own output goes through its own profile (`diagram/svg-sanitise.ts`) before it is drawn.
 *
 * ══ LOADED ON FIRST USE ══
 *
 * `load()` is a dynamic import, so a renderer — and the library behind it — is fetched only when a preview
 * first shows a block it claims (FR-047). A failed load is not cached by the registry: each caller retries.
 */
import type { DiagramTheme } from '../diagram/diagram-theme.js';

export interface BlockRenderOptions {
  readonly theme: DiagramTheme;
}

export interface BlockRenderer {
  /** Draw `source`. Rejects with an `Error` whose message names what is wrong with it. */
  render(source: string, options: BlockRenderOptions): Promise<SVGSVGElement>;
}

export interface BlockRendererEntry {
  /** The fence language, as `data-lang` carries it. */
  readonly lang: string;
  load(): Promise<BlockRenderer>;
}

/** A block the body hands to a renderer, in document order. */
export interface ClaimedBlock {
  readonly pre: HTMLElement;
  readonly lang: string;
  readonly source: string;
  /** The block's `data-source-line`, or `null` when it carries none. */
  readonly line: number | null;
  readonly entry: BlockRendererEntry;
}

const registry = new Map<string, BlockRendererEntry>();

/**
 * Register `entry` for its language. Returns the call that removes it again — putting back whatever it
 * replaced, so a test that stands a fake in for a shipped renderer leaves the shipped one behind it.
 */
export function registerBlockRenderer(entry: BlockRendererEntry): () => void {
  const previous = registry.get(entry.lang);
  registry.set(entry.lang, entry);
  return () => {
    if (registry.get(entry.lang) !== entry) return;
    if (previous === undefined) registry.delete(entry.lang);
    else registry.set(entry.lang, previous);
  };
}

export function blockRendererFor(lang: string): BlockRendererEntry | null {
  return registry.get(lang) ?? null;
}

/**
 * Every `pre > code[data-lang]` under `root` whose language has a renderer and that `enabled` admits (a
 * provider setting can switch a language off — Render Mermaid diagrams, FR-041), in document order. The
 * blocks are only found here; replacing them is the caller's.
 */
export function claimRenderedBlocks(root: ParentNode, enabled: (lang: string) => boolean): ClaimedBlock[] {
  const claimed: ClaimedBlock[] = [];
  for (const code of root.querySelectorAll<HTMLElement>('pre > code[data-lang]')) {
    const lang = code.getAttribute('data-lang') ?? '';
    const entry = registry.get(lang);
    if (entry === undefined || !enabled(lang)) continue;
    const pre = code.parentElement as HTMLElement;
    const lineText = pre.getAttribute('data-source-line');
    const line = lineText !== null && /^\d+$/.test(lineText) ? Number(lineText) : null;
    claimed.push({ pre, lang, source: code.textContent ?? '', line, entry });
  }
  return claimed;
}

registerBlockRenderer({
  lang: 'mermaid',
  load: () => import('../diagram/mermaid-renderer.js').then((m) => m.mermaidBlockRenderer),
});
