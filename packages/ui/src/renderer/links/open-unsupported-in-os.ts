/**
 * 067 FR-131 — the reader a surface hands `followLink` as `opensInOs`: is this in-project file one throng
 * cannot open (the editor refuses it as BINARY) while `explorer.openUnsupportedInOs` is on?
 *
 * The same question the File Explorer's double-click asks (`editor-open.tsx`, FR-116/FR-117), asked of the
 * same main-process decision (`openDecisionFor`), so a Ctrl+click on a link and a double-click on the file's
 * tree row cannot disagree. A too-large file is not this case: the editor's own message stands.
 *
 * It lives beside `link-actions.ts` rather than inside it because it reaches into the editor's open router,
 * and `link-actions.ts` is kept free of every import that would drag a destination in.
 */
import type { ResolvedLink } from '@throng/core';
import { openDecisionFor, type WorkspaceApi } from '../editor/open-into-panel.js';

export interface OpenUnsupportedInOsInputs {
  /** `explorer.openUnsupportedInOs`, read at the gesture. */
  readonly enabled: boolean;
  readonly ws: WorkspaceApi;
  /** The project the surface belongs to, where it is not the layout's own (a sub-workspace window). */
  readonly ownerProjectId?: string;
}

export function refusedAsBinaryToOs(
  read: () => OpenUnsupportedInOsInputs,
): (file: Pick<ResolvedLink, 'path'>) => Promise<boolean> {
  return async (link) => {
    const { enabled, ws, ownerProjectId } = read();
    if (!enabled) return false;
    const decision = await openDecisionFor(ws, link.path, ownerProjectId);
    return decision?.action === 'refuse' && decision.reason === 'binary';
  };
}
