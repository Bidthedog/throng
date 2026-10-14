/**
 * 054 FR-073 — when a diagram's Full Pane target goes.
 *
 * A frame unmounting says nothing about the diagram: a tab switch unmounts every panel of the tab, and the
 * Full Pane target is the tab's, so it must survive that (the remounted frame takes the layer over). The
 * target goes when the DIAGRAM is gone — the body, which knows what it drew, releases it here.
 */
import { getMaximiseStack, sectionUnmounted, tabOfMaximisePanel } from '../../workspace/maximise-store.js';

const ORDINAL = /^diagram-(\d+)$/;

/** Release `panelId`'s diagram section targets whose ordinal is `keepBelow` or more (`0` releases them all). */
export function releaseDiagramSections(panelId: string, keepBelow: number): void {
  const tabId = tabOfMaximisePanel(panelId);
  if (tabId === null) return;
  for (const target of [...getMaximiseStack(tabId)]) {
    if (target.kind !== 'section' || target.panelId !== panelId) continue;
    const ordinal = ORDINAL.exec(target.sectionId);
    if (ordinal !== null && Number(ordinal[1]) >= keepBelow) sectionUnmounted(tabId, panelId, target.sectionId);
  }
}
