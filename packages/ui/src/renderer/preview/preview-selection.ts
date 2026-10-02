/**
 * The selection a preview keeps when focus leaves it (049 US5, #457; FR-021 – FR-026, research R11).
 *
 * A document has ONE DOM selection, and clicking into another panel replaces it — so a preview that lost focus
 * lost its selection, and an unmount never saved it (Constitution XI). This controller tracks the selection of the
 * body while it is focused, as offsets into the text model preview find searches (`preview-selection-model.ts`),
 * and keeps it:
 *
 * - **focus leaves** — painted under `throng-preview-selection-inactive` through the per-panel registry, in the
 *   inactive-selection colour, so it stays visible but is plainly not the active one (FR-021, FR-024);
 * - **focus returns without a pointer-down inside** — the DOM selection is re-created from the offsets and the paint
 *   cleared, so Copy copies exactly its text (FR-023); a pointer-down inside discards it, as clicking always has;
 * - **another panel selects** — nothing here changes (FR-022);
 * - **the body redraws** — the nodes are new, so the range is rebuilt from the offsets, and dropped when the text at
 *   those offsets is no longer what was selected (FR-026: never shown over other text);
 * - **unmount** — saved in `preview-selection-store.ts`; the next view takes it on its first draw and shows it
 *   inactive until the panel takes focus (US5.7);
 * - **window move** — reported by the `previewSelection` capture and seeded by the receiving window (FR-000a).
 *
 * `selectionchange` fires on every caret move, so its handler only schedules one animation frame (Principle XII);
 * the exceptions are `focusout`, which must read the selection before it is gone, and `focusin`, which restores it.
 */
import { setPanelRanges } from './highlight-registry.js';
import { registerPanelStateCapture } from '../workspace/panel-state-capture.js';
import {
  createModelCache,
  liveRange,
  rangeOver,
  readSelection,
  type ModelCache,
} from './preview-selection-model.js';
import {
  savePreviewSelection,
  takePreviewSelection,
  type RetainedSelection,
} from './preview-selection-store.js';

export {
  clearPreviewSelection,
  peekPreviewSelection,
  seedPreviewSelection,
  type RetainedSelection,
} from './preview-selection-store.js';

/** The named highlight this feature paints; its colour is the `editorSelectionInactive` token (`find-bar.css`). */
export const PREVIEW_SELECTION_INACTIVE_HIGHLIGHT = 'throng-preview-selection-inactive';

