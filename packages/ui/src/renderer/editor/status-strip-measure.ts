/**
 * The measuring half of a status bar's fit (040 FR-021 … FR-026), shared by the editor's strip and the preview's
 * bar (#637) so both give way to width by one mechanism. `status-strip-fit.ts` owns the decision; this owns only
 * the numbers it is fed: the bar's width, the never-hidden controls' width, and each segment's width in each label
 * form, read from a hidden ruler that draws every present segment in both forms.
 *
 * ══ WHAT HAPPENS WITH NO ResizeObserver ══
 *
 * The width starts at infinity, so everything renders at its full label until a measurement arrives: the right
 * default before the observer first fires, in jsdom (which has no `ResizeObserver` at all), and anywhere
 * measurement fails. A bar that starts full and tightens does not flash; one that starts empty and fills in would.
 */
import { useLayoutEffect, useState, type RefObject } from 'react';
import { labelShortens, type LabelForm, type SegmentId, type SegmentWidth } from './status-strip-fit.js';

export interface StripMeasure {
  /** The bar's content width, or `Infinity` before (or without) a measurement. */
  readonly barWidth: number;
  /** The width of the measured controls group — what the segments may never take. */
  readonly controls: number;
  /** Each segment's width in each label form, as the ruler drew it. */
  readonly widths: Partial<Record<SegmentId, SegmentWidth>>;
}

/** Whether two measurement tables agree, so an unchanged measurement causes no re-render. */
function sameWidths(a: Partial<Record<SegmentId, SegmentWidth>>, b: Partial<Record<SegmentId, SegmentWidth>>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as SegmentId[]);
  for (const key of keys) {
    if (a[key]?.full !== b[key]?.full || a[key]?.short !== b[key]?.short) return false;
  }
  return true;
}

/**
 * Observe `barRef`'s width and read `controlsRef` and the ruler's `[data-measure="<id>:<form>"]` children after every
 * render. Writes back only when something moved: the updater returns the previous value BY IDENTITY otherwise, so
 * React bails out and the measure → setState → render chain ends after one pass.
 */
export function useStripMeasure(
  barRef: RefObject<HTMLElement | null>,
  controlsRef: RefObject<HTMLElement | null>,
  rulerRef: RefObject<HTMLElement | null>,
): StripMeasure {
  const [barWidth, setBarWidth] = useState(Number.POSITIVE_INFINITY);
  const [measured, setMeasured] = useState<{ controls: number; widths: Partial<Record<SegmentId, SegmentWidth>> }>({
    controls: 0,
    widths: {},
  });

  // Every render, deliberately: the ruler's widths change with the font, the theme and the digit count, none of
  // which is expressible as a dependency. The identity bail-out above is what stops it looping.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const controls = controlsRef.current?.getBoundingClientRect().width ?? 0;
    const widths: Partial<Record<SegmentId, SegmentWidth>> = {};
    for (const el of rulerRef.current?.children ?? []) {
      const key = el.getAttribute('data-measure');
      const [id, form] = (key ?? '').split(':') as [SegmentId, LabelForm];
      if (!id || !form) continue;
      const width = el.getBoundingClientRect().width;
      // A label with no shorter form is drawn ONCE and stands for both. Taking the measured width for the missing
      // form matters: leaving it at 0 would tell the fit that `Ln 412` costs nothing at its short label.
      widths[id] = labelShortens(id) ? { ...(widths[id] ?? { full: 0, short: 0 }), [form]: width } : { full: width, short: width };
    }
    setMeasured((prev) => (prev.controls === controls && sameWidths(prev.widths, widths) ? prev : { controls, widths }));
  });

  // `contentRect` excludes padding, which is exactly what the fit's `available` wants.
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number') setBarWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
    // The ref is stable; re-observing per render would tear the observer down mid-measurement.
  }, [barRef]);

  return { barWidth, controls: measured.controls, widths: measured.widths };
}
