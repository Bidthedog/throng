/**
 * The moved-out flag, into THIS window's held layout — for every editor and preview in it, mounted or not
 * (050 FR-035, SC-012; research R19).
 *
 * Main's walk (`moved-layout-walk.ts`) covers the layouts NO window holds. A held layout is its window's to
 * write, and the per-panel routes cannot cover all of it: an editor hears `movedOut` on its document's sync
 * relay, a preview on its run's `pathChanged`, but a panel in a background tab that has not mounted this
 * session has neither a live document nor a run — so after a cut-paste into another project it would keep
 * the old path and no flag, and mount later to a "could not be read" notice instead of the moved one.
 *
 * So each move the window hears (`throng:files:moved`, to every window) is run through core's one rule
 * (`movedPanelConfig`, shared with main's walk) over every panel the layout holds, and only a CHANGE of the
 * flag is written — with the new path beside it, so a flagged panel never shows the old one. Everything
 * else the moves touch (an editor's path inside the project, a history) stays with its own routes, and a
 * panel whose flag already agrees is left alone, so the routes above and this one never write twice.
 */
import { useEffect, useRef } from 'react';
import { EDITOR_KIND, PREVIEW_KIND, collectPanels, movedPanelConfig, type Panel } from '@throng/core';
import { useProjects } from '../state/projects-store.js';
import { useWorkspace } from '../state/workspace-store.js';

export function MovedOutLayoutSync(): null {
  const ws = useWorkspace();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const { projects } = useProjects();
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  useEffect(
    () =>
      window.throng?.files?.onMoved?.(({ moves }) => {
        const { layout, updatePanelConfig } = wsRef.current;
        for (const tab of layout?.tabs ?? []) {
          for (const panel of collectPanels(tab.root) as Panel[]) {
            if (panel.kind !== EDITOR_KIND && panel.kind !== PREVIEW_KIND) continue;
            // The root of the panel's OWN project; a panel of no registered project (a sub-workspace's) is
            // never flagged — core reads `undefined` as "no project to leave".
            const root = projectsRef.current.find((p) => p.id === panel.originProjectId)?.rootFolder;
            const next = movedPanelConfig(panel, moves, root);
            if (next === null) continue;
            const was = (panel.config as { movedOut?: unknown } | undefined)?.movedOut === true;
            const now = next.movedOut === true;
            if (was === now) continue;
            const filePath = typeof next.filePath === 'string' ? { filePath: next.filePath } : {};
            // `undefined` names the key so the store's merge drops the flag; JSON leaves it out of the record.
            updatePanelConfig(panel.id, { ...filePath, movedOut: now ? true : undefined });
          }
        }
      }),
    [],
  );
  return null;
}
