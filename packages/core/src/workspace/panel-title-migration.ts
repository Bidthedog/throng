import { isPanel, type LayoutNode, type Panel, type Tab } from './model.js';
import { BLANK_PANEL_NAME, LEGACY_DEFAULT_PANEL_NAME } from './unique-name.js';

/**
 * The two fields a panel carried before 048 removed panel renaming (research R6). They are no longer
 * part of {@link Panel}; this is the only place that still knows them, to take them off old documents.
 */
interface LegacyTitleFields {
  titleIsCustom?: boolean;
  defaultTitle?: string;
}

type LegacyPanel = Panel & LegacyTitleFields;

function migratePanel(panel: Panel): Panel {
  const legacy = panel as LegacyPanel;
  if (!('titleIsCustom' in legacy) && !('defaultTitle' in legacy)) return panel;
  const { titleIsCustom, defaultTitle, ...rest } = legacy;
  return titleIsCustom ? { ...rest, title: defaultTitle ?? rest.title } : rest;
}

function mapNode(node: LayoutNode, fn: (panel: Panel) => Panel): LayoutNode {
  // A document read from storage or the wire is not trusted to match the model: a node that is not
  // one is left exactly as it came, for validation to report as it always has.
  if (typeof node !== 'object' || node === null) return node;
  if (isPanel(node)) return fn(node);
  if (!Array.isArray(node.children)) return node;
  const children = node.children.map((child) => mapNode(child, fn));
  return children.every((c, i) => c === node.children[i]) ? node : { ...node, children };
}

/**
 * Drop custom panel titles from a persisted document (048 FR-035): a panel the user renamed takes
 * back the title it was created with (`defaultTitle`, or its current title when none was captured),
 * and `titleIsCustom` / `defaultTitle` are removed from every panel. Nothing else is read or written —
 * ids, sizes, tree shape, kinds and configs are untouched (FR-034).
 *
 * Works on any document holding panels in tabs: a main-window layout, and a sub-workspace (which is
 * also what a tear-off is). Pure, never mutates its input, and idempotent — a document with neither
 * field anywhere is returned by identity, so a second pass is a no-op. Never throws: a malformed
 * document (no tabs array, a tab with no root, a split with no children) passes through unchanged.
 */
export function dropCustomPanelTitles<T extends { tabs: Tab[] }>(doc: T): T {
  return mapDocPanels(doc, migratePanel);
}

/**
 * Retire the pre-FR-127 generated title (048 FR-128): every panel titled "Panel <n>" becomes
 * "Blank Panel". Several may share it afterwards; the daemon's startup reconcile spreads them across
 * the sequence ("Blank Panel 2", …), as it already does for any duplicate. Only the title changes —
 * ids, sizes, tree shape, kinds and configs are untouched — and the pass is idempotent: a document
 * with no legacy title is returned by identity. Never throws, as {@link dropCustomPanelTitles}.
 */
export function renameLegacyDefaultTitles<T extends { tabs: Tab[] }>(doc: T): T {
  return mapDocPanels(doc, (panel) =>
    typeof panel.title === 'string' && LEGACY_DEFAULT_PANEL_NAME.test(panel.title.trim().toLowerCase())
      ? { ...panel, title: BLANK_PANEL_NAME }
      : panel,
  );
}

/**
 * Every panel-title migration a persisted document takes on its way in or out of storage (048 FR-035,
 * FR-128), in order: custom titles go back to their creation title first, so a renamed panel created
 * as "Panel 2" then retires to "Blank Panel" with the rest. Idempotent, as each pass is.
 */
export function migratePanelTitles<T extends { tabs: Tab[] }>(doc: T): T {
  return renameLegacyDefaultTitles(dropCustomPanelTitles(doc));
}

/** Apply `fn` to every panel of a document's tabs, preserving identity wherever nothing changed. */
function mapDocPanels<T extends { tabs: Tab[] }>(doc: T, fn: (panel: Panel) => Panel): T {
  if (typeof doc !== 'object' || doc === null || !Array.isArray(doc.tabs)) return doc;
  const tabs = doc.tabs.map((tab) => {
    if (typeof tab !== 'object' || tab === null) return tab;
    const root = mapNode(tab.root, fn);
    return root === tab.root ? tab : { ...tab, root };
  });
  return tabs.every((t, i) => t === doc.tabs[i]) ? doc : { ...doc, tabs };
}
