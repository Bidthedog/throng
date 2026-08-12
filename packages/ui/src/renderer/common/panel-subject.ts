import { useMemo } from 'react';
import { collectPanels, type NoticeSubject } from '@throng/core';

import { useProjects } from '../state/projects-store.js';
import { useWorkspace } from '../state/workspace-store.js';

/**
 * 030 US2 (#195) — WHERE A PANEL IS, so a notice can say which one it means.
 *
 * FR-022 requires a panel named on its own to be named `Project — Tab — Panel`, and the three facts
 * live in three places: the panel's title is in the layout, the tab's title is its parent, and the
 * project's NAME (not its id) is in the projects store. Every surface that raises a notice about a
 * panel would otherwise assemble those itself — and a sub-workspace window, which may hold panels
 * from several projects at once (INV-5), is exactly where a locally-assembled version would quietly
 * name the wrong one.
 *
 * The lookup is here; the FORMATTING is `formatSubject`'s and stays there (FR-021). This returns
 * parts, never a string.
 */
export interface PanelPlace {
  /** The panel's displayed title. */
  name: string;
  /** Its tab's title, where the panel was found in one. */
  tab?: string;
  /** Its ORIGIN project's name — not the window's active project, which differs in a
   *  sub-workspace window holding panels from several (INV-5/6). */
  project?: string;
}

/**
 * Locate a panel in this window's layout, or `undefined` when it is not there.
 *
 * `undefined` is a real answer and the caller must handle it: a panel can be destroyed between the
 * failure and the render that reports it, and inventing a name for one that no longer exists would
 * be the placeholder FR-027 forbids.
 */
export function usePanelPlace(panelId: string): PanelPlace | undefined {
  const { layout } = useWorkspace();
  const { projects } = useProjects();
  return useMemo(() => {
    if (!layout) return undefined;
    for (const tab of layout.tabs) {
      const panel = collectPanels(tab.root).find((p) => p.id === panelId);
      if (!panel) continue;
      return {
        name: panel.title,
        tab: tab.title,
        project: projects.find((p) => p.id === panel.originProjectId)?.name,
      };
    }
    return undefined;
  }, [layout, projects, panelId]);
}

/** The panel itself as a notice subject — `{ kind: 'none' }` when it is no longer in the layout. */
export function panelSubject(place: PanelPlace | undefined): NoticeSubject {
  return place ? { kind: 'panel', name: place.name, tab: place.tab, project: place.project } : { kind: 'none' };
}

/**
 * A TERMINAL in that panel (FR-026) — the flavour is the subject's own name, the panel a qualifier.
 *
 * Without the flavour a terminal notice says "the terminal exited" on a panel that can host any of
 * several shells, which is the same "which one?" question #195 is about one level down.
 */
export function terminalSubject(place: PanelPlace | undefined, flavour: string | undefined): NoticeSubject {
  if (!flavour) return panelSubject(place);
  return { kind: 'terminal', flavour, panel: place?.name, tab: place?.tab, project: place?.project };
}
