import type { ResolvedTarget } from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
import type { OpenMenuOptions } from '../context-menu-provider.js';

/** The two `useContextMenu()` calls this module needs — never the whole controller. */
export interface LinkMenuOpener {
  readonly openMenu: (x: number, y: number, items: MenuAction[], options?: OpenMenuOptions) => number;
  readonly updateMenu: (opId: number, items: MenuAction[]) => void;
}

/**
 * 045 FR-169 – FR-171, FR-170b / FR-170c — open the Link menu AT ONCE, then update it when main's
 * resolution answers, replacing the await-then-open pattern (`terminal-panel.tsx` used to build the
 * whole menu from a `.then()` before ever calling `openMenu`, so the user's right-click sat with
 * nothing on screen for however long main took to answer).
 *
 * ══ ONE BOUNDED RESOLUTION PER OPENING (SC-021) ══
 *
 * `resolve`, when given, is called exactly once, right here. Its answer is applied through
 * `updateMenu`, which drops it by itself if this opening is no longer the one on screen — closed, or
 * replaced by a later right-click — so a late answer after close changes nothing (FR-170c).
 *
 * `resolve` is absent for a link class that draws its whole menu from grammar alone: a web, loopback,
 * protocol or anchor link (`buildLinkMenu` needs nothing from main for those), or a folder by grammar,
 * whose menu opens with its synthesised resolution and NO resolution request at all (FR-158c, FR-158d).
 */
export function openLinkMenu(args: {
  readonly x: number;
  readonly y: number;
  readonly opener: LinkMenuOpener;
  readonly testId?: string;
  /** Render the Link menu for one resolution state. */
  readonly buildItems: (resolution: ResolvedTarget | null | 'pending') => MenuAction[];
  readonly resolve?: () => Promise<ResolvedTarget | null>;
}): void {
  const { x, y, opener, testId, buildItems, resolve } = args;
  const options: OpenMenuOptions | undefined = testId !== undefined ? { testId } : undefined;
  const opId = opener.openMenu(x, y, buildItems(resolve ? 'pending' : null), options);
  if (!resolve) return;
  void resolve().then((resolution) => {
    opener.updateMenu(opId, buildItems(resolution));
  });
}
