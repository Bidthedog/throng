/**
 * The size of an editor's syntax tree, as a node count (055 FR-024, research R9): the structure-aware
 * input to `editorRendererBytes`. What a document costs the renderer follows how many nodes its parse
 * produced, not only how many characters it has — 1 MB of Markdown paragraphs costs several times what
 * the same 1 MB as one long paragraph does, because each block element is a Lezer `Tree` of its own.
 *
 * Bounded by construction, because the estimates reporter runs every capture interval, monitor open or
 * not (SC-004), and a synchronous walk must not delay input (SC-003):
 *
 * - A `TreeBuffer` packs its nodes as four 16-bit words each, so its count is `buffer.length / 4` and it
 *   is never walked; only `Tree` objects are visited.
 * - The walk stops after `budget` nodes and reports how far into the document it got, and the caller
 *   scales the count to the whole document (`extrapolatedNodes`). Measured on a fully parsed 50 MB
 *   Markdown tree (1.1 M nodes, every one a `Tree`): an unbounded walk is 30–60 ms, and an incremental
 *   reparse after a one-character edit rebuilds every `Tree` object, so caching subtrees saves nothing.
 * - The result is cached by tree identity: trees are immutable, so an idle document costs a lookup.
 *
 * Duck-typed rather than importing `@lezer/common` (not a direct dependency of this package): a child
 * with a `buffer` is a `TreeBuffer`, anything else is a `Tree`.
 */
interface SizedBuffer {
  readonly buffer: { readonly length: number };
  readonly length: number;
}

export interface SizedTree {
  readonly children: readonly (SizedTree | SizedBuffer)[];
  readonly positions: readonly number[];
  readonly length: number;
}

/**
 * What a walk saw: `nodes` counted over the first `chars` characters of the tree, `trees` of them `Tree`
 * objects of their own (the rest are packed in buffers, which cost the renderer a fraction as much).
 */
export interface TreeSample {
  readonly nodes: number;
  readonly trees: number;
  readonly chars: number;
}

/** Nodes a walk may visit: about 5 ms on the reference workstation. */
export const COUNT_BUDGET = 100_000;

const sampled = new WeakMap<SizedTree, TreeSample>();

/** Count `tree`'s nodes, stopping after about `budget` of them. */
export function sampleSyntaxTree(tree: SizedTree, budget: number = COUNT_BUDGET): TreeSample {
  const hit = sampled.get(tree);
  if (hit !== undefined) return hit;
  let left = budget;
  let nodes = 0;
  let trees = 0;
  let reached = 0;
  let stopped = false;
  const walk = (t: SizedTree, offset: number): void => {
    nodes += 1;
    trees += 1;
    left -= 1;
    for (let i = 0; i < t.children.length; i += 1) {
      if (left <= 0) {
        stopped = true;
        return;
      }
      const child = t.children[i] as SizedTree | SizedBuffer;
      const from = offset + (t.positions[i] ?? 0);
      if ('buffer' in child) {
        const n = child.buffer.length / 4;
        nodes += n;
        left -= n;
      } else {
        walk(child, from);
        if (stopped) return;
      }
      reached = from + child.length;
    }
  };
  walk(tree, 0);
  const result: TreeSample = { nodes, trees, chars: stopped ? reached : tree.length };
  sampled.set(tree, result);
  return result;
}
