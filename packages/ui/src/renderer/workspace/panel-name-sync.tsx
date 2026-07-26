import { useEffect, useRef, useState } from 'react';
import { collectPanels } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useServices } from '../composition-root.js';

/**
 * Keeps panel names unique across the WHOLE application (024 follow-up).
 *
 * Two halves, both needed, and both here so there is one place that owns the invariant:
 *
 *  - **Reconcile what is already on disk**, once per launch. Panels are numbered within their own
 *    layout — every project's first panel is "Panel 1" — so duplicates across projects are not an
 *    edge case, they are the norm for anyone with more than one project. First claim wins, so the
 *    panel a user has been calling "Build" keeps the name and the newcomer moves.
 *  - **Claim each panel's name as it appears**, which covers the ones created from now on. A
 *    generated name is claimed SILENTLY: the user did not choose it, so an adjustment is not news.
 *    A name the user typed is claimed by the rename box itself, which does tell them.
 *
 * Claims are remembered per panel id, so a rename this component performs cannot re-trigger it —
 * and a panel is only ever asked about once per session, however often the layout changes.
 *
 * Mounted once per window, beside the other cross-window syncs. Reconcile is idempotent, so several
 * windows doing it costs a scan and changes nothing the second time.
 */
export function PanelNameSync(): null {
  const ws = useWorkspace();
  const { panelNames } = useServices();
  const claimed = useRef<Set<string>>(new Set());
  const layout = ws.layout;
  // Read through a ref so the effect below can rename without listing `ws` as a dependency (its
  // identity changes on every layout edit, which would re-run the effect mid-flight).
  const wsRef = useRef(ws);
  wsRef.current = ws;

  // Reconcile FIRST, and claim only afterwards. The two halves both rename panels, and letting them
  // interleave means claiming against a store the reconcile pass is still rewriting — so a panel can
  // be moved twice for one clash and land two suffixes along.
  const reconciled = useRef(false);
  const [reconcileDone, setReconcileDone] = useState(false);
  useEffect(() => {
    if (reconciled.current) return;
    reconciled.current = true;
    void panelNames.reconcile().finally(() => setReconcileDone(true));
  }, [panelNames]);

  useEffect(() => {
    if (!layout || !reconcileDone) return;
    for (const tab of layout.tabs) {
      for (const panel of collectPanels(tab.root)) {
        // Keyed by panel AND name, not panel alone: a panel's name changes after it is created —
        // an editor adopts its file's name, a terminal its process — and that new name needs the
        // same uniqueness as the one it was born with. Re-claiming its OWN current name is free,
        // because the daemon excludes the asking panel, so this settles rather than looping.
        const desired = panel.title;
        const seen = `${panel.id}|${desired.trim().toLowerCase()}`;
        if (claimed.current.has(seen)) continue;
        claimed.current.add(seen);
        void panelNames.claim(panel.id, desired).then(({ granted, adjusted }) => {
          if (!adjusted) return;
          // retitle, NOT rename: throng chose this name, the user did not. A rename would mark the
          // panel manually titled and permanently suppress its auto-title (#176).
          wsRef.current.retitlePanel(panel.id, granted);
          // Other windows hold this panel too when it is mirrored into a sub-workspace; the rename
          // has to reach them or the two views would disagree about what it is called.
          window.throng?.panel?.notifyRenamed?.(panel.id, granted);
        });
      }
    }
  }, [layout, panelNames, reconcileDone]);

  return null;
}
