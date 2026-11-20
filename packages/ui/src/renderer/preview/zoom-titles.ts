/**
 * 074 (2026-11-19) — the hover titles of a preview toolbar's zoom buttons, each naming the chord that does the same
 * thing from the keyboard: Zoom in and Zoom out are the panel zoom chords. The reset chord returns the view the
 * preview opened in (`diagram-zoom.ts`): a diagram's Fit, so its chord names Fit; a picture's or a PDF's opening view
 * (FR-020a, 2026-11-20), 100% wherever it fits, so its chord names Zoom 100%.
 */
import { firstBinding, formatGrouped, type Keybindings } from '@throng/core';

/** A drawing's zoom for the status bar readout: `125%`, digit-grouped. */
export function zoomPercent(scale: number): string {
  return `${formatGrouped(Math.round(scale * 100))}%`;
}

/** `label (chord)`, or the label alone when nothing is bound. */
export function withChord(label: string, chord: string | undefined): string {
  return chord === undefined ? label : `${label} (${chord})`;
}

export interface ZoomTitles {
  zoomIn: string;
  zoomOut: string;
  actual: string;
  fit: string;
}

/** `resetTo` — which button the zoom reset chord names: Fit for a diagram, Zoom 100% for a picture or a PDF. */
export function zoomTitles(keybindings: Keybindings, fitLabel: string, resetTo: 'fit' | 'actual' = 'fit'): ZoomTitles {
  const reset = firstBinding(keybindings, 'panel.zoomReset');
  return {
    zoomIn: withChord('Zoom in', firstBinding(keybindings, 'panel.zoomIn')),
    zoomOut: withChord('Zoom out', firstBinding(keybindings, 'panel.zoomOut')),
    actual: resetTo === 'actual' ? withChord('Zoom 100%', reset) : 'Zoom 100%',
    fit: resetTo === 'fit' ? withChord(fitLabel, reset) : fitLabel,
  };
}
