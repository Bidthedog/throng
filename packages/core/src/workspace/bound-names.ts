/**
 * Bounding the names a layout PERSISTS (031, FR-040). Pure — no DOM, no OS.
 *
 * The name limit has two halves and they are deliberately different. Shortening a name for DISPLAY
 * must never rewrite what is stored, so that lowering the limit and raising it again gives the full
 * names back. But the shortened form IS persisted the next time the layout is written for some other
 * reason — a rename, a tab created or destroyed, a split resized — which is what stops a project's
 * saved layout carrying names nobody can see for ever.
 *
 * That makes the WRITE boundary the only correct place for this. Applying it on read would destroy
 * the reversibility the first half promises; applying it in the components would bound what is drawn
 * and leave the stored document untouched, which is exactly the gap an E2E measured: lower the
 * limit, rename a DIFFERENT tab, and the store still held the full name.
 */
import { truncateGraphemes } from '../text/grapheme.js';
import type { LayoutNode, Panel, Tab, WorkspaceLayout } from './model.js';

function isSplit(node: LayoutNode): node is Exclude<LayoutNode, Panel> {
  return (node as { children?: unknown }).children !== undefined;
}

/** Truncate, but return the SAME reference when nothing changed, so callers can skip a rewrite. */
function bounded(title: string, limit: number): string {
  const cut = truncateGraphemes(title, limit);
  return cut === title ? title : cut;
}

function boundNode(node: LayoutNode, limit: number): LayoutNode {
  if (isSplit(node)) {
    const children = node.children.map((c) => boundNode(c, limit));
    return children.every((c, i) => c === node.children[i]) ? node : { ...node, children };
  }
  const panel = node as Panel;
  const title = bounded(panel.title, limit);
  return title === panel.title ? node : { ...panel, title };
}

function boundTab(tab: Tab, limit: number): Tab {
  const title = bounded(tab.title, limit);
  const root = boundNode(tab.root, limit);
  return title === tab.title && root === tab.root ? tab : { ...tab, title, root };
}

/**
 * Return `layout` with every tab and panel name within `limit` grapheme clusters.
 *
 * Structurally shared: any subtree that needed no change is returned by reference, so a layout
 * already within the limit comes back deeply equal to what went in and a save of it writes the same
 * bytes. Never mutates its argument.
 *
 * A non-finite or absent limit means UNBOUNDED — a `NaN` arriving from a mangled settings file must
 * show full names rather than blank every tab in the project's saved layout.
 */
export function boundLayoutNames(layout: WorkspaceLayout, limit: number): WorkspaceLayout {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return layout;
  const tabs = layout.tabs.map((t) => boundTab(t, limit));
  return tabs.every((t, i) => t === layout.tabs[i]) ? layout : { ...layout, tabs };
}
