/**
 * The ONE boundary where a layout's absolute paths are put into storage form (#229).
 *
 * #229's acceptance criteria ask for normalisation "at a single documented boundary, with one named
 * helper, rather than per consumer". This is that helper; `WorkspaceRepository` is that boundary,
 * on the way in AND on the way out. Applying it in both directions is what makes the migration
 * question moot: a row written before this existed comes back canonical without a schema version, a
 * backfill script, or a write on load. It settles to the canonical form on disk the next time
 * anything saves that project — which is the "migrate on read" half of the AC, stated.
 *
 * ## Which fields, and why only these
 *
 * A layout blob carries exactly three absolute paths, all of them produced outside this package:
 *
 * | Field | Owner | Producer |
 * |---|---|---|
 * | `config.filePath` | Editor Panel (006) | the explorer tree, or a save |
 * | `config.startDirectory` | Terminal Panel (033) | the folder right-clicked in the tree |
 * | `terminalMemory.lastCwd` | Terminal Panel (025 FR-027) | the daemon's real working directory |
 *
 * The last two are already native today; they are included as a GUARD, which is what the AC asks
 * for. Everything else in a layout is an id, a title, a number or a flag.
 *
 * `config` is `Record<string, unknown>` by design (the panel-type registry narrows it per type), so
 * these are read defensively: a non-string value is left exactly as it was rather than coerced.
 *
 * The rewrite is STRUCTURAL — a new tree is returned and the caller's layout is never mutated. A
 * repository that quietly rewrote the object its caller still held would be a much better bug than
 * the one this fixes.
 */
import { toCanonicalPath, type PathSeparator } from '../fs/path-canon.js';
import { isPanel, type LayoutNode, type Panel, type WorkspaceLayout } from './model.js';

/** Absolute-path fields inside a Panel's open `config` record. */
const CONFIG_PATH_KEYS = ['filePath', 'startDirectory'] as const;

function canonicalisePanel(panel: Panel, sep: PathSeparator): Panel {
  let next = panel;

  if (next.config) {
    let config = next.config;
    for (const key of CONFIG_PATH_KEYS) {
      const value = config[key];
      if (typeof value !== 'string' || value === '') continue;
      const canonical = toCanonicalPath(value, sep);
      if (canonical !== value) config = { ...config, [key]: canonical };
    }
    if (config !== next.config) next = { ...next, config };
  }

  const lastCwd = next.terminalMemory?.lastCwd;
  if (typeof lastCwd === 'string' && lastCwd !== '') {
    const canonical = toCanonicalPath(lastCwd, sep);
    if (canonical !== lastCwd) {
      next = { ...next, terminalMemory: { ...next.terminalMemory, lastCwd: canonical } };
    }
  }

  return next;
}

function canonicaliseNode(node: LayoutNode, sep: PathSeparator): LayoutNode {
  if (isPanel(node)) return canonicalisePanel(node, sep);
  const children = node.children.map((child) => canonicaliseNode(child, sep));
  return children.every((child, i) => child === node.children[i])
    ? node
    : { ...node, children };
}

/**
 * Every absolute path in `layout`, in the host's storage canon.
 *
 * Returns the layout unchanged (by identity) when nothing needed rewriting, so the common case
 * costs one walk and no allocation.
 */
export function canonicalisePersistedPaths(
  layout: WorkspaceLayout,
  sep: PathSeparator,
): WorkspaceLayout {
  const tabs = layout.tabs.map((tab) => {
    const root = canonicaliseNode(tab.root, sep);
    return root === tab.root ? tab : { ...tab, root };
  });
  return tabs.every((tab, i) => tab === layout.tabs[i]) ? layout : { ...layout, tabs };
}
