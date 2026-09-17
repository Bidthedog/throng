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
 * A layout blob carries exactly four kinds of absolute path, all of them produced outside this package:
 *
 * | Field | Owner | Producer |
 * |---|---|---|
 * | `config.filePath` | Editor Panel (006), Preview Panel (044) | the explorer tree, a save, a followed link |
 * | `config.history.entries[].filePath` | Editor and Preview Panels (044 FR-109) | main's history authority |
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
import { parseHistory } from '../navigation/history.js';
import {
  isPanel,
  type LayoutNode,
  type Panel,
  type PreviewPanelConfig,
  type WorkspaceLayout,
} from './model.js';

/**
 * Absolute-path fields inside a Panel's open `config` record.
 *
 * `filePath` also covers a Preview Panel's file (044 FR-068) — the preview reuses the editor's key
 * precisely so that this list did not have to grow.
 */
const CONFIG_PATH_KEYS = ['filePath', 'startDirectory'] as const;

/**
 * `config.history` with every `entries[].filePath` canonical (044 FR-109) — the first absolute paths
 * in a layout blob that sit inside an ARRAY, which is why they need their own walk. Editor and preview
 * panels both carry one.
 *
 * Read as defensively as the keys above: `config` is `Record<string, unknown>` straight off disk, so a
 * history that is not an object, entries that are not an array, and an entry that is not an object
 * with a non-empty string path are all left exactly as they were. The same value comes back, by
 * identity, when nothing changed.
 */
function canonicaliseHistory(history: unknown, sep: PathSeparator): unknown {
  if (typeof history !== 'object' || history === null) return history;
  const entries = (history as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return history;

  let changed = false;
  const next = entries.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return entry;
    const filePath = (entry as { filePath?: unknown }).filePath;
    if (typeof filePath !== 'string' || filePath === '') return entry;
    const canonical = toCanonicalPath(filePath, sep);
    if (canonical === filePath) return entry;
    changed = true;
    return { ...entry, filePath: canonical };
  });
  return changed ? { ...history, entries: next } : history;
}

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
    if ('history' in config) {
      const history = canonicaliseHistory(config.history, sep);
      if (history !== config.history) config = { ...config, history };
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

/**
 * The file a persisted preview shows (044 FR-066, FR-067): its history's current entry, else
 * `filePath`, else `undefined`.
 *
 * The ONE reader of that precedence. Attaching a restored preview, filtering a restored layout for
 * previews whose provider is gone, and purging an unloaded layout when a provider is disabled all ask
 * "which file is this?", and if any of them read `filePath` while another read the history they would
 * disagree about the same panel. The history is read with `parseHistory` — exactly as attach reads it —
 * so a malformed entry or index cannot make this answer differ from the one the preview opens with.
 * The cap does not matter here (it never drops the current entry), hence `Infinity`.
 */
export function previewPathOf(config: PreviewPanelConfig | undefined): string | undefined {
  if (config === undefined) return undefined;
  const history = parseHistory(config.history, Number.POSITIVE_INFINITY);
  const current = history.entries[history.index];
  if (current !== undefined) return current.filePath;
  return typeof config.filePath === 'string' && config.filePath !== '' ? config.filePath : undefined;
}
