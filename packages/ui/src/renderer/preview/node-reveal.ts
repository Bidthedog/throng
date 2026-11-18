/**
 * A body's way to open whatever it keeps folded around a node, for the chrome's find and link reveal (075
 * FR-010; the 047 FR-040 reveal, for content a body folds itself rather than through the section fold state).
 *
 * The chrome knows a node — a find match, a diagram, a link target — but not what the body draws around it, and
 * must not (FR-070: no surface names a provider). A body registers a revealer for its root element; the chrome
 * asks for the node, and the nearest registered root answers. A node under no registered root reveals nothing.
 *
 * Synchronous DOM: whatever the revealer opens is open when it returns, so the chrome's scroll can follow at once.
 */
const revealers = new WeakMap<Element, (node: Node) => boolean>();

/** Register `reveal` for everything under `root`. Returns the call that removes it. */
export function registerNodeRevealer(root: Element, reveal: (node: Node) => boolean): () => void {
  revealers.set(root, reveal);
  return () => {
    if (revealers.get(root) === reveal) revealers.delete(root);
  };
}

/** Open what the nearest registered body folds around `node`; whether anything was. */
export function revealNodeAt(node: Node): boolean {
  let el: Element | null = node instanceof Element ? node : node.parentElement;
  while (el !== null) {
    const reveal = revealers.get(el);
    if (reveal !== undefined) return reveal(node);
    el = el.parentElement;
  }
  return false;
}