export interface PreviewSelectionDeps {
  /** The body host to read — fresh on every call, so a redraw is always picked up. */
  host(): HTMLElement | null;
  panelId: string;
  /** The text model of the drawn body, when another controller shares it; otherwise this builds its own. */
  modelCache?: ModelCache;
  /** Test seams for the one frame; default `requestAnimationFrame` / `cancelAnimationFrame`. */
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

export interface PreviewSelection {
  /** The selection this panel holds right now — live while focused, retained while not — or `null`. */
  retained(): RetainedSelection | null;
  /** The body redrew: its text model is stale and its DOM is new. Re-validate, restore or repaint. */
  invalidate(): void;
  /** Remove the listeners and the paint, and save the selection for the next view of this panel. */
  dispose(): void;
}

export function createPreviewSelection(deps: PreviewSelectionDeps): PreviewSelection {
  const requestFrame = deps.requestFrame ?? ((cb: () => void): number => requestAnimationFrame(cb));
  const cancelFrame = deps.cancelFrame ?? ((h: number): void => cancelAnimationFrame(h));
  const models = deps.modelCache ?? createModelCache(deps.host);

  // What a previous view of this panel left, or what another window sent: held, not acted on, until the first draw
  // says what text it would be shown over.
  let retained: RetainedSelection | null = takePreviewSelection(deps.panelId) ?? null;
  let drawn = retained === null;
  /** The text under `retained` may have changed: check it at the next frame (FR-026). */
  let revalidate = false;
  /** The DOM selection belongs to nodes that are gone: put it back from the offsets at the next frame. */
  let restoreDom = false;
  let painted = false;
  let handle: number | null = null;
  let disposed = false;

  const isFocused = (host: HTMLElement): boolean => host.contains(host.ownerDocument.activeElement);

  const clearPaint = (): void => {
    if (!painted) return;
    setPanelRanges(PREVIEW_SELECTION_INACTIVE_HIGHLIGHT, deps.panelId, []);
    painted = false;
  };

  /** Read the live selection into `retained`. A body with no selection of its own keeps what it had unless `clear`. */
  const track = (host: HTMLElement, clear: boolean): void => {
    const cache = models.get();
    if (!cache) return;
    const range = liveRange(host, false);
    const sel = range ? readSelection(range, cache) : null;
    if (sel) retained = { ...sel, text: cache.model.text.slice(sel.from, sel.to) };
    else if (clear) retained = null;
  };

  /** Re-create the DOM selection from `retained`. Drops it when its offsets name nothing in the current model. */
  const restore = (host: HTMLElement): void => {
    const cache = models.get();
    if (!retained || !cache) return;
    const range = rangeOver(host, cache.model, retained.from, retained.to);
    const selection = host.ownerDocument.defaultView?.getSelection();
    if (!range || !selection) {
      retained = null;
      return;
    }
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const paintInactive = (host: HTMLElement): void => {
    const cache = models.get();
    const range = retained && cache ? rangeOver(host, cache.model, retained.from, retained.to) : null;
    if (!range) return clearPaint();
    setPanelRanges(PREVIEW_SELECTION_INACTIVE_HIGHLIGHT, deps.panelId, [range]);
    painted = true;
  };

  const frame = (): void => {
    handle = null;
    if (disposed) return;
    const host = deps.host();
    if (!host) return;
    if (retained && !drawn) return; // a saved or received selection waits for the first draw's text
    if (revalidate) {
      revalidate = false;
      const cache = models.get();
      if (retained && cache && cache.model.text.slice(retained.from, retained.to) !== retained.text) retained = null;
    }
    if (isFocused(host)) {
      if (restoreDom) restore(host);
      else track(host, true);
      restoreDom = false;
      clearPaint();
    } else {
      restoreDom = false;
      paintInactive(host);
    }
  };

  const schedule = (): void => {
    if (disposed || handle !== null) return;
    handle = requestFrame(frame);
  };

  const inside = (target: EventTarget | null): boolean => {
    const host = deps.host();
    return host !== null && target instanceof Node && host.contains(target);
  };

  const onSelectionChange = (): void => schedule();
  // The selection must be read BEFORE focus lands elsewhere and replaces it; only a selection that is there is
  // kept (an absent one is not evidence the user cleared it — another panel's click may already have taken it).
  const onFocusOut = (e: FocusEvent): void => {
    const host = deps.host();
    if (!host || !inside(e.target) || inside(e.relatedTarget)) return;
    track(host, false);
    schedule();
  };
  const onFocusIn = (e: FocusEvent): void => {
    const host = deps.host();
    if (!host || !inside(e.target)) return;
    // Focus arrived without a pointer-down inside (that discards first): Tab, a chord, a click elsewhere in the panel.
    // Restored now, and again at the frame: moving focus into a container can collapse the selection AFTER the
    // event (observed in jsdom, and the reason `preview-panel.tsx` focuses before it selects).
    if (retained && drawn) {
      restore(host);
      restoreDom = true;
    }
    clearPaint();
    schedule();
  };
  const onPointerDown = (e: Event): void => {
    if (!inside(e.target)) return;
    retained = null;
    clearPaint();
  };

  const doc = deps.host()?.ownerDocument ?? document;
  doc.addEventListener('selectionchange', onSelectionChange);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', onFocusOut);
  doc.addEventListener('pointerdown', onPointerDown, true);
  const unregisterCapture = registerPanelStateCapture(deps.panelId, 'previewSelection', () => retained ?? undefined);

  return {
    retained: () => retained,
    invalidate(): void {
      models.invalidate();
      drawn = true;
      revalidate = true;
      restoreDom = true;
      schedule();
    },
    dispose(): void {
      disposed = true;
      if (handle !== null) cancelFrame(handle);
      handle = null;
      doc.removeEventListener('selectionchange', onSelectionChange);
      doc.removeEventListener('focusin', onFocusIn);
      doc.removeEventListener('focusout', onFocusOut);
      doc.removeEventListener('pointerdown', onPointerDown, true);
      // Saved, then the live capture goes: a snapshot taken across the unmount sees one or the other.
      if (retained) savePreviewSelection(deps.panelId, retained);
      unregisterCapture();
      painted = true;
      clearPaint();
    },
  };
}
