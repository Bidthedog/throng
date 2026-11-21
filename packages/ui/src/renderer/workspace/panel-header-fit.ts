/**
 * Which of a panel header's controls fit its width (067 FR-069a, FR-069b).
 *
 * The title keeps a minimum share of the header, ellipsised, down to the narrowest a panel can be (FR-069b; its floor
 * is `.panel-box__title`'s `min-width` in `theme.css`). The controls give way instead, a whole control at a time:
 * Save As, then Save with its separator (FR-069a), then Back / Forward, then Split, then Focus Mode, then Destroy.
 * Each is an accelerator over the header's menu, which offers every one of them at any width, so nothing a hidden
 * control did becomes unreachable (Principle VI) — the editor status strip's way of giving way to width (040 FR-021).
 *
 * Each step is a header content width (padding excluded). They are set from the controls' drawn widths (28 px a
 * button, measured by `panel-header-narrow.e2e.ts`) so that, with the type icon and an editor's file pill beside it,
 * the title is left at least its 4em floor at every step.
 */
import { useEffect, useState, type RefObject } from 'react';

/** Below this header width Save As is hidden (FR-069a). */
export const SAVE_AS_MIN_HEADER_WIDTH = 360;
/** Below this header width Save and the separator are hidden too (FR-069a). */
export const SAVE_MIN_HEADER_WIDTH = 280;
/** Below this header width Back and Forward are hidden (FR-069b). */
export const HISTORY_MIN_HEADER_WIDTH = 240;
/** Below this header width the Split (+) control is hidden (FR-069b). */
export const SPLIT_MIN_HEADER_WIDTH = 170;
/** Below this header width the Focus Mode control is hidden (FR-069b). */
export const FOCUS_MIN_HEADER_WIDTH = 140;
/** Below this header width the Destroy (✕) control is hidden, and the title is all the header draws (FR-069b). */
export const DESTROY_MIN_HEADER_WIDTH = 110;

export interface HeaderControlsFit {
  save: boolean;
  saveAs: boolean;
  separator: boolean;
  history: boolean;
  split: boolean;
  focus: boolean;
  destroy: boolean;
}

/** Which controls fit a header `width` pixels wide. `0` means "not measured yet": all of them. */
export function headerControlsFit(width: number): HeaderControlsFit {
  const fits = (min: number): boolean => width <= 0 || width >= min;
  const save = fits(SAVE_MIN_HEADER_WIDTH);
  return {
    save,
    saveAs: fits(SAVE_AS_MIN_HEADER_WIDTH),
    separator: save,
    history: fits(HISTORY_MIN_HEADER_WIDTH),
    split: fits(SPLIT_MIN_HEADER_WIDTH),
    focus: fits(FOCUS_MIN_HEADER_WIDTH),
    destroy: fits(DESTROY_MIN_HEADER_WIDTH),
  };
}

/**
 * The content width of the panel header `anchor` sits in, kept current while it is mounted. `0` until the header has
 * been measured — before a first paint, and wherever there is no `ResizeObserver` (jsdom) — so every control shows.
 */
export function useHeaderWidth(anchor: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const header = anchor.current?.closest<HTMLElement>('.panel-box__header');
    if (!header || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const w = entries.find((e) => e.target === header)?.contentRect.width ?? entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(Math.floor(w));
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, [anchor]);
  return width;
}
