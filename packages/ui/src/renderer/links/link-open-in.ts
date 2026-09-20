import { collectPanels, type WorkspaceLayout } from '@throng/core';

/**
 * 045 FR-170 row 2 — the Link menu's **Open In ▸** targets, as data (T277).
 *
 * Pure, like `editor/open-in-targets.ts` beside the explorer's Open In: the performing half, which
 * reaches the workspace store and `openFileInTab`, is `link-open-in-perform.ts`, so this can be
 * asked its question in the `unit` tier with an object literal.
 */

/**
 * Which Open In row was chosen. New and Active are two DIFFERENT routes — a new panel, or the tab's
 * active (last active) editor reused — so they are two kinds, never one performer guessing from the
 * *Open files in* preference.
 */
export type LinkOpenInTarget =
  | { readonly kind: 'new' }
  | { readonly kind: 'active' }
  | { readonly kind: 'editor'; readonly editorId: string };

/** One named Open In row: the editor panel's id and the name its header shows. */
export interface OpenInEditorRow {
  readonly id: string;
  readonly name: string;
}

/** Separators and case do not distinguish two paths on this platform (#229's trap). */
const samePath = (a: string, b: string): boolean =>
  a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/**
 * One row per open editor in this window, every tab, in layout order, named by its panel title —
 * except an editor already showing `targetPath`: opening a file into the editor that shows it is
 * meaningless, so that row is absent (Principle VI), not a no-op.
 *
 * `targetPath` is main's resolved path, and absent until main answers; the rows are all disabled
 * until then anyway, and the answer removes the one editor that turns out to hold the file.
 */
export function linkOpenInEditors(
  layout: Pick<WorkspaceLayout, 'tabs'> | null | undefined,
  args: {
    /** The file an editor panel shows, from the editor store. */
    readonly heldPath: (panelId: string) => string | null | undefined;
    readonly targetPath?: string | null;
  },
): OpenInEditorRow[] {
  if (!layout) return [];
  const { heldPath, targetPath } = args;
  const rows: OpenInEditorRow[] = [];
  for (const tab of layout.tabs) {
    for (const panel of collectPanels(tab.root)) {
      if (panel.kind !== 'editor') continue;
      const held = heldPath(panel.id);
      if (targetPath && held && samePath(held, targetPath)) continue;
      rows.push({ id: panel.id, name: panel.title });
    }
  }
  return rows;
}
