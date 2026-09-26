/**
 * The default open action router (044 FR-050 – FR-055, FR-062; research R20;
 * contracts/preview-provider-seam.md §2).
 *
 * ══ WHICH OPENS IT ROUTES ══
 *
 * Exactly two gestures ask "what does opening this file do?": a File Explorer click or Enter
 * (`EditorOpenListener`'s `throng:open-file`) and a Quick Open pick. A default open action of Preview is
 * a REFINEMENT of 006 FR-011/FR-012/FR-013 and 033 FR-009 for those two (FR-052) — the file's preview
 * opens instead of an editor — and nothing else is routed here:
 *
 * - a **Find in Files** result always opens an editor at the match (FR-054; 043 FR-037/FR-087c): a preview
 *   cannot reveal a line and column;
 * - **Open In**'s editor targets always open an editor (FR-055): choosing *New Editor* asks for one;
 * - a **drop** is a gesture at a place, and keeps `openFileInPanel`.
 *
 * Those callers keep calling `openFileInTab` directly, so they cannot pick up the refinement by accident.
 *
 * ══ PREVIEW IS THE ONE `preview.open` COMMAND ══
 *
 * FR-053 — a file already open in an editor gets its preview BESIDE that editor, or the preview already
 * open is focused. Both are main's decision (contracts/preview-ipc.md §1), so the router asks the same
 * `preview.open` every other entry point asks (FR-005) and names no requester: main looks the document up
 * rather than trusting a panel id from a click in the tree.
 *
 * ══ THE DECISION IS CORE'S ══
 *
 * `defaultOpenActionFor` answers Editor unless the file's provider is ENABLED and says Preview — so a
 * disabled provider suspends the choice without rewriting it (FR-062), and re-enabling restores it. The
 * registry and settings arrive from the caller, which reads them by injection (FR-070); this module names
 * no provider.
 *
 * ══ WHY THE EDITOR ROUTE IS A PARAMETER ══
 *
 * `editor-open.tsx` hosts the tree's listener and imports this module; importing `openFileInTab` back
 * would make the two a cycle. The caller hands its editor route in — `openFileInTab`, always — which
 * also keeps this file free of the workspace store.
 */
import {
  defaultOpenActionFor,
  type EditorOpenTarget,
  type PreviewProviderRegistry,
  type PreviewSettings,
} from '@throng/core';
import type { WorkspaceContextValue } from '../state/workspace-store.js';
import { requestPreviewOpen } from '../preview/open-preview.js';
import type { RevealTarget } from './reveal-range.js';

/** `openFileInTab`'s shape — the editor route every gesture falls back to. */
export type EditorOpenRoute = (
  ws: WorkspaceContextValue,
  tabId: string,
  absPath: string,
  openTarget: EditorOpenTarget,
  range?: RevealTarget,
) => Promise<boolean>;

export interface OpenRoute {
  registry: PreviewProviderRegistry;
  previews: PreviewSettings;
  /**
   * The real project the file is opened from — the one a preview is asked for. `null` / `undefined` in a
   * window with no owning project (a sub-workspace's own panel): no preview can be asked for there, so
   * the file opens in an editor rather than not at all.
   */
  projectId: string | null | undefined;
  openInEditor: EditorOpenRoute;
}

/**
 * Ask for the preview when the default open action says so; `false` when the editor route applies OR
 * when it does but main REFUSES it (044 US4 fix round 1, item 5) — a refusal is not an open, and a
 * caller like Quick Open (FR-061) must not treat it as one.
 */
async function openedAsPreview(absPath: string, route: OpenRoute): Promise<boolean> {
  if (!route.projectId) return false;
  if (defaultOpenActionFor(route.registry, route.previews, absPath) !== 'preview') return false;
  return requestPreviewOpen({ absPath, projectId: route.projectId });
}

/**
 * A File Explorer click or Enter (FR-052, FR-053): the preview, or the active tab's editor route.
 *
 * `true` when something was opened: a preview request counts, since main places or focuses it
 * (a refusal there is main's to report, as for every other `preview.open`).
 */
export async function openFromTree(
  ws: WorkspaceContextValue,
  absPath: string,
  openTarget: EditorOpenTarget,
  route: OpenRoute,
  range?: RevealTarget,
): Promise<boolean> {
  if (await openedAsPreview(absPath, route)) return true;
  const tabId = ws.layout?.activeTabId;
  if (!tabId) return false;
  return route.openInEditor(ws, tabId, absPath, openTarget, range);
}

/**
 * A Quick Open pick (FR-052; 033 FR-009). Answers whether a file opened, which Quick Open reads to decide
 * whether to remember its query (033 FR-061) — the editor route's own answer passes straight through.
 */
export async function openFromQuickOpen(
  ws: WorkspaceContextValue,
  tabId: string,
  absPath: string,
  openTarget: EditorOpenTarget,
  route: OpenRoute,
): Promise<boolean> {
  if (await openedAsPreview(absPath, route)) return true;
  return route.openInEditor(ws, tabId, absPath, openTarget, undefined);
}
