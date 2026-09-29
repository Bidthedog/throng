/**
 * Resolves which Markdown section a preview body-menu open point falls in (047 US3, FR-036,
 * contracts "Preview body menu").
 *
 * The innermost section is simply the nearest heading AT OR BEFORE the point in DOCUMENT order — the
 * same definition the editor side uses (`sectionAtLine`, `editor/markdown-fold.ts`), translated from a
 * text line to a DOM position rather than re-derived. `target` is `root`'s own `data-heading-slug`
 * descendant tree (`providers/markdown/fold-gutter.ts`), whatever depth it sits at under `root` — the
 * caller's `root` is the body HOST, not necessarily `.preview-markdown` itself, so this walks every
 * `[data-heading-slug]` under it and keeps the LAST one that is at-or-before `target` in tree order,
 * rather than assuming headings are `root`'s direct children.
 */
export function sectionAtPoint(root: HTMLElement, target: Node | null): string | null {
  if (target === null) return null;
  if (target !== root && !root.contains(target)) return null;
  const headings = Array.from(root.querySelectorAll<HTMLElement>('[data-heading-slug]'));
  let best: string | null = null;
  for (const heading of headings) {
    const atOrBefore =
      heading === target ||
      (heading.compareDocumentPosition(target) & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)) !== 0;
    if (atOrBefore) best = heading.getAttribute('data-heading-slug');
  }
  return best;
}
