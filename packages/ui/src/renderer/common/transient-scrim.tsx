import { useEffect, useState, type ReactElement } from 'react';

import { subscribeTransientOverlay, transientOverlayOpen } from './transient-overlay.js';

/**
 * The ONE scrim behind every transient overlay (033 FR-071).
 *
 * ══ WHY ONE, AND NOT ONE EACH ══
 *
 * Every overlay used to draw its own. That is correct for a dialog that opens and closes, and wrong
 * for overlays that REPLACE one another: the tab picker lives in `workspace/tab-group.tsx` and Quick
 * Open and Go To Line in the navigation chrome, and React is free to commit the outgoing unmount and
 * the incoming mount in separate frames. For that frame no scrim exists anywhere and the whole window
 * flashes to full brightness — intermittently, and only ever on a swap that crosses component trees,
 * which is precisely how it was reported.
 *
 * The registry's slot is continuous across a hand-off — the claim is written before the incumbent is
 * dismissed — so a scrim driven by the slot has no gap to expose. It is a rule rather than a race.
 *
 * ══ WHY IT LIVES IN THE APP TREE AND NOT ON <body> ══
 *
 * The first attempt was a `<body>` class painting a pseudo-element, and it dimmed the modals along
 * with the app. A `<body>` pseudo-element is in the ROOT stacking context; the overlays are not,
 * because the window's zoom wrapper establishes a context of its own and composites everything
 * inside it as one subtree. z-index 1999 against 2000 only means what it looks like when both are in
 * the same context — outside it, the number is not compared at all. Mounted here, inside the same
 * tree the overlays render into, the comparison is local and reliable.
 *
 * Mount it once per window shell. It renders nothing at all when no overlay holds the slot.
 */
export function TransientScrim(): ReactElement | null {
  const [open, setOpen] = useState(transientOverlayOpen);

  useEffect(() => subscribeTransientOverlay(() => setOpen(transientOverlayOpen())), []);

  if (!open) return null;
  // `pointer-events: none` in the CSS: dismiss-on-click belongs to the overlay's own full-viewport
  // container, which knows what a click outside its card means. The scrim is paint and nothing else.
  return <div className="transient-scrim" data-testid="transient-scrim" aria-hidden />;
}
