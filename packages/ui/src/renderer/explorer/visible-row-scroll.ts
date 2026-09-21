/**
 * Leave the tree where it is when the row being revealed is already in full view (#419).
 *
 * Clicking a row SELECTS it, and react-arborist's `select` asks for that row to be scrolled into view
 * — through react-window's `scrollToItem`. react-window clamps the target with the list's full
 * `height`, not its `clientHeight`, so it does not know a horizontal scrollbar is taking room at the
 * bottom. A list scrolled all the way down therefore sits PAST the offset react-window believes is
 * its last, and "revealing" a row that is plainly on screen scrolls the tree up — by the horizontal
 * scrollbar's height, measured at 12px. Any scroll also sets react-window's 150 ms
 * `pointer-events: none` window on the rows, which is how a double-click on that row could miss.
 *
 * The guard answers the one question react-window gets wrong — is this row fully visible? — against
 * the element's REAL viewport, and only asks react-arborist to scroll when it is not. A row that is
 * off screen, or half under an edge, still scrolls exactly as before, keyboard navigation included —
 * and a row in view vertically still gets react-arborist's HORIZONTAL reveal (#220), which is the
 * half of `scrollTo` react-window never did and has nothing wrong with it.
 */

const GUARDED = Symbol('throng.visibleRowScroll');

/** The slice of `TreeApi` the guard reads. Narrow, so a test can stand one up without a tree. */
export interface ScrollableTree {
  scrollTo: (identity: unknown, align?: never) => Promise<void> | undefined;
  readonly idToIndex: Record<string, number>;
  readonly rowHeight: number;
  readonly listEl: { current: HTMLElement | null };
  /** react-arborist's node lookup and its private horizontal reveal (#220), when present. */
  get?: (id: string) => unknown;
  scrollToNodeHorizontally?: (node: unknown) => void;
  [GUARDED]?: true;
}

function idOf(identity: unknown): string | null {
  if (typeof identity === 'string') return identity;
  if (identity && typeof identity === 'object' && 'id' in identity) {
    const id = (identity as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

/** Is the row at `index` entirely inside the list's real viewport? */
export function rowFullyVisible(el: HTMLElement, index: number, rowHeight: number): boolean {
  const top = index * rowHeight;
  return top >= el.scrollTop && top + rowHeight <= el.scrollTop + el.clientHeight;
}

/** Wrap the tree's `scrollTo` once, so a row already in full view is left where it is. */
export function guardVisibleRowScroll(tree: object): void {
  // Typed as `object` because react-arborist's TreeApi keeps the horizontal reveal private; the
  // members read here are checked for, not assumed.
  const api = tree as ScrollableTree;
  if (api[GUARDED]) return;
  const original = api.scrollTo.bind(api);
  api.scrollTo = (identity, align) => {
    const id = idOf(identity);
    const el = api.listEl.current;
    const index = id === null ? undefined : api.idToIndex[id];
    if (el && id !== null && index !== undefined && rowFullyVisible(el, index, api.rowHeight)) {
      api.scrollToNodeHorizontally?.(api.get?.(id));
      return Promise.resolve();
    }
    return original(identity, align);
  };
  api[GUARDED] = true;
}
