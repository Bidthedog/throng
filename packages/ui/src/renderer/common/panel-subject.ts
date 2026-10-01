import { useMemo } from 'react';
import { collectPanels, type NoticeSubject } from '@throng/core';

import { useEditorStateVersion } from '../editor/editor-state.js';
import { useProjects } from '../state/projects-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useTerminalTitleVersion } from '../terminal/title-store.js';
import { currentPanelTitle } from '../workspace/use-panel-display-names.js';

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
  /** The panel's displayed title — the one its header shows (048 FR-032), not the stored one. */
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
  /*
   * 048 FR-032 / FR-130 — the panel's NAME is what its header shows, so it moves when the header's
   * does: a shell announcing a window title, an editor opening a file. The two store versions are
   * memo inputs for exactly that; the values themselves are read inside `currentPanelTitle`.
   */
  const terminalTitles = useTerminalTitleVersion();
  const editorStates = useEditorStateVersion();
  return useMemo(() => {
    if (!layout) return undefined;
    for (const tab of layout.tabs) {
      const panel = collectPanels(tab.root).find((p) => p.id === panelId);
      if (!panel) continue;
      return {
        // Never `panel.title`: that is a generated fallback ("Blank Panel 3") kept only for
        // uniqueness, and *Copy details* would end in it where the header says "Command Prompt".
        name: currentPanelTitle(panel),
        tab: tab.title,
        project: projects.find((p) => p.id === panel.originProjectId)?.name,
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the versions are change signals, read via the stores
  }, [layout, projects, panelId, terminalTitles, editorStates]);
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
