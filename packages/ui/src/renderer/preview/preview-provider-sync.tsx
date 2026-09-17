/**
 * Turning a preview provider off closes this window's previews of it (044 FR-063, FR-064; research R19;
 * contracts/preview-ipc.md §5).
 *
 * ══ ONE READER PER PROCESS ══
 *
 * The transition is `providersTurnedOff(previous, next)` — core's decision, unit-tested — and it is read
 * in exactly two places: here, once per window, for the layout this window holds; and in main, for the
 * runs and for the layouts no window holds (`preview-purge.ts`). Neither reads the other's half.
 *
 * ══ THE EXISTING DESTROY ROUTE, NOT A SECOND ONE ══
 *
 * Each preview goes through `releasePreviewView` — the call Close Panel, Destroy Tab and a sub-workspace
 * destroy already make — so main hears `destroyed` exactly where this view ends the preview, and a
 * PROJECT preview synced into a sub-workspace only forgets this window's mirror (`killsSession`'s rule).
 * Main's `dropProvider` has already dropped the runs by the time the settings reach a window; `destroyed`
 * is idempotent there, and it is what purges each panel's navigation history in one place.
 *
 * The panels then leave the layout through the store's `removePanelsWhere` — exactly as closing them by
 * hand would (FR-064): a split collapses, a tab they empty closes, and the workspace's last panel becomes
 * an empty panel (002 FR-016) — UNLESS every panel this window holds is one of the closing previews AND
 * this is an OPEN sub-workspace window, in which case FR-064 means the sub-workspace itself is destroyed
 * (005 FR-029), exactly as a hand ✕ on its last Panel already does (`panel-placeholder.tsx`), with no
 * confirmation here (044 US4 fix round 1, item 2). The MAIN window has no such concept.
 *
 * ══ THE FIRST SETTINGS PAYLOAD ══
 *
 * `previous` starts as whatever the config store rendered first — the shipped defaults, until the file
 * is read. A provider the user had already turned off therefore reads as turning off when the payload
 * lands, and any preview of it mounted in that moment closes. That is the right outcome, not a quirk: the
 * restore filter could only judge the layout against the settings it had, and such a preview must not
 * stay (FR-067).
 */
import { useEffect, useRef } from 'react';
import { collectPanels, providersTurnedOff, type Panel } from '@throng/core';
import { useAppSettings } from '../config/config-store.js';
import { useServicesOptional } from '../composition-root.js';
import { useWorkspace } from '../state/workspace-store.js';
import { SubWorkspaceWorkspaceClient } from '../state/subworkspace-window-client.js';
import { destroySubWorkspace } from '../workspace/destroy-sub-workspace.js';
import { releasePreviewView } from './forget-preview-panel.js';
import { emptiesLayout, isPreviewOfProviders } from './preview-panel-match.js';
import { usePreviewProviders } from './provider-registry-context.js';

export function PreviewProviderSync({ isSubWorkspace = false }: { isSubWorkspace?: boolean }): null {
  const ws = useWorkspace();
  const previews = useAppSettings().editor.previews;
  const { registry } = usePreviewProviders();
  const services = useServicesOptional();
  const previous = useRef(previews);
  // The store object is replaced on every render; the effect below must act on the layout as it is now.
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const servicesRef = useRef(services);
  servicesRef.current = services;

  useEffect(() => {
    const before = previous.current;
    previous.current = previews;
    if (before === previews) return;
    const off = providersTurnedOff(before, previews, registry);
    if (off.length === 0) return;

    const current = wsRef.current;
    const layout = current.layout;
    if (layout === null) return;
    const ids = new Set(off);
    const matches = (panel: Panel): boolean => isPreviewOfProviders(panel, ids, registry);

    const place = { inSubWorkspace: isSubWorkspace, layoutProjectId: layout.projectId };
    const closing = layout.tabs.flatMap((tab) => (collectPanels(tab.root) as Panel[]).filter(matches));
    if (closing.length === 0) return;
    // The predicate is decided NOW, before the mirrors are forgotten — `isPreviewOfProviders` reads the
    // live provider id from `preview-store`, which releasing a view clears.
    const closingIds = new Set(closing.map((p) => p.id));
    for (const panel of closing) releasePreviewView(panel, place);

    /*
     * Controller ruling (044 US4 fix round 1, item 2): FR-064 means "exactly as closing by hand". When
     * every panel this window's layout holds is one of the closing previews, an OPEN sub-workspace
     * window is left with nothing to show — the case a hand ✕ on its last Panel diverts to destroying
     * the sub-workspace (005 FR-029, `panel-placeholder.tsx`), taken here with no confirmation. A real
     * project's layout has no such concept: its last panel still becomes an empty panel, as before.
     */
    const subId = SubWorkspaceWorkspaceClient.subWorkspaceIdOf(layout.projectId);
    const subClient = servicesRef.current?.subWorkspaces;
    if (subId !== null && subClient && emptiesLayout(layout, closingIds)) {
      void destroySubWorkspace(subClient, subId);
      return;
    }
    current.removePanelsWhere((panel) => closingIds.has(panel.id));
  }, [previews, registry, isSubWorkspace]);

  return null;
}
